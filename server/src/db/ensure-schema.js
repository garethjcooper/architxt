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
        mm_refresh_after_consolidation TEXT DEFAULT 'false',
        mm_refresh_mode TEXT DEFAULT 'full',
        mm_exclude_all_mental_models TEXT DEFAULT 'false',
        mm_exclude_mental_model_list TEXT,
        mm_tags_match_mode TEXT DEFAULT 'all_strict',
        mm_is_template TEXT DEFAULT 'false',
        mm_max_tokens INTEGER DEFAULT 2048,
        mm_viewp_description TEXT,
        mm_viewp_meta JSON,
        mm_dimension TEXT,
        mm_returns TEXT DEFAULT 'narrative' CHECK (mm_returns IN ('json', 'narrative')),
        mm_concatenation TEXT DEFAULT 'compile' CHECK (mm_concatenation IN ('merge', 'compile')),
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
        mm_ent_refresh_mode TEXT,
        mm_ent_refresh_after_consolidation TEXT,
        mm_ent_exclude_all_mental_models TEXT,
        mm_ent_max_tokens INTEGER DEFAULT 2048,
        mm_ent_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        mm_ent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (ent_id, mm_id),
        FOREIGN KEY (ent_id) REFERENCES entities(ent_id) ON DELETE CASCADE,
        FOREIGN KEY (mm_id) REFERENCES mental_models(mm_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'research_steps',
      ddl: `CREATE TABLE IF NOT EXISTS research_steps (
        rstep_id INTEGER PRIMARY KEY AUTOINCREMENT,
        rs_id INTEGER NOT NULL,
        rstep_parent_step_id INTEGER,
        rstep_intent_text TEXT NOT NULL,
        rstep_selections JSON,
        rstep_action_type TEXT NOT NULL,
        rstep_parameters JSON,
        rstep_viewpoint_ids JSON,
        rstep_canvas_state JSON,
        rstep_synthesis JSON,
        rstep_tool_calls_used INTEGER DEFAULT 0,
        rstep_status TEXT,
        rstep_error_message TEXT,
        rstep_calls JSON,
        rstep_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (rs_id) REFERENCES research_sessions(rs_id) ON DELETE CASCADE,
        FOREIGN KEY (rstep_parent_step_id) REFERENCES research_steps(rstep_id) ON DELETE SET NULL
      )`
    },
    {
      name: 'research_sessions',
      ddl: `CREATE TABLE IF NOT EXISTS research_sessions (
        rs_id INTEGER PRIMARY KEY AUTOINCREMENT,
        rs_title TEXT NOT NULL,
        rs_description TEXT,
        rs_bank_id TEXT NOT NULL,
        rs_viewpoint_ids JSON NOT NULL,
        rs_status TEXT NOT NULL DEFAULT 'active',
        rs_current_step_id INTEGER,
        rs_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        rs_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (rs_current_step_id) REFERENCES research_steps(rstep_id) ON DELETE SET NULL
      )`
    },
    {
      name: 'research_session_tags',
      ddl: `CREATE TABLE IF NOT EXISTS research_session_tags (
        tag_id INTEGER NOT NULL,
        rs_id INTEGER NOT NULL,
        rs_tag_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        rs_tag_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (tag_id, rs_id),
        FOREIGN KEY (tag_id) REFERENCES tags(tag_id) ON DELETE CASCADE,
        FOREIGN KEY (rs_id) REFERENCES research_sessions(rs_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'research_artifacts',
      ddl: `CREATE TABLE IF NOT EXISTS research_artifacts (
        ra_id INTEGER PRIMARY KEY AUTOINCREMENT,
        rs_id INTEGER NOT NULL,
        ra_title TEXT NOT NULL,
        ra_description TEXT,
        ra_bank_id TEXT NOT NULL,
        ra_viewpoint_ids JSON NOT NULL,
        ra_source_step_ids JSON NOT NULL,
        ra_query_trail_snapshot JSON NOT NULL,
        ra_seam_report JSON NOT NULL,
        ra_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        ra_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (rs_id) REFERENCES research_sessions(rs_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'research_artifact_outputs',
      ddl: `CREATE TABLE IF NOT EXISTS research_artifact_outputs (
        rao_id INTEGER PRIMARY KEY AUTOINCREMENT,
        ra_id INTEGER NOT NULL,
        rao_output_type TEXT NOT NULL,
        rao_name TEXT NOT NULL,
        rao_content JSON NOT NULL,
        rao_rendered TEXT,
        rao_source_selections JSON,
        rao_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        rao_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (ra_id) REFERENCES research_artifacts(ra_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'research_tasks',
      ddl: `CREATE TABLE IF NOT EXISTS research_tasks (
        rt_id TEXT PRIMARY KEY,
        rs_id INTEGER NOT NULL,
        rstep_id INTEGER NOT NULL,
        rt_type TEXT NOT NULL,
        rt_status TEXT NOT NULL DEFAULT 'pending',
        rt_payload JSON,
        rt_result JSON,
        rt_error TEXT,
        rt_code TEXT,
        rt_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        rt_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (rs_id) REFERENCES research_sessions(rs_id) ON DELETE CASCADE,
        FOREIGN KEY (rstep_id) REFERENCES research_steps(rstep_id) ON DELETE CASCADE
      )`
    }
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

function relaxResearchStepsParentCascade(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'research_steps'").get();
  if (!tableExists) {
    return 0;
  }

  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='research_steps'").pluck().get();
  if (typeof sql !== 'string') return 0;

  const parentFkPattern = /FOREIGN\s+KEY\s*\(\s*rstep_parent_step_id\s*\)\s*REFERENCES\s+research_steps\s*\(\s*rstep_id\s*\)\s*ON\s+DELETE\s+(CASCADE|SET\s+NULL)/i;
  const match = sql.match(parentFkPattern);
  if (!match) {
    return 0;
  }

  const action = match[1].toUpperCase();
  if (action === 'SET NULL') {
    return 0;
  }

  logger.warn('Recreating research_steps with ON DELETE SET NULL for rstep_parent_step_id');

  const columns = [
    'rstep_id', 'rs_id', 'rstep_parent_step_id', 'rstep_intent_text', 'rstep_selections',
    'rstep_action_type', 'rstep_parameters', 'rstep_viewpoint_ids', 'rstep_canvas_state',
    'rstep_synthesis', 'rstep_proposed_actions', 'rstep_anchors', 'rstep_intent_tag',
    'rstep_status', 'rstep_error_message',
    'rstep_tool_calls_used', 'rstep_tool_tokens_used', 'rstep_synthesis_tokens_used',
    'rstep_truncated_by', 'rstep_created_at'
  ];
  const colList = columns.join(', ');

  try {
    db.pragma('foreign_keys = OFF');

    db.exec(`CREATE TABLE _research_steps_new (
      rstep_id INTEGER PRIMARY KEY AUTOINCREMENT,
      rs_id INTEGER NOT NULL,
      rstep_parent_step_id INTEGER,
      rstep_intent_text TEXT NOT NULL,
      rstep_selections JSON,
      rstep_action_type TEXT NOT NULL,
      rstep_parameters JSON,
      rstep_viewpoint_ids JSON,
      rstep_canvas_state JSON,
      rstep_synthesis JSON,
      rstep_status TEXT,
      rstep_error_message TEXT,
      rstep_tool_calls_used INTEGER DEFAULT 0,
      rstep_calls JSON,
      rstep_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (rs_id) REFERENCES research_sessions(rs_id) ON DELETE CASCADE,
      FOREIGN KEY (rstep_parent_step_id) REFERENCES research_steps(rstep_id) ON DELETE SET NULL
    )`);

    db.exec(`INSERT INTO _research_steps_new (${colList}) SELECT ${colList} FROM research_steps`);
    db.exec('DROP TABLE research_steps');
    db.exec('ALTER TABLE _research_steps_new RENAME TO research_steps');
    db.exec('CREATE INDEX IF NOT EXISTS idx_research_steps_session ON research_steps(rs_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_research_steps_parent ON research_steps(rstep_parent_step_id)');

    const fkCheck = db.pragma('foreign_key_check');
    if (fkCheck && fkCheck.length > 0) {
      logger.warn('Foreign key check found issues after research_steps migration', { issues: fkCheck });
    }

    logger.info('Recreated research_steps with ON DELETE SET NULL');
    return 1;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Remove restrictive CHECK constraints from mental model tables.
 * SQLite doesn't support ALTER TABLE DROP CONSTRAINT, so we recreate
 * the table(s) without the CHECKs and copy the data across.
 *
 * IMPORTANT: dropping mental_models CASCADE-deletes mental_model_tags,
 * and dropping mental_model_entities loses its rows. We save/restore
 * junction rows into temp tables before recreating the parents.
 */
function removeMentalModelCheckConstraints(db) {
  // If dependent tables are missing, we cannot safely recreate tables with FK references.
  // This can happen on partially-initialized databases; the base schema should be applied first.
  const requiredTables = ['mental_models', 'mental_model_entities', 'entities'];
  const missing = requiredTables.filter((name) => {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
    return !row;
  });
  if (missing.length > 0) {
    logger.warn('Skipping mental model CHECK constraint removal — missing dependent tables', { missing });
    return 0;
  }

  const mentalModelsInfo = {
    name: 'mental_models',
    newDdl: `CREATE TABLE mental_models_new (
      mm_id INTEGER PRIMARY KEY AUTOINCREMENT,
      mm_ext_id TEXT NOT NULL UNIQUE,
      mm_name TEXT,
      mm_source_query TEXT,
      mm_refresh_after_consolidation TEXT DEFAULT 'false',
      mm_refresh_mode TEXT DEFAULT 'full',
      mm_exclude_all_mental_models TEXT DEFAULT 'false',
      mm_exclude_mental_model_list TEXT,
      mm_tags_match_mode TEXT DEFAULT 'all_strict',
      mm_is_template TEXT DEFAULT 'false',
      mm_max_tokens INTEGER DEFAULT 2048,
      mm_dimension TEXT,
      mm_returns TEXT DEFAULT 'narrative' CHECK (mm_returns IN ('json', 'narrative')),
      mm_concatenation TEXT DEFAULT 'compile' CHECK (mm_concatenation IN ('merge', 'compile')),
      mm_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      mm_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`,
    columns: ['mm_id', 'mm_ext_id', 'mm_name', 'mm_source_query', 'mm_refresh_after_consolidation', 'mm_refresh_mode', 'mm_exclude_all_mental_models', 'mm_exclude_mental_model_list', 'mm_tags_match_mode', 'mm_is_template', 'mm_max_tokens', 'mm_dimension', 'mm_returns', 'mm_concatenation', 'mm_created_at', 'mm_updated_at']
  };

  const mentalModelEntitiesInfo = {
    name: 'mental_model_entities',
    newDdl: `CREATE TABLE mental_model_entities_new (
      ent_id INTEGER NOT NULL,
      mm_id INTEGER NOT NULL,
      mm_ent_refresh_mode TEXT,
      mm_ent_refresh_after_consolidation TEXT,
      mm_ent_exclude_all_mental_models TEXT,
      mm_ent_max_tokens INTEGER DEFAULT 2048,
      mm_ent_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      mm_ent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (ent_id, mm_id),
      FOREIGN KEY (ent_id) REFERENCES entities(ent_id) ON DELETE CASCADE,
      FOREIGN KEY (mm_id) REFERENCES mental_models(mm_id) ON DELETE CASCADE
    )`,
    columns: ['ent_id', 'mm_id', 'mm_ent_refresh_mode', 'mm_ent_refresh_after_consolidation', 'mm_ent_exclude_all_mental_models', 'mm_ent_max_tokens', 'mm_ent_created_at', 'mm_ent_updated_at']
  };

  function tableHasConstraint(name) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
    if (!exists) return false;

    const tableInfo = db.prepare(`PRAGMA table_info(${name})`).all();
    if (!tableInfo.length) return false;

    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").pluck().get(name);
    if (typeof sql !== 'string') return false;

    return ['mm_refresh_mode', 'mm_tags_match_mode', 'mm_ent_refresh_mode'].some((colName) => {
      const checkPattern = new RegExp(`CHECK\\s*\\(\\s*${colName}\\s+IN`, 'i');
      return checkPattern.test(sql);
    });
  }

  const needsModels = tableHasConstraint(mentalModelsInfo.name);
  const needsEntities = tableHasConstraint(mentalModelEntitiesInfo.name);

  if (!needsModels && !needsEntities) {
    logger.info('No CHECK constraints to remove from mental model tables');
    return 0;
  }

  // Clean up any stale tables left behind by a previous interrupted migration.
  db.exec(`DROP TABLE IF EXISTS mental_models_new`);
  db.exec(`DROP TABLE IF EXISTS mental_model_entities_new`);
  db.exec(`DROP TABLE IF EXISTS _temp_mm_tags`);
  db.exec(`DROP TABLE IF EXISTS _temp_mm_entities`);

  // Save junction rows BEFORE dropping the parent table so CASCADE doesn't delete them.
  if (needsModels) {
    logger.warn('Saving mental_model_tags before recreating mental_models');
    db.exec(`DROP TABLE IF EXISTS _temp_mm_tags`);
    db.exec(`CREATE TABLE _temp_mm_tags AS SELECT * FROM mental_model_tags`);
  }

  if (needsEntities) {
    logger.warn('Saving mental_model_entities before recreating mental_model_entities');
    db.exec(`DROP TABLE IF EXISTS _temp_mm_entities`);
    db.exec(`CREATE TABLE _temp_mm_entities AS SELECT * FROM mental_model_entities`);
  }

  let migrated = 0;

  for (const { name, newDdl, columns } of [mentalModelsInfo, mentalModelEntitiesInfo]) {
    if (!tableHasConstraint(name)) {
      logger.info(`No CHECK constraints to remove from ${name}`);
      continue;
    }

    logger.warn(`Recreating ${name} without CHECK constraints`);
    db.exec(newDdl);
    const colList = columns.join(', ');
    db.exec(`INSERT INTO ${name}_new (${colList}) SELECT ${colList} FROM ${name}`);
    db.exec(`DROP TABLE ${name}`);
    db.exec(`ALTER TABLE ${name}_new RENAME TO ${name}`);
    migrated++;
    logger.info(`Recreated ${name} without CHECK constraints`);
  }

  // Restore saved junction rows now that both parent tables exist.
  if (needsModels) {
    logger.warn('Restoring mental_model_tags');
    db.exec(`INSERT INTO mental_model_tags (tag_id, mm_id, mm_tag_created_at, mm_tag_updated_at)
             SELECT tag_id, mm_id, mm_tag_created_at, mm_tag_updated_at FROM _temp_mm_tags`);
    db.exec(`DROP TABLE _temp_mm_tags`);
  }

  if (needsEntities) {
    logger.warn('Restoring mental_model_entities');
    db.exec(`INSERT INTO mental_model_entities (ent_id, mm_id, mm_ent_refresh_mode, mm_ent_refresh_after_consolidation, mm_ent_exclude_all_mental_models, mm_ent_max_tokens, mm_ent_created_at, mm_ent_updated_at)
             SELECT ent_id, mm_id, mm_ent_refresh_mode, mm_ent_refresh_after_consolidation, mm_ent_exclude_all_mental_models, mm_ent_max_tokens, mm_ent_created_at, mm_ent_updated_at FROM _temp_mm_entities`);
    db.exec(`DROP TABLE _temp_mm_entities`);
  }

  return migrated;
}
function ensureMissingColumns(db) {
  const migrations = [
    {
      table: 'pending_operations',
      columns: [
        {
          name: 'pop_rs_id',
          ddl: 'ALTER TABLE pending_operations ADD COLUMN pop_rs_id INTEGER'
        },
        {
          name: 'pop_rstep_id',
          ddl: 'ALTER TABLE pending_operations ADD COLUMN pop_rstep_id INTEGER'
        }
      ]
    },
    {
      table: 'research_steps',
      columns: [
        {
          name: 'rstep_status',
          ddl: "ALTER TABLE research_steps ADD COLUMN rstep_status TEXT DEFAULT 'running'"
        },
        {
          name: 'rstep_error_message',
          ddl: 'ALTER TABLE research_steps ADD COLUMN rstep_error_message TEXT'
        },
        {
          name: 'rstep_calls',
          ddl: 'ALTER TABLE research_steps ADD COLUMN rstep_calls JSON'
        }
      ]
    },
    {
      table: 'mental_models',
      columns: [
        {
          name: 'mm_tags_match_mode',
          ddl: "ALTER TABLE mental_models ADD COLUMN mm_tags_match_mode TEXT DEFAULT 'all_strict'"
        },
        {
          name: 'mm_max_tokens',
          ddl: 'ALTER TABLE mental_models ADD COLUMN mm_max_tokens INTEGER DEFAULT 2048'
        },
        {
          name: 'mm_viewp_description',
          ddl: 'ALTER TABLE mental_models ADD COLUMN mm_viewp_description TEXT'
        },
        {
          name: 'mm_viewp_meta',
          ddl: 'ALTER TABLE mental_models ADD COLUMN mm_viewp_meta JSON'
        },
        {
          name: 'mm_dimension',
          ddl: 'ALTER TABLE mental_models ADD COLUMN mm_dimension TEXT'
        },
        {
          name: 'mm_returns',
          ddl: "ALTER TABLE mental_models ADD COLUMN mm_returns TEXT DEFAULT 'narrative' CHECK (mm_returns IN ('json', 'narrative'))"
        },
        {
          name: 'mm_concatenation',
          ddl: "ALTER TABLE mental_models ADD COLUMN mm_concatenation TEXT DEFAULT 'compile' CHECK (mm_concatenation IN ('merge', 'compile'))"
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
    const removed = removeMentalModelCheckConstraints(db);
    const relaxed = relaxResearchStepsParentCascade(db);
    const ftsCreated = ensureDocumentsFts(db);
    if (created > 0 || added > 0 || removed > 0 || relaxed > 0 || ftsCreated) {
      logger.info(`Additive migration complete — ${created} new table(s), ${added} new column(s), ${removed} CHECK constraint(s) removed, ${relaxed} FK action(s) relaxed, FTS table created: ${ftsCreated}`);
    } else {
      logger.info('Database schema already present — no missing tables or columns');
    }
    return created > 0 || added > 0 || removed > 0 || relaxed > 0 || ftsCreated;
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
