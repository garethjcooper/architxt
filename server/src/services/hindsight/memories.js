/**
 * Hindsight Service Client - Memory Operations
 *
 * Retain memories and track asynchronous operations
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-client');

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

/**
 * Retain memories to a bank - POST {server_url}/v1/default/banks/{bank_id}/memories
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {Object} payload - Retain payload per Hindsight API
 *   - items: Array<{content, timestamp?, context?, metadata?, document_id?, entities?, tags?, observation_scopes?, strategy?}>
 *   - update_mode: 'replace' | 'append'
 * @param {boolean} [async] - If true, returns operation_id for tracking
 * @returns {Promise<{success: boolean, operationId?: string, error?: string}>}
 */
export async function retainMemories(serverId, bankId, payload, async = true) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const requestPayload = {
      ...payload,
      async,
    };

    const response = await fetch(`${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/memories`, {
      method: 'POST',
      headers: buildHeaders(configResult.config),
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight retainMemories failed', { serverId, bankId, url: `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/memories`, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();

    // Hindsight returns either a single operation_id or an operation_ids array.
    // For batch/multi-item pushes, operation_ids[] contains the child IDs we can track.
    let operationId = null;
    if (data.operation_ids && Array.isArray(data.operation_ids) && data.operation_ids.length > 0) {
      operationId = data.operation_ids[0];
    } else if (data.operation_id) {
      operationId = data.operation_id;
    }

    logger.info('Hindsight retainMemories complete', {
      serverId,
      bankId,
      itemsCount: data.items_count,
      operationId,
    });

    return {
      success: true,
      operationId,
    };
  } catch (error) {
    logger.error('Hindsight retainMemories error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get a single operation detail — including child_operations for batch_retain parents.
 * GET {server_url}/v1/default/banks/{bank_id}/operations/{operation_id}
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} operationId
 * @returns {Promise<{success: boolean, operation?: Object, error?: string}>}
 */
export async function getOperation(serverId, bankId, operationId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(`${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/operations/${encodeURIComponent(operationId)}`, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getOperation failed', { serverId, bankId, operationId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    logger.debug('Hindsight getOperation complete', { serverId, bankId, operationId });
    return { success: true, operation: data };
  } catch (error) {
    logger.error('Hindsight getOperation error', { serverId, bankId, operationId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Resolve a batch_retain parent operation_id to its child operation_id.
 * If the operation has child_operations, returns the first child's id.
 * Otherwise returns the parent id itself.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} parentOperationId
 * @returns {Promise<{success: boolean, childOperationId?: string, error?: string}>}
 */
export async function resolveChildOperationId(serverId, bankId, parentOperationId) {
  const result = await getOperation(serverId, bankId, parentOperationId);
  if (!result.success) return result;

  const op = result.operation;

  // If Hindsight exposes child_operations, extract the first child's operation_id
  if (op.child_operations && Array.isArray(op.child_operations) && op.child_operations.length > 0) {
    const childId = op.child_operations[0].operation_id;
    logger.info('Resolved parent to child operation_id', {
      parentOperationId,
      childOperationId: childId,
      childCount: op.child_operations.length,
    });
    return { success: true, childOperationId: childId };
  }

  // No children — the parent IS the operation
  return { success: true, childOperationId: parentOperationId };
}

/**
 * List operations for a bank - GET {server_url}/v1/default/banks/{bank_id}/operations
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @returns {Promise<{success: boolean, operations?: Array, error?: string}>}
 */
export async function listOperations(serverId, bankId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(`${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/operations?limit=100`, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listOperations failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    logger.debug('Hindsight listOperations complete', { serverId, bankId, count: data.operations?.length || 0 });
    return { success: true, operations: data.operations || [] };
  } catch (error) {
    logger.error('Hindsight listOperations error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}
