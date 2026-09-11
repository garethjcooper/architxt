import { createLogger } from '../../utils/logger.js';
import {
  extractModelRefs,
  extractModelRefsFromDb,
  stripModelRefsFromProperties,
} from './graph-model-refs.js';
import { deleteMentalModel } from '../hindsight/mental-models.js';
import { listNodes, listEdges, upsertNode, upsertEdge } from '../../db/crud/contextual-graph.js';

const logger = createLogger('contextual-graph-delete-generated');

/**
 * Delete generated contextual-graph mental models from Hindsight and clear
 * their references from the local working graph.
 *
 * This is intentionally a user-led iteration helper, not an automatic lifecycle
 * operation. It removes remote models by `ext_id` and strips the matching
 * `provenance.model_refs` entries from node/edge properties so re-running
 * `addContext` will recreate them.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {string[]} [options.ext_ids] - explicit list; if omitted, parsed from working graph
 * @param {string} [options.role] - only delete refs with this exact role
 * @param {Function} [options.filterFn] - receives { role, ext_id, scope }
 * @param {boolean} [options.dry_run] - if true, do not delete anything
 * @param {Function} [options.deleteFromHindsight] - override for testing
 * @returns {Promise<{success: boolean, dry_run?: boolean, deleted?: string[], failed?: {ext_id: string, error: string}[], cleared?: {nodes: number, edges: number}, error?: string, code?: string}>}
 */
export async function deleteGeneratedModels(
  db,
  serverId,
  bankId,
  options = {},
) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  let extIds;
  if (Array.isArray(options.ext_ids) && options.ext_ids.length > 0) {
    extIds = [...new Set(options.ext_ids.filter((id) => typeof id === 'string' && id))];
  } else {
    const refs = await extractModelRefsFromDb(db, serverId, bankId, {
      role: options.role,
      filterFn: options.filterFn,
    });
    extIds = refs.extIds;
  }

  if (extIds.length === 0) {
    return {
      success: true,
      dry_run: options.dry_run === true,
      deleted: [],
      failed: [],
      cleared: { nodes: 0, edges: 0 },
    };
  }

  if (options.dry_run) {
    return {
      success: true,
      dry_run: true,
      deleted: [],
      failed: [],
      cleared: { nodes: 0, edges: 0 },
      ext_ids: extIds,
    };
  }

  const removeSet = new Set(extIds);
  const deleteFn = options.deleteFromHindsight || deleteMentalModel;

  const deleted = [];
  const failed = [];
  for (const extId of extIds) {
    const result = await deleteFn(serverId, bankId, extId);
    if (result.success) {
      deleted.push(extId);
    } else {
      failed.push({ ext_id: extId, error: result.error });
    }
  }

  // Always clear local refs for ids we attempted to delete, even if the remote
  // call failed. The remote model is either gone or the user can retry; leaving
  // stale provenance blocks re-runs.
  const cleared = await clearLocalModelRefs(db, serverId, bankId, removeSet);

  return {
    success: true,
    deleted,
    failed,
    cleared,
  };
}

async function clearLocalModelRefs(db, serverId, bankId, removeSet) {
  const [nodesResult, edgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 10000 }),
    listEdges(db, serverId, bankId, { limit: 10000 }),
  ]);

  const nodes = nodesResult.data || [];
  const edges = edgesResult.data || [];
  let nodesCleared = 0;
  let edgesCleared = 0;

  for (const node of nodes) {
    const next = stripModelRefsFromProperties(node.properties ?? node.cgn_properties, removeSet);
    if (next) {
      upsertNode(db, serverId, bankId, node.cgn_id, node.cgn_labels, next);
      nodesCleared += 1;
    }
  }

  for (const edge of edges) {
    const next = stripModelRefsFromProperties(edge.properties ?? edge.cge_properties, removeSet);
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
