/**
 * Hindsight Service Client - Mental Model Prebuilt Results
 *
 * Fetches mental models from a bank and merges their content according to the
 * model's declared `dimension`, `returns`, and `concatenation` metadata.
 *
 * Contract:
 *   returns='json'        -> content contains { nodes[], edges[] }
 *   returns='narrative'   -> content is a Markdown string
 *   concatenation='merge' -> json models are merged into one graph
 *   concatenation='compile' -> narrative models are concatenated
 */

import { discoverMentalModelsByDimensions } from './mental-model-discovery.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('research-mental-model-results');

const CODE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/g;

function parseJsonString(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenceFree = trimmed.replace(CODE_FENCE_RE, '$1').trim();
  const candidates = [fenceFree, trimmed];
  const looseMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (looseMatch && !candidates.includes(looseMatch[1])) {
    candidates.push(looseMatch[1]);
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // continue
    }
  }
  return null;
}

function simpleHash(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function edgeHash(edge) {
  const payload = [
    edge.source,
    edge.target,
    edge.relationship_type || '',
    edge.label || '',
    edge.label_long || '',
    (edge.source_fact_ids || []).join(','),
  ].join('|');
  return simpleHash(payload);
}

function normalizeNode(n) {
  if (!n || typeof n !== 'object') return null;
  const id = typeof n.entity === 'string' ? n.entity : typeof n.id === 'string' ? n.id : null;
  if (!id) return null;
  return {
    id,
    label: typeof n.entity_name === 'string' && n.entity_name.length > 0
      ? n.entity_name
      : typeof n.label === 'string' && n.label.length > 0
        ? n.label
        : id,
    type: typeof n.type === 'string' ? n.type : undefined,
    category: typeof n.category === 'string' ? n.category : undefined,
    source: 'mental_model',
  };
}

function normalizeEdge(e) {
  if (!e || typeof e !== 'object') return null;
  const source = typeof e.source === 'string' ? e.source : null;
  const target = typeof e.target === 'string' ? e.target : null;
  const edgeType = typeof e.edge_type === 'string' ? e.edge_type : null;
  if (!source || !target || !edgeType) return null;
  const shortLabel = typeof e.label === 'string' ? e.label : '';
  const label = shortLabel ? `${edgeType}: ${shortLabel}` : edgeType;
  const relationship_type = edgeType;
  const source_fact_ids = Array.isArray(e.source_fact_ids) ? e.source_fact_ids : [];
  const edge = {
    source,
    target,
    label,
    relationship_type,
    label_long: typeof e.label_long === 'string' && e.label_long.length > 0 ? e.label_long : undefined,
    source_fact_ids,
    edge_source: 'mental_model',
  };
  edge.id = `${source}|${target}|${label}|${edgeHash(edge)}`;
  return edge;
}

export function extractGraph(content) {
  if (!content) return null;
  let parsed = content;
  if (typeof content === 'string') {
    parsed = parseJsonString(content);
    if (!parsed) return null;
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const candidates = [parsed];
  const seen = new WeakSet();
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    candidates.push(v);
    for (const child of Object.values(v)) {
      if (typeof child === 'string') {
        const p = parseJsonString(child);
        if (p) walk(p);
      } else {
        walk(child);
      }
    }
  }
  walk(parsed);

  for (const candidate of candidates) {
    const nodes = Array.isArray(candidate.nodes)
      ? candidate.nodes.map(normalizeNode).filter(Boolean)
      : [];
    const edges = Array.isArray(candidate.edges)
      ? candidate.edges.map(normalizeEdge).filter(Boolean)
      : [];
    if (nodes.length > 0 || edges.length > 0) {
      return { nodes, edges };
    }
  }
  return null;
}

export function extractNarrative(content) {
  if (!content) return null;
  if (typeof content === 'string') {
    const parsed = parseJsonString(content);
    if (parsed && typeof parsed === 'object' && typeof parsed.narrative === 'string') {
      return parsed.narrative;
    }
    return content.trim();
  }
  if (typeof content === 'object' && typeof content.narrative === 'string') {
    return content.narrative.trim();
  }
  return null;
}

export function modelMatchesEntities(model, entityIds) {
  if (!Array.isArray(entityIds) || entityIds.length === 0) return true;
  const ids = new Set(entityIds);
  const content = model.content;
  if (!content) return false;
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  for (const id of ids) {
    if (text.includes(id)) return true;
  }
  return false;
}

/**
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} options
 * @param {string} [options.dimension='interface']
 * @param {string[]} [options.entityIds=[]]
 * @returns {Promise<{
 *   success: boolean,
 *   graph?: { nodes: object[], edges: object[] },
 *   narrative?: string,
 *   appliedEntityIds?: string[],
 *   missingEntityIds?: string[],
 *   error?: string,
 *   code?: string
 * }>}
 */
export async function fetchPrebuiltMentalModels(db, serverId, bankId, options = {}) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const dimension = options.dimension || 'interface';
  const entityIds = Array.isArray(options.entityIds) ? options.entityIds : [];

  const discovery = await discoverMentalModelsByDimensions(db, serverId, bankId, {
    entities: entityIds,
    dimensions: [dimension],
    timeoutMs: options.timeoutMs,
  });

  if (!discovery.success) {
    return { success: false, error: discovery.error, code: discovery.code };
  }

  const dimensionResult = discovery.dimensions[dimension];
  if (!dimensionResult) {
    return { success: false, error: `Dimension '${dimension}' not found in discovery result`, code: 'DIMENSION_MISSING' };
  }

  const result = dimensionResult.result || {};
  const appliedEntityIds = new Set();

  if (result.graph) {
    const graphText = JSON.stringify(result.graph.nodes) + JSON.stringify(result.graph.edges);
    for (const id of entityIds) {
      if (graphText.includes(id)) appliedEntityIds.add(id);
    }
  }
  if (result.narrative) {
    for (const id of entityIds) {
      if (result.narrative.includes(id)) appliedEntityIds.add(id);
    }
  }

  const missingEntityIds = entityIds.length > 0
    ? entityIds.filter((id) => !appliedEntityIds.has(id))
    : [];

  logger.info('Merged prebuilt mental models', {
    dimension,
    foundCount: dimensionResult.found_count,
    missingCount: dimensionResult.missing_count,
    nodeCount: result.graph?.nodes?.length ?? 0,
    edgeCount: result.graph?.edges?.length ?? 0,
    appliedCount: appliedEntityIds.size,
    missingEntityCount: missingEntityIds.length,
  });

  return {
    success: true,
    graph: result.graph || { nodes: [], edges: [] },
    narrative: result.narrative || '',
    appliedEntityIds: Array.from(appliedEntityIds),
    missingEntityIds,
  };
}
