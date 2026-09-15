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
 * List chunks for a document - GET {server_url}/v1/default/banks/{bank_id}/documents/{document_id}/chunks
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @param {string} documentId - Document identifier
 * @param {Object} [options] - Query options
 * @param {number} [options.limit] - Max results
 * @param {number} [options.offset] - Skip N results
 * @returns {Promise<{success: boolean, items?: Array, total?: number, limit?: number, offset?: number, error?: string}>}
 */
export async function listDocumentChunks(serverId, bankId, documentId, options = {}) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };
  if (!documentId) return { success: false, error: 'documentId is required' };

  const { serviceUrl } = configResult.config;
  const queryParams = new URLSearchParams();
  if (options.limit) queryParams.append('limit', options.limit);
  if (options.offset) queryParams.append('offset', options.offset);

  const queryString = queryParams.toString();
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/documents/${encodeURIComponent(documentId)}/chunks${queryString ? '?' + queryString : ''}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight listDocumentChunks failed', { serverId, bankId, documentId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const body = await response.json();
    if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
      logger.error('Unexpected Hindsight listDocumentChunks response', {
        serverId, bankId, documentId, url,
        keys: body ? Object.keys(body) : null,
        type: typeof body
      });
      return { success: false, error: `Unexpected response: expected { items: Chunk[] }, got ${typeof body}` };
    }

    logger.info('Hindsight listDocumentChunks OK', { serverId, bankId, documentId, count: body.items.length, total: body.total });
    return {
      success: true,
      items: body.items,
      total: body.total ?? body.items.length,
      limit: body.limit ?? 0,
      offset: body.offset ?? 0,
    };
  } catch (error) {
    logger.error('Hindsight listDocumentChunks error', { serverId, bankId, documentId, error: error.message });
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

    // Hindsight returns 204 on success; treat 404 as success (already gone).
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      logger.error('Hindsight deleteDocument failed', { serverId, bankId, documentId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight document deleted', { serverId, bankId, documentId, status: response.status });
    return { success: true };
  } catch (error) {
    logger.error('Hindsight deleteDocument error', { serverId, bankId, documentId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * List ALL documents in a bank by paging through Hindsight's cap.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {number} [options.limit] - Page size (default 1000)
 * @param {number} [options.timeoutMs] - Per-page fetch timeout
 * @returns {Promise<{success: boolean, documents?: Array, total?: number, error?: string}>}
 */
export async function listAllDocuments(serverId, bankId, options = {}) {
  const pageSize = options.limit || 1000;
  const maxPages = 100;
  const allDocs = [];
  const seenIds = new Set();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const offset = pageIndex * pageSize;
    const page = await listDocuments(serverId, bankId, { ...options, limit: pageSize, offset });
    if (!page.success) {
      logger.error('listAllDocuments page failed', { serverId, bankId, offset, error: page.error });
      return page;
    }
    const docs = page.documents || [];
    if (docs.length === 0) break;
    let newCount = 0;
    for (const doc of docs) {
      const id = doc.id || doc.ext_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allDocs.push(doc);
        newCount += 1;
      }
    }
    if (newCount === 0) break;
    if (docs.length < pageSize) break;
  }

  logger.info('listAllDocuments complete', { serverId, bankId, count: allDocs.length });
  return { success: true, documents: allDocs, total: allDocs.length };
}
