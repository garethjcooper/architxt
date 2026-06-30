/**
 * LLM Service Client
 *
 * HTTP client for LLM inference (Ollama, OpenAI, OpenAI-compatible)
 * Supports chat completions with vision (image-based) models
 *
 * Configuration: Uses config.providers[name] for endpoint details
 * Error handling: Returns { success, data?, error?, code? } shape
 */

import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';

const logger = createLogger('llm-client');

/**
 * Get provider config from central registry
 * Looks up in config.providers by provider name
 */
function getProviderConfig(providerName) {
  const provider = config.providers?.[providerName];

  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}. Available: ${Object.keys(config.providers || {}).join(', ')}`);
  }

  // Return config values directly in snake_case - no translation
  return {
    name: providerName,
    base_url: provider.base_url,
    api_key: provider.api_key,
    timeout_ms: provider.timeout_ms,
    chat_style: provider.chat_style,
  };
}

/**
 * Build request URL based on provider
 * For Ollama providers, checks if base_url has /v1 path (OpenAI-compatible) or not (native)
 */
function buildUrl(base_url, chat_style) {
  if (chat_style === 'openai') {
    return `${base_url}/chat/completions`;
  }

  // Native Ollama local endpoint
  return `${base_url}/api/chat`;
}

/**
 * Build request body based on provider
 */
function buildRequestBody(messages, options, chat_style) {
  const { model, temperature, max_tokens } = options;
  // OpenAI-compatible formats (includes cloud variants)
  if (chat_style === 'openai') {
    const body = {
      model,
      messages,
      temperature,
    };
    if (max_tokens !== undefined) body.max_tokens = max_tokens;
    return body;
  }

  // Ollama local format
  const body = {
    model,
    messages,
    stream: false,
    options: {
      temperature,
    },
  };
  if (max_tokens !== undefined) body.options.num_predict = max_tokens;
  return body;
}

/**
 * Parse response based on provider
 */
function parseResponse(responseData, chat_style) {
  // OpenAI-compatible response formats
  if (chat_style === 'openai') {
    return {
      content: responseData.choices?.[0]?.message?.content || '',
      usage: responseData.usage || null,
      model: responseData.model,
      finishReason: responseData.choices?.[0]?.finish_reason,
    };
  }

  // Ollama local format
  return {
    content: responseData.message?.content || '',
    usage: responseData.eval_count ? {
      prompt_tokens: responseData.prompt_eval_count,
      completion_tokens: responseData.eval_count,
      total_tokens: responseData.prompt_eval_count + responseData.eval_count,
    } : null,
    model: responseData.model,
    finishReason: responseData.done ? 'stop' : null,
  };
}

/**
 * Generate completion from LLM
 * Returns { success, data?, error?, code? }
 *
 * @param {Array} messages - Array of {role, content} messages
 * @param {Object} options - Options: { provider, model, temperature }
 * @returns {Promise<{success: boolean, data?: object, error?: string, code?: string}>}
 */
export async function generateCompletion(messages, options = {}) {
  const providerName = options.provider;
  const model = options.model;

  // FAIL FAST: model is required
  if (!model) {
    return {
      success: false,
      error: 'model is required in options',
      code: 'MISSING_MODEL',
    };
  }

  let providerConfig;
  try {
    providerConfig = getProviderConfig(providerName);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: 'UNKNOWN_PROVIDER',
    };
  }

  // Use passed values only - no merging, no defaults
  const requestOptions = {
    model,
    temperature: options.temperature,
    max_tokens: options.max_tokens,
  };

  const url = buildUrl(providerConfig.base_url, providerConfig.chat_style);
  const body = buildRequestBody(messages, requestOptions, providerConfig.chat_style);

  logger.info('LLM request', {
    provider: providerName,
    model: requestOptions.model,
    messageCount: messages.length,
  });

  const startTime = Date.now();

  try {
    const headers = {
      'Content-Type': 'application/json',
    };

    if (providerConfig.api_key) {
      headers['Authorization'] = `Bearer ${providerConfig.api_key}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), providerConfig.timeout_ms);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('LLM request failed', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      return {
        success: false,
        error: `LLM request failed: ${response.status} ${response.statusText}`,
        code: 'LLM_REQUEST_FAILED',
      };
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    const parsed = parseResponse(result, providerConfig.chat_style);

    logger.info('LLM response', {
      durationMs: duration,
      model: parsed.model,
      contentLength: parsed.content.length,
      usage: parsed.usage,
    });

    return {
      success: true,
      data: parsed,
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    if (error.name === 'AbortError') {
      logger.error('LLM request timeout', {
        durationMs: duration,
        timeout_ms: providerConfig.timeout_ms,
      });
      return {
        success: false,
        error: `LLM request timeout after ${providerConfig.timeout_ms}ms`,
        code: 'LLM_TIMEOUT',
      };
    }

    logger.error('LLM client error', { error: error.message, durationMs: duration });
    return {
      success: false,
      error: error.message,
      code: 'LLM_CLIENT_ERROR',
    };
  }
}

