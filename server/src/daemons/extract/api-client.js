import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('extract-daemon-api');

const API_BASE_URL = `http://${config.server.host}:${config.server.port}/api/v1`;

/**
 * Truncate image data for logging (keep metadata, truncate base64)
 * @param {Array} images - Array of image objects
 * @returns {Array} Images with truncated data
 */
function truncateImagesForLog(images) {
  if (!Array.isArray(images)) return images;
  return images.map(img => ({
    ...img,
    data: img.data ? `${img.data.slice(0, 100)}... (${img.data.length} chars)` : null
  }));
}

/**
 * API client - minimal fetch wrapper
 * All API calls go through this single point for consistency
 */
async function apiCall(method, path, body = null) {
  const url = `${API_BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);

    const data = response.headers.get('content-type')?.includes('json')
      ? await response.json()
      : null;

    return {
      status: response.status,
      ok: response.ok,
      data
    };
  } catch (error) {
    logger.warn('API call failed', { method, path, error: error.message, code: error.code });
    return {
      status: 0,
      ok: false,
      data: null,
      error: error.message,
      networkError: true
    };
  }
}

/**
 * Poll API for next document ready for extraction
 * Returns doc_id or null if no work available
 */
export async function pollForWork() {
  const result = await apiCall('GET', '/documents/extractwork');

  if (result.status === 204) {
    return null; // No work available
  }

  if (!result.ok) {
    logger.error('Failed to poll for work', { status: result.status, error: result.data?.error });
    return null;
  }

  return result.data?.id || null;
}

/**
 * Atomically claim a document for processing
 */
export async function claimDocument(docId) {
  logger.info('Attempting to claim document', { docId });

  const result = await apiCall('POST', `/documents/${docId}/claim`);

  if (result.status === 409) {
    logger.warn('Document already claimed by another daemon', { docId });
    return false;
  }

  if (!result.ok) {
    logger.error('Failed to claim document', { docId, status: result.status, error: result.data?.error });
    return false;
  }

  logger.info('Document claimed successfully', { docId });
  return true;
}

/**
 * Report extraction result
 */
export async function reportExtracted(docId, success, details = {}) {
  // Truncate image data for logging
  const logDetails = {
    ...details,
    markdown: details.markdown ? `${details.markdown.slice(0, 100)}... (${details.markdown.length} chars)` : null,
    images: truncateImagesForLog(details.images),
    provenance_log: details.provenance_log ? '<truncated>' : null
  };
  logger.info('Reporting extraction result', { docId, success, ...logDetails });

  const result = await apiCall('POST', `/documents/${docId}/extracted`, {
    success,
    ...details
  });

  if (!result.ok) {
    logger.error('Failed to report extraction result', { docId, status: result.status, error: result.data?.error });
    return false;
  }

  logger.info('Extraction result reported', { docId, success });
  return true;
}

/**
 * Report progress via API
 */
export async function reportProgress(docId, progress) {
  const result = await apiCall('POST', `/documents/${docId}/extractprogress`, { progress });

  if (!result.ok) {
    logger.warn('Failed to report progress', { docId, status: result.status, error: result.data?.error });
    // Don't throw - progress is best-effort, not critical
  }
}

/**
 * Release document back to uploaded state (reconciliation)
 */
export async function releaseDocument(docId, reason, metrics) {
  const result = await apiCall('POST', `/documents/${docId}/release`, {
    reason,
    metrics
  });

  if (!result.ok) {
    logger.error('Failed to release document', { docId, status: result.status, error: result.data?.error });
    return false;
  }

  return true;
}

/**
 * Fetch document details by ID
 */
export async function getDocument(docId) {
  const result = await apiCall('GET', `/documents/${docId}`);

  if (!result.ok) {
    logger.error('Failed to fetch document', { docId, status: result.status, error: result.data?.error });
    return null;
  }

  return result.data;
}

/**
 * Get orphaned documents for reconciliation
 */
export async function getOrphanedDocuments() {
  const result = await apiCall('GET', '/documents/reconcile');

  if (!result.ok) {
    logger.error('Failed to fetch orphaned documents', { status: result.status });
    return [];
  }

  return result.data?.orphans || [];
}
