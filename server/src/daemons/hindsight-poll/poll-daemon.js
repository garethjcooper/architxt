/**
 * Hindsight Poll Daemon
 *
 * Background process that polls Hindsight servers for pending operation status.
 * Forked from server/src/index.js alongside the extract daemon.
 *
 * Responsibilities:
 * 1. Query pending_operations WHERE status='pending'
 * 2. Group by server_id+bank_id
 * 3. Call Hindsight listOperations for each group
 * 4. Update local DB rows to completed/failed
 * 5. Mark stale (unknown) ops as failed
 * 6. Sleep and repeat
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { listOperations, getOperation } from '../../services/hindsight/memories.js';
import {
  updatePendingOperationStatus,
  getPendingOperationsForPoll,
} from '../../db/crud/pending-operations.js';

const logger = createLogger('hindsight-poll-daemon');

const POLL_INTERVAL_MS = config.hindsightPollDaemon?.poll_interval_ms || 5000;
const STALE_THRESHOLD_MS = config.hindsightPollDaemon?.stale_threshold_ms || 300000; // 5 min

const PAGE_SIZE = 100;
const MAX_PAGES_PER_STATUS = 100; // emergency circuit breaker (10k ops per status)
const PER_OP_LOOKUP_CONCURRENCY = 10;

let db = null;
let isRunning = false;

/**
 * Open a dedicated database connection for this daemon process.
 * Unlike import { db } from '../../db/connection.js', this creates a fresh connection
 * safe to use in a forked child process.
 */
function openDatabase() {
  const dbPath = config.database.path;
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const newDb = new Database(dbPath, {
    timeout: config.database.timeout_ms || 5000,
  });

  if (config.database.wal_mode !== false) {
    newDb.pragma('journal_mode = WAL');
    logger.debug('WAL mode enabled');
  }

  newDb.pragma('foreign_keys = ON');
  logger.info(`Daemon database connection opened at ${dbPath}`);
  return newDb;
}

/**
 * Close the daemon's database connection.
 */
