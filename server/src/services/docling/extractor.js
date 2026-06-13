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
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('docling-extractor');

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
 * @returns {Promise<{
 *   markdown: string,
 *   images: Array,
 *   metadata: Object
 * }>}
 */
export async function extract(fileBuffer, filename, options = {}) {
  const startTime = Date.now();

  logger.info('Starting extraction', { filename, size: fileBuffer.length });

  try {
    // Step 1: Call docling-serve
    const result = await convertDocument(fileBuffer, filename, {
      to_format: 'md',
      image_export_mode: 'embedded',
      do_ocr: true,
      table_mode: 'accurate',
      ...options
    });

    if (result.status !== 'success') {
      throw new Error(`Docling conversion failed: ${result.errors?.join(', ') || 'unknown error'}`);
    }

    if (!result.markdown) {
      throw new Error('Docling returned no markdown content');
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
        // Include docling doc if available for downstream use
        docling_doc: result.document || null
      }
    };

  } catch (error) {
    logger.error('Extraction failed', { filename, error: error.message });
    throw error;
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
