/**
 * Contextual Graph Refresh Daemon
 *
 * Low-frequency background poll that refreshes contextual-graph patches for
 * every (server_id, bank_id) pair that has attached model_refs in the working graph.
 *
 * Controlled by config.contextualGraph.background_refresh (default off).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { refreshContextualGraphPatches } from '../../services/contextual-graph/refresh-patches.js';
import { listContextualGraphScopes } from '../../db/crud/contextual-graph.js';

const logger = createLogger('contextual-graph-refresh-daemon');

const REFRESH_CONFIG = config.contextualGraph?.background_refresh || { enabled: false, poll_interval_ms: 300000 };
const POLL_INTERVAL_MS = REFRESH_CONFIG.poll_interval_ms || 300000;

let db = null;
let isRunning = false;
let timeoutId = null;

function openDatabase() {
  const dbPath = config.database.path;
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const newDb = new Database(dbPath, { timeout: config.database.timeout_ms || 5000 });
  if (config.database.wal_mode !== false) {
    newDb.pragma('journal_mode = WAL');
  }
  newDb.pragma('foreign_keys = ON');
  return newDb;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find all (server_id, bank_id) scopes that have at least one contextual-graph
 * node or edge.
 */
function discoverScopes() {
  const scopesResult = listContextualGraphScopes(db);
  return scopesResult?.success ? scopesResult.data : [];
}

async function runRefreshCycle() {
  const scopes = discoverScopes();
  if (scopes.length === 0) {
    logger.debug('No contextual-graph scopes to refresh');
    return;
  }

  for (const scope of scopes) {
    const { server_id: serverId, bank_id: bankId } = scope;

    logger.info('Refreshing contextual-graph patches', { serverId, bankId });
    const result = await refreshContextualGraphPatches(db, serverId, bankId);
    if (result.success) {
      logger.info('Refresh cycle complete', { serverId, bankId, ...result.stats });
    } else {
      logger.error('Refresh cycle failed', { serverId, bankId, error: result.error });
    }
  }
}

async function main() {
  if (isRunning) return;
  isRunning = true;

  if (!REFRESH_CONFIG.enabled) {
    logger.info('Contextual-graph background refresh disabled; exiting.');
    process.exit(0);
    return;
  }

  db = openDatabase();
  logger.info('Contextual-graph refresh daemon started', { pollIntervalMs: POLL_INTERVAL_MS });

  async function loop() {
    try {
      await runRefreshCycle();
    } catch (err) {
      logger.error('Refresh cycle threw', { error: err.message });
    }
    timeoutId = setTimeout(loop, POLL_INTERVAL_MS);
  }

  await loop();
}

function shutdown(signal) {
  logger.info(`Contextual-graph refresh daemon received ${signal}`);
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
  closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  logger.error('Contextual-graph refresh daemon fatal error', { error: err.message });
  closeDatabase();
  process.exit(1);
});
