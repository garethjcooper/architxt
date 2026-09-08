import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stmt } from '../cache.js';
import { createLogger } from '../utils/logger.js';
import { createFtsIndex } from '../services/search/full-text.js';
import { resetSeedData } from './ensure-seed.js';
import { getTagByName, createTag } from './crud/tags.js';

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
      mm_template_role TEXT,
      mm_max_tokens INTEGER DEFAULT 2048,
      mm_viewp_description TEXT,
      mm_viewp_meta JSON,
      mm_dimension TEXT,
      mm_returns TEXT,
      mm_concatenation TEXT,
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
        rstep_raw_query TEXT,
        rstep_selections JSON,
        rstep_action_type TEXT NOT NULL,
        rstep_parameters JSON,
        rstep_viewpoint_ids JSON,
        rstep_envelope JSON,
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
        rs_server_id INTEGER,
        rs_bank_id TEXT NOT NULL,
        rs_viewpoint_ids JSON NOT NULL,
        rs_scope_entity_ids JSON,
        rs_status TEXT NOT NULL DEFAULT 'active',
        rs_current_step_id INTEGER,
        rs_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        rs_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (rs_server_id) REFERENCES servers(svr_id) ON DELETE SET NULL,
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
    },
    {
      name: 'prompt_templates',
      ddl: `CREATE TABLE IF NOT EXISTS prompt_templates (
        pt_name TEXT PRIMARY KEY,
        pt_mode TEXT NOT NULL,
        pt_description TEXT,
        pt_body TEXT NOT NULL,
        pt_fragments JSON NOT NULL,
        pt_variables JSON NOT NULL,
        pt_examples_heuristic TEXT,
        pt_is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (pt_is_builtin IN (0, 1)),
        pt_version TEXT,
        pt_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        pt_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`
    },
    {
      name: 'contextual_graph_nodes',
      ddl: `CREATE TABLE IF NOT EXISTS contextual_graph_nodes (
        cgn_id TEXT NOT NULL,
        cgn_server_id INTEGER NOT NULL,
        cgn_bank_id TEXT NOT NULL,
        cgn_labels TEXT NOT NULL,
        cgn_properties TEXT NOT NULL,
        cgn_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        cgn_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (cgn_server_id, cgn_bank_id, cgn_id),
        FOREIGN KEY (cgn_server_id) REFERENCES servers(svr_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'contextual_graph_edges',
      ddl: `CREATE TABLE IF NOT EXISTS contextual_graph_edges (
        cge_id TEXT NOT NULL,
        cge_server_id INTEGER NOT NULL,
        cge_bank_id TEXT NOT NULL,
        cge_source_id TEXT NOT NULL,
        cge_target_id TEXT NOT NULL,
        cge_type TEXT,
        cge_properties TEXT NOT NULL,
        cge_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        cge_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        PRIMARY KEY (cge_server_id, cge_bank_id, cge_id),
        FOREIGN KEY (cge_server_id) REFERENCES servers(svr_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'contextual_graph_jobs',
      ddl: `CREATE TABLE IF NOT EXISTS contextual_graph_jobs (
        cgj_id TEXT PRIMARY KEY,
        cgj_server_id INTEGER NOT NULL,
        cgj_bank_id TEXT NOT NULL,
        cgj_status TEXT NOT NULL DEFAULT 'pending' CHECK (cgj_status IN ('pending','running','completed','failed','cancelled')),
        cgj_stages JSON NOT NULL DEFAULT '[]',
        cgj_logs JSON NOT NULL DEFAULT '[]',
        cgj_options JSON,
        cgj_stats JSON,
        cgj_error_message TEXT,
        cgj_error_code TEXT,
        cgj_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        cgj_started_at TIMESTAMP,
        cgj_finished_at TIMESTAMP,
        cgj_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (cgj_server_id) REFERENCES servers(svr_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'contextual_graph_job_logs',
      ddl: `CREATE TABLE IF NOT EXISTS contextual_graph_job_logs (
        cgjl_id INTEGER PRIMARY KEY AUTOINCREMENT,
        cgj_id TEXT NOT NULL,
        cgjl_stage TEXT,
        cgjl_level TEXT NOT NULL CHECK (cgjl_level IN ('info','warn','error')),
        cgjl_message TEXT NOT NULL,
        cgjl_details JSON,
        cgjl_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (cgj_id) REFERENCES contextual_graph_jobs(cgj_id) ON DELETE CASCADE
      )`
    },
    {
      name: 'template_roles',
      ddl: `CREATE TABLE IF NOT EXISTS template_roles (
        tr_role_id TEXT PRIMARY KEY,
        tr_display_name TEXT NOT NULL,
        tr_derivation_scope TEXT NOT NULL,
        tr_sort_order INTEGER,
        tr_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        tr_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

/**
 * Ensure the built-in prompt templates required by v0.3.5 exist in prompt_templates.
 * Runs after seed data and is idempotent via INSERT OR IGNORE.
 */
const BUILTIN_TEMPLATES = [
  {
    name: 'generic',
    mode: 'generic',
    description: 'Universal template. Returns narrative + graph + tables + diagrams based on user directives.',
    body: `Produce output for the topic below according to the Section rules. Do not write narrative prose unless the narrative section is active.\n\n## Topic\n\n{{ARCHITXT_TOPIC}}\n\n## Source material\n\n{{ARCHITXT_CORPUS}}`,
    fragments: '["contextual-patch.md","section-focus.md"]',
    variables: '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS","ARCHITXT_DIAGRAM_FOCUS"]',
    examplesHeuristic: null,
  },
  {
    name: 'sys_entity_summary',
    mode: 'sys_entity_summary',
    description: 'System template: concise evidence-backed summary for one contextual-graph node.',
    body: `Answer the topic below.

## Topic

{{ARCHITXT_TOPIC}}

## Source material

{{ARCHITXT_CORPUS}}`,
    fragments: '["contextual-patch.md","section-focus.md"]',
    variables: '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]',
    examplesHeuristic: null,
  },
  {
    name: 'sys_entity_capabilities',
    mode: 'sys_entity_capabilities',
    description: 'System template: capabilities table for one contextual-graph node.',
    body: `Answer the topic below.

## Topic

{{ARCHITXT_TOPIC}}

## Source material

{{ARCHITXT_CORPUS}}`,
    fragments: '["contextual-patch.md","section-focus.md"]',
    variables: '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]',
    examplesHeuristic: null,
  },
  {
    name: 'sys_edge_context',
    mode: 'sys_edge_context',
    description: 'System template: directed interactions between two specific contextual-graph nodes.',
    body: `Answer the topic below.

## Topic

{{ARCHITXT_TOPIC}}

## Source material

{{ARCHITXT_CORPUS}}`,
    fragments: '["contextual-patch.md","section-focus.md","edge-vocabulary.md","entity-id-format.md","provenance-rules.md"]',
    variables: '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]',
    examplesHeuristic: null,
  },
  {
    name: 'sys_discovery_context',
    mode: 'sys_discovery_context',
    description: 'System template: suggest new contextual-graph nodes and edges around a seed node.',
    body: `Answer the topic below.

## Topic

{{ARCHITXT_TOPIC}}

## Source material

{{ARCHITXT_CORPUS}}`,
    fragments: '["contextual-patch.md","section-focus.md","edge-vocabulary.md","node-discovery-policy-known.md","entity-id-format.md","provenance-rules.md"]',
    variables: '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]',
    examplesHeuristic: null,
  },
];

function ensureBuiltinPromptTemplates(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'prompt_templates'").get();
  if (!tableExists) return 0;

  const existingRows = db.prepare('SELECT pt_name, pt_is_builtin FROM prompt_templates').all();
  const existingByName = new Map(existingRows.map((r) => [r.pt_name, r.pt_is_builtin]));

  // Coerce any row that uses a built-in name to the official built-in definition.
  // This handles seed-data or user rows that were inserted with pt_is_builtin = 0.
  let coerced = 0;
  const coerce = db.prepare(`
    UPDATE prompt_templates
    SET pt_is_builtin = 1,
        pt_mode = ?,
        pt_description = ?,
        pt_body = ?,
        pt_fragments = ?,
        pt_variables = ?,
        pt_examples_heuristic = ?
    WHERE pt_name = ?
  `);
  for (const t of BUILTIN_TEMPLATES) {
    if (existingByName.get(t.name) !== 1) {
      try {
        const result = coerce.run(
          t.mode,
          t.description,
          t.body,
          t.fragments,
          t.variables,
          t.examplesHeuristic ?? null,
          t.name
        );
        coerced += result.changes;
      } catch (err) {
        logger.error('Failed to coerce built-in prompt template', { name: t.name, mode: t.mode, error: err.message });
      }
    }
  }

  const missing = BUILTIN_TEMPLATES.filter((t) => !existingByName.has(t.name));

  let seeded = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO prompt_templates
      (pt_name, pt_mode, pt_description, pt_body, pt_fragments, pt_variables, pt_examples_heuristic, pt_is_builtin)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const t of missing) {
    try {
      const result = insert.run(t.name, t.mode, t.description, t.body, t.fragments, t.variables, t.examplesHeuristic);
      seeded += result.changes;
    } catch (err) {
      logger.error('Failed to insert built-in prompt template', { name: t.name, mode: t.mode, error: err.message });
    }
  }

  // Patch existing built-ins so canonical body, fragments, variables and metadata stay current.
  let patched = 0;
  const update = db.prepare(`
    UPDATE prompt_templates
    SET pt_mode = ?,
        pt_description = ?,
        pt_body = ?,
        pt_fragments = ?,
        pt_variables = ?,
        pt_examples_heuristic = ?
    WHERE pt_name = ?
      AND pt_is_builtin = 1
      AND (pt_mode != ? OR pt_description != ? OR pt_body != ? OR pt_fragments != ? OR pt_variables != ? OR IFNULL(pt_examples_heuristic, '') != IFNULL(?, ''))
  `);
  for (const t of BUILTIN_TEMPLATES) {
    const heuristic = t.examplesHeuristic ?? null;
    const result = update.run(
      t.mode,
      t.description,
      t.body,
      t.fragments,
      t.variables,
      heuristic,
      t.name,
      t.mode,
      t.description,
      t.body,
      t.fragments,
      t.variables,
      heuristic
    );
    patched += result.changes;
  }

  if (missing.length === 0 && coerced === 0 && patched === 0) {
    logger.info('Built-in prompt templates already present', {
      total: existingRows.length,
      builtin: existingRows.filter((r) => r.pt_is_builtin === 1).length,
    });
    return 0;
  }

  logger.info('Ensured built-in prompt templates', {
    missing: missing.length,
    inserted: seeded,
    coerced,
    patched,
    names: missing.map((t) => t.name),
  });

  if (patched > 0) {
    logger.info(`Patched ${patched} built-in prompt template(s)`);
  }

  return seeded + coerced + patched;
}

/**
 * Seed system template roles for contextual-graph mental models.
 * Idempotent: inserts missing roles and updates labels/scopes/sort order when
 * rows already exist. User-created roles are never modified.
 */
function ensureTemplateRoles(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'template_roles'").get();
  if (!tableExists) return 0;

  const roles = [
    { role_id: 'sys_entity_summary', display_name: 'Entity summary', derivation_scope: 'node', sort_order: 1 },
    { role_id: 'sys_entity_capabilities', display_name: 'Entity capabilities', derivation_scope: 'node', sort_order: 2 },
    { role_id: 'sys_edge_context', display_name: 'Edge context', derivation_scope: 'edge', sort_order: 3 },
    { role_id: 'sys_discovery_context', display_name: 'Discovery', derivation_scope: 'seed', sort_order: 4 },
    { role_id: 'user_entity_derived', display_name: 'User entity derived', derivation_scope: 'node', sort_order: 5 },
  ];

  const upsert = db.prepare(`
    INSERT INTO template_roles (tr_role_id, tr_display_name, tr_derivation_scope, tr_sort_order)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(tr_role_id) DO UPDATE SET
      tr_display_name = excluded.tr_display_name,
      tr_derivation_scope = excluded.tr_derivation_scope,
      tr_sort_order = excluded.tr_sort_order
  `);

  let seeded = 0;
  for (const r of roles) {
    const result = upsert.run(r.role_id, r.display_name, r.derivation_scope, r.sort_order);
    if (result.changes > 0) seeded++;
  }

  if (seeded > 0) {
    logger.info('Ensured template roles', { seeded, roles: roles.map((r) => r.role_id) });
  }
  return seeded;
}

/**
 * Backfill legacy template_roles rows that were created before the timestamp
 * columns existed. Uses the migration epoch for rows that still carry the
 * placeholder default value.
 */
function backfillTemplateRoleTimestamps(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='template_roles'").get();
  if (!tableExists) return 0;

  const cols = new Set(db.prepare("PRAGMA table_info(template_roles)").all().map((r) => r.name));
  if (!cols.has('tr_created_at') || !cols.has('tr_updated_at')) return 0;

  const result = db.prepare(`
    UPDATE template_roles
    SET tr_created_at = CURRENT_TIMESTAMP, tr_updated_at = CURRENT_TIMESTAMP
    WHERE tr_created_at = '1970-01-01T00:00:00Z' OR tr_updated_at = '1970-01-01T00:00:00Z'
  `).run();
  if (result.changes > 0) {
    logger.info(`Backfilled ${result.changes} template role timestamp(s)`);
  }
  return result.changes;
}

/**
 * System-owned contextual-graph mental-model templates.
 *
 * These rows are identified by mm_template_role, not by tags. They are never
 * derived from mental_model_entities; add-context renders instances from the
 * working graph and pushes them directly to Hindsight.
 */
export const CONTEXTUAL_GRAPH_TEMPLATES = [
  {
    extId: 'entity-summary-{entity-id}',
    name: 'Entity summary: {entity-name}',
    role: 'sys_entity_summary',
    sourceQuery: `[[{entity-name} ({entity-id})]].
#narrative
Describe its core architectural role, responsibilities, and relationships to other components.
#end`,
    maxTokens: 8192,
    refreshMode: 'full',
    refreshAfterConsolidation: 'false',
    excludeAllMentalModels: 'true',
    tagsMatchMode: 'any',
  },
  {
    extId: 'entity-capabilities-{entity-id}',
    name: 'Entity capabilities: {entity-name}',
    role: 'sys_entity_capabilities',
    sourceQuery: `[[{entity-name} ({entity-id})]].
#table
#table-name Capabilities
Return the major architectural capabilities of the entity in a table with columns: name, responsibility, purpose, business_capability_mapping, evidence.
- name: the capability name.
- responsibility: what the entity does for this capability.
- purpose: why the capability matters.
- business_capability_mapping: the business domain this capability belongs to.
- evidence: array of Hindsight memory IDs supporting this capability.
List its major capabilities, each with its purpose, responsibility, business capability mapping, and evidence.
#end`,
    maxTokens: 8192,
    refreshMode: 'full',
    refreshAfterConsolidation: 'false',
    excludeAllMentalModels: 'true',
    tagsMatchMode: 'any',
  },
  {
    extId: 'edge-ctx-{source-id}|{target-id}',
    name: 'Edge context: {source-name} ↔ {target-name}',
    role: 'sys_edge_context',
    sourceQuery: `What are the flows (APIs, data, files, interface calls, events, or dependencies) between [[{source-name} ({source-id})]] and [[{target-name} ({target-id})]]?
#graph
For each flow, describe what is transferred, how it is transferred, how often, any known intermediaries, and any known reliability behavior. The endpoints are supplied above with their exact node ids; reuse those exact ids for from/to. Only use a bare lowercase slug for endpoints that are genuinely new and not listed above.
#end`,
    maxTokens: 8192,
    refreshMode: 'full',
    refreshAfterConsolidation: 'false',
    excludeAllMentalModels: 'true',
    tagsMatchMode: 'any',
  },
  {
    extId: 'discover-{seed-id}',
    name: 'Discover around {seed-name}',
    role: 'sys_discovery_context',
    sourceQuery: 'Seed entity: {seed-id} ({seed-name}).\n#graph\nSuggest candidate related components, systems, or entities that interact with or are adjacent to this seed, and describe how they connect. Candidates should use the same node id as the seed for any known neighbor; only use a bare lowercase slug for genuinely new candidates.\n#end',
    maxTokens: 8192,
    refreshMode: 'full',
    refreshAfterConsolidation: 'false',
    excludeAllMentalModels: 'true',
    tagsMatchMode: 'any',
  },
];

function migrateLegacyIdPlaceholder(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'mental_models'").get();
  if (!tableExists) return 0;

  // Rename the old bare {id} placeholder to the canonical {entity-id} across
  // all templated mental-model fields. This unifies user/system/custom
  // templates with the shared substitution vocabulary.
  const cols = ['mm_ext_id', 'mm_name', 'mm_source_query'];
  let migrated = 0;
  for (const col of cols) {
    const update = db.prepare(`
      UPDATE mental_models
      SET ${col} = REPLACE(${col}, '{id}', '{entity-id}')
      WHERE ${col} LIKE '%{id}%'
    `);
    const result = update.run();
    migrated += result.changes;
  }
  if (migrated > 0) {
    logger.info(`Migrated ${migrated} mental-model field(s) from {id} to {entity-id}`);
  }
  return migrated;
}

function ensureContextualGraphTemplates(db) {
  const mmTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'mental_models'").get();
  const ptTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'prompt_templates'").get();
  if (!mmTableExists || !ptTableExists) return 0;

  const existing = db.prepare('SELECT mm_ext_id, mm_template_role FROM mental_models WHERE mm_is_template = ?').all('true');
  const existingRoles = new Set(existing.map((r) => r.mm_template_role));

  // Delete stale contextual-graph template rows whose role is one of ours but
  // whose ext_id no longer matches the canonical shape. This prevents old
  // deployed templates (e.g. discover-*-{batch}) from shadowing the new ones.
  let deleted = 0;
  const deleteStale = db.prepare(`
    DELETE FROM mental_models
    WHERE mm_is_template = ?
      AND mm_template_role = ?
      AND mm_ext_id != ?
  `);
  for (const t of CONTEXTUAL_GRAPH_TEMPLATES) {
    const result = deleteStale.run('true', t.role, t.extId);
    deleted += result.changes;
  }

  // Delete deprecated contextual-graph roles that are no longer canonical
  // (e.g. sys_entity_context was replaced by sys_entity_summary).
  const deprecatedRoles = ['sys_entity_context'];
  if (deprecatedRoles.length > 0) {
    const deleteDeprecated = db.prepare(`
      DELETE FROM mental_models
      WHERE mm_is_template = ?
        AND mm_template_role IN (${deprecatedRoles.map(() => '?').join(',')})
    `);
    const deprecatedResult = deleteDeprecated.run('true', ...deprecatedRoles);
    deleted += deprecatedResult.changes;
  }

  let seeded = 0;
  const insertIfMissing = db.prepare(`
    INSERT OR IGNORE INTO mental_models (mm_ext_id, mm_name, mm_source_query, mm_is_template, mm_template_role, mm_max_tokens, mm_refresh_mode, mm_refresh_after_consolidation, mm_exclude_all_mental_models, mm_tags_match_mode)
    VALUES (?, ?, ?, 'true', ?, ?, ?, ?, ?, ?)
  `);

  for (const t of CONTEXTUAL_GRAPH_TEMPLATES) {
    try {
      const result = insertIfMissing.run(
        t.extId,
        t.name,
        t.sourceQuery,
        t.role,
        t.maxTokens,
        t.refreshMode,
        t.refreshAfterConsolidation,
        t.excludeAllMentalModels,
        t.tagsMatchMode,
      );

      if (result.changes > 0) {
        seeded++;
      }
    } catch (err) {
      logger.error('Failed to ensure contextual-graph template', { extId: t.extId, role: t.role, error: err.message });
    }
  }

  if (seeded > 0 || deleted > 0) {
    logger.info('Ensured contextual-graph system templates', { seeded, deleted, roles: CONTEXTUAL_GRAPH_TEMPLATES.map((t) => t.role) });
  }

  return seeded;
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

  // SQLite only supports a limited subset of ALTER TABLE, so recreate the
  // table when adding a column. Existing columns are preserved.
  const columns = [
    'rstep_id', 'rs_id', 'rstep_parent_step_id', 'rstep_intent_text', 'rstep_raw_query', 'rstep_selections',
    'rstep_action_type', 'rstep_parameters', 'rstep_viewpoint_ids', 'rstep_envelope',
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
      rstep_raw_query TEXT,
      rstep_selections JSON,
      rstep_action_type TEXT NOT NULL,
      rstep_parameters JSON,
      rstep_viewpoint_ids JSON,
      rstep_envelope JSON,
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
  // Existing installs may still have the old CHECK ('json','narrative') on mm_returns.
  // We recreate the table with a foreign-key reference to prompt_templates instead.
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
      mm_template_role TEXT,
      mm_max_tokens INTEGER DEFAULT 2048,
      mm_viewp_description TEXT,
      mm_viewp_meta JSON,
      mm_dimension TEXT,
      mm_returns TEXT,
      mm_concatenation TEXT,
      mm_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      mm_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`,
    columns: ['mm_id', 'mm_ext_id', 'mm_name', 'mm_source_query', 'mm_refresh_after_consolidation', 'mm_refresh_mode', 'mm_exclude_all_mental_models', 'mm_exclude_mental_model_list', 'mm_tags_match_mode', 'mm_is_template', 'mm_template_role', 'mm_max_tokens', 'mm_viewp_description', 'mm_viewp_meta', 'mm_dimension', 'mm_returns', 'mm_concatenation', 'mm_created_at', 'mm_updated_at']
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

    return ['mm_refresh_mode', 'mm_tags_match_mode', 'mm_ent_refresh_mode', 'mm_returns'].some((colName) => {
      const checkPattern = new RegExp(`CHECK\\s*\\(\\s*${colName}\\s+IN`, 'i');
      const fkPattern = colName === 'mm_returns'
        ? new RegExp(`${colName}\\s+[^,]*REFERENCES`, 'i')
        : null;
      return checkPattern.test(sql) || (fkPattern && fkPattern.test(sql));
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
  const needsJunctionBackup = needsModels || needsEntities;
  if (needsJunctionBackup) {
    logger.warn('Saving mental_model_tags and mental_model_entities before recreating mental model tables');
    db.exec(`DROP TABLE IF EXISTS _temp_mm_tags`);
    db.exec(`CREATE TABLE _temp_mm_tags AS SELECT * FROM mental_model_tags`);
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
    if (name === 'mental_models') {
      const mappedColList = columns.map((c) =>
        c === 'mm_returns' ? "CASE mm_returns WHEN 'json' THEN 'generic' WHEN 'narrative' THEN 'generic' WHEN 'graph-known' THEN 'generic' WHEN 'graph-discovery' THEN 'generic' WHEN 'graph-discovered-only' THEN 'generic' WHEN 'narrative-graph-known' THEN 'generic' WHEN 'narrative-graph-discovery' THEN 'generic' WHEN 'narrative-graph-discovered-only' THEN 'generic' ELSE mm_returns END AS mm_returns" : c
      ).join(', ');
      db.exec(`INSERT INTO ${name}_new (${colList}) SELECT ${mappedColList} FROM ${name}`);
    } else {
      db.exec(`INSERT INTO ${name}_new (${colList}) SELECT ${colList} FROM ${name}`);
    }
    db.exec(`DROP TABLE ${name}`);
    db.exec(`ALTER TABLE ${name}_new RENAME TO ${name}`);
    migrated++;
    logger.info(`Recreated ${name} without CHECK constraints`);
  }

  // Restore saved junction rows now that both parent tables exist.
  if (needsJunctionBackup) {
    logger.warn('Restoring mental_model_tags and mental_model_entities');
    db.exec(`INSERT INTO mental_model_tags (tag_id, mm_id, mm_tag_created_at, mm_tag_updated_at)
             SELECT tag_id, mm_id, mm_tag_created_at, mm_tag_updated_at FROM _temp_mm_tags`);
    db.exec(`DROP TABLE _temp_mm_tags`);

    db.exec(`INSERT INTO mental_model_entities (ent_id, mm_id, mm_ent_refresh_mode, mm_ent_refresh_after_consolidation, mm_ent_exclude_all_mental_models, mm_ent_max_tokens, mm_ent_created_at, mm_ent_updated_at)
             SELECT ent_id, mm_id, mm_ent_refresh_mode, mm_ent_refresh_after_consolidation, mm_ent_exclude_all_mental_models, mm_ent_max_tokens, mm_ent_created_at, mm_ent_updated_at FROM _temp_mm_entities`);
    db.exec(`DROP TABLE _temp_mm_entities`);
  }

  return migrated;
}

/**
 * Remove the column-level UNIQUE constraint on mental_models.mm_template_role.
 *
 * The unlimited 'user_entity_derived' role is meant to be assigned to many
 * mental models (one per User derived entity type), so a blanket UNIQUE
 * constraint is incorrect. We recreate the table without it, then rely on a
 * partial unique index (created by ensureTemplateRoleUniqueIndex) to keep
 * system/user role-based template roles unique at the database level.
 */
function removeMentalModelTemplateRoleUnique(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mental_models'").get();
  if (!tableExists) return 0;

  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='mental_models'").pluck().get();
  if (typeof sql !== 'string') return 0;

  const hasUnique = /mm_template_role\s+TEXT\s+UNIQUE/i.test(sql);
  if (!hasUnique) return 0;

  logger.warn('Recreating mental_models to remove mm_template_role UNIQUE constraint');

  db.pragma('foreign_keys = OFF');
  try {
    // Save junction rows before dropping the parent table.
    db.exec(`DROP TABLE IF EXISTS _temp_mm_tags`);
    db.exec(`CREATE TABLE _temp_mm_tags AS SELECT * FROM mental_model_tags`);
    db.exec(`DROP TABLE IF EXISTS _temp_mm_entities`);
    db.exec(`CREATE TABLE _temp_mm_entities AS SELECT * FROM mental_model_entities`);

    db.exec(`CREATE TABLE mental_models_new (
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
      mm_template_role TEXT,
      mm_max_tokens INTEGER DEFAULT 2048,
      mm_viewp_description TEXT,
      mm_viewp_meta JSON,
      mm_dimension TEXT,
      mm_returns TEXT,
      mm_concatenation TEXT,
      mm_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      mm_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);

    db.exec(`INSERT INTO mental_models_new (
      mm_id, mm_ext_id, mm_name, mm_source_query, mm_refresh_after_consolidation,
      mm_refresh_mode, mm_exclude_all_mental_models, mm_exclude_mental_model_list,
      mm_tags_match_mode, mm_is_template, mm_template_role, mm_max_tokens,
      mm_viewp_description, mm_viewp_meta, mm_dimension, mm_returns,
      mm_concatenation, mm_created_at, mm_updated_at
    ) SELECT
      mm_id, mm_ext_id, mm_name, mm_source_query, mm_refresh_after_consolidation,
      mm_refresh_mode, mm_exclude_all_mental_models, mm_exclude_mental_model_list,
      mm_tags_match_mode, mm_is_template, mm_template_role, mm_max_tokens,
      mm_viewp_description, mm_viewp_meta, mm_dimension,
      CASE mm_returns WHEN 'json' THEN 'generic' WHEN 'narrative' THEN 'generic' WHEN 'graph-known' THEN 'generic' WHEN 'graph-discovery' THEN 'generic' WHEN 'graph-discovered-only' THEN 'generic' WHEN 'narrative-graph-known' THEN 'generic' WHEN 'narrative-graph-discovery' THEN 'generic' WHEN 'narrative-graph-discovered-only' THEN 'generic' ELSE mm_returns END AS mm_returns,
      mm_concatenation, mm_created_at, mm_updated_at
    FROM mental_models`);

    db.exec(`DROP TABLE mental_models`);
    db.exec(`ALTER TABLE mental_models_new RENAME TO mental_models`);

    // Restore junction rows.
    db.exec(`INSERT INTO mental_model_tags (tag_id, mm_id, mm_tag_created_at, mm_tag_updated_at)
             SELECT tag_id, mm_id, mm_tag_created_at, mm_tag_updated_at FROM _temp_mm_tags`);
    db.exec(`DROP TABLE _temp_mm_tags`);
    db.exec(`INSERT INTO mental_model_entities (ent_id, mm_id, mm_ent_refresh_mode, mm_ent_refresh_after_consolidation, mm_ent_exclude_all_mental_models, mm_ent_max_tokens, mm_ent_created_at, mm_ent_updated_at)
             SELECT ent_id, mm_id, mm_ent_refresh_mode, mm_ent_refresh_after_consolidation, mm_ent_exclude_all_mental_models, mm_ent_max_tokens, mm_ent_created_at, mm_ent_updated_at FROM _temp_mm_entities`);
    db.exec(`DROP TABLE _temp_mm_entities`);

    const fkCheck = db.pragma('foreign_key_check');
    if (fkCheck && fkCheck.length > 0) {
      logger.warn('Foreign key check found issues after removing mm_template_role UNIQUE constraint', { issues: fkCheck });
    }

    logger.info('Recreated mental_models without mm_template_role UNIQUE constraint');
    return 1;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Remove the restrictive pt_mode CHECK constraint from prompt_templates.
 * The application validates template modes in code; the database CHECK
 * prevents adding new modes without a full schema migration, which is why
 * it is being dropped.
 */
function removePromptTemplateModeCheck(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_templates'").get();
  if (!tableExists) return 0;

  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='prompt_templates'").pluck().get();
  if (typeof sql !== 'string') return 0;

  const hasModeCheck = /CHECK\s*\(\s*pt_mode\s+IN/i.test(sql);
  const hasDiscoveryColumn = /pt_discovery_allowed/i.test(sql);
  if (!hasModeCheck && !hasDiscoveryColumn) {
    return 0;
  }

  if (hasDiscoveryColumn) {
    logger.warn('Recreating prompt_templates without pt_discovery_allowed column');
  }
  if (hasModeCheck) {
    logger.warn('Recreating prompt_templates without pt_mode CHECK constraint');
  }

  try {
    db.pragma('foreign_keys = OFF');

    db.exec(`CREATE TABLE prompt_templates_new (
      pt_name TEXT PRIMARY KEY,
      pt_mode TEXT NOT NULL,
      pt_description TEXT,
      pt_body TEXT NOT NULL,
      pt_fragments JSON NOT NULL,
      pt_variables JSON NOT NULL,
      pt_examples_heuristic TEXT,
      pt_is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (pt_is_builtin IN (0, 1)),
      pt_version TEXT,
      pt_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      pt_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);

    db.exec(`INSERT INTO prompt_templates_new
      (pt_name, pt_mode, pt_description, pt_body, pt_fragments, pt_variables, pt_examples_heuristic, pt_is_builtin, pt_version, pt_created_at, pt_updated_at)
      SELECT pt_name, pt_mode, pt_description, pt_body, pt_fragments, pt_variables, pt_examples_heuristic, pt_is_builtin, pt_version, pt_created_at, pt_updated_at
      FROM prompt_templates`);

    db.exec('DROP TABLE prompt_templates');
    db.exec('ALTER TABLE prompt_templates_new RENAME TO prompt_templates');

    const fkCheck = db.pragma('foreign_key_check');
    if (fkCheck && fkCheck.length > 0) {
      logger.warn('Foreign key check found issues after prompt_templates migration', { issues: fkCheck });
    }

    logger.info('Recreated prompt_templates without pt_mode CHECK constraint or pt_discovery_allowed column');
    return 1;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Migrate legacy mm_returns values ('json', 'narrative', 'graph-known', etc.)
 * to 'generic' since the old per-mode templates have been replaced by a single
 * universal template with directive-driven output.
 */
function migrateMentalModelReturnsToGeneric(db) {
  const mmTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mental_models'").get();
  if (!mmTableExists) return 0;

  const legacyValues = ['json', 'narrative', 'graph-known', 'graph-discovery', 'graph-discovered-only', 'narrative-graph-known', 'narrative-graph-discovery', 'narrative-graph-discovered-only'];
  const placeholders = legacyValues.map(() => '?').join(',');
  const existingLegacy = db.prepare(`SELECT mm_returns, COUNT(*) as c FROM mental_models WHERE mm_returns IN (${placeholders}) GROUP BY mm_returns`).all(...legacyValues);
  if (!existingLegacy || existingLegacy.length === 0) return 0;

  const update = db.prepare(`UPDATE mental_models SET mm_returns = 'generic' WHERE mm_returns IN (${placeholders})`);
  const result = update.run(...legacyValues);
  logger.info(`Migrated ${result.changes} mental model(s) from legacy mm_returns to 'generic'`, { legacyValues, counts: existingLegacy });
  return result.changes;
}

/**
 * Ensure the FTS index for documents exists and is backfilled.
 * Delegates to the search adapter so the migration engine stays free of
 * SQLite FTS5 specifics.
 */
function ensureDocumentsFts(db) {
  const result = createFtsIndex(db);
  return result.success ? result.data : false;
}

function ensureMissingColumns(db) {
  const migrations = [
    {
      table: 'servers',
      columns: [
        {
          name: 'svr_contextual_graph_banks',
          ddl: 'ALTER TABLE servers ADD COLUMN svr_contextual_graph_banks JSON'
        }
      ]
    },
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
      table: 'research_sessions',
      columns: [
        {
          name: 'rs_server_id',
          ddl: 'ALTER TABLE research_sessions ADD COLUMN rs_server_id INTEGER REFERENCES servers(svr_id) ON DELETE SET NULL'
        },
        {
          name: 'rs_scope_entity_ids',
          ddl: 'ALTER TABLE research_sessions ADD COLUMN rs_scope_entity_ids JSON'
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
        },
        {
          name: 'rstep_raw_query',
          ddl: 'ALTER TABLE research_steps ADD COLUMN rstep_raw_query TEXT'
        },
        {
          name: 'rstep_envelope',
          ddl: 'ALTER TABLE research_steps ADD COLUMN rstep_envelope JSON'
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
          ddl: "ALTER TABLE mental_models ADD COLUMN mm_returns TEXT DEFAULT 'narrative'"
        },
        {
          name: 'mm_concatenation',
          ddl: "ALTER TABLE mental_models ADD COLUMN mm_concatenation TEXT DEFAULT 'compile' CHECK (mm_concatenation IN ('merge', 'compile'))"
        },
        {
          name: 'mm_template_role',
          ddl: 'ALTER TABLE mental_models ADD COLUMN mm_template_role TEXT'
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
    },
    {
      table: 'entity_types',
      columns: [
        {
          name: 'et_word_boundary_match',
          ddl: "ALTER TABLE entity_types ADD COLUMN et_word_boundary_match TEXT DEFAULT 'boundaries' CHECK (et_word_boundary_match IN ('boundaries', 'no-boundaries'))"
        },
        {
          name: 'et_uses_entity_id_pattern',
          ddl: 'ALTER TABLE entity_types ADD COLUMN et_uses_entity_id_pattern INTEGER DEFAULT 0 CHECK (et_uses_entity_id_pattern IN (0, 1))'
        },
        {
          name: 'et_id_format_prefix',
          ddl: 'ALTER TABLE entity_types ADD COLUMN et_id_format_prefix TEXT'
        },
        {
          name: 'et_min_id_digits',
          ddl: 'ALTER TABLE entity_types ADD COLUMN et_min_id_digits INTEGER DEFAULT 3 CHECK (et_min_id_digits BETWEEN 1 AND 10)'
        },
        {
          name: 'et_id_separator',
          ddl: "ALTER TABLE entity_types ADD COLUMN et_id_separator TEXT"
        }
      ]
    },
    {
      table: 'entities',
      columns: [
        {
          name: 'ent_word_boundary_match',
          ddl: "ALTER TABLE entities ADD COLUMN ent_word_boundary_match TEXT DEFAULT 'boundaries' CHECK (ent_word_boundary_match IN ('boundaries', 'no-boundaries'))"
        }
      ]
    },
    {
      table: 'template_roles',
      columns: [
        {
          name: 'tr_created_at',
          ddl: "ALTER TABLE template_roles ADD COLUMN tr_created_at DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00Z'"
        },
        {
          name: 'tr_updated_at',
          ddl: "ALTER TABLE template_roles ADD COLUMN tr_updated_at DATETIME NOT NULL DEFAULT '1970-01-01T00:00:00Z'"
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
        // Older SQLite versions do not support IF NOT EXISTS on ADD COLUMN, so
        // ignore duplicate-column errors instead of crashing. This also makes
        // concurrent initialization safe across parallel test workers/processes.
        try {
          db.exec(ddl);
        } catch (err) {
          const isDuplicateColumn = err?.message?.toLowerCase().includes("duplicate column name");
          if (!isDuplicateColumn) throw err;
        }
        logger.info(`Added missing column: ${table}.${name}`);
        addedCount++;
      }
    }
  }
  return addedCount;
}

/**
 * Normalize entity case/boundary match data after schema upgrades.
 *
 * - Backfills entity_types with NULL case/boundary defaults to the schema defaults.
 * - Clears entity-level overrides that are identical to the type default so
 *   the entity inherits from the type instead of redundantly overriding it.
 *
 * Idempotent: running twice produces no changes the second time.
 */
function normalizeEntityMatchInheritance(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(entity_types)").all().map((r) => r.name));
  if (!cols.has('et_case_match') || !cols.has('et_word_boundary_match')) {
    return 0;
  }

  let changes = 0;

  // Ensure every entity type has explicit defaults rather than relying on
  // implicit schema defaults.
  const typeFill = db.prepare(`
    UPDATE entity_types
    SET et_case_match = COALESCE(et_case_match, 'insensitive'),
        et_word_boundary_match = COALESCE(et_word_boundary_match, 'boundaries')
    WHERE et_case_match IS NULL
       OR et_word_boundary_match IS NULL
  `);
  const typeFillChanges = typeFill.run().changes;
  if (typeFillChanges > 0) {
    logger.info(`Backfilled ${typeFillChanges} entity type default(s) for case/boundary`);
    changes += typeFillChanges;
  }

  // Backfill entity-level NULL case/boundary values from the type defaults.
  // This denormalizes the effective values into the entities table for upgraded
  // installations, so queries can read them directly without coalescing.
  const entityCols = new Set(db.prepare("PRAGMA table_info(entities)").all().map((r) => r.name));
  if (entityCols.has('ent_case_match') && entityCols.has('ent_word_boundary_match')) {
    const entityFill = db.prepare(`
      UPDATE entities
      SET ent_case_match = COALESCE(ent_case_match, (
        SELECT t.et_case_match FROM entity_types t WHERE t.et_id = entities.ent_type_id
      )),
          ent_word_boundary_match = COALESCE(ent_word_boundary_match, (
        SELECT t.et_word_boundary_match FROM entity_types t WHERE t.et_id = entities.ent_type_id
      ))
      WHERE ent_case_match IS NULL
         OR ent_word_boundary_match IS NULL
    `);
    const entityFillChanges = entityFill.run().changes;
    if (entityFillChanges > 0) {
      logger.info(`Backfilled ${entityFillChanges} entity match value(s) from type defaults`);
      changes += entityFillChanges;
    }
  }

  return changes;
}

/**
 * Repair a broken rs_server_id foreign key created by the original v0.3.6
 * migration that referenced servers(server_id) instead of servers(svr_id).
 * SQLite only reports the mismatch on insert, so we recreate the table with
 * the correct FK, preserving all existing rows and related child tables.
 */
function ensureResearchSessionsServerFk(db) {
  const fkList = db.prepare("PRAGMA foreign_key_list(research_sessions)").all();
  const serverFk = fkList.find((fk) => fk.from === 'rs_server_id');
  if (!serverFk) return 0;
  if (serverFk.table === 'servers' && serverFk.to === 'svr_id') return 0;

  logger.warn('Recreating research_sessions to fix rs_server_id foreign key target');
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE _research_sessions_new (
        rs_id INTEGER PRIMARY KEY AUTOINCREMENT,
        rs_title TEXT NOT NULL,
        rs_description TEXT,
        rs_server_id INTEGER,
        rs_bank_id TEXT NOT NULL,
        rs_viewpoint_ids JSON NOT NULL,
        rs_scope_entity_ids JSON,
        rs_status TEXT NOT NULL DEFAULT 'active',
        rs_current_step_id INTEGER,
        rs_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        rs_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        FOREIGN KEY (rs_server_id) REFERENCES servers(svr_id) ON DELETE SET NULL,
        FOREIGN KEY (rs_current_step_id) REFERENCES research_steps(rstep_id) ON DELETE SET NULL
      )
    `);

    const columns = [
      'rs_id', 'rs_title', 'rs_description', 'rs_server_id', 'rs_bank_id',
      'rs_viewpoint_ids', 'rs_scope_entity_ids', 'rs_status', 'rs_current_step_id', 'rs_created_at', 'rs_updated_at'
    ];
    const colList = columns.join(', ');
    db.exec(`INSERT INTO _research_sessions_new (${colList}) SELECT ${colList} FROM research_sessions`);
    db.exec('DROP TABLE research_sessions');
    db.exec('ALTER TABLE _research_sessions_new RENAME TO research_sessions');

    db.exec('CREATE INDEX IF NOT EXISTS idx_research_sessions_bank_id ON research_sessions(rs_bank_id)');

    logger.info('research_sessions recreated with rs_server_id -> servers(svr_id)');
    return 1;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function migrateLegacyStepsToEnvelopeAndDropLegacyColumns(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='research_steps'").get();
  if (!tableExists) return 0;

  const cols = new Set(db.prepare("PRAGMA table_info(research_steps)").all().map((r) => r.name));
  const hasCanvas = cols.has('rstep_canvas_state');
  const hasSynthesis = cols.has('rstep_synthesis');
  const hasEnvelope = cols.has('rstep_envelope');

  if (!hasCanvas && !hasSynthesis) return 0;

  if (hasEnvelope) {
    // Backfill rows that have legacy split fields but no unified envelope.
    const pending = db.prepare(`
      SELECT rstep_id, rstep_synthesis, rstep_canvas_state
      FROM research_steps
      WHERE rstep_envelope IS NULL AND (rstep_synthesis IS NOT NULL OR rstep_canvas_state IS NOT NULL)
    `).all();

    const update = db.prepare(`
      UPDATE research_steps
      SET rstep_envelope = ?
      WHERE rstep_id = ?
    `);

    for (const row of pending) {
      const synthesis = row.rstep_synthesis ? JSON.parse(row.rstep_synthesis) : { narrative: '' };
      const canvas = row.rstep_canvas_state ? JSON.parse(row.rstep_canvas_state) : { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] };
      const firstNarrative = typeof synthesis.narrative === 'string' ? synthesis.narrative : '';
      const envelope = {
        narratives: firstNarrative ? [{ narrative_name: synthesis.narrative_name || '', narrative: firstNarrative }] : [],
        graph: canvas.graph ?? { nodes: [], edges: [] },
        tables: canvas.tables ?? [],
        diagrams: canvas.diagrams ?? [],
      };
      update.run(JSON.stringify(envelope), row.rstep_id);
    }

    if (pending.length > 0) {
      logger.info(`Backfilled ${pending.length} legacy step(s) into rstep_envelope`);
    }
  }

  // Recreate research_steps without the legacy split columns.
  logger.warn('Recreating research_steps to remove rstep_canvas_state and rstep_synthesis');
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`CREATE TABLE _research_steps_new (
      rstep_id INTEGER PRIMARY KEY AUTOINCREMENT,
      rs_id INTEGER NOT NULL,
      rstep_parent_step_id INTEGER,
      rstep_intent_text TEXT NOT NULL,
      rstep_raw_query TEXT,
      rstep_selections JSON,
      rstep_action_type TEXT NOT NULL,
      rstep_parameters JSON,
      rstep_viewpoint_ids JSON,
      rstep_envelope JSON,
      rstep_tool_calls_used INTEGER DEFAULT 0,
      rstep_status TEXT,
      rstep_error_message TEXT,
      rstep_calls JSON,
      rstep_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      FOREIGN KEY (rs_id) REFERENCES research_sessions(rs_id) ON DELETE CASCADE,
      FOREIGN KEY (rstep_parent_step_id) REFERENCES research_steps(rstep_id) ON DELETE SET NULL
    )`);

    const columns = [
      'rstep_id', 'rs_id', 'rstep_parent_step_id', 'rstep_intent_text', 'rstep_raw_query', 'rstep_selections',
      'rstep_action_type', 'rstep_parameters', 'rstep_viewpoint_ids', 'rstep_envelope',
      'rstep_tool_calls_used', 'rstep_status', 'rstep_error_message', 'rstep_calls', 'rstep_created_at'
    ];
    const colList = columns.join(', ');
    db.exec(`INSERT INTO _research_steps_new (${colList}) SELECT ${colList} FROM research_steps`);
    db.exec('DROP TABLE research_steps');
    db.exec('ALTER TABLE _research_steps_new RENAME TO research_steps');
    db.exec('CREATE INDEX IF NOT EXISTS idx_research_steps_session ON research_steps(rs_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_research_steps_parent ON research_steps(rstep_parent_step_id)');

    const fkCheck = db.pragma('foreign_key_check');
    if (fkCheck && fkCheck.length > 0) {
      logger.warn('Foreign key check found issues after research_steps migration', { issues: fkCheck });
    }

    logger.info('Recreated research_steps without legacy canvas/synthesis columns');
    return 1;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Ensure pending_operations.pop_doc_id is nullable. Older schemas created it
 * as NOT NULL, but document-less async operations (e.g. mental-model refresh)
 * need to leave it null. Recreate the table preserving existing rows only when
 * the current schema still enforces the constraint.
 */
function ensurePendingOpsNullableDocId(db) {
  const tableInfo = db.prepare("PRAGMA table_info(pending_operations)").all();
  const docCol = tableInfo.find((c) => c.name === 'pop_doc_id');
  if (!docCol) return 0;
  if (docCol.notnull === 0) return 0;

  logger.warn('Recreating pending_operations to make pop_doc_id nullable');
  db.pragma('foreign_keys = OFF');
  try {
    db.exec(`
      CREATE TABLE _pending_operations_new (
        pop_id INTEGER PRIMARY KEY AUTOINCREMENT,
        pop_operation_id TEXT NOT NULL,
        pop_server_id INTEGER NOT NULL,
        pop_bank_id TEXT NOT NULL,
        pop_doc_id INTEGER,
        pop_rs_id INTEGER,
        pop_rstep_id INTEGER,
        pop_ext_id TEXT,
        pop_action TEXT NOT NULL DEFAULT 'push',
        pop_status TEXT NOT NULL DEFAULT 'pending',
        pop_error_message TEXT,
        pop_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        pop_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);

    const columns = [
      'pop_id', 'pop_operation_id', 'pop_server_id', 'pop_bank_id', 'pop_doc_id',
      'pop_rs_id', 'pop_rstep_id', 'pop_ext_id', 'pop_action', 'pop_status',
      'pop_error_message', 'pop_created_at', 'pop_updated_at'
    ];
    const colList = columns.join(', ');
    db.exec(`INSERT INTO _pending_operations_new (${colList}) SELECT ${colList} FROM pending_operations`);
    db.exec('DROP TABLE pending_operations');
    db.exec('ALTER TABLE _pending_operations_new RENAME TO pending_operations');

    db.exec('CREATE INDEX IF NOT EXISTS idx_pending_ops_server_bank ON pending_operations(pop_server_id, pop_bank_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pending_ops_status ON pending_operations(pop_status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pending_ops_ext_id ON pending_operations(pop_ext_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pending_ops_doc_id ON pending_operations(pop_doc_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pending_ops_research_session ON pending_operations(pop_rs_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_pending_ops_research_step ON pending_operations(pop_rstep_id)');

    db.exec('CREATE INDEX IF NOT EXISTS idx_cge_server_bank_source_target ON contextual_graph_edges(cge_server_id, cge_bank_id, cge_source_id, cge_target_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cge_source ON contextual_graph_edges(cge_source_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cge_target ON contextual_graph_edges(cge_target_id)');

    logger.info('pending_operations recreated with nullable pop_doc_id');
    return 1;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Recreate contextual graph tables if they still use the old cg_* schema.
 * This is a one-time destructive migration for the experimental pre-v36 tables.
 */
function ensureContextualGraphSchema(db) {
  const nodesInfo = db.prepare("PRAGMA table_info(contextual_graph_nodes)").all();
  const hasOldNodes = nodesInfo.some((c) => c.name === 'cg_id');
  const edgesInfo = db.prepare("PRAGMA table_info(contextual_graph_edges)").all();
  const hasOldEdges = edgesInfo.some((c) => c.name === 'cg_id');

  if (!hasOldNodes && !hasOldEdges) return 0;

  logger.warn('Recreating contextual graph tables to align with v36 schema');
  db.pragma('foreign_keys = OFF');
  try {
    if (hasOldNodes) db.exec('DROP TABLE IF EXISTS contextual_graph_nodes');
    if (hasOldEdges) db.exec('DROP TABLE IF EXISTS contextual_graph_edges');

    db.exec(`CREATE TABLE contextual_graph_nodes (
      cgn_id TEXT NOT NULL,
      cgn_server_id INTEGER NOT NULL,
      cgn_bank_id TEXT NOT NULL,
      cgn_labels TEXT NOT NULL,
      cgn_properties TEXT NOT NULL,
      cgn_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      cgn_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (cgn_server_id, cgn_bank_id, cgn_id),
      FOREIGN KEY (cgn_server_id) REFERENCES servers(svr_id) ON DELETE CASCADE
    )`);

    db.exec(`CREATE TABLE contextual_graph_edges (
      cge_id TEXT NOT NULL,
      cge_server_id INTEGER NOT NULL,
      cge_bank_id TEXT NOT NULL,
      cge_source_id TEXT NOT NULL,
      cge_target_id TEXT NOT NULL,
      cge_type TEXT,
      cge_properties TEXT NOT NULL,
      cge_created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      cge_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
      PRIMARY KEY (cge_server_id, cge_bank_id, cge_id),
      FOREIGN KEY (cge_server_id) REFERENCES servers(svr_id) ON DELETE CASCADE
    )`);

    return 2;
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Ensure contextual graph edge indexes exist. Runs during additive migration
 * in case the table was created before the indexes were added.
 */
function ensureContextualGraphIndexes(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'contextual_graph_edges'").get();
  if (!tableExists) return 0;

  const columns = new Set(
    db.prepare("PRAGMA table_info(contextual_graph_edges)").all().map((r) => r.name)
  );
  const needsServerBank = columns.has('cge_server_id') && columns.has('cge_bank_id') && columns.has('cge_source_id') && columns.has('cge_target_id');
  const needsSource = columns.has('cge_source_id');
  const needsTarget = columns.has('cge_target_id');

  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'contextual_graph_edges'").all().map((r) => r.name)
  );
  const indexes = [
    { name: 'idx_cge_server_bank_source_target', ddl: 'CREATE INDEX IF NOT EXISTS idx_cge_server_bank_source_target ON contextual_graph_edges(cge_server_id, cge_bank_id, cge_source_id, cge_target_id)', needed: needsServerBank },
    { name: 'idx_cge_source', ddl: 'CREATE INDEX IF NOT EXISTS idx_cge_source ON contextual_graph_edges(cge_source_id)', needed: needsSource },
    { name: 'idx_cge_target', ddl: 'CREATE INDEX IF NOT EXISTS idx_cge_target ON contextual_graph_edges(cge_target_id)', needed: needsTarget },
  ];

  let created = 0;
  for (const { name, ddl, needed } of indexes) {
    if (needed && !existing.has(name)) {
      db.exec(ddl);
      created++;
    }
  }
  return created;
}

/**
 * Ensure mental_models.mm_template_role is unique for non-null values, except
 * for the unlimited 'user_entity_derived' role which may be assigned to many
 * mental models (one per User derived entity type).
 *
 * SQLite treats multiple NULLs as distinct, so plain (Generic/no-role) models
 * are not affected. Before adding the index, any duplicate non-null roles other
 * than 'user_entity_derived' are resolved by keeping the lowest mm_id for each
 * role and clearing the role on the rest. This allows existing dev/test
 * databases that accidentally shared a legacy role to migrate cleanly.
 */
function ensureTemplateRoleUniqueIndex(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'mental_models'").get();
  if (!tableExists) return false;

  const existing = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND name = 'idx_mental_models_template_role_unique'").get();
  const isPartial = existing && existing.sql && /WHERE\s+mm_template_role\s*!=?\s*['"]user_entity_derived['"]/i.test(existing.sql);
  if (isPartial) return false;

  // Drop the old non-partial unique index if present so we can recreate it with
  // the unlimited-role exception. Column-level UNIQUE constraints created by
  // earlier schema versions are also backed by an index, but dropping by name
  // only removes the explicit index; SQLite will still enforce the column
  // constraint via its auto-generated index. Those are removed by recreating
  // the table in removeMentalModelCheckConstraints when CHECK constraints
  // still exist, or by the dedicated removeMentalModelTemplateRoleUnique
  // migration below.
  if (existing) {
    db.exec('DROP INDEX IF EXISTS idx_mental_models_template_role_unique');
    logger.info('Dropped old non-partial unique index on mental_models.mm_template_role');
  }

  const duplicates = db.prepare(`
    SELECT mm_template_role, GROUP_CONCAT(mm_id) AS ids, GROUP_CONCAT(mm_ext_id) AS ext_ids
    FROM mental_models
    WHERE mm_template_role IS NOT NULL
      AND mm_template_role != 'user_entity_derived'
    GROUP BY mm_template_role
    HAVING COUNT(*) > 1
  `).all();
  if (duplicates.length > 0) {
    const cleared = db.prepare(`
      UPDATE mental_models
      SET mm_template_role = NULL,
          mm_updated_at = CURRENT_TIMESTAMP
      WHERE mm_id NOT IN (
        SELECT MIN(mm_id)
        FROM mental_models
        WHERE mm_template_role IS NOT NULL
          AND mm_template_role != 'user_entity_derived'
        GROUP BY mm_template_role
      )
      AND mm_template_role IS NOT NULL
      AND mm_template_role != 'user_entity_derived'
    `).run();
    logger.warn(`Cleared duplicate mm_template_role values from ${cleared.changes} mental model row(s) to prepare unique index: ${duplicates.map((d) => `${d.mm_template_role} (ids ${d.ids})`).join('; ')}`);
  }

  db.exec("CREATE UNIQUE INDEX idx_mental_models_template_role_unique ON mental_models(mm_template_role) WHERE mm_template_role != 'user_entity_derived'");
  logger.info('Created partial unique index on mental_models.mm_template_role (excludes user_entity_derived)');
  return true;
}

export function ensureSchema(db) {
  const hadSchema = hasSchema(db);

  if (hadSchema) {
    const cgSchemaFixed = ensureContextualGraphSchema(db);
    const created = ensureMissingTables(db);
    const templatesSeeded = ensureBuiltinPromptTemplates(db);
    const added = ensureMissingColumns(db);
    backfillTemplateRoleTimestamps(db);
    const removed = removeMentalModelCheckConstraints(db);
    const templateRoleUniqueRemoved = removeMentalModelTemplateRoleUnique(db);
    const promptTemplateFixed = removePromptTemplateModeCheck(db);
    const mmReturnsMigrated = migrateMentalModelReturnsToGeneric(db);
    const curatedPagesMigrated = migrateLegacyStepsToEnvelopeAndDropLegacyColumns(db);
    const relaxed = relaxResearchStepsParentCascade(db);
    const nullableDocId = ensurePendingOpsNullableDocId(db);
    const researchFkFixed = ensureResearchSessionsServerFk(db);
    const ftsCreated = ensureDocumentsFts(db);
    const normalized = normalizeEntityMatchInheritance(db);
    const cgIndexes = ensureContextualGraphIndexes(db);
    const cgTemplates = ensureContextualGraphTemplates(db);
    const templateRolesSeeded = ensureTemplateRoles(db);
    const templateRoleUniqueIndex = ensureTemplateRoleUniqueIndex(db);
    const idPlaceholderMigrated = migrateLegacyIdPlaceholder(db);
    if (created > 0 || added > 0 || removed > 0 || templateRoleUniqueRemoved > 0 || promptTemplateFixed > 0 || relaxed > 0 || nullableDocId > 0 || researchFkFixed > 0 || ftsCreated || normalized > 0 || templatesSeeded > 0 || cgIndexes > 0 || cgSchemaFixed > 0 || cgTemplates > 0 || mmReturnsMigrated > 0 || curatedPagesMigrated > 0 || templateRolesSeeded > 0 || templateRoleUniqueIndex || idPlaceholderMigrated > 0) {
      logger.info(`Additive migration complete — ${created} new table(s), ${templatesSeeded} prompt template(s) seeded, ${cgTemplates} contextual-graph template(s), ${added} new column(s), ${removed} CHECK constraint(s) removed, ${templateRoleUniqueRemoved} mm_template_role UNIQUE constraint(s) removed, ${promptTemplateFixed} prompt template CHECK(s) removed, ${relaxed} FK action(s) relaxed, ${nullableDocId} pending_ops nullable fix, ${researchFkFixed} research_sessions FK fix, FTS table created: ${ftsCreated}, entity inheritance normalizations: ${normalized}, contextual-graph tables recreated: ${cgSchemaFixed}, contextual-graph indexes created: ${cgIndexes}, mental model returns migrated: ${mmReturnsMigrated}, curated-page envelope migrations: ${curatedPagesMigrated}, template roles seeded: ${templateRolesSeeded}, template role unique index: ${templateRoleUniqueIndex}, id placeholder migrated: ${idPlaceholderMigrated}`);
    } else {
      logger.info('Database schema already present — no missing tables or columns');
    }
    return created > 0 || added > 0 || removed > 0 || templateRoleUniqueRemoved > 0 || promptTemplateFixed > 0 || relaxed > 0 || nullableDocId > 0 || researchFkFixed > 0 || ftsCreated || normalized > 0 || templatesSeeded > 0 || cgIndexes > 0 || cgSchemaFixed > 0 || cgTemplates > 0 || mmReturnsMigrated > 0 || curatedPagesMigrated > 0 || templateRolesSeeded > 0 || templateRoleUniqueIndex || idPlaceholderMigrated > 0;
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
  const templatesSeeded = ensureBuiltinPromptTemplates(db);
  const cgTemplates = ensureContextualGraphTemplates(db);
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
