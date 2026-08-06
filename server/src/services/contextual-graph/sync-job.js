import { randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import {
  createJob,
  hasActiveJob,
  getJob,
  updateJob,
  appendLog,
  listLogs,
  requestCancel,
  listJobs,
} from '../../db/crud/contextual-graph-jobs.js';
import { importHindsightSkeleton as defaultImportSkeleton } from './import-hindsight-skeleton.js';
import { addContext as defaultAddContext } from './add-context.js';
import { refreshContextualGraphPatches as defaultRefreshPatches } from './refresh-patches.js';
import { syncContextualMentalModelConfig as defaultSyncMentalModelConfig } from './sync-mental-model-config.js';
import { cleanupDisallowedModels as defaultCleanupDisallowedModels } from './cleanup-disallowed-models.js';

const logger = createLogger('contextual-graph-sync-job');

const STAGES = [
  { name: 'importing_skeleton', label: 'Import Hindsight skeleton' },
  { name: 'cleaning_up_models', label: 'Remove disallowed models' },
  { name: 'deploying_models', label: 'Deploy contextual models' },
  { name: 'syncing_config', label: 'Sync mental-model config' },
  { name: 'refreshing_patches', label: 'Refresh patches' },
];

/**
 * Start a new contextual graph sync job for a server/bank.
 * The runner executes in the background. The caller receives the job record.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {Object} [deps]
 * @returns {Promise<{success: boolean, job?: Object, error?: string, code?: string}>}
 */
export async function startContextualGraphSyncJob(
  db,
  serverId,
  bankId,
  options = {},
  deps = {},
) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const active = hasActiveJob(db, serverId, bankId);
  if (active.success && active.data) {
    return {
      success: false,
      error: 'A sync job is already running for this server/bank',
      code: 'ALREADY_RUNNING',
    };
  }

  const jobId = randomUUID();
  const stages = STAGES.map((s) => ({
    name: s.name,
    label: s.label,
    status: 'pending',
    started_at: null,
    finished_at: null,
    error_message: null,
    error_code: null,
    stats: {},
  }));

  const createResult = createJob(db, {
    cgj_id: jobId,
    cgj_server_id: serverId,
    cgj_bank_id: bankId,
    cgj_status: 'pending',
    cgj_stages: stages,
    cgj_options: options,
  });

  if (!createResult.success) {
    return {
      success: false,
      error: createResult.error,
      code: createResult.code || 'CREATE_JOB_FAILED',
    };
  }

  // Launch the runner in the background. The promise is intentionally not awaited.
  const runner = buildRunner(deps);
  runner(db, jobId, serverId, bankId, options).catch((err) => {
    logger.error('Sync job runner top-level error', { jobId, error: err.message });
  });

  return { success: true, job: getJob(db, jobId).data };
}

/**
 * Build the background runner function.
 */
