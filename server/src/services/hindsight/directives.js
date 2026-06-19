/**
 * Hindsight Service Client - Directive Operations
 *
 * Directive list / push / pull from a Hindsight bank.
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-directives-client');

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

/**
 * List directives in a bank - GET {server_url}/v1/default/banks/{bank_id}/directives
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max results
 * @param {number} [options.offset] - Skip N results
 * @returns {Promise<{success: boolean, directives?: Array, total?: number, error?: string}>}
 */
export async function listDirectives(serverId, bankId, options = {}) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const queryParams = new URLSearchParams();
  if (options.limit) queryParams.append('limit', options.limit);
  if (options.offset) queryParams.append('offset', options.offset);

  const queryString = queryParams.toString();
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/directives${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listDirectives failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const body = await response.json();

    // Contract: Hindsight returns { items: Directive[], limit, offset, total }
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      logger.error('Unexpected Hindsight listDirectives response', {
        serverId, bankId, url,
        keys: body ? Object.keys(body) : null,
        type: typeof body,
      });
      return { success: false, error: `Unexpected response: expected { items: Directive[] }, got ${typeof body}` };
    }

    const directives = body.items;
    logger.info('Hindsight listDirectives OK', { serverId, bankId, url, count: directives.length, total: body.total });
    return { success: true, directives, total: body.total ?? directives.length };
  } catch (error) {
    logger.error('Hindsight listDirectives error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

function buildPayload(directive) {
  return {
    name: directive.name || null,
    content: directive.statement || null,
    priority: directive.priority ?? 0,
    is_active: directive.is_active === true,
    tags: Array.isArray(directive.tags) ? directive.tags : [],
  };
}

/**
 * Push (update) an existing directive on Hindsight via PATCH.
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} directive - Must have ext_id, name, statement, priority, is_active, tags
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function pushDirective(serverId, bankId, directive) {
  if (!directive?.ext_id) {
    return { success: false, error: 'Directive ext_id is required for push update' };
  }

  logger.info('Updating directive on Hindsight', { serverId, bankId, extId: directive.ext_id });

  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/directives/${encodeURIComponent(directive.ext_id)}`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: buildHeaders(configResult.config),
      body: JSON.stringify(buildPayload(directive)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight pushDirective failed', { serverId, bankId, extId: directive.ext_id, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight pushDirective OK', { serverId, bankId, extId: directive.ext_id });
    return { success: true };
  } catch (error) {
    logger.error('Hindsight pushDirective error', { serverId, bankId, extId: directive.ext_id, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Create a new directive on Hindsight via POST.
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} directive - Must have name, statement, priority, is_active, tags
 * @returns {Promise<{success: boolean, directive?: Object, error?: string}>}
 */
export async function createDirective(serverId, bankId, directive) {
  logger.info('Creating directive on Hindsight', { serverId, bankId, name: directive.name });

  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/directives`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: buildHeaders(configResult.config),
      body: JSON.stringify(buildPayload(directive)),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight createDirective failed', { serverId, bankId, name: directive.name, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const created = await response.json();
    logger.info('Hindsight createDirective OK', { serverId, bankId, name: directive.name, returnedId: created?.id });
    return { success: true, directive: created };
  } catch (error) {
    logger.error('Hindsight createDirective error', { serverId, bankId, name: directive.name, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get a single directive from Hindsight by id.
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} directiveId
 * @returns {Promise<{success: boolean, directive?: Object, error?: string}>}
 */
export async function getDirective(serverId, bankId, directiveId) {
  logger.info('Fetching directive from Hindsight', { serverId, bankId, directiveId });

  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/directives/${encodeURIComponent(directiveId)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getDirective failed', { serverId, bankId, directiveId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const directive = await response.json();
    logger.info('Hindsight getDirective OK', { serverId, bankId, directiveId });
    return { success: true, directive };
  } catch (error) {
    logger.error('Hindsight getDirective error', { serverId, bankId, directiveId, error: error.message });
    return { success: false, error: error.message };
  }
}
