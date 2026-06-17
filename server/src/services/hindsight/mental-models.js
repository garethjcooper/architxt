/**
 * Hindsight Service Client - Mental Model Operations
 *
 * List mental models in a bank. We request detail=content so we can compare
 * against architxt local values without pulling the reflect_response payload.
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-mental-models-client');

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

const VALID_DETAIL_LEVELS = new Set(['metadata', 'content', 'full']);

/**
 * List mental models in a bank - GET {server_url}/v1/default/banks/{bank_id}/mental-models
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max results
 * @param {number} [options.offset] - Skip N results
 * @param {string} [options.detail] - 'metadata' | 'content' | 'full' (default 'content')
 * @returns {Promise<{success: boolean, mentalModels?: Array, total?: number, error?: string}>}
 */
export async function listMentalModels(serverId, bankId, options = {}) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const queryParams = new URLSearchParams();
  const detail = VALID_DETAIL_LEVELS.has(options.detail) ? options.detail : 'content';
  queryParams.set('detail', detail);
  if (options.limit) queryParams.append('limit', options.limit);
  if (options.offset) queryParams.append('offset', options.offset);

  const queryString = queryParams.toString();
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/mental-models${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listMentalModels failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const body = await response.json();

    // Contract: Hindsight returns { items: MentalModel[], limit, offset, total }
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      logger.error('Unexpected Hindsight listMentalModels response', {
        serverId, bankId, url,
        keys: body ? Object.keys(body) : null,
        type: typeof body,
      });
      return { success: false, error: `Unexpected response: expected { items: MentalModel[] }, got ${typeof body}` };
    }

    const mentalModels = body.items;
    logger.info('Hindsight listMentalModels OK', { serverId, bankId, url, count: mentalModels.length, total: body.total });
    return { success: true, mentalModels, total: body.total ?? mentalModels.length };
  } catch (error) {
    logger.error('Hindsight listMentalModels error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}
