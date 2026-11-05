/**
 * Denoise LLM Stage (v3 Pattern)
 * 
 * LLM-based document cleaning using the LLM stage service.
 * Processes markdown chunks through the denoiseText function.
 */

import { createLogger } from '../../utils/logger.js';
import { denoiseText } from '../../services/llm/stage-service.js';

const logger = createLogger('stage-denoise-llm');

// Tunable chunking constants. Kept in one place so they can later be moved to
// environment variables without scattering magic numbers through the algorithm.
// The base chunk size itself comes from config.document_denoise_llm.chunk_size
// (env ARCHITXT_DENOISE_LLM_CHUNK_SIZE), so only the new controls live here.
const HARD_CAP_MULTIPLIER = 1.5;
const MAX_LINES_PER_CHUNK = 200;

/**
 * Find the best split index inside `currentChunk` for a forced break.
 * Prefers, in order: Markdown headings, blank lines, lines ending in sentence
 * punctuation. Returns the index (0..currentChunk.length) where the chunk
 * should be cut; content from splitIdx onward moves to the next chunk.
 *
 * @param {string[]} currentChunk
 * @returns {number}
 */
function findBestSplitIndex(currentChunk) {
  for (let j = currentChunk.length - 1; j >= 0; j--) {
    if (currentChunk[j].match(/^#{1,6}\s+/)) {
      return j;
    }
  }
  for (let j = currentChunk.length - 1; j > 0; j--) {
    if (currentChunk[j].trim() === '') {
      return j;
    }
  }
  for (let j = currentChunk.length - 1; j > 0; j--) {
    if (/[.!?]\s*$/.test(currentChunk[j])) {
      return j + 1;
    }
  }
  return currentChunk.length;
}

/**
 * Chunk markdown by line, trying to keep headings with their following content.
 * Splitting respects heading boundaries where possible, and falls back to
 * blank lines, sentence boundaries, or a hard cap to avoid unbounded growth on
 * flat inputs such as raw logs.
 *
 * @param {string} text - Markdown text
 * @param {number} targetSize - Target chunk size in characters
 * @returns {string[]} Array of markdown chunks
 */
function chunkMarkdown(text, targetSize) {
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    throw new TypeError('chunkMarkdown targetSize must be a positive integer');
  }
  const chunks = [];
  const hardCap = Math.floor(targetSize * HARD_CAP_MULTIPLIER);

  let content = text.replace(/^---[\s\S]*?---\n*/, '');
  const lines = content.split('\n');
  let startIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^#{1,6}\s+/) || (lines[i].trim() && !lines[i].match(/^[a-z_]+:/))) {
      startIdx = i;
      break;
    }
  }

  const validLines = lines.slice(startIdx);
  let currentChunk = [];
  let currentSize = 0;

  function emitChunk(upToIndex) {
    const chunk = currentChunk.slice(0, upToIndex).join('\n');
    if (chunk.trim()) chunks.push(chunk);
    currentChunk = currentChunk.slice(upToIndex);
    currentSize = currentChunk.reduce((sum, l) => sum + l.length + 1, 0);
  }

  for (let i = 0; i < validLines.length; i++) {
    const line = validLines[i];
    const lineSize = line.length + 1;

    // If a single line is already larger than the hard cap, isolate it as its
    // own chunk rather than allowing it into the accumulator. The chunk may
    // still exceed the cap, but this preserves line integrity (important for
    // XML/JSON-like records) while preventing it from merging with other lines.
    if (line.length > hardCap) {
      // Flush any pending content first so it doesn't inherit the giant line.
      if (currentChunk.length > 0) {
        emitChunk(findBestSplitIndex(currentChunk));
      }
      if (line.trim()) chunks.push(line);
      currentSize = 0;
      continue;
    }

    // Soft-target split: adding this line would exceed the target size.
    if (currentSize + lineSize > targetSize && currentChunk.length > 0) {
      emitChunk(findBestSplitIndex(currentChunk));
    }

    currentChunk.push(line);
    currentSize += lineSize;

    // Hard-cap / max-lines safety valves: guarantee a bounded chunk even when
    // the input has no headings, blank lines, or sentence boundaries.
    if (currentSize > hardCap || currentChunk.length >= MAX_LINES_PER_CHUNK) {
      const splitIdx = findBestSplitIndex(currentChunk);
      // Avoid emitting nothing when the whole current chunk is one giant line.
      const effectiveSplit = splitIdx === 0 && currentChunk[0] && currentChunk[0].length > hardCap
        ? 1
        : splitIdx;
      emitChunk(effectiveSplit);
    }
  }

  if (currentChunk.length > 0) {
    const chunk = currentChunk.join('\n');
    if (chunk.trim()) chunks.push(chunk);
  }

  return chunks;
}

