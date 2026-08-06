import { createLogger } from '../../utils/logger.js';
import { extractModelRefsFromDb, stripModelRefsFromProperties } from './graph-model-refs.js';
import { deleteMentalModel, listAllMentalModels } from '../hindsight/mental-models.js';
import {
  listNodes,
  listEdges,
  upsertNode,
  upsertEdge,
  deleteNode,
  deleteEdge,
} from '../../db/crud/contextual-graph.js';

const logger = createLogger('contextual-graph-cleanup');

const ROLE_TO_PREFIX = Object.freeze({
  sys_entity_summary: 'entity-summary-',
  sys_entity_capabilities: 'entity-capabilities-',
  sys_edge_context: 'edge-ctx-',
  sys_discovery_context: 'discover-',
});

const MODEL_TYPE_TO_ROLE = Object.freeze({
  'entity-summary': 'sys_entity_summary',
  'entity-capabilities': 'sys_entity_capabilities',
  'edge-ctx': 'sys_edge_context',
  discover: 'sys_discovery_context',
});

const ROLES = Object.freeze({
  entitySummary: 'sys_entity_summary',
  entityCapabilities: 'sys_entity_capabilities',
  edgeContext: 'sys_edge_context',
  discoveryContext: 'sys_discovery_context',
});

/**
 * Delete generated contextual-graph mental models whose role is not in the
 * bank's allowed_model_types list, remove any applied mental-model data they
 * produced (summaries, capabilities, generated edges, discovered subgraphs),
 * and strip their refs from the local graph.
 *
 * This is the reconcile half of a sync run: anything not allowed is removed
 * from both Hindsight and the local working graph so it is no longer refreshed
 * or surfaced in the UI.
 *
 * Hindsight is the source of truth for which remote models exist; we delete by
 * role prefix so orphaned models that no longer have local refs are also purged.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} allowedModelTypes - e.g. ['entity-summary', 'discover']
 * @param {Object} [options]
 * @param {Function} [options.deleteFromHindsight] - override for testing
 * @param {Function} [options.listMentalModels] - override for testing
 * @returns {Promise<{success: boolean, deleted?: string[], failed?: {ext_id: string, error: string}[], cleared?: {nodes: number, edges: number}, error?: string, code?: string}>}
 */
export async function cleanupDisallowedModels(
  db,
  serverId,
  bankId,
  allowedModelTypes,
  options = {},
) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const allowedRoles = new Set(
    Array.isArray(allowedModelTypes)
      ? allowedModelTypes.map((t) => MODEL_TYPE_TO_ROLE[t] || t)
      : [],
  );

  const KNOWN_ROLES = new Set([
    'sys_entity_summary',
    'sys_entity_capabilities',
    'sys_edge_context',
    'sys_discovery_context',
  ]);

  const disallowedRoles = [...KNOWN_ROLES].filter((role) => !allowedRoles.has(role));

  // Use Hindsight as the source of truth for remote models so orphaned models
  // (whose local refs were already stripped) are also deleted.
  const listModels = options.listMentalModels || listAllMentalModels;
  const listResult = await listModels(serverId, bankId, { detail: 'metadata' });
  if (!listResult.success) {
    return { success: false, error: listResult.error, code: 'LIST_MODELS_FAILED' };
  }

  const remoteModels = listResult.mentalModels || [];
  const disallowedRemoteModels = remoteModels.filter((model) => {
    const role = inferRoleFromExtId(model.id);
    return KNOWN_ROLES.has(role) && !allowedRoles.has(role);
  });

  const refs = await extractModelRefsFromDb(db, serverId, bankId, {
    filterFn: ({ role }) => KNOWN_ROLES.has(role) && !allowedRoles.has(role),
  });

  const removeSet = new Set([
    ...disallowedRemoteModels.map((model) => model.id),
    ...refs.extIds,
  ]);

  logger.info('Cleaning up disallowed contextual models', {
    serverId,
    bankId,
    disallowedRoles,
    remoteCount: disallowedRemoteModels.length,
    localRefCount: refs.extIds.length,
    total: removeSet.size,
  });

  const deleteFn = options.deleteFromHindsight || deleteMentalModel;

  const deleted = [];
  const failed = [];
  for (const extId of removeSet) {
    const result = await deleteFn(serverId, bankId, extId);
    if (result.success) {
      deleted.push(extId);
    } else {
      failed.push({ ext_id: extId, error: result.error });
    }
  }

  // Always clear local applied data and provenance for ids we attempted to
  // delete, even if the remote call failed. The remote model is either gone or
  // the user can retry; leaving stale generated data in the graph is the
  // symptom we are fixing.
  const cleared = await clearLocalModelData(db, serverId, bankId, removeSet, refs);

  return {
    success: true,
    deleted,
    failed,
    cleared,
  };
}

