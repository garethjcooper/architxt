import { createLogger } from '../../utils/logger.js';
import { generateCompletion } from '../llm/client.js';
import { config } from '../../config.js';
import { loadAndCompose } from '../../prompts/template-service.js';
import { parseJsonString } from '../../prompts/graph-parser.js';

const logger = createLogger('contextual-graph-discovery');

const DEFAULT_DISCOVERY_CONFIG = {
  provider: 'ollama_cloud',
  model: 'kimi-k2.5:cloud',
  temperature: 0.2,
  max_tokens: 4096,
};

/**
 * Default LLM discovery runner for contextual-graph Add Context.
 *
 * Composes the `discover-ctx` prompt using the seed node + its neighbors as the
 * topic, calls the configured LLM, and returns normalized candidate nodes/edges.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {object} spec - discover-ctx mental model spec from deriveDiscoverContextModel()
 * @param {object} context
 * @param {object[]} context.existingNodes - working graph nodes
 * @param {object[]} context.existingEdges - working graph edges
 * @param {Function} [context.generateCompletion] - test override
 * @returns {Promise<{success: boolean, candidates?: Array, error?: string, code?: string}>}
 */
export async function runDiscovery(db, serverId, bankId, spec, context = {}) {
  if (!spec?.source_query) {
    return { success: false, error: 'discovery spec missing source_query', code: 'MISSING_SPEC' };
  }

  const discoveryConfig = {
    provider: config.contextual_graph?.discovery?.provider ?? DEFAULT_DISCOVERY_CONFIG.provider,
    model: config.contextual_graph?.discovery?.model ?? DEFAULT_DISCOVERY_CONFIG.model,
    temperature: config.contextual_graph?.discovery?.temperature ?? DEFAULT_DISCOVERY_CONFIG.temperature,
    max_tokens: config.contextual_graph?.discovery?.max_tokens ?? DEFAULT_DISCOVERY_CONFIG.max_tokens,
  };

  let template;
  try {
    template = loadAndCompose(db, 'discover-ctx', {
      ARCHITXT_TOPIC: spec.source_query,
      ARCHITXT_CORPUS: buildCorpus(context, spec),
    });
  } catch (err) {
    logger.error('Failed to compose discover-ctx prompt', { error: err.message, seed: spec.ext_id });
    return { success: false, error: err.message, code: 'PROMPT_COMPOSE_FAILED' };
  }

  const messages = [
    { role: 'system', content: template.prompt },
    { role: 'user', content: 'Suggest new candidate architectural elements and relationships. Return only the JSON object specified above.' },
  ];

  const completionFn = typeof context.generateCompletion === 'function'
    ? context.generateCompletion
    : generateCompletion;

  logger.info('Discovery LLM request', {
    serverId,
    bankId,
    seed: spec.ext_id,
    provider: discoveryConfig.provider,
    model: discoveryConfig.model,
  });

  const llmResult = await completionFn(messages, discoveryConfig);

  if (!llmResult.success) {
    logger.error('Discovery LLM call failed', {
      serverId,
      bankId,
      seed: spec.ext_id,
      error: llmResult.error,
      code: llmResult.code,
    });
    return { success: false, error: llmResult.error, code: llmResult.code || 'LLM_FAILED' };
  }

  const content = llmResult.data?.content || '';
  logger.info('Discovery LLM response', { serverId, bankId, seed: spec.ext_id, contentLength: content.length });

  const parsed = parseJsonString(content);
  if (!parsed || typeof parsed !== 'object') {
    logger.warn('Discovery response was not valid JSON', { serverId, bankId, seed: spec.ext_id, content });
    return { success: false, error: 'LLM response was not valid JSON', code: 'PARSE_FAILED' };
  }

  const candidates = normalizeCandidates(parsed.candidates, spec);

  return {
    success: true,
    candidates,
  };
}

function buildCorpus(context, spec) {
  const existingNodes = context.existingNodes || [];
  const existingEdges = context.existingEdges || [];
  const seedNode = existingNodes.find((n) => n.cgn_id === spec.seedId) || null;

  const neighborIds = new Set(spec.neighbor_ids || []);
  const neighbors = existingNodes.filter((n) => neighborIds.has(n.cgn_id));

  const lines = [
    '## Seed node',
    formatNode(seedNode, spec),
    '',
    '## Direct neighbors',
    ...neighbors.map((n) => formatNode(n, spec)),
    '',
    '## Existing edges touching the seed',
    ...existingEdges
      .filter((e) => e.cge_source_id === spec.seedId || e.cge_target_id === spec.seedId)
      .map(formatEdge),
  ];

  return lines.join('\n');
}

function formatNode(node, spec) {
  if (!node) return `(seed ${spec.seedId})`;
  const display = node.cgn_properties?.display_name || node.cgn_id;
  return `- ${node.cgn_id}: ${display} ${(node.cgn_labels || []).join(',')}`;
}

function formatEdge(edge) {
  return `- ${edge.cge_source_id} ↔ ${edge.cge_target_id} ${edge.cge_type ? `(${edge.cge_type})` : ''}`;
}

function normalizeCandidates(rawCandidates, spec) {
  if (!Array.isArray(rawCandidates)) return [];

  return rawCandidates
    .map((c) => {
      const id = typeof c.id === 'string' && c.id.length > 0 ? c.id : null;
      const displayName = typeof c.summary === 'string' && c.summary.length > 0
        ? c.summary
        : (typeof c.name === 'string' ? c.name : (typeof c.displayName === 'string' ? c.displayName : id));
      if (!id || !displayName) return null;

      const hypothesizedEdges = (Array.isArray(c.hypothesized_edges)
        ? c.hypothesized_edges
        : (Array.isArray(c.hypothesizedEdges) ? c.hypothesizedEdges : []))
        .map((he) => ({
          target: typeof he.target === 'string' ? he.target : null,
          type: typeof he.type === 'string' ? he.type : 'co-occurs',
          evidence: typeof he.evidence === 'string' ? he.evidence : '',
        }))
        .filter((he) => he.target);

      return {
        id,
        displayName,
        aliases: Array.isArray(c.aliases) ? c.aliases.filter((a) => typeof a === 'string') : [],
        hypothesizedEdges,
      };
    })
    .filter(Boolean);
}
