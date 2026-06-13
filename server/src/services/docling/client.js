/**
 * Docling Service Client
 *
 * HTTP client for docling-serve (external Python service)
 * Handles multipart file upload and response parsing
 *
 * Environment: DOCLING_SERVICE_URL=http://localhost:5001
 * API Docs: /docs (FastAPI auto-generated)
 */

import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('docling-client');

const SERVICE_URL = config.docling?.serviceUrl || 'http://localhost:5001';

/**
 * Docling conversion options
 * @see http://localhost:5001/docs for full options
 */
const DEFAULT_OPTIONS = {
  // File upload options
  from_format: ['pdf', 'docx', 'pptx', 'html', 'image'], // Input formats
  to_format: 'md',  // Output: 'md', 'json', 'html', 'text', 'doctags'
  image_export_mode: 'placeholder',  // 'placeholder', 'embedded', 'referenced'
  
  // Processing options
  do_ocr: true,
  ocr_language: ['en'],
  force_ocr: config.docling.forceOcr,
  table_mode: 'accurate', // 'fast' or 'accurate'
  pipeline: 'standard', // 'legacy', 'standard', 'vlm', 'asr'
};

/**
 * Convert document via docling-serve
 *
 * POST /v1/convert/file
 * Content-Type: multipart/form-data
 *
 * @param {Buffer|ReadableStream} fileBuffer - File content
 * @param {string} filename - Original filename for type detection
 * @param {Object} options - Override default conversion options
 * @returns {Promise<{
 *   markdown: string|null,
 *   document: Object|null,  // DoclingDocument JSON if requested
 *   status: string,
 *   errors: Array,
 *   processingTime: number
 * }>}
 */
export async function convertDocument(fileBuffer, filename, options = {}) {
  if (!SERVICE_URL) {
    throw new Error('DOCLING_SERVICE_URL not configured');
  }

  const url = `${SERVICE_URL}/v1/convert/file`;
  const startTime = Date.now();

  // Build form data
  const formData = new FormData();
  
  // Add file - browser/node compatible
  // Node Buffer needs explicit Blob wrapping
  const blob = fileBuffer instanceof Blob 
    ? fileBuffer
    : new Blob([fileBuffer]);
  formData.append('files', blob, filename);

  // Add options as JSON
  const requestOptions = { ...DEFAULT_OPTIONS, ...options };
  formData.append('options', JSON.stringify(requestOptions));

  logger.info('Sending document to docling', { filename, url: SERVICE_URL });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        // Don't set Content-Type - fetch/boundary handles it for FormData
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Docling conversion failed', { 
        status: response.status, 
        statusText: response.statusText,
        error: errorText 
      });
      throw new Error(`Docling conversion failed: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    logger.info('Docling conversion complete', { 
      filename, 
      status: result.status,
      processingTime: result.processing_time,
      durationMs: duration
    });

    // Transform docling response to architxt format
    return {
      markdown: result.document?.md_content || null,
      document: result.document?.json_content || null, // Full docling doc with images
      html: result.document?.html_content || null,
      text: result.document?.text_content || null,
      filename: result.document?.filename || filename,
      status: result.status, // 'success', 'partial', 'failure'
      errors: result.errors || [],
      processingTime: result.processing_time,
      timings: result.timings || {},
    };

  } catch (error) {
    logger.error('Docling client error', { filename, error: error.message });
    throw error;
  }
}

/**
 * Check docling-serve health
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
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check service readiness (models loaded, etc)
 *
 * GET /ready
 * @returns {Promise<boolean>}
 */
export async function readinessCheck() {
  if (!SERVICE_URL) {
    return false;
  }

  try {
    const response = await fetch(`${SERVICE_URL}/ready`);
    if (!response.ok) return false;
    
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}

/**
 * Get version info
 * @returns {Promise<Object|null>}
 */
export async function getVersion() {
  if (!SERVICE_URL) {
    return null;
  }

  try {
    const response = await fetch(`${SERVICE_URL}/version`);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Extract images from docling document response
 * Images are in document.json_content.pages[].images or similar structure
 *
 * @param {Object} doclingDoc - The json_content from convertDocument response
 * @returns {Array} Array of image objects with {filename, data, mime_type}
 */
export function extractImages(doclingDoc) {
  if (!doclingDoc) {
    return [];
  }

  const images = [];
  
  // Docling stores images in pages[].images
  // Structure varies by document type
  const pages = doclingDoc.pages || [];
  
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageImages = page.images || [];
    
    for (let j = 0; j < pageImages.length; j++) {
      const img = pageImages[j];
      images.push({
        page: i + 1,
        index: j,
        filename: img.filename || `image_${i}_${j}.png`,
        data: img.data, // base64 encoded
        mimeType: img.mime_type || 'image/png',
        width: img.width,
        height: img.height,
        // bbox if available
        bbox: img.bbox,
      });
    }
  }

  return images;
}

/**
 * Async conversion for large documents
 * POST /v1/convert/file/async
 * Returns task_id, poll /v1/status/poll/{task_id}
 * 
 * Not yet implemented - use sync for now
 */
export async function convertDocumentAsync(fileBuffer, filename, options = {}) {
  throw new Error('Async conversion not yet implemented');
}

export default {
  convertDocument,
  healthCheck,
  readinessCheck,
  getVersion,
  extractImages,
};
