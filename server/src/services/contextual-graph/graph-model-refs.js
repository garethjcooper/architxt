import { createLogger } from '../../utils/logger.js';
import { CONTEXTUAL_GRAPH_ROLES, ROLE_TO_MODEL_TYPE } from './template-models.js';

const logger = createLogger('contextual-graph-model-refs');

const KNOWN_ROLES = new Set(Object.values(CONTEXTUAL_GRAPH_ROLES));

/**
 * Extract generated mental-model ext_ids from a single properties object.
 *
 * Reads every `provenance.model_refs[].ext_id`.
 * Optionally filters by role (exact match) or a matching predicate.
 *
 * @param {Object} properties
 * @param {Object} [options]
 * @param {string} [options.role] - exact contextual role to include
 * @param {string} [options.rolePrefix] - kept for compat; treated as startsWith(role)
 * @param {Function} [options.filterFn] - receives { role, ext_id, scope }
 * @returns {string[]}
 */
export function extractRefsFromProperties(properties, options = {}) {
  if (!properties || typeof properties !== 'object') return [];

  const provenance = properties.provenance;
  if (!provenance || typeof provenance !== 'object') return [];

  const refs = [];

  if (Array.isArray(provenance.model_refs)) {
    for (const ref of provenance.model_refs) {
      if (ref && typeof ref.ext_id === 'string' && ref.ext_id) {
        const role = ref.role;
        if (!role || !KNOWN_ROLES.has(role)) continue;
        refs.push({ role, ext_id: ref.ext_id, scope: ref.scope });
      }
    }
  }

  const { role, rolePrefix, filterFn } = options;
  const filtered = refs.filter((item) => {
    if (role && item.role !== role) return false;
    if (rolePrefix && !item.role?.startsWith?.(rolePrefix)) return false;
    if (typeof filterFn === 'function' && !filterFn(item)) return false;
    return true;
  });

  return [...new Set(filtered.map((item) => item.ext_id))];
}

/**
 * Same as extractRefsFromProperties but returns the full ref objects.
 * Internal helper for callers that also need role and scope.
 */
function extractRefObjectsFromProperties(properties, options = {}) {
  if (!properties || typeof properties !== 'object') return [];

  const provenance = properties.provenance;
  if (!provenance || typeof provenance !== 'object') return [];

  const refs = [];

  if (Array.isArray(provenance.model_refs)) {
    for (const ref of provenance.model_refs) {
      if (ref && typeof ref.ext_id === 'string' && ref.ext_id) {
        const role = ref.role;
        if (!role || !KNOWN_ROLES.has(role)) continue;
        refs.push({ role, ext_id: ref.ext_id, scope: ref.scope });
      }
    }
  }

  const { role, rolePrefix, filterFn } = options;
  return refs.filter((item) => {
    if (role && item.role !== role) return false;
    if (rolePrefix && !item.role?.startsWith?.(rolePrefix)) return false;
    if (typeof filterFn === 'function' && !filterFn(item)) return false;
    return true;
  });
}

/**
 * Extract generated mental-model ext_ids from a working graph.
 *
 * Accepts either a raw graph object (`{ nodes, edges }`) or a DB-shaped object
 * (`{ nodes: Array<{cgn_properties}>, edges: Array<{cge_properties}> }`).
 * The function reads both `cgn_properties`/`cge_properties` and `properties`.
 *
 * @param {Object} graph
 * @param {Array<Object>} graph.nodes
 * @param {Array<Object>} graph.edges
 * @param {Object} [options]
 * @param {string} [options.role]
 * @param {string} [options.rolePrefix]
 * @param {Function} [options.filterFn]
 * @returns {{ extIds: string[], byExtId: Map<string, {role, ext_id, scope}>, byNodeId: Map<string, string[]>, byEdgeId: Map<string, string[]> }}
 */
export function extractModelRefs(graph, options = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const extIds = new Set();
  const byExtId = new Map();
  const byNodeId = new Map();
  const byEdgeId = new Map();

  for (const node of nodes) {
    const id = node.id ?? node.cgn_id;
    const properties = node.properties ?? node.cgn_properties;
    const refs = extractRefObjectsFromProperties(properties, options);
    if (refs.length > 0) {
      byNodeId.set(id, refs.map((r) => r.ext_id));
      for (const ref of refs) {
        extIds.add(ref.ext_id);
        if (!byExtId.has(ref.ext_id)) byExtId.set(ref.ext_id, ref);
      }
    }
  }

  for (const edge of edges) {
    const id = edge.id ?? edge.cge_id;
    const properties = edge.cge_properties ?? edge.properties;
    const refs = extractRefObjectsFromProperties(properties, options);
    if (refs.length > 0) {
      byEdgeId.set(id, refs.map((r) => r.ext_id));
      for (const ref of refs) {
        extIds.add(ref.ext_id);
        if (!byExtId.has(ref.ext_id)) byExtId.set(ref.ext_id, ref);
      }
    }
  }

  return {
    extIds: [...extIds],
    byExtId,
    byNodeId,
    byEdgeId,
  };
}

/**
 * Clear generated mental-model references from working-graph properties.
 *
 * Removes any `model_refs` entries whose ext_id is in the removal set.
 * If no refs remain, deletes the `provenance` block.
 *
 * @param {Object} properties
 * @param {Set<string>} extIdsToRemove
 * @returns {Object | null} updated properties, or null if unchanged
 */
export function stripModelRefsFromProperties(properties, extIdsToRemove) {
  if (!properties || typeof properties !== 'object') return null;
  const provenance = properties.provenance;
  if (!provenance || typeof provenance !== 'object') return null;

  const removeSet = new Set(extIdsToRemove);

  const remainingRefs = (provenance.model_refs || []).filter(
    (ref) => ref && typeof ref.ext_id === 'string' && !removeSet.has(ref.ext_id),
  );

  if (remainingRefs.length === (provenance.model_refs?.length || 0)) {
    return null;
  }

  const nextProvenance = { ...provenance, model_refs: remainingRefs };

  const nextProperties = { ...properties, provenance: nextProvenance };
  if (remainingRefs.length === 0) {
    delete nextProvenance.model_refs;
  }
  if (Object.keys(nextProvenance).length === 0) {
    delete nextProperties.provenance;
  }
  return nextProperties;
}

/**
 * Read the working graph from the local DB and extract all generated model refs.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @returns {Promise<{ extIds: string[], byExtId: Map<string, {role, ext_id, scope}>, byNodeId: Map<string, string[]>, byEdgeId: Map<string, string[]> }>}
 */
export async function extractModelRefsFromDb(db, serverId, bankId, options = {}) {
  const [{ listNodes }, { listEdges }] = await Promise.all([
    import('../../db/crud/contextual-graph.js'),
    import('../../db/crud/contextual-graph.js'),
  ]);

  const [nodesResult, edgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 10000 }),
    listEdges(db, serverId, bankId, { limit: 10000 }),
  ]);

  return extractModelRefs(
    { nodes: nodesResult.data || [], edges: edgesResult.data || [] },
    options,
  );
}

/**
 * Map a contextual-graph role to the model-type shorthand used in API options.
 */
export function roleToModelType(role) {
  return ROLE_TO_MODEL_TYPE[role] || null;
}