function closeDaemonDb() {
  if (db) {
    db.close();
    logger.info('Daemon database connection closed');
    db = null;
  }
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Group pending ops by server_id+bank_id
 */
function groupByServerBank(ops) {
  const groups = new Map();
  for (const op of ops) {
    const key = `${op.pop_server_id}:${op.pop_bank_id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        serverId: op.pop_server_id,
        bankId: op.pop_bank_id,
        ops: [],
      });
    }
    groups.get(key).ops.push(op);
  }
  return Array.from(groups.values());
}

/**
 * Hindsight OperationResponse uses 'id' for child operations.
 */
function remoteOpId(op) {
  return op && (op.id || op.operation_id);
}

/**
 * Fetch all operations for a bank/status that are needed to cover a set of
 * tracked operation IDs. Pages through Hindsight's 100-item limit and stops
 * early once every tracked ID is found or the list ends.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} status
 * @param {Set<string>} trackedIds
 * @param {boolean} [excludeParents=false]
 * @returns {Promise<{success: boolean, opMap?: Map<string, Object>, error?: string}>}
 */
async function fetchStatusPage(serverId, bankId, status, trackedIds, excludeParents = false) {
  const opMap = new Map();
  let offset = 0;
  let pageCount = 0;

  while (pageCount < MAX_PAGES_PER_STATUS) {
    pageCount += 1;
    const result = await listOperations(serverId, bankId, { status, limit: PAGE_SIZE, offset, excludeParents });
    if (!result.success) {
      return { success: false, error: result.error };
    }

    const operations = result.operations || [];
    for (const op of operations) {
      const opId = remoteOpId(op);
      if (opId) {
        opMap.set(opId, op);
      }
    }

    const allFound = trackedIds.size > 0 && Array.from(trackedIds).every(id => opMap.has(id));
    if (operations.length < PAGE_SIZE || allFound) {
      break;
    }

    offset += PAGE_SIZE;
  }

  if (pageCount >= MAX_PAGES_PER_STATUS) {
    logger.error('Hindsight status pagination hit emergency cap', {
      serverId,
      bankId,
      status,
      trackedCount: trackedIds.size,
    });
  }

  return { success: true, opMap };
}

/**
 * Run a limited-concurrency batch of getOperation calls.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} operationIds
 * @returns {Promise<Map<string, Object|null>>} map of operationId to operation or null
 */
async function lookupOperations(serverId, bankId, operationIds) {
  const results = new Map();
  let index = 0;

  async function worker() {
    while (index < operationIds.length) {
      const currentIndex = index;
      index += 1;
      const operationId = operationIds[currentIndex];
      const result = await getOperation(serverId, bankId, operationId);
      if (result.success) {
        results.set(operationId, result.operation || null);
      } else {
        results.set(operationId, null);
      }
    }
  }

  await Promise.all(Array.from({ length: PER_OP_LOOKUP_CONCURRENCY }, worker));
  return results;
}

/**
 * Single poll iteration
 */
async function pollOnce() {
  if (!db) {
    logger.error('Database not initialised, cannot poll');
    return 0;
  }

  // 1. Fetch all pending ops from local DB (across all servers/banks)
  let pendingOpsResult;
  try {
    pendingOpsResult = getPendingOperationsForPoll(db);
  } catch (err) {
    logger.error('Failed to query pending operations', { error: err.message });
    return 0;
  }

  const pendingOps = pendingOpsResult.success ? pendingOpsResult.data : [];
  if (pendingOps.length === 0) {
    logger.debug('No pending operations to poll');
    return 0;
  }

  logger.info('Polling Hindsight for pending operations', { count: pendingOps.length });

  // 2. Group by server+bank
  const groups = groupByServerBank(pendingOps);
  let updatedCount = 0;

  for (const group of groups) {
    const { serverId, bankId, ops } = group;
    const trackedIds = new Set(ops.map(op => op.pop_operation_id));

    // 3. Fetch active statuses in priority order: processing first (most time-sensitive),
    //    then pending. Stop paginating each status once all tracked IDs are found.
    const processingResult = await fetchStatusPage(serverId, bankId, 'processing', trackedIds, true);
    if (!processingResult.success) {
      logger.error('Hindsight listOperations failed for processing', {
        serverId, bankId, error: processingResult.error
      });
      continue;
    }

    const pendingResult = await fetchStatusPage(serverId, bankId, 'pending', trackedIds, true);
    if (!pendingResult.success) {
      logger.error('Hindsight listOperations failed for pending', {
        serverId, bankId, error: pendingResult.error
      });
      continue;
    }

    // 4. Build union active map
    const activeMap = new Map(processingResult.opMap);
    for (const [opId, op] of pendingResult.opMap.entries()) {
      if (!activeMap.has(opId)) {
        activeMap.set(opId, op);
      }
    }

    // 5. Match local ops to remote states found in active lists
    const missingFromActive = [];
    for (const localOp of ops) {
      const remoteOp = activeMap.get(localOp.pop_operation_id);

      if (remoteOp) {
        updatedCount += applyRemoteStatus(localOp, remoteOp);
      } else {
        missingFromActive.push(localOp);
      }
    }

    // 6. Per-op lookup for tracked ops that disappeared from active lists.
    //    These are likely terminal; a single getOperation tells us the outcome
    //    without scanning Hindsight's potentially huge terminal operation history.
    if (missingFromActive.length > 0) {
      logger.debug('Looking up terminal state for missing active ops', {
        serverId,
        bankId,
        count: missingFromActive.length,
      });

      const missingIds = missingFromActive.map(op => op.pop_operation_id);
      const terminalMap = await lookupOperations(serverId, bankId, missingIds);

      const stillMissing = [];
      for (const localOp of missingFromActive) {
        const remoteOp = terminalMap.get(localOp.pop_operation_id);
        if (remoteOp) {
          updatedCount += applyRemoteStatus(localOp, remoteOp);
        } else {
          stillMissing.push(localOp);
        }
      }

      // 7. Anything still missing after active + terminal lookup waits for stale threshold
      for (const localOp of stillMissing) {
        updatedCount += handleMissingOperation(localOp);
      }
    }
  }

  return updatedCount;
}

/**
 * Apply a remote operation's status to the local pending_operations row.
 * @returns {number} 1 if a DB update occurred, 0 otherwise
 */
function applyRemoteStatus(localOp, remoteOp) {
  const remoteStatus = remoteOp.status;
  const remoteError = remoteOp.error_message || remoteOp.message || null;

  if (remoteStatus === 'completed') {
    const updateResult = updatePendingOperationStatus(db, localOp.pop_id, {
      pop_status: 'completed',
      pop_error_message: null,
    });
    if (updateResult.success) {
      logger.info('Operation completed', {
        popId: localOp.pop_id,
        operationId: localOp.pop_operation_id,
      });
      return 1;
    }
    logger.error('Failed to update completed op', {
      popId: localOp.pop_id,
      error: updateResult.error,
    });
    return 0;
  }

  if (remoteStatus === 'failed') {
    const updateResult = updatePendingOperationStatus(db, localOp.pop_id, {
      pop_status: 'failed',
      pop_error_message: remoteError,
    });
    if (updateResult.success) {
      logger.warn('Operation failed on Hindsight', {
        popId: localOp.pop_id,
        operationId: localOp.pop_operation_id,
        error: remoteError,
      });
      return 1;
    }
    return 0;
  }

  if (remoteStatus === 'cancelled' || remoteStatus === 'canceled') {
    const updateResult = updatePendingOperationStatus(db, localOp.pop_id, {
      pop_status: 'failed',
      pop_error_message: remoteError || 'Operation was cancelled on server',
    });
    if (updateResult.success) {
      logger.warn('Operation cancelled on Hindsight', {
        popId: localOp.pop_id,
        operationId: localOp.pop_operation_id,
        error: remoteError,
      });
      return 1;
    }
    return 0;
  }

  // Intermediate status (e.g. 'processing', 'pending') — mirror it if changed.
  if (remoteStatus !== localOp.pop_status) {
    const updateResult = updatePendingOperationStatus(db, localOp.pop_id, {
      pop_status: remoteStatus,
      pop_error_message: null,
    });
    if (updateResult.success) {
      logger.info('Operation status updated', {
        popId: localOp.pop_id,
        operationId: localOp.pop_operation_id,
        fromStatus: localOp.pop_status,
        toStatus: remoteStatus,
      });
      return 1;
    }
    return 0;
  }

  logger.debug('Operation status unchanged', {
    popId: localOp.pop_id,
    operationId: localOp.pop_operation_id,
    remoteStatus,
  });
  return 0;
}

/**
 * Handle a tracked operation that is not visible in Hindsight's active or
 * terminal lookups. If it has exceeded the stale threshold, mark it failed.
 * Otherwise, leave it for the next poll cycle.
 * @returns {number} 1 if a DB update occurred, 0 otherwise
 */
function handleMissingOperation(localOp) {
  const createdAt = new Date(localOp.pop_created_at).getTime();
  const elapsed = Date.now() - createdAt;

  if (elapsed > STALE_THRESHOLD_MS) {
    const updateResult = updatePendingOperationStatus(db, localOp.pop_id, {
      pop_status: 'failed',
      pop_error_message: 'Operation not found on server after threshold — may have expired or been cleaned up',
    });
    if (updateResult.success) {
      logger.warn('Operation expired (stale)', {
        popId: localOp.pop_id,
        operationId: localOp.pop_operation_id,
        elapsedMs: elapsed,
      });
      return 1;
    }
    return 0;
  }

  logger.debug('Operation not yet visible on server', {
    popId: localOp.pop_id,
    operationId: localOp.pop_operation_id,
    elapsedMs: elapsed,
  });
  return 0;
}

/**
 * Main daemon loop
 */
async function run() {
  logger.info('Hindsight poll daemon starting', { pollIntervalMs: POLL_INTERVAL_MS });
  isRunning = true;

  // Open own DB connection (WAL mode supports multi-process access)
  try {
    db = openDatabase();
  } catch (err) {
    logger.error('Failed to initialise database', { error: err.message });
    process.exit(1);
  }

  while (isRunning) {
    try {
      const updated = await pollOnce();
      if (updated > 0) {
        logger.info('Poll cycle complete', { updated });
      }
    } catch (error) {
      logger.error('Error in poll cycle', { error: error.message, stack: error.stack });
    }

    await sleep(POLL_INTERVAL_MS);
  }

  closeDaemonDb();
  logger.info('Hindsight poll daemon stopped');
}

/**
 * Graceful shutdown
 */
function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully`);
  isRunning = false;

  closeDaemonDb();
}

// Signal handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// If the parent process dies, the IPC channel closes — exit immediately
process.on('disconnect', () => {
  logger.warn('IPC parent disconnected (parent process died), exiting');
  closeDaemonDb();
  process.exit(1);
});

// Start the daemon
run().catch(error => {
  logger.error('Daemon crashed', { error: error.message, stack: error.stack });
  closeDaemonDb();
  process.exit(1);
});
