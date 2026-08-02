-- ============================================================================
-- SYSTEM SEED DATA
-- ============================================================================
-- Idempotent inserts: INSERT OR IGNORE skips duplicates via the
-- UNIQUE(meta_key, meta_value) constraint on the metadata table.
-- These entries are tagged with generated_by='system' and are read-only.
--
-- Array-based placeholders (Tags, Entities, Authors) are expected to produce
-- multiple metadata entries per document during retain expansion.
-- ============================================================================

INSERT OR IGNORE INTO metadata (meta_key, meta_value, meta_generated_by) VALUES
  ('architxt-tags',                   '{tags}',                  'system'),
  ('architxt-entity-match-pattern',   '{entity-match-pattern}',  'system'),
  ('architxt-entities',               '{entities}',              'system'),
  ('architxt-document-size',          '{document-size}',         'system'),
  ('architxt-document-full-path',     '{document-full-path}',    'system'),
  ('architxt-file-name',              '{document-file-name}',    'system'),
  ('architxt-document-date',          '{document-date}',         'system'),
  ('architxt-author',                 '{document-author}',       'system');

-- ----------------------------------------------------------------------------
-- Mental model templates
-- Seeded from dev01: 4 base templates used by the Research prebuilt flow.
-- They are templates (mm_is_template='true') and expand per entity via
-- {entity-id}, {entity-name}, {entity-type} placeholders at runtime.
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO mental_models (mm_ext_id, mm_name, mm_source_query, mm_dimension, mm_concatenation, mm_returns, mm_is_template, mm_template_role) VALUES
  ('architxt-capabilities-txt-{entity-id}', 'architxt-capabilities-txt-{entity-id}-{entity-name}', 'What are the major architectural capabilities for {entity-name} ({entity-type}:{entity-id})? List their responsibilities, purpose and business capability mapping.', 'capability', 'compile', 'narrative', 'true', 'user_entity_derived'),
  ('architxt-interface-found-{entity-id}', 'architxt-interface-found-{entity-id}-{entity-name}', 'What are the flows (apis, data, files and interface calls) into and out of {entity-name} ({entity-type}:{entity-id})? For found flows, describe them contextually. Return each contextual flow as a separate row.', 'interface-found', 'merge', 'graph-discovery', 'true', 'user_entity_derived'),
  ('architxt-interface-json-{entity-id}', 'architxt-interface-json-{entity-id}-{entity-name}', 'What are the flows (apis, data, files and interface calls) into and out of {entity-name} ({entity-type}:{entity-id})? For known flows, describe them contextually. Return each contextual flow as a separate row.', 'interface', 'compile', 'graph-known', 'true', 'user_entity_derived'),
  ('architxt-summary-txt-{entity-id}', 'architxt-summary-txt-{entity-id}-{entity-name}', 'Describe the core role that {entity-name} ({entity-type}:{entity-id}) plays in the architecture. Return a short summary and a table listing aspect and description.', 'summary', 'compile', 'narrative', 'true', 'user_entity_derived');

-- ----------------------------------------------------------------------------
-- Built-in prompt templates (v0.3.5 prompt/graph standardization)
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO prompt_templates (pt_name, pt_mode, pt_description, pt_body, pt_fragments, pt_variables, pt_examples_heuristic, pt_is_builtin) VALUES
  ('narrative', 'narrative', 'Narrative-only output.', 'Answer the topic below as a focused Markdown narrative. Do not return a graph section.\\n\\n{{ARCHITXT_TOPIC}}', '[]', '["ARCHITXT_TOPIC"]', NULL, 1),
  ('graph-known', 'graph-known', 'Graph-only output using known entities only.', 'Return only the graph section for the topic below. Use only entity ids from the provided catalog. Do not invent new entities.\\n\\n{{ARCHITXT_TOPIC}}', '["output-format-graph.md","entity-catalog.md","entity-id-format.md","node-discovery-policy-known.md","edge-vocabulary.md","node-eligibility.md","label-rules.md","provenance-rules.md"]', '["ARCHITXT_TOPIC","ARCHITXT_ENTITIES","ARCHITXT_NODE_EXAMPLES"]', 'top-n', 1),
  ('graph-discovery', 'graph-discovery', 'Graph-only output allowing discovered nodes.', 'Return only the graph section for the topic below. Prefer known entities from the catalog; you may add found: nodes for persistent named architectural elements not in the catalog.\\n\\n{{ARCHITXT_TOPIC}}', '["output-format-graph.md","entity-catalog.md","entity-id-format.md","node-discovery-policy-allowed.md","edge-vocabulary.md","node-eligibility.md","label-rules.md","provenance-rules.md"]', '["ARCHITXT_TOPIC","ARCHITXT_ENTITIES","ARCHITXT_NODE_EXAMPLES"]', 'top-n', 1),
  ('graph-discovered-only', 'graph-discovered-only', 'Graph-only output returning discovered nodes and edges only.', 'Return only the graph section for the topic below. Emit only discovered nodes and edges. Known entities may appear only as endpoints of discovered edges; do not return them as standalone nodes.\\n\\n{{ARCHITXT_TOPIC}}', '["output-format-graph.md","entity-catalog.md","entity-id-format.md","node-discovery-policy-discovered-only.md","edge-vocabulary.md","node-eligibility.md","label-rules.md","provenance-rules.md"]', '["ARCHITXT_TOPIC","ARCHITXT_ENTITIES","ARCHITXT_NODE_EXAMPLES"]', 'top-n', 1),
  ('narrative-graph-discovered-only', 'narrative-graph-discovered-only', 'Narrative + graph returning discovered nodes and edges only.', 'Answer the topic below as a focused Markdown narrative. Then return a graph section containing only discovered nodes and edges. Known entities may appear only as endpoints of discovered edges; do not return them as standalone nodes.\\n\\n{{ARCHITXT_TOPIC}}', '["output-format-narrative-graph.md","entity-catalog.md","entity-id-format.md","node-discovery-policy-discovered-only.md","edge-vocabulary.md","node-eligibility.md","label-rules.md","provenance-rules.md"]', '["ARCHITXT_TOPIC","ARCHITXT_ENTITIES","ARCHITXT_NODE_EXAMPLES"]', 'top-n', 1),
  ('narrative-graph-known', 'narrative-graph-known', 'Narrative + graph using known entities only.', 'Answer the topic below as a focused Markdown narrative. Then return a graph section. Use only entity ids from the provided catalog. Do not invent new entities.\\n\\n{{ARCHITXT_TOPIC}}', '["output-format-narrative-graph.md","entity-catalog.md","entity-id-format.md","node-discovery-policy-known.md","edge-vocabulary.md","node-eligibility.md","label-rules.md","provenance-rules.md"]', '["ARCHITXT_TOPIC","ARCHITXT_ENTITIES","ARCHITXT_NODE_EXAMPLES"]', 'top-n', 1),
  ('narrative-graph-discovery', 'narrative-graph-discovery', 'Narrative + graph allowing discovered nodes.', 'Answer the topic below as a focused Markdown narrative. Then return a graph section. Prefer known entities from the catalog; you may add found: nodes for persistent named architectural elements not in the catalog.\\n\\n{{ARCHITXT_TOPIC}}', '["output-format-narrative-graph.md","entity-catalog.md","entity-id-format.md","node-discovery-policy-allowed.md","edge-vocabulary.md","node-eligibility.md","label-rules.md","provenance-rules.md"]', '["ARCHITXT_TOPIC","ARCHITXT_ENTITIES","ARCHITXT_NODE_EXAMPLES"]', 'top-n', 1);
