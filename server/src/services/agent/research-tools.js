import { createLogger } from '../../utils/logger.js';
import { submitDiscoverOperation } from '../../routes/research.js';
import { recall } from '../../services/hindsight/research.js';
import { getStep } from '../../db/crud/research.js';
import { getServerConfig } from '../../services/hindsight/config.js';

const logger = createLogger('agent-research-tools');

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Poll a research step until it is no longer running.
 * @param {Object} db
 * @param {number} stepId
 * @param {number} serverId
 * @param {string} bankId
 * @returns {Promise<{success: boolean, step?: object, error?: string, code?: string}>}
 */
async function pollResearchStep(db, stepId, serverId, bankId) {
  const deadline = Date.now() + MAX_POLL_MS;

  while (Date.now() < deadline) {
    const stepResult = getStep(db, stepId);
    if (!stepResult.success) {
      return { success: false, error: stepResult.error, code: stepResult.code || 'STEP_NOT_FOUND' };
    }
    const step = stepResult.data;

    if (step.rstep_status === 'completed') {
      return { success: true, step };
    }
    if (step.rstep_status === 'failed') {
      return {
        success: false,
        error: step.rstep_error_message || 'Research step failed',
        code: 'RESEARCH_STEP_FAILED',
      };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { success: false, error: 'Research step timed out while waiting for completion', code: 'RESEARCH_STEP_TIMEOUT' };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Synchronously run a recall query against the bank.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} query
 * @param {Object} options
 */
const MAX_LOG_STRING = 2000;
const MAX_LOG_ARRAY = 100;

function sanitizeLog(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value.length > MAX_LOG_STRING ? `${value.slice(0, MAX_LOG_STRING)}…` : value;
  if (Array.isArray(value)) return value.slice(0, MAX_LOG_ARRAY).map(sanitizeLog);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = sanitizeLog(v);
    }
    return out;
  }
  return value;
}

export async function runRecallTool(db, serverId, bankId, query, options = {}) {
  if (!serverId || !bankId || !query) {
    return { success: false, error: 'serverId, bankId, and query are required', code: 'MISSING_PARAMS' };
  }

  logger.info('Agent recall tool', { serverId, bankId, queryLength: query.length });

  const serverConfig = await getServerConfig(serverId);
  if (!serverConfig.success) {
    return { success: false, error: serverConfig.error, code: serverConfig.code || 'SERVER_CONFIG_ERROR' };
  }

  let effectiveQuery = query;
  if (options.canonicalEntities?.length) {
    effectiveQuery = `${query}\n\nEntities: ${options.canonicalEntities.join(', ')}`;
  }

  const body = {
    query: effectiveQuery,
    types: options.types,
    tags: options.tags,
    tags_match: options.tags_match,
    budget: options.budget,
    max_tokens: options.max_tokens,
    prefer_observations: options.prefer_observations,
    include: options.include,
  };
  // Remove keys that are still undefined after provider.js applied defaults.
  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key];
  }

  const result = await recall(serverId, bankId, body);
  if (!result.success) {
    return { success: false, error: result.error, code: result.code || 'RECALL_FAILED' };
  }

  const response = result.data || {};
  const results = Array.isArray(response.results) ? response.results : [];
  const chunks = response.chunks || {};
  const entities = response.entities || {};

  const memories = results.map((r) => {
    const chunk = r.chunk_id ? chunks[r.chunk_id] : null;
    const text = r.text || (chunk ? chunk.text : '') || '';
    return {
      id: r.memory_id || r.id,
      summary: text ? text.slice(0, 200) : '-',
      content: text,
      type: r.type || null,
      context: r.context || null,
      mentioned_at: r.mentioned_at || null,
      occurred_start: r.occurred_start || null,
      occurred_end: r.occurred_end || null,
      document_id: r.document_id || null,
      chunk_id: r.chunk_id || null,
      entities: r.entities || [],
      tags: r.tags || [],
      source_fact_ids: r.source_fact_ids || [],
      scores: r.scores || null,
    };
  });

  // Build a focused markdown digest for the LLM; keep the full structured data
  // available in the provenance payload for debugging.
  const llmDigest = buildLlmDigest(memories);

  return {
    success: true,
    data: {
      query: effectiveQuery,
      request: body,
      count: memories.length,
      relevance_analysis: null,
      llm_digest: llmDigest,
      memories,
      raw_response: sanitizeLog(response),
    },
  };
}

