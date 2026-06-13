/**
 * LLM Stage Service
 *
 * High-level interface for pipeline stages to use LLM capabilities.
 * Abstracts provider differences (Ollama, OpenAI) and handles common patterns.
 *
 * Usage:
 *   import { describeImage, denoiseText, summarize } from './llm/stage-service.js';
 *
 *   const result = await describeImage(imageBuffer, 'What is in this diagram?');
 *   if (result.success) { use result.data }
 *
 * All functions return { success, data?, error?, code? } shape.
 */

import { generateCompletion, generateVisionCompletion, complete } from './client.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('llm-stage-service');

/**
 * Denoise/clean markdown text
 * Uses text model to fix OCR errors and formatting issues
 *
 * @param {string} text - Raw markdown text
 * @param {Object} stageConfig - { provider, model, temperature, task_prompt, system_prompt } from pipeline
 * @returns {Promise<{success: boolean, data?: string, error?: string, code?: string}>}
 */
export async function denoiseText(text, stageConfig = null) {
  // Stage config is REQUIRED - fail if not provided
  if (!stageConfig || !stageConfig.task_prompt || !stageConfig.system_prompt) {
    return {
      success: false,
      error: 'denoiseText requires stageConfig with task_prompt and system_prompt',
      code: 'MISSING_STAGE_CONFIG'
    };
  }

  logger.info('Denoising text', { length: text.length });

  const messages = [
    { role: 'system', content: `${stageConfig.system_prompt}\n\n${stageConfig.task_prompt}` },
    { role: 'user', content: text }
  ];

  const result = await generateCompletion(messages, {
    provider: stageConfig.provider,
    model: stageConfig.model,
    temperature: stageConfig.temperature,
  });

  if (!result.success) {
    logger.error('Denoising failed', { error: result.error, code: result.code });
    return result;
  }

  logger.info('Denoising complete', {
    inputLength: text.length,
    outputLength: result.data.content.length,
  });

  return {
    success: true,
    data: result.data.content,
  };
}

/**
 * Describe an image (vision model)
 * @param {Buffer|string} imageData - Image buffer or base64
 * @param {Object} stageConfig - { provider, model, temperature, task_prompt, system_prompt } from pipeline
 * @returns {Promise<{success: boolean, data?: string, error?: string, code?: string}>}
 */
export async function describeImage(imageData, stageConfig = null) {
  // Stage config is REQUIRED - fail if not provided
  if (!stageConfig || !stageConfig.task_prompt || !stageConfig.system_prompt) {
    return {
      success: false,
      error: 'describeImage requires stageConfig with task_prompt and system_prompt',
      code: 'MISSING_STAGE_CONFIG'
    };
  }

  logger.info('Describing image');

  // Concatenate system + task prompt for vision model
  const combinedPrompt = `${stageConfig.system_prompt}\n\n${stageConfig.task_prompt}`;

  const result = await generateVisionCompletion(
    combinedPrompt,
    imageData,
    {
      provider: stageConfig.provider,
      model: stageConfig.model,
      temperature: stageConfig.temperature,
    }
  );

  if (!result.success) {
    logger.error('Image description failed', { error: result.error, code: result.code });
    return result;
  }

  logger.info('Image description complete', {
    descriptionLength: result.data.content.length,
    model: result.data.model,
  });

  return {
    success: true,
    data: result.data.content,
  };
}

/**
 * Summarize text
 *
 * @param {string} text - Text to summarize
 * @param {Object} options - { provider, model, maxLength }
 * @returns {Promise<{success: boolean, data?: string, error?: string, code?: string}>}
 */
export async function summarize(text, options = {}) {
  logger.info('Summarizing text', { length: text.length });

  const prompt = `Provide a brief summary of the following content. Be concise.\n\n${text}`;
  const result = await complete(prompt, {
    provider: options.provider,
    model: options.model,
    temperature: options.temperature ?? 0.7,
  });

  if (!result.success) {
    logger.error('Summarization failed', { error: result.error, code: result.code });
    return result;
  }

  logger.info('Summarization complete', {
    inputLength: text.length,
    summaryLength: result.data.length,
  });

  return {
    success: true,
    data: result.data,
  };
}

/**
 * Generic completion with built-in prompt engineering
 *
 * @param {string} task - Task description
 * @param {string} content - Content to process
 * @param {Object} options - { provider, model, temperature }
 * @returns {Promise<{success: boolean, data?: string, error?: string, code?: string}>}
 */
export async function processWithLLM(task, content, options = {}) {
  logger.info('Processing with LLM', { task, contentLength: content.length });

  const prompt = `${task}\n\n${content}`;
  const result = await complete(prompt, {
    provider: options.provider,
    model: options.model,
    temperature: options.temperature ?? 0.7,
  });

  if (!result.success) {
    logger.error('LLM processing failed', { error: result.error, code: result.code });
    return result;
  }

  return {
    success: true,
    data: result.data,
  };
}

/**
 * Health check
 * @param {string} provider - Provider name from config.providers
 * @returns {Promise<{success: boolean, data?: boolean, error?: string, code?: string}>}
 */
export async function healthCheck(provider = 'ollama_local') {
  const { healthCheck: clientHealthCheck } = await import('./client.js');
  return clientHealthCheck(provider);
}

export default {
  denoiseText,
  describeImage,
  summarize,
  processWithLLM,
  healthCheck,
};