async function clearLocalModelData(db, serverId, bankId, removeSet, refs) {
  const byRole = new Map();
  for (const extId of removeSet) {
    const role = inferRoleFromExtId(extId);
    if (!byRole.has(role)) byRole.set(role, new Set());
    byRole.get(role).add(extId);
  }

  const [nodesResult, edgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 10000 }),
    listEdges(db, serverId, bankId, { limit: 10000 }),
  ]);

  const nodes = nodesResult.data || [];
  const edges = edgesResult.data || [];

  let nodesCleared = 0;
  let edgesCleared = 0;

  const deletedNodeIds = new Set();
  const deletedEdgeIds = new Set();

  // 1. Discovery cleanup first, using the original snapshot so ref-stripping
  //    later does not hide the nodes/edges we need to remove.
  const discoveryIds = byRole.get(ROLES.discoveryContext);
  if (discoveryIds && discoveryIds.size > 0) {
    for (const edge of edges) {
      const disallowedRefsOnEdge = refs.byEdgeId.get(edge.cge_id) || [];
      if (disallowedRefsOnEdge.some((extId) => discoveryIds.has(extId))) {
        deleteEdge(db, serverId, bankId, edge.cge_id);
        edgesCleared += 1;
        deletedEdgeIds.add(edge.cge_id);
      }
    }

    for (const node of nodes) {
      const disallowedRefsOnNode = refs.byNodeId.get(node.cgn_id) || [];
      if (!disallowedRefsOnNode.some((extId) => discoveryIds.has(extId))) continue;

      // Preserve nodes that are seeds for their own discovery model.
      const isOwnSeed = disallowedRefsOnNode.some((extId) => extId === `discover-${node.cgn_id}`);
      if (isOwnSeed) continue;

      deleteNode(db, serverId, bankId, node.cgn_id);
      nodesCleared += 1;
      deletedNodeIds.add(node.cgn_id);
    }
  }

  // 2. Strip refs and clear applied role data for remaining nodes/edges.
  for (const node of nodes) {
    if (deletedNodeIds.has(node.cgn_id)) continue;

    const properties = node.cgn_properties || node.properties || {};
    const nextProperties = stripModelRefsFromProperties(properties, removeSet);
    const effectiveProperties = nextProperties || { ...properties };

    let changed = nextProperties !== null;
    changed = clearNodeRoleData(effectiveProperties, byRole, node.cgn_id) || changed;

    if (changed) {
      cleanupEmptyProvenance(effectiveProperties);
      upsertNode(db, serverId, bankId, node.cgn_id, node.cgn_labels, effectiveProperties);
      nodesCleared += 1;
    }
  }

  for (const edge of edges) {
    if (deletedEdgeIds.has(edge.cge_id)) continue;

    const properties = edge.cge_properties || edge.properties || {};
    const disallowedRefsOnEdge = refs.byEdgeId.get(edge.cge_id) || [];
    const edgeCtxRefsOnEdge = disallowedRefsOnEdge.filter((extId) => extId.startsWith('edge-ctx-'));

    const nextProperties = stripModelRefsFromProperties(properties, removeSet);
    const effectiveProperties = nextProperties || { ...properties };
    const remainingModelRefs = (effectiveProperties.provenance?.model_refs || []).filter(
      (ref) => ref && ref.ext_id && !removeSet.has(ref.ext_id),
    );

    let changed = nextProperties !== null;

    // Delete directed edge-ctx edges that were generated by a removed model and
    // have no remaining contextual model refs. We only delete if this specific
    // edge carried a removed edge-ctx ref.
    if (
      edgeCtxRefsOnEdge.length > 0 &&
      properties.directed === true &&
      (properties.label !== undefined || properties.detail !== undefined || properties.evidence !== undefined) &&
      remainingModelRefs.length === 0
    ) {
      deleteEdge(db, serverId, bankId, edge.cge_id);
      edgesCleared += 1;
      continue;
    }

    if (changed) {
      cleanupEmptyProvenance(effectiveProperties);
      upsertEdge(
        db,
        serverId,
        bankId,
        edge.cge_id,
        edge.cge_source_id,
        edge.cge_target_id,
        edge.cge_type,
        effectiveProperties,
      );
      edgesCleared += 1;
    }
  }

  return { nodes: nodesCleared, edges: edgesCleared };
}

function clearNodeRoleData(properties, byRole, nodeId) {
  let changed = false;

  const entitySummaryExtIds = byRole.get(ROLES.entitySummary);
  if (entitySummaryExtIds && entitySummaryExtIds.has(`entity-summary-${nodeId}`)) {
    if (properties.summary !== undefined) {
      delete properties.summary;
      changed = true;
    }
  }

  const entityCapabilitiesExtIds = byRole.get(ROLES.entityCapabilities);
  if (entityCapabilitiesExtIds && entityCapabilitiesExtIds.has(`entity-capabilities-${nodeId}`)) {
    if (properties.capabilities !== undefined) {
      delete properties.capabilities;
      changed = true;
    }
  }

  return changed;
}

function cleanupEmptyProvenance(properties) {
  const provenance = properties.provenance;
  if (!provenance || typeof provenance !== 'object') return;
  if (Array.isArray(provenance.model_refs) && provenance.model_refs.length === 0) {
    delete provenance.model_refs;
  }
  if (Object.keys(provenance).length === 0) {
    delete properties.provenance;
  }
}

function inferRoleFromExtId(extId) {
  if (typeof extId !== 'string') return 'model';
  if (extId.startsWith('entity-summary-')) return ROLES.entitySummary;
  if (extId.startsWith('entity-capabilities-')) return ROLES.entityCapabilities;
  if (extId.startsWith('edge-ctx-')) return ROLES.edgeContext;
  if (extId.startsWith('discover-')) return ROLES.discoveryContext;
  return 'model';
}

/**
 * Map a canonical model type shorthand to the generated id prefix used by
 * contextual-graph mental models.
 */
export function modelTypeToPrefix(modelType) {
  return ROLE_TO_PREFIX[modelType] || null;
}