/**
 * Execute denoise-llm stage (v3 signature)
 * 
 * @param {Object} artifacts - { markdown: string }
 * @param {Object} config - { document_denoise_llm: {...} }
 * @param {Object} data - { doc_id }
 * @param {Object} services - {} (not used, service imported directly)
 * @returns {Promise<{stageResult, stageMetrics, stageOutput}>}
 */
async function execute(artifacts, config, data, services, context) {
  const startTime = Date.now();
  
  const markdown = artifacts.markdown;
  const docId = data.doc_id;
  
  try {
    const denoiseLlmConfig = config.document_denoise_llm;
    const chunkSize = denoiseLlmConfig?.chunk_size ?? 4000;
    const chunks = chunkMarkdown(markdown, chunkSize);

    logger.info('Denoise LLM:', { 
      docId, 
      contentLengthOriginal: markdown.length,
      chunkCount: chunks.length,
      chunkSize
    });

    // Process each chunk through LLM
    const cleanChunks = [];
    let totalTokens = 0;
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Check for cancellation at start of each chunk iteration
      if (context?.abortSignal?.aborted) {
        throw new Error('Denoise LLM cancelled by abort signal');
      }

      // Emit chunk progress
      if (context?.emit) {
        context.emit('progress', {
          current: i + 1,
          total: chunks.length,
          label: `chunk ${i + 1}/${chunks.length}`
        });
      }

      logger.debug(`Denoising chunk ${i + 1}/${chunks.length}`, { 
        docId, 
        chunkLength: chunk.length 
      });
      
      const chunkStartTime = Date.now();
      const result = await denoiseText(chunk, denoiseLlmConfig);
      const chunkDurationMs = Date.now() - chunkStartTime;

      if (!result.success) {
        logger.error(`Denoise failed for chunk ${i + 1}`, { 
          docId, 
          error: result.error, 
          code: result.code 
        });
        // Return failure but preserve original markdown
        return {
          stageResult: { success: false, error: result.error },
          stageMetrics: { 
            durationMs: Date.now() - startTime,
            chunksProcessed: i,
            chunksTotal: chunks.length
          },
          stageOutput: [
            { name: 'document-md', data: markdown }
          ]
        };
      }
      
      cleanChunks.push(result.data);
      
      // Track tokens if available in response
      let chunkTokens = 0;
      if (result.data?.usage?.total_tokens) {
        chunkTokens = result.data.usage.total_tokens;
        totalTokens += chunkTokens;
      }

      // Emit chunk completion
      if (context?.emit) {
        context.emit('progress', {
          event: 'item_complete',
          current: i + 1,
          total: chunks.length,
          label: `chunk ${i + 1}/${chunks.length}`,
          durationMs: chunkDurationMs,
          tokens: chunkTokens || undefined
        });
      }
    }
    
    const cleanMarkdown = cleanChunks.join('\n');

    const stats = {
      inputLength: markdown.length,
      outputLength: cleanMarkdown.length,
      chunkCount: chunks.length,
      totalTokens: totalTokens || undefined
    };

    const durationMs = Date.now() - startTime;

    logger.info('Denoise LLM: Complete', { 
      docId, 
      durationMs,
      cleanLength: cleanMarkdown.length,
      ...stats
    });

    return {
      stageResult: { success: true },
      stageMetrics: { durationMs, stats },
      stageOutput: [
        { name: 'document-md', data: cleanMarkdown }
      ]
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error('Denoise LLM: failed', { error: error.message, docId, durationMs });

    return {
      stageResult: { success: false, error: error.message },
      stageMetrics: { durationMs },
      stageOutput: [
        { name: 'document-md', data: markdown }
      ]
    };
  }
}

function validate(config) {
  const errors = [];
  
  // Validate that document_denoise_llm config exists
  if (!config.document_denoise_llm) {
    errors.push('Missing document_denoise_llm config');
  } else {
    if (!config.document_denoise_llm.task_prompt) {
      errors.push('Missing document_denoise_llm.task_prompt');
    }
    if (!config.document_denoise_llm.system_prompt) {
      errors.push('Missing document_denoise_llm.system_prompt');
    }
  }
  
  return { valid: errors.length === 0, errors };
}

export { execute, validate, chunkMarkdown };
