/**
 * Reflect handler for research discovery.
 *
 * Calls Hindsight Reflect with the user query and returns a Markdown narrative.
 * Consumes the plain text `text` field from the Reflect response directly.
 */

import { reflect } from '../../hindsight/index.js';
import { parseGraphResponse } from '../../../prompts/parse-graph-response.js';
import { normalizeGraph } from '../../../prompts/normalize-graph.js';
import { loadEntityCatalog } from '../../../prompts/entity-catalog.js';
import { createLogger } from '../../../utils/logger.js';
import { composeMentalModelPrompt } from '../../../prompts/template-service.js';

const logger = createLogger('research-handler-reflect');

const VALID_TEMPLATES = new Set([
  'narrative',
  'graph-known',
  'graph-discovery',
  'graph-discovered-only',
  'narrative-graph-known',
  'narrative-graph-discovery',
  'narrative-graph-discovered-only',
]);

function resolveTemplate(requestedTemplate, outputMode, allowDiscovery) {
  if (VALID_TEMPLATES.has(requestedTemplate)) return requestedTemplate;

  // Legacy UI output_mode values map to v0.3.5 template names.
  if (outputMode === 'narrative') return 'narrative';
  if (outputMode === 'graph-only') return 'graph-known';
  if (outputMode === 'narrative+graph') {
    return allowDiscovery ? 'narrative-graph-discovery' : 'narrative-graph-known';
  }
  return 'narrative-graph-known';
}

async function composeReflectPrompt(db, query, requestedTemplate, outputMode, allowDiscovery) {
  if (!db) throw new Error('db is required to compose Reflect prompt');
  const templateName = resolveTemplate(requestedTemplate, outputMode, allowDiscovery);
  return composeMentalModelPrompt(db, templateName, query);
}

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

  const templateName = resolveTemplate(options.template, options.output_mode, options.allow_discovery);

  let composedQuery;
  try {
    composedQuery = await composeReflectPrompt(db, query, options.template, options.output_mode, options.allow_discovery);
  } catch (err) {
    logger.error('Failed to compose Reflect prompt', { error: err.message, template: templateName });
    return { success: false, error: err.message, code: 'COMPOSE_PROMPT_FAILED' };
  }

  const knownCatalogPromise = loadEntityCatalog(db).then((entities) => new Map(entities.map((e) => [e.id, e])));

  const body = {
    query: composedQuery,
    budget: options.budget || 'low',
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

  const text = result.data?.text;
  const extracted = parseGraphResponse(text || '', {
    mode: templateName,
    expectGraph: templateName.startsWith('graph-'),
    defaultSource: 'mental_model',
  });
  const knownCatalog = await knownCatalogPromise;
  const normalizedGraph = normalizeGraph(extracted.graph, {
    activity: 'reflect',
    knownCatalog,
    mode: templateName,
  });

  const graph = {
    nodes: normalizedGraph.nodes,
    edges: normalizedGraph.edges,
  };
  const hasGraph = graph.nodes.length > 0 || graph.edges.length > 0;
  const graphOnly = templateName.startsWith('graph-');

  if (graphOnly) {
    if (!hasGraph) {
      logger.warn('Reflect graph-only response missing graph data', { keys: Object.keys(result.data || {}), preview: text?.slice(0, 200) });
      return {
        success: false,
        error: 'Reflect graph-only response missing graph data',
        code: 'INVALID_REFLECT_RESPONSE',
        calls: [{
          ...baseCall,
          status: 'failure',
          error: 'Reflect graph-only response missing graph data',
          code: 'INVALID_REFLECT_RESPONSE',
        }],
      };
    }
  } else if (typeof text !== 'string' || text.length === 0) {
    logger.warn('Reflect response missing plain text narrative', { keys: Object.keys(result.data || {}) });
    return {
      success: false,
      error: 'Reflect response missing plain text narrative',
      code: 'INVALID_REFLECT_RESPONSE',
      calls: [{
        ...baseCall,
        status: 'failure',
        error: 'Reflect response missing plain text narrative',
        code: 'INVALID_REFLECT_RESPONSE',
      }],
    };
  }

  return {
    success: true,
    narrative: graphOnly ? '' : `# Results - ${query}\n\n${text}` + basedOnToMarkdown(result.data, query),
    graph,
    calls_used: ['reflect'],
    calls: [baseCall],
  };
}
