/**
 * Hindsight Service Client - Banks Operations
 *
 * Memory bank CRUD operations
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
 * List all banks - GET {server_url}/v1/default/banks
 *
 * @param {number} serverId - Server ID from servers table
 * @returns {Promise<{success: boolean, banks?: Array, error?: string}>}
 */
export async function listBanks(serverId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  
  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(`${serviceUrl}/v1/default/banks`, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listBanks failed', { serverId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    logger.debug('Hindsight listBanks complete', { serverId, count: data.banks?.length || 0 });
    return { success: true, banks: data.banks || [] };
  } catch (error) {
    logger.error('Hindsight listBanks error', { serverId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get bank by ID - GET {server_url}/v1/default/banks/{bank_id}
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @returns {Promise<{success: boolean, bank?: Object, error?: string}>}
 */
export async function getBank(serverId, bankId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(`${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}`, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (response.status === 404) return { success: false, error: 'Bank not found' };
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getBank failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    return { success: true, bank: await response.json() };
  } catch (error) {
    logger.error('Hindsight getBank error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * List tags for a bank - GET {server_url}/v1/default/banks/{bank_id}/tags
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @returns {Promise<{success: boolean, items?: Array, total?: number, error?: string}>}
 */
export async function listBankTags(serverId, bankId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(`${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/tags`, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listBankTags failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    logger.debug('Hindsight listBankTags complete', { serverId, bankId, count: data.items?.length || 0 });
    return { success: true, items: data.items || [], total: data.total ?? data.items?.length ?? 0 };
  } catch (error) {
    logger.error('Hindsight listBankTags error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Create a new bank - POST {server_url}/v1/default/banks
 *
 * @param {number} serverId - Server ID from servers table
 * @param {Object} params - Bank parameters
 * @param {string} params.name - Bank name
 * @param {string} [params.description] - Bank description
 * @returns {Promise<{success: boolean, bank?: Object, error?: string}>}
 */
export async function createBank(serverId, { name, description }) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!name) return { success: false, error: 'name is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(`${serviceUrl}/v1/default/banks`, {
      method: 'POST',
      headers: buildHeaders(configResult.config),
      body: JSON.stringify({ name, description }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight createBank failed', { serverId, name, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    logger.info('Hindsight bank created', { serverId, bankId: data.id, name });
    return { success: true, bank: data };
  } catch (error) {
    logger.error('Hindsight createBank error', { serverId, name, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Delete bank - DELETE {server_url}/v1/default/banks/{bank_id}
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteBank(serverId, bankId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(`${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}`, {
      method: 'DELETE',
      headers: buildHeaders(configResult.config),
    });

    if (response.status === 404) return { success: false, error: 'Bank not found' };
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight deleteBank failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight bank deleted', { serverId, bankId });
    return { success: true };
  } catch (error) {
    logger.error('Hindsight deleteBank error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}