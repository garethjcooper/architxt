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
/**
 * Refresh a mental model - POST {server_url}/v1/default/banks/{bank_id}/mental-models/{mental_model_id}/refresh
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {string} mentalModelId - Mental model id on Hindsight
 * @returns {Promise<{success: boolean, operationId?: string, status?: string, error?: string}>}
 */
export async function refreshMentalModel(serverId, bankId, mentalModelId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };
  if (!mentalModelId) return { success: false, error: 'mentalModelId is required' };

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/mental-models/${encodeURIComponent(mentalModelId)}/refresh`;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: buildHeaders(configResult.config),
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight refreshMentalModel failed', { serverId, bankId, mentalModelId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    logger.info('Hindsight refreshMentalModel OK', { serverId, bankId, mentalModelId, operationId: data.operation_id, status: data.status });
    return {
      success: true,
      operationId: data.operation_id,
      status: data.status,
    };
  } catch (error) {
    logger.error('Hindsight refreshMentalModel error', { serverId, bankId, mentalModelId, error: error.message });
    return { success: false, error: error.message };
  }
}

export async function listMentalModels(serverId, bankId, options = {}) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const queryParams = new URLSearchParams();
  const detail = VALID_DETAIL_LEVELS.has(options.detail) ? options.detail : 'content';
  queryParams.set('detail', detail);
  if (options.limit !== undefined) queryParams.append('limit', options.limit);
  if (options.offset !== undefined) queryParams.append('offset', options.offset);

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
 * List ALL mental models in a bank by paging through Hindsight's 1000-item cap.
 *
 * Hindsight rejects limit > 1000 with HTTP 422. Some builds also cap or lie in
 * body.total, so we page until a page returns no new items (with a safety cap)
 * instead of trusting body.total.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {string} [options.detail] - 'metadata' | 'content' | 'full' (default 'content')
 * @param {number} [options.timeoutMs] - Per-page fetch timeout (default 30000)
 * @returns {Promise<{success: boolean, mentalModels?: Array, total?: number, error?: string}>}
 */
export async function listAllMentalModels(serverId, bankId, options = {}) {
  const pageSize = 1000;
  const maxPages = 100; // hard safety cap at 100k models
  const allModels = [];
  const seenIds = new Set();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const offset = pageIndex * pageSize;
    const page = await listMentalModels(serverId, bankId, { ...options, limit: pageSize, offset });
    if (!page.success) {
      logger.error('Hindsight listAllMentalModels page failed', { serverId, bankId, offset, error: page.error });
      return { success: false, error: `Failed to fetch mental models page at offset ${offset}: ${page.error}` };
    }

    const pageModels = page.mentalModels || [];
    const firstId = pageModels[0]?.id ?? null;
    const lastId = pageModels[pageModels.length - 1]?.id ?? null;
    const newModels = pageModels.filter((mm) => {
      if (!mm.id || seenIds.has(mm.id)) return false;
      seenIds.add(mm.id);
      return true;
    });

    logger.info('Hindsight listAllMentalModels page', {
      serverId,
      bankId,
      offset,
      limit: pageSize,
      returned: pageModels.length,
      newIds: newModels.length,
      total: page.total,
      firstId,
      lastId,
      duplicateIds: pageModels.length - newModels.length,
    });

    allModels.push(...newModels);

    // Stop when a page is empty or when every item in it was already seen.
    // Do not trust body.total because some Hindsight builds cap total at 1000
    // alongside the limit cap, which makes total a lie for larger banks.
    if (pageModels.length === 0 || newModels.length === 0) {
      logger.info('Hindsight listAllMentalModels complete', { serverId, bankId, pages: pageIndex + 1, total: page.total, fetched: allModels.length });
      return { success: true, mentalModels: allModels, total: allModels.length };
    }
  }

  logger.warn('Hindsight listAllMentalModels hit safety cap', { serverId, bankId, maxPages, fetched: allModels.length });
  return { success: true, mentalModels: allModels, total: allModels.length };
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
