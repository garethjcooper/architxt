/**
 * Reflect handler for research discovery.
 *
 * Calls Hindsight Reflect with the user query and returns a Markdown narrative.
 * Consumes the plain text `text` field from the Reflect response directly.
 */

import { reflect } from '../../hindsight/index.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('research-handler-reflect');

function basedOnToMarkdown(data, query) {
  const memories = data?.based_on?.memories;
  if (!Array.isArray(memories) || memories.length === 0) return '';

  const rows = memories.map((m) => ({
    text: escapeTableCell(m.text || '-'),
    type: escapeTableCell(m.type || '-'),
    id: escapeTableCell(m.id || '-'),
  }));

  const headers = ['Text', 'Type', 'ID'];
  const colWidths = headers.map((h, i) => Math.max(
    h.length,
    ...rows.map((r) => Object.values(r)[i]?.toString().length || 0),
  ));

  const separator = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  const header = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';

  const lines = ['', `# Memories - ${query}`, '', header, separator];
  for (const row of rows) {
    const vals = [row.text, row.type, row.id];
    lines.push('| ' + vals.map((v, i) => v.toString().slice(0, colWidths[i]).padEnd(colWidths[i])).join(' | ') + ' |');
  }
  return lines.join('\n');
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

export async function handleReflect(serverId, bankId, query, options = {}) {
  if (!serverId || !bankId || !query) {
    return { success: false, error: 'server_id, bank_id, and query are required', code: 'MISSING_PARAMS' };
  }

  logger.info('Reflect research query', { serverId, bankId, queryLength: query.length });

  const body = {
    query,
    budget: options.budget || 'low',
  };
  if (options.max_tokens) body.max_tokens = options.max_tokens;
  if (options.types?.length) body.types = options.types;
  if (options.fact_types?.length) body.fact_types = options.fact_types;
  if (options.tags?.length) body.tags = options.tags;
  if (options.tags_match) body.tags_match = options.tags_match;
  if (typeof options.exclude_mental_models === 'boolean') body.exclude_mental_models = options.exclude_mental_models;
  if (options.include) body.include = options.include;

  const result = await reflect(serverId, bankId, body);
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      code: result.code || 'REFLECT_FAILED',
      request: result.request,
    };
  }

  const text = result.data?.text;
  if (typeof text !== 'string' || text.length === 0) {
    logger.warn('Reflect response missing plain text narrative', { keys: Object.keys(result.data || {}) });
    return {
      success: false,
      error: 'Reflect response missing plain text narrative',
      code: 'INVALID_REFLECT_RESPONSE',
    };
  }

  const requestPayloadChars = JSON.stringify(body).length;

  return {
    success: true,
    narrative: `# Results - ${query}\n\n${text}` + basedOnToMarkdown(result.data, query),
    graph: { nodes: [], edges: [] },
    calls_used: ['reflect'],
    calls: [{
      tool: 'reflect',
      mode: 'reflect',
      status: 'success',
      duration_ms: 0,
      request_payload_chars: requestPayloadChars,
      prompt_text: `Query: ${query}\n\nRequest body:\n${JSON.stringify(body, null, 2)}`,
      response_text: JSON.stringify(result.data, null, 2),
      response_summary: {
        kind: 'reflect',
        preview: text.slice(0, 200),
      },
      request: result.request,
    }],
  };
}
