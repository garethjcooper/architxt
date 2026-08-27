/**
 * Reflect handler for research discovery.
 *
 * Calls Hindsight Reflect with the user query and returns a Markdown narrative.
 * Consumes the plain text `text` field from the Reflect response directly.
 */

import { reflect } from '../../hindsight/index.js';
import { loadEntityCatalog } from '../../../prompts/entity-catalog.js';
import { createLogger } from '../../../utils/logger.js';
import { composeMentalModelPrompt, formatFocusVariable } from '../../../prompts/template-service.js';
import { UNIFIED_RESPONSE_SCHEMA } from '../../contextual-graph/unified-response-schema.js';
import { toEnvelope } from '../../contextual-graph/to-envelope.js';

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

export async function handleReflect(serverId, bankId, query, options = {}, db) {
  if (!serverId || !bankId || !query) {
    return { success: false, error: 'server_id, bank_id, and query are required', code: 'MISSING_PARAMS' };
  }

  if (!db) {
    return { success: false, error: 'db is required to compose Reflect prompt', code: 'MISSING_DB' };
  }

  logger.info('Reflect research query', { serverId, bankId, queryLength: query.length });

  const focus = options.section_focus || {};
  const requestedGraph = Boolean(focus.graph && (typeof focus.graph === 'string' ? focus.graph.trim() : focus.graph.content?.trim()));
  const requestedTables = Array.isArray(focus.table) && focus.table.length > 0;
  const requestedDiagrams = Array.isArray(focus.diagram) && focus.diagram.length > 0;
  const requestedNarrative = focus.narrative && (typeof focus.narrative === 'string'
    ? focus.narrative.trim().length > 0
    : focus.narrative.content?.trim().length > 0);
  const requestedStructured = requestedGraph || requestedTables || requestedDiagrams;
  const hasAnyDirective = requestedNarrative || requestedStructured;
  let composedQuery;
  try {
    composedQuery = await composeMentalModelPrompt(db, 'generic', query, {
      ARCHITXT_GRAPH_FOCUS: formatFocusVariable(focus.graph),
      ARCHITXT_TABLE_FOCUS: formatFocusVariable(focus.table),
      ARCHITXT_DIAGRAM_FOCUS: formatFocusVariable(focus.diagram),
      ARCHITXT_NARRATIVE_FOCUS: formatFocusVariable(focus.narrative),
    });
  } catch (err) {
    logger.error('Failed to compose Reflect prompt', { error: err.message });
    return { success: false, error: err.message, code: 'COMPOSE_PROMPT_FAILED' };
  }

  const knownCatalogPromise = loadEntityCatalog(db).then((entities) => new Map(entities.map((e) => [e.id, e])));

  const body = {
    query: composedQuery,
    budget: options.budget || 'low',
    response_schema: UNIFIED_RESPONSE_SCHEMA,
  };
  if (options.max_tokens) body.max_tokens = options.max_tokens;
  if (options.types?.length) body.types = options.types;
  if (options.fact_types?.length) body.fact_types = options.fact_types;
  if (options.tags?.length) body.tags = options.tags;
  if (options.tags_match) body.tags_match = options.tags_match;
  if (typeof options.exclude_mental_models === 'boolean') body.exclude_mental_models = options.exclude_mental_models;
  if (options.include) body.include = options.include;

  const result = await (typeof options.reflectFn === 'function' ? options.reflectFn(body) : reflect(serverId, bankId, body));
  const requestPayloadChars = JSON.stringify(body).length;
  const baseCall = {
    tool: 'reflect',
    mode: 'reflect',
    status: 'success',
    duration_ms: 0,
    request_payload_chars: requestPayloadChars,
    prompt_text: `Query: ${query}\n\nRequest body:\n${JSON.stringify(body, null, 2)}`,
    response_text: JSON.stringify(result.data, null, 2),
    response_summary: {
      kind: 'reflect',
      preview: (result.data?.text || '').slice(0, 200),
    },
    request: result.request,
  };

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      code: result.code || 'REFLECT_FAILED',
      request: result.request,
      calls: [{ ...baseCall, status: 'failure', error: result.error, code: result.code || 'REFLECT_FAILED' }],
    };
  }

  const structuredOutput = result.data?.structured_output;
  if (!structuredOutput || typeof structuredOutput !== 'object') {
    const keys = Object.keys(result.data || {});
    logger.warn('Reflect response missing structured_output', { keys });
    return {
      success: false,
      error: 'Reflect response missing structured_output',
      code: 'INVALID_REFLECT_RESPONSE',
      calls: [{
        ...baseCall,
        status: 'failure',
        error: 'Reflect response missing structured_output',
        code: 'INVALID_REFLECT_RESPONSE',
      }],
    };
  }
  const extracted = structuredOutput;
  const knownCatalog = await knownCatalogPromise;
  const envelope = toEnvelope(extracted, {
    knownCatalog,
    activity: 'reflect',
    mode: 'generic',
  });

  const hasGraph = envelope.graph.nodes.length > 0 || envelope.graph.edges.length > 0;
  const hasTables = Array.isArray(envelope.tables) && envelope.tables.length > 0;
  const hasDiagrams = Array.isArray(envelope.diagrams) && envelope.diagrams.length > 0;
  const hasStructuredOutput = hasGraph || hasTables || hasDiagrams;

  // Require a non-empty narrative only when narrative was explicitly requested
  // or when no structured output sections were produced.
  if (!envelope.narrative || envelope.narrative.length === 0) {
    if (requestedNarrative || !hasStructuredOutput) {
      logger.warn('Reflect response missing narrative', { keys: Object.keys(result.data || {}) });
      return {
        success: false,
        error: 'Reflect response missing narrative',
        code: 'INVALID_REFLECT_RESPONSE',
        calls: [{
          ...baseCall,
          status: 'failure',
          error: 'Reflect response missing narrative',
          code: 'INVALID_REFLECT_RESPONSE',
        }],
      };
    }
  }

  // Only discard a produced narrative when the caller explicitly requested
  // structured sections (graph/table/diagram) and the model also produced that
  // structured output. For plain Reflect queries with no explicit section
  // directives, the narrative is the primary output and must be preserved.
  let finalNarrative = envelope.narrative;
  let finalNarrativeName = envelope.narrative_name;
  if (requestedStructured && !requestedNarrative && hasStructuredOutput) {
    finalNarrative = '';
    finalNarrativeName = '';
  }

  // If narrative is empty but structured output exists, synthesize a header so
  // downstream consumers still have a Markdown section to render.
  const narrative = finalNarrative && finalNarrative.length > 0
    ? finalNarrative + basedOnToMarkdown(result.data, query)
    : basedOnToMarkdown(result.data, query);

  return {
    success: true,
    narrative,
    narrative_name: finalNarrativeName,
    graph: envelope.graph,
    tables: envelope.tables,
    diagrams: envelope.diagrams,
    calls_used: ['reflect'],
    calls: [baseCall],
  };
}
