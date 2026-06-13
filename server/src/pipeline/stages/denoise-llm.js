/**
 * Denoise LLM Stage (v3 Pattern)
 * 
 * LLM-based document cleaning using the LLM stage service.
 * Processes markdown chunks through the denoiseText function.
 */

import { createLogger } from '../../utils/logger.js';
import { denoiseText } from '../../services/llm/stage-service.js';

const logger = createLogger('stage-denoise-llm');

function chunkMarkdown(text, maxSize = 4000) {
  const chunks = [];
  
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
  
  for (let i = 0; i < validLines.length; i++) {
    const line = validLines[i];
    const lineSize = line.length + 1;
    
    if (currentSize + lineSize > maxSize) {
      let splitIdx = currentChunk.length;
      for (let j = currentChunk.length - 1; j >= 0; j--) {
        if (currentChunk[j].match(/^#{1,6}\s+/)) {
          splitIdx = j;
          break;
        }
      }
      
      const chunk = currentChunk.slice(0, splitIdx).join('\n');
      if (chunk.trim()) chunks.push(chunk);
      
      currentChunk = currentChunk.slice(splitIdx);
      currentChunk.push(line);
      currentSize = currentChunk.reduce((sum, l) => sum + l.length + 1, 0);
    } else {
      currentChunk.push(line);
      currentSize += lineSize;
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n'));
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
    const chunks = chunkMarkdown(markdown);

    logger.info('Denoise LLM:', { 
      docId, 
      contentLengthOriginal: markdown.length,
      chunkCount: chunks.length
    });

    // Process each chunk through LLM
    const cleanChunks = [];
    let totalTokens = 0;
    
    const denoiseLlmConfig = config.document_denoise_llm;
    
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
    
    const cleanMarkdown = cleanChunks.join('\n\n');

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
