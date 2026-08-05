import { createLogger } from '../utils/logger.js';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { stmt } from '../cache.js';
import { startContextualGraphSyncJob } from '../services/contextual-graph/sync-job.js';
import { getAutoSyncBanks, parseRefreshInterval } from '../services/contextual-graph/server-bank-config.js';

const logger = createLogger('contextual-graph-sync-daemon');

let isRunning = false;
let loopTimer = null;

const POLL_INTERVAL_MS = config.contextualGraph.sync_daemon.poll_interval_ms;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load the last completed/failed/cancelled sync job for a server/bank.
 */
function getLastJobEndTime(serverId, bankId) {
  const row = stmt(
    db,
    `SELECT cgj_finished_at, cgj_updated_at
     FROM contextual_graph_jobs
     WHERE cgj_server_id = ? AND cgj_bank_id = ?
       AND cgj_status IN ('completed', 'failed', 'cancelled')
     ORDER BY cgj_updated_at DESC
     LIMIT 1`,
  ).get(serverId, bankId);

  if (!row) return null;
  return row.cgj_finished_at || row.cgj_updated_at || null;
}

/**
 * Determine if a bank is due for auto-sync based on its refresh_interval.
 */
function isDue(bankConfig) {
  const parsed = parseRefreshInterval(bankConfig.refresh_interval);
  if (!parsed.success) {
    logger.warn('Invalid refresh_interval for bank', {
      bankId: bankConfig.bank_id,
      error: parsed.error,
    });
    return false;
  }

  const lastEnd = getLastJobEndTime(bankConfig.server_id, bankConfig.bank_id);
  if (!lastEnd) {
    return true; // Never synced; start now.
  }

  const elapsedMinutes = (Date.now() - new Date(lastEnd).getTime()) / 60000;
  return elapsedMinutes >= parsed.minutes;
}

/**
 * Enumerate all auto-sync bank configs across all servers.
 */
function listAutoSyncBanks() {
  try {
    const servers = stmt(db, 'SELECT svr_id, svr_contextual_graph_banks FROM servers').all();
    const configs = [];
    for (const server of servers) {
      const banks = getAutoSyncBanks(server);
      for (const bank of banks) {
        configs.push({
          server_id: server.svr_id,
          bank_id: bank.bank_id,
          refresh_interval: bank.refresh_interval,
        });
      }
    }
    return configs;
  } catch (err) {
    logger.error('Failed to list auto-sync banks', { error: err.message });
    return [];
  }
}

/**
 * Try to start a sync job for one server/bank. Swallow ALREADY_RUNNING as normal.
 */
async function enqueueIfDue(configEntry) {
  const { server_id, bank_id, refresh_interval } = configEntry;

  if (!isDue(configEntry)) {
    logger.debug('Bank sync not due yet', { serverId: server_id, bankId: bank_id });
    return { skipped: true };
  }

  const result = await startContextualGraphSyncJob(db, server_id, bank_id);
  if (!result.success && result.code === 'ALREADY_RUNNING') {
    logger.debug('Sync job already running for bank', { serverId: server_id, bankId: bank_id });
    return { skipped: true, reason: 'already_running' };
  }

  if (!result.success) {
    logger.error('Failed to auto-start sync job', {
      serverId: server_id,
      bankId: bank_id,
      error: result.error,
      code: result.code,
    });
    return { failed: true, error: result.error, code: result.code };
  }

  logger.info('Auto-started contextual graph sync job', {
    serverId: server_id,
    bankId: bank_id,
    refreshInterval: refresh_interval,
    jobId: result.job?.cgj_id,
  });
  return { started: true, jobId: result.job?.cgj_id };
}

/**
 * One daemon iteration.
 */
async function tick() {
  const configs = listAutoSyncBanks();
  if (configs.length === 0) {
    logger.debug('No auto-sync banks configured');
    return;
  }

  let started = 0;
  let skipped = 0;
  let failed = 0;

  for (const configEntry of configs) {
    const outcome = await enqueueIfDue(configEntry);
    if (outcome.started) started++;
    else if (outcome.failed) failed++;
    else skipped++;
  }

  if (started > 0 || failed > 0) {
    logger.info('Auto-sync daemon tick complete', { started, skipped, failed });
  } else {
    logger.debug('Auto-sync daemon tick complete — no jobs started', { skipped });
  }
}

/**
 * Main loop. Runs immediately once on startup, then polls.
 */
async function run() {
  logger.info('Contextual-graph sync daemon starting', { pollIntervalMs: POLL_INTERVAL_MS });
  isRunning = true;

  // Run immediately on startup, then poll.
  await tick();

  while (isRunning) {
    await sleep(POLL_INTERVAL_MS);
    if (!isRunning) break;
    await tick();
  }

  logger.info('Contextual-graph sync daemon stopped');
}

function shutdown(signal) {
  logger.info(`Contextual-graph sync daemon received ${signal}, stopping`);
  isRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('disconnect', () => {
  logger.warn('IPC parent disconnected, exiting');
  process.exit(1);
});

if (config.contextualGraph.sync_daemon.enabled) {
  run().catch((error) => {
    logger.error('Contextual-graph sync daemon crashed', { error: error.message, stack: error.stack });
    process.exit(1);
  });
} else {
  logger.info('Contextual-graph sync daemon disabled via config');
}
