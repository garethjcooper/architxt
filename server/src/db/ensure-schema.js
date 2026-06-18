import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import { resetSeedData } from './ensure-seed.js';

const logger = createLogger('schema');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const schemaPath = path.join(rootDir, 'sql', 'architxt_db_schema_ddl.sql');

/**
 * Detect whether the database already has schema by checking
 * for a known core table (documents).
 */
function hasSchema(db) {
  try {
    const stmt = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='documents'`);
    const row = stmt.get();
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Apply individual CREATE TABLE statements for new tables if they are missing.
 * This is the additive migration path for existing databases.
 */
function ensureMissingTables(db) {
  const tablesToCreate = [
    {
      name: 'mental_models',
      ddl: `CREATE TABLE IF NOT EXISTS mental_models (
        mm_id INTEGER PRIMARY KEY AUTOINCREMENT,
        mm_ext_id TEXT NOT NULL UNIQUE,
        mm_name TEXT,
        mm_source_query TEXT,
        mm_refresh_after_consolidation TEXT DEFAULT 'false' CHECK (mm_refresh_after_consolidation IN ('true', 'false')),
        mm_refresh_mode TEXT DEFAULT 'full' CHECK (mm_refresh_mode IN ('full', 'delta')),
        mm_exclude_all_mental_models TEXT DEFAULT 'false' CHECK (mm_exclude_all_mental_models IN ('true', 'false')),
        mm_exclude_mental_model_list TEXT,
        mm_tags_match_mode TEXT DEFAULT 'all_strict' CHECK (mm_tags_match_mode IN ('all_strict', 'any_strict','all','any')),
        mm_is_template TEXT DEFAULT 'false' CHECK (mm_is_template IN ('true', 'false')),
        mm_max_tokens INTEGER DEFAULT 2048,
        mm_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        mm_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`
    },
    {
      name: 'mental_model_tags',
      ddl: `CREATE TABLE IF NOT EXISTS mental_model_tags (
        tag_id INTEGER NOT NULL,
        mm_id INTEGER NOT NULL,
        mm_tag_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        mm_tag_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (tag_id, mm_id),
        FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE,
        FOREIGN KEY (mm_id) REFERENCES mental_models(mm_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'mental_model_entities',
      ddl: `CREATE TABLE IF NOT EXISTS mental_model_entities (
        ent_id INTEGER NOT NULL,
        mm_id INTEGER NOT NULL,
        mm_ent_refresh_mode TEXT CHECK (mm_ent_refresh_mode IN ('full', 'delta')),
        mm_ent_refresh_after_consolidation TEXT CHECK (mm_ent_refresh_after_consolidation IN ('true', 'false')),
        mm_ent_exclude_all_mental_models TEXT CHECK (mm_ent_exclude_all_mental_models IN ('true', 'false')),
        mm_ent_max_tokens INTEGER DEFAULT 2048,
        mm_ent_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        mm_ent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (ent_id, mm_id),
        FOREIGN KEY (ent_id) REFERENCES entities(ent_id) ON DELETE CASCADE,
        FOREIGN KEY (mm_id) REFERENCES mental_models(mm_id) ON DELETE CASCADE
      )`
    },
  ];

  let createdCount = 0;
  for (const { name, ddl } of tablesToCreate) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
    if (!exists) {
      db.exec(ddl);
      logger.info(`Created missing table: ${name}`);
      createdCount++;
    }
  }
  return createdCount;
}

/**
 * Apply individual ADD COLUMN migrations for existing tables.
 * SQLite supports ALTER TABLE ADD COLUMN, but only for non-constraint-heavy
 * additions. Defaults and type-only constraints are safe.
 */
function ensureMissingColumns(db) {
  const migrations = [
    {
      table: 'mental_models',
      columns: [
        {
          name: 'mm_tags_match_mode',
          ddl: "ALTER TABLE mental_models ADD COLUMN mm_tags_match_mode TEXT DEFAULT 'all_strict' CHECK (mm_tags_match_mode IN ('all_strict', 'any_strict','all','any'))"
        },
        {
          name: 'mm_max_tokens',
          ddl: 'ALTER TABLE mental_models ADD COLUMN mm_max_tokens INTEGER DEFAULT 2048'
        }
      ]
    },
    {
      table: 'mental_model_entities',
      columns: [
        {
          name: 'mm_ent_max_tokens',
          ddl: 'ALTER TABLE mental_model_entities ADD COLUMN mm_ent_max_tokens INTEGER DEFAULT 2048'
        }
      ]
    }
  ];

  const existingColumns = (table) => {
    return new Set(
      db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
    );
  };

  let addedCount = 0;
  for (const { table, columns } of migrations) {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
    if (!tableExists) continue;

    const cols = existingColumns(table);
    for (const { name, ddl } of columns) {
      if (!cols.has(name)) {
        db.exec(ddl);
        logger.info(`Added missing column: ${table}.${name}`);
        addedCount++;
      }
    }
  }
  return addedCount;
}

/**
 * Ensure the FTS5 virtual table for documents exists and is backfilled.
 * This is an additive migration for existing databases.
 *
 * Important: we intentionally recreate the table on every migration run.
 * FTS5 has no ALTER VIRTUAL TABLE, and we need to guarantee the tokenizer
 * (unicode61 with hyphen/underscore as token chars) matches the code's
 * MATCH expectations. Dropping and rebuilding only loses the derived index,
 * not any source data.
 */
function ensureDocumentsFts(db) {
  const exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get('documents_fts');

  if (exists) {
    logger.info('Recreating documents_fts FTS5 virtual table to ensure tokenizer is current');
    db.exec('DROP TABLE IF EXISTS documents_fts');
  }

  logger.info('Creating documents_fts FTS5 virtual table');
  db.exec(`
    CREATE VIRTUAL TABLE documents_fts USING fts5(
      doc_content,
      content='documents',
      content_rowid='doc_id',
      tokenize="unicode61 tokenchars '-_:'"
    )
  `);

  const docCount = db.prepare('SELECT COUNT(*) AS c FROM documents').get().c;
  if (docCount > 0) {
    logger.info(`Backfilling documents_fts with ${docCount} documents`);
    db.exec(`
      INSERT INTO documents_fts(rowid, doc_content)
      SELECT doc_id, doc_content FROM documents
    `);
  }

  logger.info('documents_fts ready');
  return true;
}

/**
 * Apply the DDL schema to a fresh database.
 * Called automatically by db/connection.js when no tables exist.
 */
export function ensureSchema(db) {
  const hadSchema = hasSchema(db);

  if (hadSchema) {
    const created = ensureMissingTables(db);
    const added = ensureMissingColumns(db);
    const ftsCreated = ensureDocumentsFts(db);
    if (created > 0 || added > 0 || ftsCreated) {
      logger.info(`Additive migration complete — ${created} new table(s), ${added} new column(s), FTS table created: ${ftsCreated}`);
    } else {
      logger.info('Database schema already present — no missing tables or columns');
    }
    return created > 0 || added > 0 || ftsCreated;
  }

  if (!fs.existsSync(schemaPath)) {
    logger.error(`Schema file not found: ${schemaPath}`);
    throw new Error(`Missing schema file: ${schemaPath}`);
  }

  logger.info('Fresh database detected — applying schema ...');

  const schema = fs.readFileSync(schemaPath, 'utf8');

  // Remove PRAGMA lines that are already set by connection.js
  // (WAL mode and foreign_keys are handled there)
  const cleaned = schema
    .replace(/PRAGMA\s+foreign_keys\s*=\s*ON;?\s*/gi, '')
    .replace(/PRAGMA\s+journal_mode\s*=\s*WAL;?\s*/gi, '');

  db.exec(cleaned);
  logger.info('Schema applied successfully');
  return true;
}

/**
 * Destructive reset: drop and recreate schema.
 * Used by `npm run db:reset` or explicit init-db --force.
 */
export function resetSchema(db) {
  logger.warn('Resetting database schema — ALL DATA WILL BE LOST');

  // Get all user tables
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).all();

  // Drop tables in reverse dependency order (SQLite doesn't support DROP CASCADE)
  for (const { name } of tables.reverse()) {
    db.exec(`DROP TABLE IF EXISTS ${name}`);
    logger.debug(`Dropped table: ${name}`);
  }

  // Re-apply schema
  ensureSchema(db);

  // Re-apply seed data after reset
  resetSeedData(db);

  logger.info('Database reset complete');
  return true;
}
