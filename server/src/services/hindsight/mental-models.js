/**
 * Hindsight Service Client - Mental Model Operations
 *
 * List mental models in a bank. We request detail=content so we can compare
 * against architxt local values without pulling the reflect_response payload.
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-mental-models-client');

const DEFAULT_TIMEOUT_MS = 30000;

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

function fetchWithTimeout(url, fetchOptions, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
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
 * @param {number} [options.timeoutMs] - Fetch timeout in milliseconds (default 30000)
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
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    }, options.timeoutMs);

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

/**
 * Get a single mental model by external id - GET {server_url}/v1/default/banks/{bank_id}/mental-models/{ext_id}
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {string} extId - Mental model external id
 * @param {Object} [options] - Query options
 * @param {string} [options.detail] - 'metadata' | 'content' | 'full' (default 'content')
 * @param {number} [options.timeoutMs] - Fetch timeout in milliseconds (default 30000)
 * @returns {Promise<{success: boolean, mentalModel?: object, error?: string}>}
 */
export async function getMentalModel(serverId, bankId, extId, options = {}) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };
  if (!extId) return { success: false, error: 'extId is required' };

  const { serviceUrl } = configResult.config;
  const queryParams = new URLSearchParams();
  const detail = VALID_DETAIL_LEVELS.has(options.detail) ? options.detail : 'content';
  queryParams.set('detail', detail);

  const queryString = queryParams.toString();
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/mental-models/${encodeURIComponent(extId)}${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    }, options.timeoutMs);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getMentalModel failed', { serverId, bankId, extId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const mentalModel = await response.json();
    logger.info('Hindsight getMentalModel OK', { serverId, bankId, extId, url });
    return { success: true, mentalModel };
  } catch (error) {
    logger.error('Hindsight getMentalModel error', { serverId, bankId, extId, error: error.message });
    return { success: false, error: error.message };
  }
}
