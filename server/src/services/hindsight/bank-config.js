/**
 * Hindsight Service Client — Bank Config
 *
 * Fetches a bank's configuration, including entity_labels.
 * GET {serviceUrl}/v1/default/banks/{bank_id}/config
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
 * Fetch bank configuration from Hindsight server.
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @returns {Promise<{success: boolean, config?: Object, error?: string}>}
 */
export async function getBankConfig(serverId, bankId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/config`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getBankConfig failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const body = await response.json();
    logger.info('Hindsight getBankConfig OK', { serverId, bankId, url });
    return { success: true, config: body };
  } catch (error) {
    logger.error('Hindsight getBankConfig error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}
