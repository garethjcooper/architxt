import { createLogger } from '../../utils/logger.js';
import { listAllMentalModels, deleteMentalModel } from '../hindsight/mental-models.js';
import {
  listNodes,
  listEdges,
  upsertNode,
  upsertEdge,
  deleteAllContextualGraphNodesAndEdges,
} from '../../db/crud/contextual-graph.js';
import { getServer, updateServer } from '../../db/crud/servers.js';
import { stripModelRefsFromProperties } from './graph-model-refs.js';

const logger = createLogger('contextual-graph-undeploy');

const GENERATED_MODEL_PREFIXES = Object.freeze([
  'entity-summary-',
  'entity-capabilities-',
  'edge-ctx-',
  'discover-',
]);

/**
 * Undeploy all contextual-graph generated mental models from a Hindsight bank
 * and clean the local working graph.
 *
 * This is a user-led emergency brake. It:
 * - Disables auto-sync for the bank (sets mode to manual).
 * - Lists every mental model in the Hindsight bank and deletes any whose id
 *   matches the contextual-graph generated prefixes.
 * - Optionally deletes the entire local working graph for the bank via
 *   `options.delete_local_graph`. When true, no local stale state is kept.
 * - When `delete_local_graph` is false, it strips provenance.model_refs from
 *   local nodes/edges and marks all Hindsight-sourced nodes/edges as stale.
 *
 * It never deletes user-created nodes/edges or non-contextual-graph mental
 * models, unless `delete_local_graph` is true which removes the whole scoped
 * working graph.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {boolean} [options.dry_run] - if true, return preview without deleting
 * @param {boolean} [options.delete_local_graph] - if true, also delete all local nodes/edges for the bank
 * @param {Function} [options.listModels] - override for testing
 * @param {Function} [options.deleteModel] - override for testing
 * @returns {Promise<{success: boolean, dry_run?: boolean, stopped_auto_sync?: boolean, deleted?: string[], failed?: {ext_id: string, error: string}[], cleared?: {nodes: number, edges: number}, marked_stale?: {nodes: number, edges: number}, deleted_local_graph?: {nodes: number, edges: number}, error?: string, code?: string}>}
 */
export async function undeployContextualGraphBank(
  db,
  serverId,
  bankId,
  options = {},
) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const dryRun = options.dry_run === true;

  // 1. Disable auto-sync for this bank so the daemon cannot re-provision while
  //    cleanup is in progress.
  let stoppedAutoSync = false;
  const serverResult = getServer(db, serverId);
  if (serverResult.success && serverResult.data) {
    const banks = parseBankConfig(serverResult.data.svr_contextual_graph_banks);
    let changed = false;
    for (const bank of banks) {
      if (bank.bank_id === bankId && bank.mode === 'auto') {
        bank.mode = 'manual';
        delete bank.refresh_interval;
        changed = true;
      }
    }
    if (changed) {
      if (!dryRun) {
        const updateResult = updateServer(db, serverId, {
          svr_contextual_graph_banks: JSON.stringify(banks),
        });
        if (!updateResult.success) {
          logger.warn('Failed to disable auto-sync during undeploy', { serverId, bankId, error: updateResult.error });
        }
      }
      stoppedAutoSync = true;
    }
  }

  // 2. Identify all generated mental models in the Hindsight bank.
  const listFn = options.listModels || listAllMentalModels;
  const listResult = await listFn(serverId, bankId, { detail: 'metadata' });
  if (!listResult.success) {
    return {
      success: false,
      error: listResult.error,
      code: 'LIST_MODELS_FAILED',
    };
  }

  const allModels = listResult.mentalModels || [];
  const targetIds = allModels
    .map((m) => m.id)
    .filter((id) => typeof id === 'string' && isGeneratedModelId(id));

  if (dryRun) {
    return {
      success: true,
      dry_run: true,
      stopped_auto_sync: stoppedAutoSync,
      target_count: targetIds.length,
      target_ids: targetIds,
      delete_local_graph: options.delete_local_graph === true,
    };
  }

  // 3. Delete from Hindsight.
  const deleteFn = options.deleteModel || deleteMentalModel;
  const deleted = [];
  const failed = [];
  for (const extId of targetIds) {
    const result = await deleteFn(serverId, bankId, extId);
    if (result.success) {
      deleted.push(extId);
    } else {
      failed.push({ ext_id: extId, error: result.error });
      logger.warn('Failed to delete generated mental model', { serverId, bankId, extId, error: result.error });
    }
  }

  // 4. Clear local model_refs for the ids we attempted to remove.
  let cleared;
  let markedStale;
  let deletedLocalGraph;
  if (options.delete_local_graph === true) {
    deletedLocalGraph = deleteAllContextualGraphNodesAndEdges(db, serverId, bankId);
    cleared = { nodes: 0, edges: 0 };
    markedStale = { nodes: 0, edges: 0 };
  } else {
    const removeSet = new Set(targetIds);
    cleared = await clearLocalModelRefs(db, serverId, bankId, removeSet);
    markedStale = await markHindsightStale(db, serverId, bankId);
  }

  logger.info('Undeployed contextual graph bank', {
    serverId,
    bankId,
    stoppedAutoSync,
    targetCount: targetIds.length,
    deleted: deleted.length,
    failed: failed.length,
    cleared,
    markedStale,
    deletedLocalGraph,
    deleteLocalGraph: options.delete_local_graph === true,
  });

  return {
    success: true,
    stopped_auto_sync: stoppedAutoSync,
    deleted,
    failed,
    cleared,
    marked_stale: markedStale,
    deleted_local_graph: deletedLocalGraph,
  };
}

