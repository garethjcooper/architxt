/**
 * Docling Extractor
 *
 * Thin wrapper combining HTTP client + image extraction.
 * Converts documents via docling-serve, extracts embedded base64 images,
 * replaces them with {{IMAGE:pending:image-N}} placeholders.
 *
 * Returns archie-ai-compatible format.
 */

import { convertDocument } from './client.js';
import { convertDocumentToPdf } from '../gotenberg/client.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';
import path from 'path';

const logger = createLogger('docling-extractor');

const WORD_EXTENSIONS = new Set(['.doc', '.docx']);
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const POWERPOINT_EXTENSIONS = new Set(['.ppt', '.pptx']);

/**
 * Decide whether a file should be preprocessed by Gotenberg.
 * @param {string} filename
 * @returns {boolean}
 */
function shouldPreprocessToPdf(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (WORD_EXTENSIONS.has(ext)) return config.gotenberg?.convertDocDocxToPdf ?? false;
  if (HTML_EXTENSIONS.has(ext)) return config.gotenberg?.convertHtmlToPdf ?? false;
  if (POWERPOINT_EXTENSIONS.has(ext)) return config.gotenberg?.convertPptPptxToPdf ?? false;
  return false;
}

/**
 * Convert Word/HTML file to PDF via Gotenberg, with fallback to the original file.
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {AbortSignal} [signal]
 * @returns {Promise<{buffer: Buffer, filename: string, preprocessed: boolean}>}
 */
async function maybeConvertToPdf(fileBuffer, filename, signal) {
  if (!shouldPreprocessToPdf(filename)) {
    return { buffer: fileBuffer, filename, preprocessed: false };
  }

  const pdfResult = await convertDocumentToPdf(fileBuffer, filename, signal);

  if (pdfResult.success && pdfResult.buffer?.length > 0) {
    logger.info('Gotenberg PDF preprocessing succeeded', {
      originalFilename: filename,
      pdfSize: pdfResult.buffer.length,
    });
    const pdfFilename = `${filename.replace(/\.[^.]+$/, '')}.pdf`;
    return { buffer: pdfResult.buffer, filename: pdfFilename, preprocessed: true };
  }

  logger.warn('Gotenberg PDF preprocessing failed, falling back to direct Docling', {
    originalFilename: filename,
    error: pdfResult.error,
  });
  return { buffer: fileBuffer, filename, preprocessed: false };
}

/**
 * Extract images from markdown content
 * Finds ![Image](data:image/...;base64,...) patterns and extracts base64 data
 *
 * @param {string} markdown - Markdown content with embedded base64 images
 * @returns {Object} { cleanedMarkdown, images }
 */
function extractImagesFromMarkdown(markdown) {
  const images = [];
  let imageIndex = 0;

  // Pattern matches: ![Image](data:image/png;base64,ABC123) or ![Image](data:image/jpeg;base64,ABC123)
  // Also captures optional alt text: ![Any Text](data:image/...
  const imagePattern = /!\[([^\]]*)\]\(data:image\/([^;]+);base64,([^)]+)\)/g;

  const cleanedMarkdown = markdown.replace(imagePattern, (match, altText, mimeType, base64Data) => {
    const imageId = `image-${imageIndex}`;
    
    // Determine file extension from mime type
    const ext = mimeType === 'jpeg' || mimeType === 'jpg' ? 'jpg' : 'png';
    
    images.push({
      id: imageId,
      filename: `${imageId}.${ext}`,
      index: imageIndex,
      // Page and section info would require docling JSON - null for now
      page: null,
      caption: altText && altText !== 'Image' ? altText : null,
      section: null,
      data: base64Data, // Raw base64, no data: prefix
    });

    imageIndex++;
    
    // Return placeholder in archie-ai format
    return `{{IMAGE:pending:${imageId}}}`;
  });

  return { cleanedMarkdown, images };
}

/**
 * Extract document content via docling-serve
 *
 * @param {Buffer} fileBuffer - File content buffer
 * @param {string} filename - Original filename (for type detection)
 * @param {Object} options - Optional overrides for docling conversion
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the request
 * @returns {Promise<...>}
 */
export async function extract(fileBuffer, filename, options = {}, signal = null) {
  const startTime = Date.now();

  logger.info('Starting extraction', { filename, size: fileBuffer.length });

  try {
    // Step 0: Optionally preprocess Word/HTML files to PDF via Gotenberg
    const { buffer: convertedBuffer, filename: convertedFilename, preprocessed } =
      await maybeConvertToPdf(fileBuffer, filename, signal);

    // Step 1: Call docling extractor (pass abort signal so cancellation interrupts the HTTP request)
    const result = await convertDocument(convertedBuffer, convertedFilename, {
      to_format: 'md',
      image_export_mode: 'embedded',
      do_ocr: true,
      table_mode: 'accurate',
      ...options
    }, signal);

    if (result.status !== 'success') {
      // If Gotenberg preprocessed the file and Docling still failed, fall back
      // to sending the original Word file directly. This preserves current behaviour
      // if the PDF happens to be worse for a specific document.
      if (preprocessed) {
        logger.warn('Docling failed on Gotenberg PDF, falling back to original Word file', {
          originalFilename: filename,
          error: result.errors?.join('; ') || result.status,
        });
        return extract(fileBuffer, filename, options, signal);
      }
      const doclingErrors = result.errors?.join('; ') || 'unknown error';
      const err = new Error(`Docling conversion failed (${result.status}): ${doclingErrors}`);
      err.doclingStatus = result.status;
      err.doclingErrors = result.errors || [];
      err.doclingResponse = result;
      throw err;
    }

    if (!result.markdown) {
      const err = new Error('Docling returned no markdown content');
      err.doclingStatus = result.status;
      err.doclingResponse = result;
      throw err;
    }

    // Step 2: Extract images from markdown
    const { cleanedMarkdown, images } = extractImagesFromMarkdown(result.markdown);

    const duration = Date.now() - startTime;

    logger.info('Extraction complete', {
      filename,
      originalLength: result.markdown.length,
      cleanedLength: cleanedMarkdown.length,
      imageCount: images.length,
      durationMs: duration
    });

    // Step 3: Return archie-ai-compatible format
    return {
      markdown: cleanedMarkdown,
      images,
      metadata: {
        pages: result.document?.pages?.length || null,
        title: result.document?.name || filename,
        docling_version: result.doclingVersion || 'unknown',
        image_count: images.length,
        processing_time: result.processingTime,
        extraction_duration_ms: duration,
        preprocessed_to_pdf: preprocessed,
        // Include docling doc if available for downstream use
        docling_doc: result.document || null
      }
    };

  } catch (error) {
    logger.error('Extraction failed', { filename, error: error.message });
    const err = new Error(error.message || 'Extraction failed');
    err.doclingStatus = error.doclingStatus;
    err.doclingErrors = error.doclingErrors;
    err.doclingResponse = error.doclingResponse;
    throw err;
  }
}

/**
 * Quick health check - validates docling service is available
 * @returns {Promise<boolean>}
 */
export async function healthCheck() {
  const { healthCheck: clientHealthCheck } = await import('./client.js');
  return clientHealthCheck();
}

export default {
  extract,
  healthCheck
};
