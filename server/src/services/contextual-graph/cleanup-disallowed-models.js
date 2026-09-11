import { createLogger } from '../../utils/logger.js';
import { extractModelRefsFromDb, stripModelRefsFromProperties } from './graph-model-refs.js';
import { deleteMentalModel, listAllMentalModels } from '../hindsight/mental-models.js';
import {
  deleteNode,
  deleteEdge,
  listNodes,
  listEdges,
  upsertNode,
  upsertEdge,
} from '../../db/crud/contextual-graph.js';
import { MODEL_TYPE_TO_ROLE, ROLE_TO_MODEL_TYPE, getRoleScopeMap } from '../../db/crud/template-roles.js';

const logger = createLogger('contextual-graph-cleanup');

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
 * checking the known contextual id prefixes so orphaned models that no longer
 * have local refs are also purged.
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

  const scopeMap = getRoleScopeMap(db);
  const knownRoleIds = new Set(scopeMap.keys());

  const allowedRoles = new Set(
    Array.isArray(allowedModelTypes)
      ? allowedModelTypes.map((t) => MODEL_TYPE_TO_ROLE[t] || t).filter((r) => knownRoleIds.has(r))
      : [],
  );

  const disallowedRoles = [...knownRoleIds].filter((role) => !allowedRoles.has(role));

  // Use Hindsight as the source of truth for remote models so orphaned models
  // (whose local refs were already stripped) are also deleted.
  const listModels = options.listMentalModels || listAllMentalModels;
  const listResult = await listModels(serverId, bankId, { detail: 'metadata' });
  if (!listResult.success) {
    return { success: false, error: listResult.error, code: 'LIST_MODELS_FAILED' };
  }

  const remoteModels = listResult.mentalModels || [];
  const disallowedRemoteModels = remoteModels.filter((model) => {
    const role = roleFromExtId(model.id, scopeMap);
    return knownRoleIds.has(role) && !allowedRoles.has(role);
  });

  const refs = await extractModelRefsFromDb(db, serverId, bankId, {
    filterFn: ({ role }) => knownRoleIds.has(role) && !allowedRoles.has(role),
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
  const cleared = await clearLocalModelData(db, serverId, bankId, removeSet, refs, scopeMap);

  return {
    success: true,
    deleted,
    failed,
    cleared,
  };
}

export async function clearLocalModelData(db, serverId, bankId, removeSet, refs, scopeMap) {
  const byRole = new Map();
  for (const extId of removeSet) {
    const role = refs.byExtId?.get(extId)?.role || roleFromExtId(extId, scopeMap);
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
  const discoveryRoles = new Set();
  for (const [role, scope] of scopeMap) {
    if (scope === 'seed') discoveryRoles.add(role);
  }

  const discoveryIds = new Set();
  for (const role of discoveryRoles) {
    const ids = byRole.get(role);
    if (ids) {
      for (const id of ids) discoveryIds.add(id);
    }
  }

  if (discoveryIds.size > 0) {
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
      const isOwnSeed = refs.byNodeId.get(node.cgn_id)?.some((extId) => {
        const ref = refs.byExtId?.get(extId);
        return discoveryRoles.has(ref?.role) && ref?.scope?.seed_id === node.cgn_id;
      });
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

    const disallowedRefsOnNode = refs.byNodeId.get(node.cgn_id) || [];
    changed = clearNodeRoleData(effectiveProperties, scopeMap, node.cgn_id, disallowedRefsOnNode, refs) || changed;
    changed = clearSeedRoleData(effectiveProperties, scopeMap, node.cgn_id, disallowedRefsOnNode, refs) || changed;

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
    const edgeCtxRefsOnEdge = disallowedRefsOnEdge.filter((extId) => {
      const role = refs.byExtId?.get(extId)?.role || roleFromExtId(extId, scopeMap);
      return scopeMap.get(role) === 'edge';
    });

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

function clearNodeRoleData(properties, _scopeMap, nodeId, disallowedRefsOnNode, refs) {
  let changed = false;

  // Map node-scoped roles to the canonical fields they generate. When a role is
  // disallowed, only the fields it owns are removed, so other allowed node
  // scoped roles (e.g. capabilities) remain untouched.
  const ROLE_FIELDS = {
    sys_entity_summary: ['summary'],
    sys_entity_capabilities: ['capabilities'],
  };

  const seenRoles = new Set(
    disallowedRefsOnNode.map((extId) => refs.byExtId?.get(extId)?.role).filter(Boolean),
  );

  for (const role of seenRoles) {
    const fields = ROLE_FIELDS[role];
    if (!fields) continue;
    for (const field of fields) {
      if (properties[field] !== undefined) {
        delete properties[field];
        changed = true;
      }
    }
  }

  return changed;
}

function clearSeedRoleData(properties, scopeMap, nodeId, disallowedRefsOnNode, refs) {
  let changed = false;

  // Clear discovery-only display_name overrides for discovered nodes.
  const seedRoles = new Set();
  for (const [role, scope] of scopeMap) {
    if (scope === 'seed') seedRoles.add(role);
  }
  const hasDiscoveryRef = disallowedRefsOnNode.some((extId) => {
    const role = refs.byExtId?.get(extId)?.role;
    return seedRoles.has(role);
  });
  if (hasDiscoveryRef) {
    if (properties.display_name !== undefined && nodeId.startsWith('discovered-')) {
      delete properties.display_name;
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

/**
 * Infer role from the known contextual-graph ext_id prefixes and the
 * configured template_roles table. For remote models where no local ref exists
 * yet, we map legacy model-type prefixes to role IDs; local refs always carry
 * an explicit role.
 */
function roleFromExtId(extId, scopeMap) {
  if (typeof extId !== 'string') return 'model';
  for (const [role, modelType] of Object.entries(ROLE_TO_MODEL_TYPE)) {
    const prefix = `${modelType}-`;
    if (extId.startsWith(prefix)) return role;
  }
  // Fallback: match any configured role prefix derived from its display name
  // or role_id is not reliable, so only legacy prefixes are supported here.
  return 'model';
}
