/**
 * Hindsight Service Client - Document Operations
 *
 * Document list, get, and delete
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
 * List documents in a bank - GET {server_url}/v1/default/banks/{bank_id}/documents
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max results
 * @param {number} [options.offset] - Skip N results
 * @param {string} [options.query] - Search query
 * @returns {Promise<{success: boolean, documents?: Array, total?: number, error?: string}>}
 */
export async function listDocuments(serverId, bankId, options = {}) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const queryParams = new URLSearchParams();
  if (options.limit) queryParams.append('limit', options.limit);
  if (options.offset) queryParams.append('offset', options.offset);
  if (options.query) queryParams.append('query', options.query);
  
  const queryString = queryParams.toString();
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listDocuments failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const body = await response.json();

    // Contract: Hindsight listDocuments returns { items: Document[], limit, offset, total }
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      logger.error('Unexpected Hindsight listDocuments response', {
        serverId, bankId, url,
        keys: body ? Object.keys(body) : null,
        type: typeof body
      });
      return { success: false, error: `Unexpected response: expected { items: Document[] }, got ${typeof body}` };
    }

    const documents = body.items;
    logger.info('Hindsight listDocuments OK', { serverId, bankId, url, count: documents.length, total: body.total });
    return { success: true, documents, total: body.total ?? documents.length };
  } catch (error) {
    logger.error('Hindsight listDocuments error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Get document by ID - GET {server_url}/v1/default/banks/{bank_id}/documents/{document_id}
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {string} documentId - Document identifier
 * @returns {Promise<{success: boolean, document?: Object, error?: string}>}
 */
export async function getDocument(serverId, bankId, documentId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };
  if (!documentId) return { success: false, error: 'documentId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(
      `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(documentId)}`,
      { method: 'GET', headers: buildHeaders(configResult.config) }
    );

    if (response.status === 404) return { success: false, error: 'Document not found' };
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getDocument failed', { serverId, bankId, documentId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    return { success: true, document: await response.json() };
  } catch (error) {
    logger.error('Hindsight getDocument error', { serverId, bankId, documentId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Delete document from bank - DELETE {server_url}/v1/default/banks/{bank_id}/documents/{document_id}
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {string} documentId - Document identifier
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteDocument(serverId, bankId, documentId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };
  if (!documentId) return { success: false, error: 'documentId is required' };

  const { serviceUrl } = configResult.config;

  try {
    const response = await fetch(
      `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(documentId)}`,
      { method: 'DELETE', headers: buildHeaders(configResult.config) }
    );

    if (response.status === 404) return { success: false, error: 'Document not found' };
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight deleteDocument failed', { serverId, bankId, documentId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight document deleted', { serverId, bankId, documentId });
    return { success: true };
  } catch (error) {
    logger.error('Hindsight deleteDocument error', { serverId, bankId, documentId, error: error.message });
    return { success: false, error: error.message };
  }
}