function buildRunner(deps) {
  const importSkeleton = deps.importHindsightSkeleton || defaultImportSkeleton;
  const cleanupDisallowedModels = deps.cleanupDisallowedModels || defaultCleanupDisallowedModels;
  const addContext = deps.addContext || defaultAddContext;
  const syncMentalModelConfig = deps.syncMentalModelConfig || defaultSyncMentalModelConfig;
  const refreshPatches = deps.refreshPatches || defaultRefreshPatches;

  return async function run(db, jobId, serverId, bankId, options) {
    const start = new Date().toISOString();
    updateJob(db, jobId, { status: 'running', started_at: start });
    appendLog(db, jobId, {
      stage: null,
      level: 'info',
      message: `Sync job started for ${bankId} on server ${serverId}`,
      details: { options },
    });

    const stats = {
      import: {},
      cleanup: {},
      deploy: {},
      sync: {},
      refresh: {},
    };

    try {
      await runStage(db, jobId, 'importing_skeleton', async () => {
        const restriction = options.restriction?.import || {};
        const result = await importSkeleton(db, serverId, bankId, {
          min_count: options.min_count,
          min_weight: options.min_weight,
          top_k_nodes: restriction.top_k_nodes,
          include_patterns: restriction.include_patterns,
          exclude_patterns: restriction.exclude_patterns,
        });
        if (!result.success) {
          throw new StageError(result.error, result.code || 'IMPORT_FAILED');
        }
        stats.import = result;
        return result;
      });

      const allowedModelTypes = options.restriction?.deploy?.allowed_model_types;

      await runStage(db, jobId, 'cleaning_up_models', async () => {
        const result = await cleanupDisallowedModels(db, serverId, bankId, allowedModelTypes);
        if (!result.success) {
          throw new StageError(result.error, result.code || 'CLEANUP_FAILED');
        }
        stats.cleanup = result;
        return result;
      });

      await runStage(db, jobId, 'deploying_models', async () => {
        const restriction = options.restriction?.deploy || {};
        const deployOptions = {
          import_skeleton: false,
          node_ids: options.node_ids,
          seed_node_ids: options.seed_node_ids,
          neighborhood: options.neighborhood,
          allowed_model_types: restriction.allowed_model_types,
          max_models_per_run: restriction.max_models_per_run,
          include_node_ids: restriction.include_node_ids,
          exclude_node_ids: restriction.exclude_node_ids,
        };
        const result = await addContext(db, serverId, bankId, deployOptions);
        if (!result.success) {
          throw new StageError(result.error, result.code || 'DEPLOY_FAILED');
        }
        stats.deploy = result;
        return result;
      });

      const syncResult = await runStage(db, jobId, 'syncing_config', async () => {
        const result = await syncMentalModelConfig(db, serverId, bankId, { dryRun: false });
        if (!result.success) {
          throw new StageError(result.error, result.code || 'SYNC_CONFIG_FAILED');
        }
        stats.sync = result;
        return result;
      });

      await runStage(db, jobId, 'refreshing_patches', async () => {
        const result = await refreshPatches(db, serverId, bankId, {
          dryRun: false,
          rerunExtIds: syncResult?.updatedExtIds || [],
          newlyDeployedExtIds: stats.deploy?.pushed || [],
        });
        if (!result.success) {
          throw new StageError(result.error, result.code || 'REFRESH_FAILED');
        }
        stats.refresh = result;
        return result;
      });

      const finishedAt = new Date().toISOString();
      const issueCount = countIssues(stats);
      stats.issue_count = issueCount;
      updateJob(db, jobId, {
        status: 'completed',
        finished_at: finishedAt,
        stats,
      });
      appendLog(db, jobId, {
        stage: null,
        level: issueCount > 0 ? 'warn' : 'info',
        message: issueCount > 0 ? `Sync job completed with ${issueCount} issue(s)` : 'Sync job completed',
        details: { stats },
      });
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const status = err.code === 'CANCELLED' ? 'cancelled' : 'failed';
      const issueCount = countIssues(stats);
      stats.issue_count = issueCount;
      updateJob(db, jobId, {
        status,
        finished_at: finishedAt,
        error_message: err.message,
        error_code: err.code || 'UNKNOWN',
        stats,
      });
      appendLog(db, jobId, {
        stage: err.stage || null,
        level: status === 'cancelled' ? 'warn' : 'error',
        message: err.message,
        details: { code: err.code || 'UNKNOWN' },
      });
      logger.error('Sync job failed', { jobId, stage: err.stage, error: err.message });
    }
  };
}

class StageError extends Error {
  constructor(message, code, stage) {
    super(message);
    this.code = code;
    this.stage = stage;
  }
}

/**
 * Count partial-failure issues across stage stats.
 * Prefer the explicit errors array; fall back to failed/rerunFailed counts
 * when no per-item error list is provided. Do not add them together, because
 * `failed` is usually just the cardinality of `errors`.
 */
