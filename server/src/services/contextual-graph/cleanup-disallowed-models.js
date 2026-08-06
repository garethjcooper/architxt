import { createLogger } from '../../utils/logger.js';
import { extractModelRefsFromDb } from './graph-model-refs.js';
import { deleteGeneratedModels } from './delete-generated-models.js';

const logger = createLogger('contextual-graph-cleanup');

const ROLE_TO_PREFIX = Object.freeze({
  sys_entity_summary: 'entity-summary-',
  sys_entity_capabilities: 'entity-capabilities-',
  sys_edge_context: 'edge-ctx-',
  sys_discovery_context: 'discover-',
});

/**
 * Delete generated contextual-graph mental models whose role is not in the
 * bank's allowed_model_types list, and strip their refs from the local graph.
 *
 * This is the reconcile half of a sync run: anything not allowed is removed
 * from both Hindsight and local provenance so it is no longer refreshed or
 * surfaced in the UI.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} allowedModelTypes - e.g. ['entity-summary', 'discover']
 * @param {Object} [options]
 * @param {Function} [options.deleteFromHindsight] - override for testing
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
      ? allowedModelTypes.map((t) => {
        if (t === 'entity-summary') return 'sys_entity_summary';
        if (t === 'entity-capabilities') return 'sys_entity_capabilities';
        if (t === 'edge-ctx') return 'sys_edge_context';
        if (t === 'discover') return 'sys_discovery_context';
        return t;
      })
      : [],
  );

  const refs = await extractModelRefsFromDb(db, serverId, bankId, {
    filterFn: ({ role }) => !allowedRoles.has(role),
  });

  if (refs.extIds.length === 0) {
    return {
      success: true,
      deleted: [],
      failed: [],
      cleared: { nodes: 0, edges: 0 },
    };
  }

  logger.info('Cleaning up disallowed contextual models', {
    serverId,
    bankId,
    count: refs.extIds.length,
    roles: [...allowedRoles],
  });

  return deleteGeneratedModels(db, serverId, bankId, {
    ext_ids: refs.extIds,
    deleteFromHindsight: options.deleteFromHindsight,
  });
}

/**
 * Map a canonical model type shorthand to the generated id prefix used by
 * contextual-graph mental models.
 */
export function modelTypeToPrefix(modelType) {
  return ROLE_TO_PREFIX[modelType] || null;
}
