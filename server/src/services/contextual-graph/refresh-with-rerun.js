import { refreshMentalModel as refreshHindsightMentalModel, listAllMentalModels } from '../../services/hindsight/mental-models.js';
import { getOperation } from '../../services/hindsight/memories.js';
import { syncContextualMentalModelConfig } from './sync-mental-model-config.js';
import { refreshContextualGraphPatches as defaultRefreshPatches } from './refresh-patches.js';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { createPendingOperation } from '../../db/crud/pending-operations.js';

const logger = createLogger('contextual-graph-refresh-with-rerun');

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_POLL_MS = 120000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollOperationCompletion(serverId, bankId, operationId, options = {}) {
  const maxPollMs = options.maxPollMs ?? DEFAULT_MAX_POLL_MS;
  const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + maxPollMs;

  while (Date.now() < deadline) {
    const result = await getOperation(serverId, bankId, operationId);
    if (!result.success) {
      return { success: false, error: result.error, timedOut: false };
    }

    const status = result.operation?.status || result.operation?.state;
    if (status === 'completed' || status === 'success') {
      return { success: true, operation: result.operation, timedOut: false };
    }
    if (status === 'failed' || status === 'error') {
      return {
        success: false,
        error: result.operation?.error || `Operation ${operationId} failed`,
        operation: result.operation,
        timedOut: false,
      };
    }

    await sleep(intervalMs);
  }

  return { success: false, error: `Timed out waiting for operation ${operationId}`, timedOut: true };
}

/**
 * Full contextual-graph refresh with optional re-run.
 *
 * When rerun=true:
 *   1. Push local system-template config changes to Hindsight.
 *   2. Trigger Hindsight refresh for every enabled contextual mental model.
 *   3. Poll each operation to completion.
 *   4. Fetch the new model content and apply patches.
 *
 * When rerun=false: delegates to the standard refresh path.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {object} [options]
 * @param {boolean} [options.rerun=false]
 * @param {boolean} [options.dryRun=false]
 * @param {Function} [options.refreshPatches]
 * @returns {Promise<{success: boolean, stats: object, error?: string}>}
 */
export async function refreshContextualGraphWithRerun(db, serverId, bankId, options = {}) {
  const rerun = options.rerun === true;
  const dryRun = options.dryRun === true;
  const refreshPatches = options.refreshPatches || defaultRefreshPatches;

  if (!rerun) {
    return refreshPatches(db, serverId, bankId, { dryRun });
  }

  const patchRoles = config.contextualGraph?.patchRoles || {};

  const stats = {
    synced: 0,
    rerunQueued: 0,
    rerunCompleted: 0,
    rerunFailed: 0,
    rerunTimedOut: 0,
    refresh: null,
    errors: [],
  };

  try {
    // 1. Push any local config changes to Hindsight.
    const syncResult = await syncContextualMentalModelConfig(db, serverId, bankId, { dryRun });
    if (!syncResult.success) {
      return { success: false, error: syncResult.error, stats };
    }
    stats.synced = syncResult.stats?.updated ?? 0;
    if (dryRun) {
      return { success: true, stats };
    }

    // 2. Fetch the current contextual mental models so we can re-run the enabled ones.
    const listResult = await listAllMentalModels(serverId, bankId, { detail: 'metadata' });
    if (!listResult.success) {
      return { success: false, error: listResult.error, stats };
    }

    const contextualRoles = ['sys_entity_summary', 'sys_entity_capabilities', 'sys_edge_context', 'sys_discovery_context'];
    const enabledModels = (listResult.mentalModels || []).filter((mm) => {
      const role = mm.dimension || mm.role;
      return contextualRoles.includes(role) && patchRoles[role] === true;
    });

    // 3. Trigger Hindsight refresh for each enabled model.
    const operationIds = [];
    for (const model of enabledModels) {
      const refreshResult = await refreshHindsightMentalModel(serverId, bankId, model.id);
      if (!refreshResult.success) {
        stats.rerunFailed += 1;
        stats.errors.push({ extId: model.id, error: refreshResult.error });
        logger.error('Failed to queue contextual mental model re-run', { extId: model.id, error: refreshResult.error });
        continue;
      }

      stats.rerunQueued += 1;
      operationIds.push({ extId: model.id, operationId: refreshResult.operationId });

      if (refreshResult.operationId) {
        const createResult = createPendingOperation(db, {
          pop_operation_id: refreshResult.operationId,
          pop_server_id: serverId,
          pop_bank_id: bankId,
          pop_ext_id: model.id,
          pop_action: 'contextual-refresh',
          pop_status: refreshResult.status || 'pending',
        });
        if (!createResult.success) {
          logger.error('Failed to track contextual refresh operation', { extId: model.id, operationId: refreshResult.operationId, error: createResult.error });
        }
      }
    }

    // 4. Poll each operation to completion.
    for (const { extId, operationId } of operationIds) {
      const pollResult = await pollOperationCompletion(serverId, bankId, operationId, {
        maxPollMs: config.contextualGraph?.rerun_poll_timeout_ms || DEFAULT_MAX_POLL_MS,
        pollIntervalMs: config.contextualGraph?.rerun_poll_interval_ms || DEFAULT_POLL_INTERVAL_MS,
      });
      if (!pollResult.success) {
        if (pollResult.timedOut) {
          stats.rerunTimedOut += 1;
        } else {
          stats.rerunFailed += 1;
        }
        stats.errors.push({ extId, error: pollResult.error });
        logger.error('Contextual mental model re-run did not complete', { extId, operationId, error: pollResult.error });
        continue;
      }
      stats.rerunCompleted += 1;
    }

    // 5. Fetch new content and apply patches.
    const refreshResult = await refreshPatches(db, serverId, bankId, { dryRun });
    if (!refreshResult.success) {
      return { success: false, error: refreshResult.error, stats };
    }
    stats.refresh = refreshResult.stats;

    return { success: true, stats };
  } catch (err) {
    logger.error('refreshContextualGraphWithRerun failed', { serverId, bankId, error: err.message });
    return { success: false, error: err.message, stats };
  }
}
