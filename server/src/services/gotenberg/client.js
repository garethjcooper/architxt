/**
 * Gotenberg Service Client
 *
 * HTTP client for Gotenberg (external document-conversion microservice).
 * Handles multipart file upload to the LibreOffice conversion endpoint and
 * response parsing. DocX/DOC files are converted to PDF before being sent
 * to Docling so WMF/EMF diagrams are captured as rendered page content.
 *
 * Environment: ARCHITXT_GOTENBERG_URL=http://localhost:3031
 */

import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('gotenberg-client');

const SERVICE_URL = config.gotenberg?.url || 'http://localhost:3031';

/**
 * Convert a Word document (.doc, .docx) to PDF via Gotenberg.
 *
 * POST /forms/libreoffice/convert
 * Content-Type: multipart/form-data
 *
 * @param {Buffer|ReadableStream|Blob} fileBuffer - File content
 * @param {string} filename - Original filename for type detection
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the request
 * @returns {Promise<{success: true, buffer: Buffer, contentType: string}|{success: false, error: string}>}
 */
export async function convertDocumentToPdf(fileBuffer, filename, signal = null) {
  if (!SERVICE_URL) {
    return { success: false, error: 'ARCHITXT_GOTENBERG_URL not configured' };
  }

  const url = `${SERVICE_URL}/forms/libreoffice/convert`;
  const startTime = Date.now();

  // Build form data. Node Buffer needs explicit Blob wrapping.
  const formData = new FormData();
  const blob = fileBuffer instanceof Blob ? fileBuffer : new Blob([fileBuffer]);
  formData.append('files', blob, filename);

  logger.info('Sending document to Gotenberg', { filename, url: SERVICE_URL });

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: signal || null,
    });

    const duration = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      const detail = errorText ? ` - ${errorText.slice(0, 2000)}` : '';
      logger.warn('Gotenberg conversion failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `Gotenberg conversion failed: ${response.status} ${response.statusText}${detail}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'application/pdf';

    logger.info('Gotenberg conversion complete', {
      filename,
      size: arrayBuffer.byteLength,
      contentType,
      durationMs: duration,
    });

    return {
      success: true,
      buffer: Buffer.from(arrayBuffer),
      contentType,
    };
  } catch (error) {
    logger.warn('Gotenberg client error', { filename, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Check Gotenberg health.
 *
 * GET /health
 * @returns {Promise<boolean>}
 */
export async function healthCheck() {
  if (!SERVICE_URL) {
    return false;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${SERVICE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

export default {
  convertDocumentToPdf,
  healthCheck,
};
