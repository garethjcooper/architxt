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
import { listOperations } from '../../services/hindsight/memories.js';
import {
  updatePendingOperationStatus,
} from '../../db/crud/pending-operations.js';

const logger = createLogger('hindsight-poll-daemon');

const POLL_INTERVAL_MS = config.hindsightPollDaemon?.poll_interval_ms || 5000;
const STALE_THRESHOLD_MS = config.hindsightPollDaemon?.stale_threshold_ms || 300000; // 5 min

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
 * Single poll iteration
 */
async function pollOnce() {
  if (!db) {
    logger.error('Database not initialised, cannot poll');
    return 0;
  }

    // 1. Fetch all pending ops from local DB (across all servers/banks)
    let pendingOps;
    try {
      pendingOps = db.prepare(`
        SELECT pop_id, pop_operation_id, pop_server_id, pop_bank_id, pop_doc_id,
               pop_ext_id, pop_action, pop_status, pop_error_message,
               pop_created_at, pop_updated_at
        FROM pending_operations
        WHERE pop_status NOT IN ('completed', 'failed', 'acknowledged')
        ORDER BY pop_created_at DESC
      `).all();
    } catch (err) {
    logger.error('Failed to query pending operations', { error: err.message });
    return 0;
  }
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

    // 3. Call Hindsight listOperations for this bank
    const hindResult = await listOperations(serverId, bankId);
    if (!hindResult.success) {
      logger.error('Hindsight listOperations failed', {
        serverId, bankId, error: hindResult.error
      });
      // Don't mark ops as failed on remote error — they'll be retried next loop
      continue;
    }

    const opMap = new Map();
    for (const op of (hindResult.operations || [])) {
      // Hindsight OperationResponse uses 'id' not 'operation_id'
      const opId = op.id || op.operation_id;
      if (op && opId) {
        opMap.set(opId, op);
      }
    }

    // 4. Match local ops to remote states
    for (const localOp of ops) {
      const remoteOp = opMap.get(localOp.pop_operation_id);

      if (remoteOp) {
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
            updatedCount++;
          } else {
            logger.error('Failed to update completed op', {
              popId: localOp.pop_id,
              error: updateResult.error,
            });
          }
        } else if (remoteStatus === 'failed') {
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
            updatedCount++;
          }
        } else if (remoteStatus === 'cancelled' || remoteStatus === 'canceled') {
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
            updatedCount++;
          }
        } else {
          // Hindsight reports an intermediate status (e.g. 'processing', 'pending') —
          // mirror it into our DB so the frontend shows the real remote state.
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
              updatedCount++;
            }
          } else {
            logger.debug('Operation status unchanged', {
              popId: localOp.pop_id,
              operationId: localOp.pop_operation_id,
              remoteStatus,
            });
          }
        }
      } else {
        // Remote doesn't know this operation_id anymore
        // Check if it's stale enough to mark failed
        const createdAt = new Date(localOp.pop_created_at).getTime();
        const now = Date.now();
        const elapsed = now - createdAt;

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
            updatedCount++;
          }
        } else {
          logger.debug('Operation not yet visible on server', {
            popId: localOp.pop_id,
            operationId: localOp.pop_operation_id,
            elapsedMs: elapsed,
          });
        }
      }
    }
  }

  return updatedCount;
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
