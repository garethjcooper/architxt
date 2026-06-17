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
        mm_is_template TEXT DEFAULT 'false' CHECK (mm_is_template IN ('true', 'false')),
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
 * Apply the DDL schema to a fresh database.
 * Called automatically by db/connection.js when no tables exist.
 */
export function ensureSchema(db) {
  const hadSchema = hasSchema(db);
  const created = ensureMissingTables(db);

  if (hadSchema) {
    if (created > 0) {
      logger.info(`Additive migration complete — ${created} new table(s) created`);
    } else {
      logger.info('Database schema already present — no missing tables');
    }
    return created > 0;
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
