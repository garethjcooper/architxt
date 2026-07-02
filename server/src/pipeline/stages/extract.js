/**
 * Extract Stage (v3 Pattern - architxt)
 * 
 * I/O stage that extracts document content using docling-serve.
 * Reads source file, converts via docling, extracts images with placeholders.
 */

import path from 'path';
import { promises as fs } from 'fs';
import { createLogger } from '../../utils/logger.js';
import { extract } from '../../services/docling/extractor.js';

const logger = createLogger('stage-extract');

/**
 * Execute extract stage (v3 signature)
 * 
 * @param {Object} artifacts - Empty for stage 0 (no upstream inputs)
 * @param {Object} config - { storage_path, docExtractOptions }
 * @param {Object} data - { doc_id, source_path, filename }
 * @param {Object} services - { extractor } (docling or other)
 * @param {Object} context - { abortSignal }
 * @returns {Promise<{stageResult, stageMetrics, stageOutput}>}
 */
async function execute(artifacts, config, data, services, context) {
  const startTime = Date.now();

  try {
    logger.info('Starting extraction', {
      docId: data.doc_id,
      sourcePath: data.source_path,
      filename: data.filename
    });

    // Check for cancellation before file operations
    if (context?.abortSignal?.aborted) {
      throw new Error('Extraction cancelled before file read');
    }

    // Validate source file exists and read it
    let fileBuffer;
    let fileSize;
    try {
      await fs.access(data.source_path); // Check existence first
      fileBuffer = await fs.readFile(data.source_path);
      fileSize = fileBuffer.length;
    } catch (fileErr) {
      logger.error('Source file access failed', { 
        docId: data.doc_id, 
        sourcePath: data.source_path,
        error: fileErr.code || fileErr.message 
      });
      throw new Error(`Cannot access source file: ${data.source_path} (${fileErr.code || fileErr.message})`);
    }

    // Check for cancellation before docling call
    if (context?.abortSignal?.aborted) {
      throw new Error('Extraction cancelled before docling conversion');
    }

    logger.info('File loaded', { docId: data.doc_id, fileSize });

    // Call docling extractor
    const result = await extract(fileBuffer, data.filename);

    // Check for cancellation before returning
    if (context?.abortSignal?.aborted) {
      throw new Error('Extraction cancelled before completion');
    }

    // Calculate extraction time
    const durationMs = Date.now() - startTime;

    logger.info('Extraction complete', {
      docId: data.doc_id,
      durationMs,
      markdownLength: result.markdown.length,
      imageCount: result.images.length
    });

    // Return v3 pipeline format
    return {
      stageResult: { success: true },
      stageMetrics: {
        durationMs,
        fileSize,
        markdownLength: result.markdown.length,
        imageCount: result.images.length
      },
      stageOutput: [
        { name: 'document-md', data: result.markdown, type: 'string' },
        { name: 'document-images', data: result.images, type: 'array' }
      ]
    };

  } catch (error) {
    logger.error('Extract failed', {
      docId: data.doc_id,
      error: error.message,
      doclingStatus: error.doclingStatus,
      doclingErrors: error.doclingErrors
    });

    return {
      stageResult: { success: false, error: `Extract failed: ${error.message}` },
      stageMetrics: {
        durationMs: Date.now() - startTime,
        error: error.message,
        doclingStatus: error.doclingStatus || null,
        doclingErrors: error.doclingErrors || null,
      },
      stageOutput: []
    };
  }
}

/**
 * Validate extract configuration
 * @param {Object} config - Configuration to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validate(config) {
  const errors = [];

  // Required: storage_path must be a non-empty string
  if (!config.storage_path || typeof config.storage_path !== 'string') {
    errors.push('storage_path is required and must be a string');
  }

  // Optional: validate docExtractOptions if provided
  if (config.docExtractOptions && typeof config.docExtractOptions !== 'object') {
    errors.push('docExtractOptions must be an object if provided');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export { execute, validate };