/**
 * Generate completion with image (vision model)
 * Returns { success, data?, error?, code? }
 *
 * @param {string} textPrompt - Text prompt
 * @param {Buffer|string} imageData - Image buffer or base64 string
 * @param {Object} options - Options: { provider, model, temperature }
 * @returns {Promise<{success: boolean, data?: object, error?: string, code?: string}>}
 */
export async function generateVisionCompletion(textPrompt, imageData, options = {}) {
  const providerName = options.provider;

  // FAIL FAST: provider is required
  if (!providerName) {
    return {
      success: false,
      error: 'provider is required in options',
      code: 'MISSING_PROVIDER',
    };
  }

  let providerConfig;
  try {
    providerConfig = getProviderConfig(providerName);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: 'UNKNOWN_PROVIDER',
    };
  }

  // chat_style comes from provider registry (app config), not options
  const chat_style = providerConfig.chat_style;

  // Normalize image data to base64
  const imageBase64 = Buffer.isBuffer(imageData)
    ? imageData.toString('base64')
    : imageData;

  let messages;

  if (chat_style === 'openai') {
    // OpenAI/Anthropic vision format
    messages = [{
      role: 'user',
      content: [
        { type: 'text', text: textPrompt },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${imageBase64}`,
          },
        },
      ],
    }];
  } else {
    // Ollama local format (llava compatible)
    messages = [{
      role: 'user',
      content: textPrompt,
      images: [imageBase64],
    }];
  }

  return generateCompletion(messages, options);
}

/**
 * Simple text completion helper
 * Returns { success, data?, error?, code? }
 *
 * @param {string} prompt - Simple text prompt
 * @param {Object} options - Override config: { provider, model, temperature }
 * @returns {Promise<{success: boolean, data?: string, error?: string, code?: string}>}
 */
export async function complete(prompt, options = {}) {
  const messages = [{ role: 'user', content: prompt }];
  const result = await generateCompletion(messages, options);

  if (!result.success) {
    return result;
  }

  return {
    success: true,
    data: result.data.content,
    model: result.data.model,
    usage: result.data.usage,
  };
}

/**
 * Health check for LLM service
 * @returns {Promise<{success: boolean, data?: boolean, error?: string, code?: string}>}
 */
export async function healthCheck(providerName = 'ollama_local') {
  let providerConfig;
  try {
    providerConfig = getProviderConfig(providerName);
  } catch (err) {
    return {
      success: false,
      error: err.message,
      code: 'UNKNOWN_PROVIDER',
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    let response;

    // Ollama health endpoint
    if (providerName.includes('ollama')) {
      response = await fetch(`${providerConfig.base_url}/api/tags`, {
        method: 'GET',
        signal: controller.signal,
      });
    } else {
      // OpenAI/Anthropic - try a minimal request
      response = await fetch(`${providerConfig.base_url}/models`, {
        method: 'GET',
        headers: providerConfig.api_key ? { 'Authorization': `Bearer ${providerConfig.api_key}` } : {},
        signal: controller.signal,
      });
    }

    clearTimeout(timeoutId);

    return {
      success: true,
      data: response.ok,
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      code: 'HEALTH_CHECK_FAILED',
    };
  }
}

export default {
  generateCompletion,
  generateVisionCompletion,
  complete,
  healthCheck,
};
