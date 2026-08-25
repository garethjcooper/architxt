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
-- Built-in prompt templates (v0.3.5 prompt/graph standardization)
-- ----------------------------------------------------------------------------
INSERT OR IGNORE INTO prompt_templates (pt_name, pt_mode, pt_description, pt_body, pt_fragments, pt_variables, pt_examples_heuristic, pt_is_builtin) VALUES
  ('generic', 'generic', 'Universal template. Returns narrative + graph + tables based on user directives.', 'Answer the topic below.\\n\\n## Topic\\n\\n{{ARCHITXT_TOPIC}}\\n\\n## Source material\\n\\n{{ARCHITXT_CORPUS}}', '["contextual-patch.md","section-focus.md"]', '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]', NULL, 1),
  ('sys_entity_summary', 'sys_entity_summary', 'System template: concise evidence-backed summary for one contextual-graph node.', 'You are summarising a single known architectural entity for an architecture graph.\\n\\n## Entity\\n\\n{{ARCHITXT_TOPIC}}\\n\\n## Instructions\\n\\nDescribe the core role that the entity plays in the architecture. Return the summary in the `narrative` field of the JSON envelope.\\n\\nRules:\\n- Use only facts supported by the source material.\\n- Do not invent aliases, artifacts, or related entities.\\n- Evidence is implicit in the source query scope; do not enumerate memory IDs inside the narrative.\\n- Keep the narrative short enough to fit within the model token budget.\\n\\n## Source material\\n\\n{{ARCHITXT_CORPUS}}', '["contextual-patch.md","section-focus.md"]', '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]', NULL, 1),
  ('sys_entity_capabilities', 'sys_entity_capabilities', 'System template: capabilities table for one contextual-graph node.', 'You are listing the major architectural capabilities of a single known entity.\\n\\n## Entity\\n\\n{{ARCHITXT_TOPIC}}\\n\\n## Instructions\\n\\nReturn the capabilities in a single table named `capabilities` with columns `name`, `responsibility`, `purpose`, `business_capability_mapping`, and `evidence`.\\n\\nRules:\\n- Each capability must be a stable, high-level responsibility, not a one-off mention.\\n- `responsibility` describes what the entity does for this capability.\\n- `purpose` explains why the capability matters.\\n- `business_capability_mapping` places the capability in a business domain.\\n- `evidence` must be an array of memory IDs that support the capability.\\n- Do not include capabilities that are not backed by evidence.\\n\\n## Source material\\n\\n{{ARCHITXT_CORPUS}}', '["contextual-patch.md","output-format-table-contextual.md"]', '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]', NULL, 1),
  ('sys_edge_context', 'sys_edge_context', 'System template: characterize directed relationships between two contextual-graph nodes.', 'Answer the topic below.\\n\\n## Topic\\n\\n{{ARCHITXT_TOPIC}}\\n\\n## Source material\\n\\n{{ARCHITXT_CORPUS}}', '["contextual-patch.md","section-focus.md","edge-vocabulary.md","entity-id-format.md","provenance-rules.md"]', '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]', NULL, 1),
  ('sys_discovery_context', 'sys_discovery_context', 'System template: suggest new contextual-graph nodes and edges around a seed node.', 'You are discovering candidate entities and relationships around a seed entity in the corpus.\\n\\n## Seed\\n\\n{{ARCHITXT_TOPIC}}\\n\\n## Instructions\\n\\nReturn candidate nodes and edges in `graph.nodes` and `graph.edges`. This output is an internal working-graph input only; do not surface it as user-facing prose.\\n\\nRules:\\n- Candidate node IDs must use the `found:{slug}` form.\\n- Existing known nodes must use their canonical `TYPE:ID` id.\\n- Every candidate and edge must be backed by evidence.\\n- Do not return candidates that are already known canonical nodes.\\n\\n## Source material\\n\\n{{ARCHITXT_CORPUS}}', '["contextual-patch.md","output-format-graph-contextual.md","edge-vocabulary.md","entity-id-format.md","provenance-rules.md","node-discovery-policy-allowed.md"]', '["ARCHITXT_TOPIC","ARCHITXT_NARRATIVE_FOCUS","ARCHITXT_GRAPH_FOCUS","ARCHITXT_TABLE_FOCUS"]', NULL, 1);
