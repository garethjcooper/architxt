import { dbExec } from '../../utils/db-helpers.js';
import { stmt } from '../../cache.js';

export const CONTEXTUAL_GRAPH_ROLES = {
  entitySummary: 'sys_entity_summary',
  entityCapabilities: 'sys_entity_capabilities',
  edge: 'sys_edge_context',
  discover: 'sys_discovery_context',
};

/**
 * Fetch a contextual-graph system template by role.
 * Returns the normalized row with tags array, or null if not seeded.
 */
export function getContextualGraphTemplate(db, role) {
  return dbExec(() => {
    const row = db.prepare(`
      SELECT m.*,
        (SELECT json_group_array(t.tag_name)
         FROM mental_model_tags mmt
         JOIN tags t ON mmt.tag_id = t.tag_id
         WHERE mmt.mm_id = m.mm_id) AS tags
      FROM mental_models m
      WHERE m.mm_is_template = ? AND m.mm_template_role = ?
      LIMIT 1
    `).get('true', role);

    if (!row) return null;
    return normalizeTemplateRow(row);
  }, 'contextualGraph.template.get');
}

/**
 * Substitute placeholder tokens in a template string.
 * Throws if a placeholder is present but has no value provided.
 */
export function substituteTemplateFields(template, values) {
  if (typeof template !== 'string') return '';
  let text = template;
  for (const [key, val] of Object.entries(values)) {
    if (text.includes(key) && (val === undefined || val === null)) {
      throw new Error(`Missing template value for placeholder ${key}`);
    }
    text = text.replaceAll(key, String(val));
  }
  return text;
}

/**
 * Derive an entity-summary mental model spec from the system template + graph node.
 */
export async function deriveEntitySummaryModel(db, node, bankId) {
  const template = getContextualGraphTemplate(db, CONTEXTUAL_GRAPH_ROLES.entitySummary)?.data;
  if (!template) throw new Error(`Missing contextual graph template: ${CONTEXTUAL_GRAPH_ROLES.entitySummary}`);

  const values = {
    '{id}': node.id,
    '{entity-name}': node.displayName || node.id,
  };

  return {
    role: template.role,
    ext_id: substituteTemplateFields(template.ext_id, values),
    name: substituteTemplateFields(template.name, values),
    source_query: substituteTemplateFields(template.source_query, values),
    returns: template.returns,
    dimension: template.dimension,
    max_tokens: template.max_tokens,
    refresh_mode: template.refresh_mode,
    refresh_after_consolidation: template.refresh_after_consolidation,
    exclude_all_mental_models: template.exclude_all_mental_models,
    exclude_mental_model_list: template.exclude_mental_model_list,
    tags_match_mode: template.tags_match_mode,
    tags: [`ctx-${bankId}`, template.role, `node-${node.id}`],
  };
}

/**
 * Derive an entity-capabilities mental model spec from the system template + graph node.
 */
export async function deriveEntityCapabilitiesModel(db, node, bankId) {
  const template = getContextualGraphTemplate(db, CONTEXTUAL_GRAPH_ROLES.entityCapabilities)?.data;
  if (!template) throw new Error(`Missing contextual graph template: ${CONTEXTUAL_GRAPH_ROLES.entityCapabilities}`);

  const values = {
    '{id}': node.id,
    '{entity-name}': node.displayName || node.id,
  };

  return {
    role: template.role,
    ext_id: substituteTemplateFields(template.ext_id, values),
    name: substituteTemplateFields(template.name, values),
    source_query: substituteTemplateFields(template.source_query, values),
    returns: template.returns,
    dimension: template.dimension,
    max_tokens: template.max_tokens,
    refresh_mode: template.refresh_mode,
    refresh_after_consolidation: template.refresh_after_consolidation,
    exclude_all_mental_models: template.exclude_all_mental_models,
    exclude_mental_model_list: template.exclude_mental_model_list,
    tags_match_mode: template.tags_match_mode,
    tags: [`ctx-${bankId}`, template.role, `node-${node.id}`],
  };
}

/**
 * Derive an edge-ctx mental model spec from the system template + graph edge.
 */
export async function deriveEdgeContextModel(db, sourceNode, targetNode, bankId) {
  const template = getContextualGraphTemplate(db, CONTEXTUAL_GRAPH_ROLES.edge)?.data;
  if (!template) throw new Error(`Missing contextual graph template: ${CONTEXTUAL_GRAPH_ROLES.edge}`);

  const values = {
    '{source-id}': sourceNode.id,
    '{source-name}': sourceNode.displayName || sourceNode.id,
    '{target-id}': targetNode.id,
    '{target-name}': targetNode.displayName || targetNode.id,
  };

  return {
    role: template.role,
    ext_id: substituteTemplateFields(template.ext_id, values),
    name: substituteTemplateFields(template.name, values),
    source_query: substituteTemplateFields(template.source_query, values),
    returns: template.returns,
    dimension: template.dimension,
    max_tokens: template.max_tokens,
    refresh_mode: template.refresh_mode,
    refresh_after_consolidation: template.refresh_after_consolidation,
    exclude_all_mental_models: template.exclude_all_mental_models,
    exclude_mental_model_list: template.exclude_mental_model_list,
    tags_match_mode: template.tags_match_mode,
    tags: [`ctx-${bankId}`, template.role, `pair-${sourceNode.id}|${targetNode.id}`],
  };
}

/**
 * Derive a discover-ctx mental model spec from the system template + seed node.
 */
export async function deriveDiscoverContextModel(db, seedNode, neighbors = [], bankId) {
  const template = getContextualGraphTemplate(db, CONTEXTUAL_GRAPH_ROLES.discover)?.data;
  if (!template) throw new Error(`Missing contextual graph template: ${CONTEXTUAL_GRAPH_ROLES.discover}`);

  const values = {
    '{seed-id}': seedNode.id,
    '{seed-name}': seedNode.displayName || seedNode.id,
  };

  return {
    role: template.role,
    ext_id: substituteTemplateFields(template.ext_id, values),
    name: substituteTemplateFields(template.name, values),
    source_query: substituteTemplateFields(template.source_query, values),
    returns: template.returns,
    dimension: template.dimension,
    max_tokens: template.max_tokens,
    refresh_mode: template.refresh_mode,
    refresh_after_consolidation: template.refresh_after_consolidation,
    exclude_all_mental_models: template.exclude_all_mental_models,
    exclude_mental_model_list: template.exclude_mental_model_list,
    tags_match_mode: template.tags_match_mode,
    tags: [`ctx-${bankId}`, template.role, `seed-${seedNode.id}`],
    // Pass neighbors to the deploy layer so it can include them in the prompt topic.
    neighbor_ids: neighbors.map((n) => (typeof n === 'string' ? n : n.id)),
  };
}

function normalizeTemplateRow(row) {
  return {
    id: row.mm_id,
    ext_id: row.mm_ext_id,
    name: row.mm_name,
    source_query: row.mm_source_query,
    role: row.mm_template_role,
    is_template: row.mm_is_template === 'true',
    returns: row.mm_returns,
    dimension: row.mm_dimension,
    max_tokens: row.mm_max_tokens,
    refresh_mode: row.mm_refresh_mode,
    refresh_after_consolidation: row.mm_refresh_after_consolidation === 'true',
    exclude_all_mental_models: row.mm_exclude_all_mental_models === 'true',
    exclude_mental_model_list: row.mm_exclude_mental_model_list,
    tags_match_mode: row.mm_tags_match_mode,
    tags: parseJsonArray(row.tags),
  };
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