function buildLlmDigest(memories) {
  if (memories.length === 0) {
    return 'No relevant memories were found for this query.';
  }

  const lines = [
    `Found ${memories.length} memory result${memories.length === 1 ? '' : 's'} ordered by relevance:`,
    '',
  ];

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    const id = m.id || `item-${i + 1}`;
    const score = m.scores?.final != null ? `score=${m.scores.final.toFixed(3)}` : 'score=—';
    const type = m.type ? `type=${m.type}` : '';
    const tags = m.tags?.length ? `tags=${m.tags.join(', ')}` : '';
    const entities = m.entities?.length ? `entities=${m.entities.join(', ')}` : '';
    const source = [m.document_id && `doc=${m.document_id}`, m.chunk_id && `chunk=${m.chunk_id}`].filter(Boolean).join(' ');
    const meta = [score, type, tags, entities, source].filter(Boolean).join(' | ');

    lines.push(`id=${id}`);
    if (meta) lines.push(meta);
    lines.push(m.content || m.summary || '(no content)');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Synchronously run a reflect/research discovery query against the bank.
 * Creates a research step and polls until completion.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {number} sessionId
 * @param {string} intentText
 * @param {Object} options
 */
export async function runReflectTool(db, serverId, bankId, sessionId, intentText, options = {}) {
  if (!serverId || !bankId || !sessionId || !intentText) {
    return { success: false, error: 'serverId, bankId, sessionId, and intentText are required', code: 'MISSING_PARAMS' };
  }

  logger.info('Agent reflect tool', { serverId, bankId, sessionId, intentLength: intentText.length });

  const submitResult = await submitDiscoverOperation({
    db,
    serverId,
    bankId,
    intentText,
    queryDepth: 'reflect',
    sessionId,
    options: {
      budget: options.budget || 'low',
      ...(options.max_tokens !== undefined && { max_tokens: options.max_tokens }),
      ...(options.types?.length && { types: options.types }),
      ...(options.tags?.length && { tags: options.tags }),
      ...(options.tags_match && { tags_match: options.tags_match }),
      ...(options.fact_types?.length && { fact_types: options.fact_types }),
      ...(typeof options.exclude_mental_models === 'boolean' && { exclude_mental_models: options.exclude_mental_models }),
      ...(typeof options.include_source_facts === 'boolean' && { include_source_facts: options.include_source_facts }),
    },
    rawQuery: intentText,
  });

  if (!submitResult.success) {
    return { success: false, error: submitResult.error, code: submitResult.code || 'REFLECT_SUBMIT_FAILED' };
  }

  const pollResult = await pollResearchStep(db, submitResult.step_id, serverId, bankId);
  if (!pollResult.success) {
    return pollResult;
  }

  const step = pollResult.step;
  const envelope = step.rstep_envelope || {};
  const narratives = (envelope.narratives || []).map((n) => ({
    name: n.narrative_name || '',
    text: n.narrative || '',
  }));
  const graph = envelope.graph || { nodes: [], edges: [] };
  const tables = envelope.tables || [];
  const diagrams = envelope.diagrams || [];

  return {
    success: true,
    data: {
      intent: intentText,
      request: {
        queryDepth: 'reflect',
        budget: options.budget || 'low',
        options,
      },
      step_id: step.rstep_id,
      narratives,
      full_narratives: sanitizeLog(envelope.narratives || []),
      graph: sanitizeLog(graph),
      tables: sanitizeLog(tables),
      diagrams: sanitizeLog(diagrams),
      entity_count: graph.nodes.length,
      edge_count: graph.edges.length,
      table_count: tables.length,
      diagram_count: diagrams.length,
    },
  };
}
