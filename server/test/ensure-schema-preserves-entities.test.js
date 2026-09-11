import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ensureSchema } from '../src/db/ensure-schema.js';

function tempDb() {
  const dir = path.join(process.cwd(), 'test-tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `schema-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  return { db: new Database(file), file };
}

function closeAndDelete({ db, file }) {
  try { db.close(); } catch {}
  try { fs.unlinkSync(file); } catch {}
}

function seedOldSchema(db) {
  // Simulate an older schema that still has the CHECK ('json','narrative') on mm_returns.
  db.exec(`
    CREATE TABLE mental_models (
      mm_id INTEGER PRIMARY KEY AUTOINCREMENT,
      mm_ext_id TEXT NOT NULL UNIQUE,
      mm_name TEXT,
      mm_source_query TEXT,
      mm_refresh_after_consolidation TEXT DEFAULT 'false',
      mm_refresh_mode TEXT DEFAULT 'full' CHECK (mm_refresh_mode IN ('full', 'delta')),
      mm_exclude_all_mental_models TEXT DEFAULT 'false',
      mm_exclude_mental_model_list TEXT,
      mm_tags_match_mode TEXT DEFAULT 'all_strict' CHECK (mm_tags_match_mode IN ('all_strict', 'any_strict', 'all', 'any', 'exact')),
      mm_is_template TEXT DEFAULT 'false',
      mm_max_tokens INTEGER DEFAULT 2048,
      mm_viewp_description TEXT,
      mm_viewp_meta JSON,
      mm_dimension TEXT,
      mm_returns TEXT DEFAULT 'narrative' CHECK (mm_returns IN ('json', 'narrative')),
      mm_concatenation TEXT DEFAULT 'compile' CHECK (mm_concatenation IN ('merge', 'compile')),
      mm_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      mm_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE mental_model_entities (
      ent_id INTEGER NOT NULL,
      mm_id INTEGER NOT NULL,
      mm_ent_refresh_mode TEXT CHECK (mm_ent_refresh_mode IN ('full', 'delta')),
      mm_ent_refresh_after_consolidation TEXT,
      mm_ent_exclude_all_mental_models TEXT,
      mm_ent_max_tokens INTEGER DEFAULT 2048,
      mm_ent_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      mm_ent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (ent_id, mm_id),
      FOREIGN KEY (ent_id) REFERENCES entities(ent_id) ON DELETE CASCADE,
      FOREIGN KEY (mm_id) REFERENCES mental_models(mm_id) ON DELETE CASCADE
    )
  `);

  // Minimal supporting tables needed by ensureSchema for a 'had schema' run.
  db.exec(`
    CREATE TABLE documents (
      doc_id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_ext_id TEXT,
      doc_title TEXT,
      doc_content TEXT,
      doc_bank_id TEXT,
      doc_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      doc_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE entities (
      ent_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ent_type_id INTEGER,
      ent_entity_id TEXT,
      ent_name TEXT,
      ent_description TEXT,
      ent_aliases JSON,
      ent_case_match TEXT DEFAULT 'insensitive',
      ent_generated_by TEXT,
      ent_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ent_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE entity_types (
      et_id INTEGER PRIMARY KEY AUTOINCREMENT,
      et_type_name TEXT,
      et_description TEXT,
      et_case_match TEXT DEFAULT 'insensitive',
      et_word_boundary_match TEXT DEFAULT 'boundaries',
      et_uses_entity_id_pattern INTEGER DEFAULT 0,
      et_id_format_prefix TEXT,
      et_min_id_digits INTEGER DEFAULT 3,
      et_id_separator TEXT,
      et_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      et_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE tags (
      tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_name TEXT,
      tag_generated_by TEXT,
      tag_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      tag_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE prompt_templates (
      pt_name TEXT PRIMARY KEY,
      pt_mode TEXT NOT NULL,
      pt_description TEXT,
      pt_body TEXT NOT NULL,
      pt_fragments JSON NOT NULL,
      pt_variables JSON NOT NULL,
      pt_examples_heuristic TEXT,
      pt_is_builtin INTEGER NOT NULL DEFAULT 0,
      pt_version TEXT,
      pt_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      pt_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    );
  `);

  // Seed the built-in templates so ensureSchema has them for FK reference.
  // Also include the contextual-graph templates that the migration expects.
  db.exec(`
    INSERT INTO prompt_templates
      (pt_name, pt_mode, pt_description, pt_body, pt_fragments, pt_variables, pt_is_builtin)
    VALUES
      ('generic', 'generic', 'Generic output.', '...', '[]', '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]', 1),
      ('sys_entity_summary', 'sys_entity_summary', 'Entity summary.', '...', '[]', '["ARCHITXT_TOPIC"]', 1),
      ('sys_entity_capabilities', 'sys_entity_capabilities', 'Entity capabilities.', '...', '[]', '["ARCHITXT_TOPIC"]', 1),
      ('sys_edge_context', 'sys_edge_context', 'Edge context.', '...', '[]', '["ARCHITXT_TOPIC"]', 1),
      ('sys_discovery_context', 'sys_discovery_context', 'Discovery context.', '...', '[]', '["ARCHITXT_TOPIC"]', 1)
  `);

  // Create a mental model with one entity linked to it.
  const mmResult = db.prepare(`
    INSERT INTO mental_models (mm_ext_id, mm_name, mm_returns)
    VALUES ('mm-test-1', 'Test Model', 'narrative')
  `).run();
  const mmId = Number(mmResult.lastInsertRowid);

  const entResult = db.prepare(`
    INSERT INTO entities (ent_entity_id, ent_name)
    VALUES ('ent-001', 'Entity One')
  `).run();
  const entId = Number(entResult.lastInsertRowid);

  db.prepare(`
    INSERT INTO mental_model_entities (ent_id, mm_id)
    VALUES (?, ?)
  `).run(entId, mmId);

  return { mmId, entId };
}

describe('ensureSchema preserves mental_model_entities across CHECK constraint removal', () => {
  it('keeps mental_model_entities rows after recreating mental_models', () => {
    const { db, file } = tempDb();
    try {
      const { mmId, entId } = seedOldSchema(db);

      // Sanity check: the junction row exists before migration.
      const before = db.prepare('SELECT COUNT(*) AS n FROM mental_model_entities WHERE mm_id = ? AND ent_id = ?').get(mmId, entId);
      assert.equal(before.n, 1);

      // Run the additive migration.
      ensureSchema(db);

      // Post-migration: the junction row must still exist.
      const after = db.prepare('SELECT COUNT(*) AS n FROM mental_model_entities WHERE mm_id = ? AND ent_id = ?').get(mmId, entId);
      assert.equal(after.n, 1, 'mental_model_entities row was lost during migration');

      // The parent model must still exist with the returns mapped to a valid template name.
      const model = db.prepare('SELECT mm_returns FROM mental_models WHERE mm_id = ?').get(mmId);
      assert.equal(model.mm_returns, 'generic');
    } finally {
      closeAndDelete({ db, file });
    }
  });
});

describe('ensureSchema backfills user template roles and validates contextual placeholders', () => {
  it('does not auto-backfill legacy user templates to avoid violating the unique role constraint', () => {
    const { db, file } = tempDb();
    try {
      seedOldSchema(db);

      // Insert a legacy user template without a role.
      db.prepare(`
        INSERT INTO mental_models (mm_ext_id, mm_name, mm_source_query, mm_is_template, mm_returns)
        VALUES ('user-template-{entity-id}', 'User Template {entity-name}', 'Query for {entity-type}', 'true', 'narrative')
      `).run();

      ensureSchema(db);

      const row = db.prepare(`
        SELECT mm_template_role, mm_ext_id FROM mental_models WHERE mm_ext_id = ?
      `).get('user-template-{entity-id}');
      assert.equal(row.mm_template_role, null);
    } finally {
      closeAndDelete({ db, file });
    }
  });

  it('replaces legacy system template rows with canonical v36 rows', () => {
    const { db, file } = tempDb();
    try {
      seedOldSchema(db);
      ensureSchema(db);

      // The system templates should have their new reserved roles.
      const rows = db.prepare(`
        SELECT mm_ext_id, mm_template_role FROM mental_models WHERE mm_is_template = 'true'
      `).all();
      const summary = rows.find((r) => r.mm_ext_id === 'entity-summary-{entity-id}');
      assert.ok(summary);
      assert.equal(summary.mm_template_role, 'sys_entity_summary');
    } finally {
      closeAndDelete({ db, file });
    }
  });

  it('replaces stale contextual-graph templates with the canonical ones', () => {
    const { db, file } = tempDb();
    try {
      seedOldSchema(db);

      // Add the role column manually so we can seed a stale template before
      // ensureSchema seeds the canonical templates and enforces uniqueness.
      db.exec(`ALTER TABLE mental_models ADD COLUMN mm_template_role TEXT`);

      // Insert a stale discover template that predates the deterministic ext_id.
      // Use a legacy returns value that the old CHECK constraint allows.
      db.prepare(`
        INSERT INTO mental_models (mm_ext_id, mm_name, mm_source_query, mm_is_template, mm_template_role, mm_returns, mm_dimension, mm_max_tokens)
        VALUES ('discover-a-com:COM-001-{batch}', 'Old discover template', 'Old query', 'true', 'sys_discovery_context', 'narrative', 'sys_discovery_context', 4096)
      `).run();

      // Re-run migration: it should delete the stale row and upsert the canonical one.
      ensureSchema(db);

      const rows = db.prepare(`
        SELECT mm_ext_id, mm_template_role FROM mental_models WHERE mm_is_template = 'true' AND mm_template_role = 'sys_discovery_context'
      `).all();
      assert.equal(rows.length, 1, 'stale discover template was not cleaned up');
      assert.equal(rows[0].mm_ext_id, 'discover-{seed-id}');
    } finally {
      closeAndDelete({ db, file });
    }
  });
});
