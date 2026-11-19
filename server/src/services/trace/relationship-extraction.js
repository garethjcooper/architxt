/**
 * Extract an image-style systems inventory + connection mappings table from a
 * cleaned, delimited trace log using an LLM.
 *
 * This is intentionally separate from the deterministic trace pipeline. It
 * consumes the cleaned delimited log produced by processTraceContent and emits
 * markdown tables matching the VLLM image description prompt shape.
 */

import { generateCompletion } from '../llm/client.js';
import { createLogger } from '../../utils/logger.js';
import { config as appConfig } from '../../config.js';

const logger = createLogger('trace-relationship-extraction');

const DEFAULT_CHUNK_COUNT = 4;
const DEFAULT_MAX_LINES_PER_CHUNK = 120;

/**
 * Build the prompt for relationship extraction from a delimited log.
 *
 * Uses the dedicated trace_relationship_extraction task prompt and replaces the
 * [sample] ... [/sample] placeholder with the supplied delimited log.
 *
 * @param {string} delimitedLog
 * @returns {string}
 */
function buildTaskPrompt(delimitedLog) {
  const prompt = appConfig.trace_relationship_extraction.task_prompt;
  return prompt.replace(/{sample}/g, delimitedLog);
}

const SYSTEM_PROMPT = appConfig.trace_relationship_extraction.system_prompt;

/**
 * Split a delimited log into roughly N line-based chunks. The first line is the
 * header and is included in every chunk so the LLM can interpret columns.
 *
 * @param {string} delimitedLog
 * @param {number} chunkCount
 * @returns {string[]}
 */
export function chunkDelimitedLog(delimitedLog, chunkCount = DEFAULT_CHUNK_COUNT) {
  if (!delimitedLog || typeof delimitedLog !== 'string') return [];

  const lines = delimitedLog.split(/\r?\n/);
  if (lines.length <= 1) return [delimitedLog];

  const header = lines[0];
  const dataLines = lines.slice(1).filter((line) => line.trim() !== '');
  if (dataLines.length === 0) return [header];

  const effectiveChunkCount = Math.min(chunkCount, dataLines.length);
  const chunkSize = Math.max(1, Math.ceil(dataLines.length / effectiveChunkCount));

  const chunks = [];
  for (let i = 0; i < dataLines.length; i += chunkSize) {
    const slice = dataLines.slice(i, i + chunkSize);
    chunks.push([header, ...slice].join('\n'));
  }
  return chunks;
}

/**
 * Extract relationships from a delimited log via LLM.
 *
 * @param {object} options
 * @param {string} options.delimitedLog
 * @param {string} options.provider
 * @param {string} options.model
 * @param {number} [options.temperature=0.0]
 * @param {number} [options.maxTokens]
 * @param {number} [options.chunkCount=4]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ success: boolean, markdown?: string, relationships?: object[], error?: string, code?: string }>}
 */
export async function extractRelationshipsFromDelimitedLog(options) {
  const {
    delimitedLog,
    provider,
    model,
    temperature = 0.2,
    maxTokens,
    timeoutMs,
    maxChunks,
  } = options;

  if (!delimitedLog || typeof delimitedLog !== 'string' || delimitedLog.trim() === '') {
    return { success: false, error: 'delimitedLog is required', code: 'MISSING_INPUT' };
  }

  const resolvedProvider = provider || appConfig.trace_relationship_extraction.provider;
  const resolvedModel = model || appConfig.trace_relationship_extraction.model;
  const resolvedTemperature = temperature ?? appConfig.trace_relationship_extraction.temperature;
  const resolvedMaxTokens = maxTokens || appConfig.trace_relationship_extraction.max_tokens || 16384;
  const resolvedTimeoutMs = timeoutMs || appConfig.trace_relationship_extraction.timeout_ms || 300000;
  const resolvedMaxChunks = maxChunks || appConfig.trace_relationship_extraction.max_chunks || DEFAULT_CHUNK_COUNT;

  if (!resolvedProvider || typeof resolvedProvider !== 'string') {
    return { success: false, error: 'provider is required', code: 'MISSING_PROVIDER' };
  }
  if (!resolvedModel || typeof resolvedModel !== 'string') {
    return { success: false, error: 'model is required', code: 'MISSING_MODEL' };
  }

  const chunks = chunkDelimitedLog(delimitedLog, resolvedMaxChunks);
  if (chunks.length === 0) {
    return { success: false, error: 'delimitedLog produced no chunks', code: 'EMPTY_INPUT' };
  }

  const limitedChunks = chunks.map((chunk) => {
    const lines = chunk.split(/\r?\n/);
    if (lines.length <= DEFAULT_MAX_LINES_PER_CHUNK + 1) return chunk;
    return lines.slice(0, DEFAULT_MAX_LINES_PER_CHUNK + 1).join('\n');
  });

  const combinedLog = limitedChunks.join('\n\n--- CHUNK ---\n\n');
  const prompt = buildTaskPrompt(combinedLog);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];

  logger.info('Extracting relationships from delimited log', {
    provider: resolvedProvider,
    model: resolvedModel,
    chunkCount: chunks.length,
    inputLength: combinedLog.length,
  });

  const result = await generateCompletion(messages, {
    provider: resolvedProvider,
    model: resolvedModel,
    temperature: resolvedTemperature,
    max_tokens: resolvedMaxTokens,
    timeout_ms: resolvedTimeoutMs,
  });

  if (!result.success) {
    logger.error('Relationship extraction LLM call failed', { error: result.error, code: result.code });
    return {
      success: false,
      error: result.error,
      code: result.code || 'LLM_ERROR',
    };
  }

  const markdown = result.data?.content || '';
  const relationships = parseConnectionMappingsTable(markdown);

  logger.info('Relationship extraction complete', {
    markdownLength: markdown.length,
    relationshipCount: relationships.length,
  });

  return {
    success: true,
    markdown,
    relationships,
  };
}

/**
 * Parse the Connection Mappings markdown table into structured rows.
 *
 * @param {string} markdown
 * @returns {Array<{from: string, to: string, flowText: string, direction: string, description: string}>}
 */
export function parseConnectionMappingsTable(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];

  const lines = markdown.split(/\r?\n/);
  let inConnectionTable = false;
  let headerSeen = false;
  const rows = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('**Connection Mappings:**') || line.startsWith('## Connection Mappings')) {
      inConnectionTable = true;
      headerSeen = false;
      continue;
    }
    if (inConnectionTable && line.startsWith('|')) {
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell !== '');
      if (cells.length >= 5) {
        if (/^\s*-+\s*$/.test(cells[0])) {
          headerSeen = true;
          continue;
        }
        if (headerSeen) {
          rows.push({
            from: cells[0],
            to: cells[1],
            flowText: cells[2],
            direction: cells[3],
            description: cells[4],
          });
        }
      }
      continue;
    }
    if (inConnectionTable && line.startsWith('**') && line.includes('Inventory')) {
      // Stay in parsing mode; another section header doesn't reset.
    }
  }

  return rows;
}
