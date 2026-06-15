/**
 * Hindsight Service Client
 *
 * HTTP client for hindsight API (external memory/retrieval service)
 * Server endpoints are stored in the database servers table
 *
 * Usage: Operations require a server_id to identify which hindsight instance
 */

// Config
export { getServerConfig } from './config.js';

// Health
export { healthCheck } from './health.js';

// Banks
export {
  listBanks,
  getBank,
  createBank,
  deleteBank,
} from './banks.js';

// Memory Operations
export {
  retainMemories,
  listOperations,
} from './memories.js';