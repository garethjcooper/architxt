/**
 * Extract Trace Stage
 *
 * Deterministic transform: trace source file + profile → document content.
 * When the profile has a sequenceProfile, document-md is the mined sequence
 * analysis (matching what /trace-profiles/preview-sequences shows); otherwise
 * it is the cleaned log.
 *
 * I/O stage that reads the document source file, runs it through the trace
 * parser engine configured by the selected trace profile, and emits the same
 * artifacts as the standard extract stage:
 *   - document-md: the mined sequence document (or cleaned log without a profile)
 *   - document-images: empty array (trace extraction produces no images)
 *
 * Relationship extraction is intentionally not performed here. Trace-specific
 * sidecar artifacts are not part of the pipeline contract and must not be added
 * here.
 */

import { promises as fs } from 'fs';
import { createLogger } from '../../utils/logger.js';
import { processTraceContent } from '../../services/trace/index.js';

const logger = createLogger('stage-extract-trace');

async function execute(artifacts, config, data, services, context) {
  const startTime = Date.now();

  try {
    if (context?.abortSignal?.aborted) {
      throw new Error('Trace extraction cancelled before file read');
    }

    if (!data.trace_profile || !data.trace_profile.tfp_config) {
      throw new Error('Trace document missing resolved trace_profile');
    }

    let fileBuffer;
    let fileSize;
    try {
      await fs.access(data.source_path);
      fileBuffer = await fs.readFile(data.source_path);
      fileSize = fileBuffer.length;
    } catch (fileErr) {
      logger.error('Trace source file access failed', {
        docId: data.doc_id,
        sourcePath: data.source_path,
        error: fileErr.code || fileErr.message,
      });
      throw new Error(`Cannot access trace source file: ${data.source_path} (${fileErr.code || fileErr.message})`);
    }

    if (context?.abortSignal?.aborted) {
      throw new Error('Trace extraction cancelled before parse');
    }

    const { markdown, metrics, sequenceDocument } = await processTraceContent(
      data.trace_profile,
      fileBuffer,
      data.filename,
      { abortSignal: context?.abortSignal }
    );

    // When the profile has a sequenceProfile, document-md IS the mined
    // sequence document — the cleaned log stays out of the stored content
    // (the raw source file is already kept at source_path). Without a
    // sequenceProfile the cleaned log remains the document content.
    const finalMarkdown = sequenceDocument?.markdown ?? markdown;

    const durationMs = Date.now() - startTime;

    logger.info('Trace extraction complete', {
      docId: data.doc_id,
      durationMs,
      markdownLength: markdown.length,
      sequenceDocumentLength: sequenceDocument?.markdown?.length ?? 0,
      rawRecords: metrics.rawRecords,
      parsedRecords: metrics.parsedRecords,
      unparsedCount: metrics.unparsedCount,
      oversizedCount: metrics.oversizedCount ?? 0,
    });

    return {
      stageOutput: [
        { name: 'document-md', data: finalMarkdown, type: 'string' },
        { name: 'document-images', data: [], type: 'array' },
      ],
      stageMetrics: {
        durationMs,
        fileSize,
        markdownLength: finalMarkdown.length,
        rawRecords: metrics.rawRecords,
        parsedRecords: metrics.parsedRecords,
        unparsedCount: metrics.unparsedCount,
      },
      stageResult: { success: true },
    };
  } catch (error) {
    logger.error('Trace extraction failed', { docId: data.doc_id, error: error.message });

    return {
      stageResult: { success: false, error: `Trace extraction failed: ${error.message}` },
      stageMetrics: { durationMs: Date.now() - startTime, error: error.message },
      stageOutput: [],
    };
  }
}

function validate(config) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    errors.push('config object is required');
  }
  return { valid: errors.length === 0, errors };
}

export { execute, validate };