function countIssues(stats) {
  let count = 0;
  for (const key of Object.keys(stats || {})) {
    if (key === 'issue_count') continue;
    const stageStats = stats[key]?.stats || stats[key] || {};
    if (Array.isArray(stageStats.errors)) {
      count += stageStats.errors.length;
    } else {
      if (typeof stageStats.failed === 'number' && stageStats.failed > 0) count += stageStats.failed;
      if (typeof stageStats.rerunFailed === 'number' && stageStats.rerunFailed > 0) count += stageStats.rerunFailed;
    }
  }
  return count;
}

function countStageIssues(result) {
  const stats = result?.stats || result || {};
  if (Array.isArray(stats.errors)) return stats.errors.length;
  let count = 0;
  if (typeof stats.failed === 'number' && stats.failed > 0) count += stats.failed;
  if (typeof stats.rerunFailed === 'number' && stats.rerunFailed > 0) count += stats.rerunFailed;
  return count;
}

async function runStage(db, jobId, stageName, fn) {
  const stageStart = new Date().toISOString();
  updateStageState(db, jobId, stageName, { status: 'running', started_at: stageStart });
  appendLog(db, jobId, {
    stage: stageName,
    level: 'info',
    message: `Stage ${stageName} started`,
  });

  try {
    const result = await fn();
    const stageFinished = new Date().toISOString();
    const stageIssueCount = countStageIssues(result);
    updateStageState(db, jobId, stageName, {
      status: stageIssueCount > 0 ? 'completed_with_issues' : 'completed',
      finished_at: stageFinished,
      stats: result,
      issue_count: stageIssueCount,
    });
    appendLog(db, jobId, {
      stage: stageName,
      level: stageIssueCount > 0 ? 'warn' : 'info',
      message: stageIssueCount > 0 ? `Stage ${stageName} completed with ${stageIssueCount} issue(s)` : `Stage ${stageName} completed`,
      details: result,
    });
    return result;
  } catch (err) {
    const stageFinished = new Date().toISOString();
    updateStageState(db, jobId, stageName, {
      status: 'failed',
      finished_at: stageFinished,
      error_message: err.message,
      error_code: err.code || 'UNKNOWN',
    });
    throw new StageError(err.message, err.code || 'UNKNOWN', stageName);
  }
}

function updateStageState(db, jobId, stageName, updates) {
  const jobResult = getJob(db, jobId);
  if (!jobResult.success || !jobResult.data) return;
  const stages = jobResult.data.stages.map((s) =>
    s.name === stageName ? { ...s, ...updates } : s
  );
  updateJob(db, jobId, { stages });
}

/**
 * Cancel a running or pending job.
 */
export function cancelContextualGraphSyncJob(db, jobId) {
  const jobResult = getJob(db, jobId);
  if (!jobResult.success || !jobResult.data) {
    return { success: false, error: 'Job not found', code: 'NOT_FOUND' };
  }
  if (!['pending', 'running'].includes(jobResult.data.status)) {
    return { success: false, error: 'Job is not active', code: 'NOT_ACTIVE' };
  }
  const ok = requestCancel(db, jobId);
  if (!ok.success || !ok.data) {
    return { success: false, error: 'Failed to cancel job', code: 'CANCEL_FAILED' };
  }
  appendLog(db, jobId, {
    stage: null,
    level: 'warn',
    message: 'Job cancellation requested',
  });
  return { success: true };
}

/**
 * Get a job with its logs.
 */
export function getContextualGraphSyncJob(db, jobId, { limit = 200, offset = 0 } = {}) {
  const jobResult = getJob(db, jobId);
  if (!jobResult.success || !jobResult.data) {
    return { success: false, error: 'Job not found', code: 'NOT_FOUND' };
  }
  const logsResult = listLogs(db, jobId, { limit, offset });
  return {
    success: true,
    job: { ...jobResult.data, logs: logsResult.success ? logsResult.data : [] },
  };
}

/**
 * List jobs for a scope.
 */
export function listContextualGraphSyncJobs(db, { serverId, bankId, status, since, until, limit = 50, offset = 0 } = {}) {
  return listJobs(db, { serverId, bankId, status, since, until, limit, offset });
}
