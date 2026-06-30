/**
 * Hindsight Service Client - Research/Recall Operations
 *
 * Lightweight wrappers around Hindsight recall, reflect, entities/graph,
 * and memory listing for the research discovery agent.
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-research');

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers.Authorization = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

/**
 * Resolve a server_id into a Hindsight base URL.
 * @param {number} serverId
 * @returns {Promise<{success: boolean, serviceUrl?: string, config?: Object, error?: string}>}
 */
async function resolveServer(serverId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  const { serviceUrl, apiKey, apiVersion } = configResult.config;
  return {
    success: true,
    serviceUrl,
    config: { serviceUrl, apiKey, apiVersion },
  };
}

function buildUrl(serviceUrl, bankId, path) {
  return `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}${path}`;
}

/**
 * POST /v1/default/banks/{bank_id}/memories/recall
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} body
 */
export async function recall(serverId, bankId, body) {
  const resolved = await resolveServer(serverId);
  if (!resolved.success) return resolved;

  try {
    const url = buildUrl(resolved.serviceUrl, bankId, '/memories/recall');
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(resolved.config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight recall failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_RECALL_FAILED' };
    }

    const data = await response.json();
    logger.info('Hindsight recall OK', { serverId, bankId, resultCount: data.results?.length || 0 });
    return { success: true, data };
  } catch (error) {
    logger.error('Hindsight recall error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message, code: 'HINDSIGHT_RECALL_ERROR' };
  }
}

/**
 * POST /v1/default/banks/{bank_id}/reflect
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} body
 */
export async function reflect(serverId, bankId, body) {
  const resolved = await resolveServer(serverId);
  if (!resolved.success) return resolved;

  const url = buildUrl(resolved.serviceUrl, bankId, '/reflect');
  const request = { method: 'POST', url, body };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(resolved.config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight reflect failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_REFLECT_FAILED', request };
    }

    const data = await response.json();
    logger.info('Hindsight reflect OK', { serverId, bankId });
    return { success: true, data, request };
  } catch (error) {
    logger.error('Hindsight reflect error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message, code: 'HINDSIGHT_REFLECT_ERROR' };
  }
}

/**
 * Retry reflect with lower budget if the default budget times out.
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} body
 */
export async function reflectWithBudgetFallback(serverId, bankId, body) {
  const result = await reflect(serverId, bankId, body);
  if (result.success) return result;
  if (result.code !== 'HINDSIGHT_REFLECT_FAILED') return result;

  const errorText = (result.error || '').toLowerCase();
  const isTimeout = errorText.includes('timeout') || errorText.includes('timed out') || errorText.includes('request time');
  if (!isTimeout) return result;

  if (body.budget && body.budget !== 'mid') return result;

  logger.info('Reflect timed out with default budget; retrying with low budget', { serverId, bankId });
  return reflect(serverId, bankId, { ...body, budget: 'low' });
}

/**
 * GET /v1/default/banks/{bank_id}/entities/graph
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} options
 */
export async function getEntityGraph(serverId, bankId, options = {}) {
  const resolved = await resolveServer(serverId);
  if (!resolved.success) return resolved;

  const params = new URLSearchParams();
  if (options.limit) params.append('limit', options.limit);
  if (options.min_count) params.append('min_count', options.min_count);

  try {
    const url = buildUrl(resolved.serviceUrl, bankId, `/entities/graph?${params.toString()}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(resolved.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight entity graph failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_ENTITY_GRAPH_FAILED' };
    }

    const data = await response.json();
    logger.info('Hindsight entity graph OK', { serverId, bankId, nodeCount: data.nodes?.length || 0 });
    return { success: true, data };
  } catch (error) {
    logger.error('Hindsight entity graph error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message, code: 'HINDSIGHT_ENTITY_GRAPH_ERROR' };
  }
}

/**
 * GET /v1/default/banks/{bank_id}/memories/list
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} options
 */
export async function listMemories(serverId, bankId, options = {}) {
  const resolved = await resolveServer(serverId);
  if (!resolved.success) return resolved;

  const params = new URLSearchParams();
  if (options.limit) params.append('limit', options.limit);
  if (options.offset) params.append('offset', options.offset);
  if (options.context) params.append('context', options.context);

  try {
    const url = buildUrl(resolved.serviceUrl, bankId, `/memories/list?${params.toString()}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(resolved.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listMemories failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_LIST_MEMORIES_FAILED' };
    }

    const data = await response.json();
    logger.info('Hindsight listMemories OK', { serverId, bankId, count: data.memories?.length || 0 });
    return { success: true, data };
  } catch (error) {
    logger.error('Hindsight listMemories error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message, code: 'HINDSIGHT_LIST_MEMORIES_ERROR' };
  }
}

/**
 * POST /v1/default/banks/{bank_id}/memories/cooccurrence (if available)
 * Falls back to a recall-based co-occurrence search if endpoint is missing.
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} body
 */
export async function entityCooccurrence(serverId, bankId, body) {
  const resolved = await resolveServer(serverId);
  if (!resolved.success) return resolved;

  try {
    const url = buildUrl(resolved.serviceUrl, bankId, '/memories/cooccurrence');
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(resolved.config),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight cooccurrence failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}`, code: 'HINDSIGHT_COOCCURRENCE_FAILED' };
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    logger.error('Hindsight cooccurrence error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message, code: 'HINDSIGHT_COOCCURRENCE_ERROR' };
  }
}
