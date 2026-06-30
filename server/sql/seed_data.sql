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
INSERT OR IGNORE INTO mental_models (mm_ext_id, mm_name, mm_source_query, mm_dimension, mm_concatenation, mm_returns, mm_is_template) VALUES
  ('architxt-capabilities-txt-{entity-id}', 'architxt-capabilities-txt-{entity-id}-{entity-name}', 'What are the major architectural capabilities for {entity-name} ({entity-id})? List their responsibilities, purpose and business capability mapping. Return a short summary of the capabilities and a table listing capability, responsibility, purpose and business capability mapping. For example.:

Capability Summary
System A(COM‑XYZ) is the core component that handles the commercial and technical processing of inter‑carrier traffic. The following table captures the principal capabilities, their responsibilities, the purpose they serve, and the corresponding business capability they realise.

| Capability	| Responsibility	| Purpose | 	Business Capability Mapping |
| ----------------------- | ------------- | ----------- | --------------------------------|
|Settlement Engine	     | Executes domestic inter‑carrier settlement calculations and produces settlement records. | Provides a financially‑accurate reconciliation of traffic exchanged between carriers. | Inter‑carrier Settlement (financial clearing) |
| Billing Calculation |	Computes charges for interconnect usage, applies tariffs, and generates billing records.  | Ensures each usage event is monetised correctly before invoicing. |  Billing & Rating (charge generation) |', 'capability', 'compile', 'narrative', 'true'),
  ('architxt-interface-found-{entity-id}', 'architxt-interface-found-{entity-id}-{entity-name}', '## Task 
What are the flows (apis, data, files and interface calls) into and out of {entity-name} ({entity-type}:{entity-id}). For found flows, describe then contextually. Return each contextual flow as a separate row. Compile a list of nodes based on the edges and provide a distinct ''nodes'' list.

## Rules 
1. ONLY return edges where {entity-name} ({entity-type}:{entity-id}) is known and the source/target entity is NOT known
2. ALWAYS use the full entity name value (i.e. {entity type}:{entity id}).  
3. If a source or target entity does not map to a known entity but confidence is high (>0.95) that the discovered source/target is an entity then use "found:{found entity name}"
4. Prefer explicit evidence over inference. If a relationship is only a guess, don''t return. 
5. Use directed edges: source acts upon / sends to / depends on target. 
6. Label each edge with one of the allowed edge types. 
7. Only return valid JSON as per the output schema, not commentary or markdown.

## Allowed edge types 
- ''found:calls'' - source service/component calls/invokes target service/component 
- ''found:sends'' - target reads/accepts data from target such as files or other blob type objects. Data that ''flows'' from target to source. 
- ''found:receives'' - source reads/accepts data from target such as files or other blob type objects. Data that ''flows'' from source to target. 
- ''found:depends_on'' - general dependency 

## Output schema 

{ "nodes": [ { entity: "entity-id", "entity_name": "entity-name" } ] }, 
	"edges": [ { "source": "entity-id", "target": "entity-id", "edge_type": "calls:found", "label": "short human-readable phrase (max 4 words)", "label_long": "the full description of the edge context. Limit to 2 sentence", "source_fact_ids": ["fact-uuid-1"] } ] } 

- ALWAYS return the full set of schema fields.
- use full entity id in for nodes and edges
- only use entity name in the entity name field, do not suffix with entity id
- ''edge_type'' must be from the allowed list. 
- ''label'' is a short human-readable phrase (max 4 words). 
- ''label_long'' is a the full description of the edge context. Limit to 2 sentence. 
- ''source_fact_ids'' are the IDs of the facts that justify the relationship. 

If no directed relationships can be determined, return `{"nodes": [], "edges": []}`.', 'interface-found', 'merge', 'json', 'true'),
  ('architxt-interface-json-{entity-id}', 'architxt-interface-json-{entity-id}-{entity-name}', '## Task 
What are the flows (apis, data, files and interface calls) into and out of {entity-name} ({entity-type}:{entity-id}). For found flows, describe then contextually. Return each contextual flow as a separate row. Compile a list of nodes based on the edges and provide a distinct ''nodes'' list.

## Rules 
1. ONLY return edges where both entity ids are known - do NOT invent entities.
2. ALWAYS use the full entity name value (i.e. {entity type}:{entity id}). 
3. Prefer explicit evidence over inference. If a relationship is only a guess, don''t return. 
4. Use directed edges: source acts upon / sends to / depends on target. 
5. Label each edge with one of the allowed edge types. 
6. Only return valid JSON as per the output schema, not commentary or markdown.

## Allowed edge types 
- ''calls'' - source service/component calls/invokes target service/component 
- ''sends'' - target reads/accepts data from target such as files or other blob type objects. Data that ''flows'' from target to source. 
- ''receives'' - source reads/accepts data from target such as files or other blob type objects. Data that ''flows'' from source to target. 
- ''depends_on'' - general dependency 

## Output schema 

{ "nodes": [ { entity: "entity-id", "entity_name": "entity-name" } ] }, 
	"edges": [ { "source": "entity-id", "target": "entity-id", "edge_type": "calls", "label": "short human-readable phrase (max 4 words)", "label_long": "the full description of the edge context. Limit to 2 sentence", "source_fact_ids": ["fact-uuid-1"] } ] } 

- ALWAYS return the full set of schema fields.
- use full entity id in for nodes and edges
- only use entity name in the entity name field, do not suffix with entity id
- ''edge_type'' must be from the allowed list. 
- ''label'' is a short human-readable phrase (max 4 words). 
- ''label_long'' is a the full description of the edge context. Limit to 2 sentence. 
- ''source_fact_ids'' are the IDs of the facts that justify the relationship. 

If no directed relationships can be determined, return `{"nodes": [], "edges": []}`.', 'interface', 'compile', 'json', 'true'),
  ('architxt-summary-txt-{entity-id}', 'architxt-summary-txt-{entity-id}-{entity-name}', 'Describe the core role that {entity-name} ({entity-type}:{entity-id}) plays in the architecture. Return a short summary and a table listing aspect and description. For example.:

Summary
System A (COM‑XYZ) is the core NoSQL data platform that consolidates, persists, and serves all billing‑related artifacts. It underpins transaction processing, reporting, and audit capabilities while acting as the integration point for a wide range of services and APIs throughout the billing architecture.

| Aspect	                          | Description |
| ----------------------- | ------------- |
| Primary Data Store     | Serves as the central repository for all billing‑related information – invoices, PDF statements, reports, and audit records. |
| Data Warehouse‑Lite |	Acts as a partial data warehouse for billing data, although the data is not yet exposed to the Data Lake platform. |', 'summary', 'compile', 'narrative', 'true');
