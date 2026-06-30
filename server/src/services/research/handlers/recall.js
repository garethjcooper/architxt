/**
 * Recall handler for research discovery.
 *
 * Calls Hindsight recall with the user query and returns the results as a
 * Markdown table narrative.
 */

import { recall } from '../../hindsight/index.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('research-handler-recall');

function resultsToMarkdownTable(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return 'No results found.';
  }

  const rows = results.map((r) => {
    const memory = r.memory || r;
    return {
      text: escapeTableCell(memory.summary || memory.content || memory.text || '-'),
      when: formatMentionedAt(memory.mentioned_at),
    };
  });

  const headers = ['Text', 'When'];
  const colWidths = headers.map((h, i) => Math.max(
    h.length,
    ...rows.map((r) => Object.values(r)[i]?.toString().length || 0),
  ));

  const separator = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  const header = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';

  const lines = [header, separator];
  for (const row of rows) {
    const vals = [row.text, row.when];
    lines.push('| ' + vals.map((v, i) => v.toString().slice(0, colWidths[i]).padEnd(colWidths[i])).join(' | ') + ' |');
  }

  return lines.join('\n');
}

function escapeTableCell(value) {
  return String(value).replace(/\|/g, '\\|');
}

function formatMentionedAt(value) {
  if (!value) return '-';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  // Use non-breaking hyphens so the date does not wrap across line breaks.
  return date.toISOString().split('T')[0].replace(/-/g, '\u2011');
}

function extractSourceFacts(resultData) {
  // Hindsight RecallResponse.source_facts is an object keyed by fact ID,
  // where each value is a RecallResult.
  const facts = resultData?.source_facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return [];

  return Object.entries(facts).map(([key, value]) => {
    const fact = value || {};
    return {
      id: fact.id || key || '-',
      text: fact.text || '-',
      document_id: fact.document_id || '-',
    };
  }).filter((f) => f.text !== '-' || f.id !== '-' || f.document_id !== '-');
}

function sourceFactsToMarkdown(sourceFacts) {
  if (!Array.isArray(sourceFacts) || sourceFacts.length === 0) return '';

  const rows = sourceFacts.map((fact) => ({
    text: escapeTableCell(fact.text || '-'),
    documentId: escapeTableCell(fact.document_id || '-'),
    id: escapeTableCell(fact.id || '-'),
  }));

  const headers = ['Text', 'Document Id', 'ID'];
  const colWidths = headers.map((h, i) => Math.max(
    h.length,
    ...rows.map((r) => Object.values(r)[i]?.toString().length || 0),
  ));

  const separator = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  const header = '| ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' | ') + ' |';

  const lines = [header, separator];
  for (const row of rows) {
    const vals = [row.text, row.documentId, row.id];
    lines.push('| ' + vals.map((v, i) => v.toString().slice(0, colWidths[i]).padEnd(colWidths[i])).join(' | ') + ' |');
  }

  return lines.join('\n');
}

export async function handleRecall(serverId, bankId, query, options = {}) {
  if (!serverId || !bankId || !query) {
    return { success: false, error: 'server_id, bank_id, and query are required', code: 'MISSING_PARAMS' };
  }

  logger.info('Recall research query', { serverId, bankId, queryLength: query.length });

  const body = { query };
  if (options.limit) body.limit = options.limit;
  if (options.types?.length) body.types = options.types;
  if (options.tags?.length) body.tags = options.tags;
  if (options.tags_match) body.tags_match = options.tags_match;
  if (options.budget) body.budget = options.budget;
  if (options.max_tokens) body.max_tokens = options.max_tokens;
  if (typeof options.prefer_observations === 'boolean') body.prefer_observations = options.prefer_observations;
  if (options.include) body.include = options.include;

  const result = await recall(serverId, bankId, body);
  if (!result.success) {
    return {
      success: false,
      error: result.error,
      code: result.code || 'RECALL_FAILED',
    };
  }

  const results = result.data?.results || [];
  const table = resultsToMarkdownTable(results);
  const facts = sourceFactsToMarkdown(extractSourceFacts(result.data));

  let narrative = `# Results - ${query}\n\n${table}`;
  if (facts) {
    narrative += `\n\n# Source Facts - ${query}\n${facts}`;
  }

  const requestPayloadChars = JSON.stringify(body).length;

  return {
    success: true,
    narrative,
    graph: { nodes: [], edges: [] },
    calls_used: ['recall'],
    calls: [{
      tool: 'recall',
      mode: 'recall',
      status: 'success',
      duration_ms: 0,
      request_payload_chars: requestPayloadChars,
      prompt_text: `Query: ${query}\n\nRequest body:\n${JSON.stringify(body, null, 2)}`,
      response_text: JSON.stringify(result.data, null, 2),
      response_summary: {
        kind: 'recall',
        preview: `Recall returned ${results.length} result${results.length === 1 ? '' : 's'}`,
      },
      request: result.request,
    }],
  };
}