function isGeneratedModelId(id) {
  return GENERATED_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function parseBankConfig(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function clearLocalModelRefs(db, serverId, bankId, removeSet) {
  const [nodesResult, edgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 100000 }),
    listEdges(db, serverId, bankId, { limit: 100000 }),
  ]);

  const nodes = nodesResult.data || [];
  const edges = edgesResult.data || [];
  let nodesCleared = 0;
  let edgesCleared = 0;

  for (const node of nodes) {
    const next = stripModelRefsFromProperties(node.cgn_properties, removeSet);
    if (next) {
      upsertNode(db, serverId, bankId, node.cgn_id, node.cgn_labels, next);
      nodesCleared += 1;
    }
  }

  for (const edge of edges) {
    const next = stripModelRefsFromProperties(edge.cge_properties, removeSet);
    if (next) {
      upsertEdge(
        db,
        serverId,
        bankId,
        edge.cge_id,
        edge.cge_source_id,
        edge.cge_target_id,
        edge.cge_type,
        next,
      );
      edgesCleared += 1;
    }
  }

  return { nodes: nodesCleared, edges: edgesCleared };
}

async function markHindsightStale(db, serverId, bankId) {
  const now = new Date().toISOString();
  const [nodesResult, edgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 100000 }),
    listEdges(db, serverId, bankId, { limit: 100000 }),
  ]);

  let staleNodes = 0;
  let staleEdges = 0;

  if (nodesResult.success) {
    for (const row of nodesResult.data) {
      const labels = Array.isArray(row.cgn_labels) ? row.cgn_labels : [];
      const source = row.cgn_properties?.provenance?.source;
      if (source !== 'hindsight') continue;
      if (labels.includes('stale')) continue;

      const newLabels = labels.filter((l) => l !== 'active').concat('stale');
      const newProperties = {
        ...row.cgn_properties,
        updated_at: now,
      };
      upsertNode(db, serverId, bankId, row.cgn_id, newLabels, newProperties);
      staleNodes += 1;
    }
  }

  if (edgesResult.success) {
    for (const row of edgesResult.data) {
      const properties = row.cge_properties || {};
      const source = properties.provenance?.source;
      if (source !== 'hindsight') continue;

      const labels = Array.isArray(properties.labels) ? properties.labels : [];
      if (labels.includes('stale')) continue;

      const newLabels = labels.filter((l) => l !== 'active').concat('stale');
      const newProperties = {
        ...properties,
        labels: newLabels,
        updated_at: now,
      };
      upsertEdge(
        db,
        serverId,
        bankId,
        row.cge_id,
        row.cge_source_id,
        row.cge_target_id,
        row.cge_type,
        newProperties,
      );
      staleEdges += 1;
    }
  }

  return { nodes: staleNodes, edges: staleEdges };
}
