import { createLogger } from '../../utils/logger.js';

const logger = createLogger('contextual-graph-model-refs');

/**
 * Extract generated mental-model ext_ids from a single properties object.
 *
 * Reads every `provenance.model_refs[].ext_id`.
 * Optionally filters by role prefix (e.g. 'entity-ctx') or a matching predicate.
 *
 * @param {Object} properties
 * @param {Object} [options]
 * @param {string} [options.rolePrefix]
 * @param {Function} [options.filterFn] - receives { role, ext_id }
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
        refs.push({ role: ref.role || guessRole(ref.ext_id), ext_id: ref.ext_id });
      }
    }
  }

  const { rolePrefix, filterFn } = options;
  const filtered = refs.filter((item) => {
    if (rolePrefix && !item.role?.startsWith?.(rolePrefix)) return false;
    if (typeof filterFn === 'function' && !filterFn(item)) return false;
    return true;
  });

  return [...new Set(filtered.map((item) => item.ext_id))];
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
 * @param {string} [options.rolePrefix]
 * @param {Function} [options.filterFn]
 * @returns {{ extIds: string[], byNodeId: Map<string, string[]>, byEdgeId: Map<string, string[]> }}
 */
export function extractModelRefs(graph, options = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  const extIds = new Set();
  const byNodeId = new Map();
  const byEdgeId = new Map();

  for (const node of nodes) {
    const id = node.id ?? node.cgn_id;
    const properties = node.properties ?? node.cgn_properties;
    const refs = extractRefsFromProperties(properties, options);
    if (refs.length > 0) {
      byNodeId.set(id, refs);
      for (const extId of refs) extIds.add(extId);
    }
  }

  for (const edge of edges) {
    const id = edge.id ?? edge.cge_id;
    const properties = edge.cge_properties ?? edge.properties;
    const refs = extractRefsFromProperties(properties, options);
    if (refs.length > 0) {
      byEdgeId.set(id, refs);
      for (const extId of refs) extIds.add(extId);
    }
  }

  return {
    extIds: [...extIds],
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

function guessRole(extId) {
  if (typeof extId !== 'string') return 'model';
  if (extId.startsWith('entity-ctx-')) return 'entity-ctx';
  if (extId.startsWith('edge-ctx-')) return 'edge-ctx';
  if (extId.startsWith('discover-')) return 'discover-ctx';
  return 'model';
}

/**
 * Read the working graph from the local DB and extract all generated model refs.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @returns {Promise<{ extIds: string[], byNodeId: Map<string, string[]>, byEdgeId: Map<string, string[]> }>}
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
