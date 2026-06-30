/**
 * Fetch labelled directed edges from Hindsight mental models for a set of
 * found entities. These edges are transient: they live only in the research
 * step canvas and are never persisted to the canonical bank graph.
 *
 * Schema contract (stable):
 *   content.nodes[]  -> { entity: string, entity_name: string, type?: string, category?: string }
 *   content.edges[]  -> { source: string, target: string, edge_type: string,
 *                         label?: string, label_long?: string, source_fact_ids?: string[] }
 *
 * Because content is LLM-generated it may be wrapped in Markdown or stored in
 * a wrapper object such as { answer: "..." }. This module extracts the graph
 * data defensively and logs the shape of anything it cannot parse.
 */

import { createLogger } from '../../utils/logger.js';
import { listMentalModels } from '../hindsight/mental-models.js';

const logger = createLogger('research-mental-model-edges');

const MENTAL_MODEL_ID_PATTERN = /^architxt-sequences-json-(.+)$/i;
const CODE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/g;

/**
 * Deeply find any object containing graph-shaped arrays.
 *
 * Searches an already-parsed object for the canonical fields (nodes/edges).
 * It also descends into string values that might themselves contain JSON or
 * Markdown-wrapped JSON.
 *
 * @param {unknown} value
 * @returns {{ nodes: object[], edges: object[] } | null}
 */
function extractGraphPayload(value) {
  if (!value || typeof value !== 'object') return null;

  const candidates = [];
  const seen = new WeakSet();

  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);

    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }

    candidates.push(v);

    for (const [key, child] of Object.entries(v)) {
      if (typeof child === 'string') {
        const parsed = parseJsonString(child);
        if (parsed) walk(parsed);
      } else {
        walk(child);
      }
    }
  }

  walk(value);

  for (const candidate of candidates) {
    const nodes = normalizeNodeList(candidate.nodes);
    const edges = normalizeEdgeList(candidate.edges);
    if (nodes.length > 0 || edges.length > 0) {
      return { nodes, edges };
    }
  }

  return null;
}

function parseJsonString(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();

  // Strip Markdown code fences and try to parse the whole thing.
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

function parseMentalModelContent(value) {
  if (!value) return null;

  let parsed = null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    parsed = value;
  } else if (typeof value === 'string') {
    parsed = parseJsonString(value);
  }

  if (!parsed) return null;

  const graph = extractGraphPayload(parsed);
  if (graph && (graph.nodes.length > 0 || graph.edges.length > 0)) {
    return graph;
  }

  return null;
}

function normalizeNodeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidNode);
}

function normalizeEdgeList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidEdge);
}

function isValidNode(n) {
  return n && typeof n === 'object' && typeof n.entity === 'string' && n.entity.length > 0;
}

function isValidEdge(e) {
  return (
    e &&
    typeof e === 'object' &&
    typeof e.source === 'string' && e.source.length > 0 &&
    typeof e.target === 'string' && e.target.length > 0 &&
    typeof e.edge_type === 'string' && e.edge_type.length > 0
  );
}

function nodeInfoFromModel(content, nameById) {
  const infoById = new Map();
  for (const n of content.nodes) {
    if (!isValidNode(n)) continue;
    if (infoById.has(n.entity)) continue;
    const canonicalName = nameById[n.entity];
    if (!canonicalName && !(typeof n.entity_name === 'string' && n.entity_name.length > 0)) {
      logger.warn('Mental model node missing entity_name', { entityId: n.entity });
      continue;
    }
    infoById.set(n.entity, {
      id: n.entity,
      label: canonicalName || n.entity_name,
      type: typeof n.type === 'string' ? n.type : undefined,
      category: typeof n.category === 'string' ? n.category : undefined,
    });
  }
  return infoById;
}

/**
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} [entityIds] - optional entity IDs to report coverage for.
 * @param {Record<string, string>} [nameById] - optional canonical DB names to override model labels.
 * @returns {Promise<{
 *   success: boolean,
 *   edges?: Array<{
 *     id: string,
 *     source: string,
 *     target: string,
 *     label: string,
 *     relationship_type: string,
 *     label_long?: string,
 *     source_fact_ids: string[],
 *     edge_source: 'mental_model'
 *   }>,
 *   appliedEntityIds?: string[],
 *   missingEntityIds?: string[],
 *   referencedEntityIds?: string[],
 *   referencedNodes?: Array<{
 *     id: string,
 *     label: string,
 *     type?: string,
 *     category?: string,
 *     mention_count: number,
 *     source: 'mental_model_referenced'
 *   }>,
 *   error?: string,
 *   code?: string
 * }>}
 */
export async function fetchMentalModelEdgesForEntities(serverId, bankId, entityIds, nameById = {}) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const listResult = await listMentalModels(serverId, bankId, { limit: 1000, detail: 'content' });
  if (!listResult.success) {
    logger.warn('Failed to list mental models for edge fetch', { error: listResult.error });
    return { success: false, error: listResult.error, code: listResult.code || 'LIST_MENTAL_MODELS_FAILED' };
  }

  const foundSet = Array.isArray(entityIds) ? new Set(entityIds) : new Set();

  const matchedModels = [];
  const unmatchedReasons = { noPattern: 0, noContent: 0, noNodes: 0, noEdges: 0, noContentMatch: 0 };

  for (const model of listResult.mentalModels || []) {
    if (!model || !model.id) continue;

    const patternMatch = MENTAL_MODEL_ID_PATTERN.exec(model.id);
    const content = parseMentalModelContent(model.content);

    if (!content) {
      unmatchedReasons.noContent++;
      const preview = typeof model.content === 'string'
        ? model.content.slice(0, 500)
        : JSON.stringify(model.content).slice(0, 500);
      logger.warn('Mental model content could not be parsed', { modelId: model.id, preview });
      continue;
    }
    if (content.nodes.length === 0) {
      unmatchedReasons.noNodes++;
      logger.warn('Mental model has no nodes', { modelId: model.id });
      continue;
    }
    if (content.edges.length === 0) {
      unmatchedReasons.noEdges++;
      logger.warn('Mental model has no edges', { modelId: model.id });
      continue;
    }

    const contentEntityIds = new Set(
      content.nodes.filter(isValidNode).map((n) => n.entity),
    );

    // Match if the ext_id follows the sequence pattern, or if the content
    // itself describes any of the requested found entities. The content is the
    // authoritative source because models are generated.
    let effectiveEntityId = patternMatch ? patternMatch[1] : null;
    let matchedByContent = false;
    if (foundSet.size > 0) {
      for (const id of foundSet) {
        if (contentEntityIds.has(id)) {
          matchedByContent = true;
          if (!effectiveEntityId) effectiveEntityId = id;
          break;
        }
      }
    }

    if (!patternMatch && !matchedByContent) {
      unmatchedReasons.noPattern++;
      continue;
    }

    if (foundSet.size > 0 && !matchedByContent && !contentEntityIds.has(effectiveEntityId)) {
      unmatchedReasons.noContentMatch++;
      logger.warn('Mental model ext_id does not match content', {
        modelId: model.id,
        extIdSuffix: effectiveEntityId,
        contentIds: Array.from(contentEntityIds),
      });
    }

    if (!effectiveEntityId) {
      effectiveEntityId = contentEntityIds.values().next().value || null;
    }
    if (!effectiveEntityId) {
      unmatchedReasons.noNodes++;
      continue;
    }

    matchedModels.push({ model, content, entityId: effectiveEntityId, matchedByContent, contentEntityIds });
  }

  // Build node info from all matched models so out-of-scope endpoints are labelled.
  const nodeInfoById = new Map();
  for (const { content } of matchedModels) {
    for (const [id, info] of nodeInfoFromModel(content, nameById)) {
      if (!nodeInfoById.has(id)) nodeInfoById.set(id, info);
    }
  }

  const edges = [];
  const seenDirectedEdges = new Set();
  let edgeIdx = 0;

  const appliedEntityIds = new Set();
  const referencedEntityIds = new Set();
  const dropReasons = { missingEndpoint: 0, selfLoop: 0, duplicate: 0, noType: 0, outOfScope: 0 };

  for (const { model, content, entityId, contentEntityIds } of matchedModels) {
    let modelApplied = false;

    for (const e of content.edges) {
      if (!isValidEdge(e)) {
        dropReasons.missingEndpoint++;
        continue;
      }
      if (e.source === e.target) {
        dropReasons.selfLoop++;
        continue;
      }

      const edgeType = e.edge_type;
      // Scope rule: at least one endpoint must be in the found set. This keeps
      // the edge list tied to the query while still surfacing neighbours.
      if (foundSet.size > 0 && !foundSet.has(e.source) && !foundSet.has(e.target)) {
        dropReasons.outOfScope++;
        continue;
      }

      // Validate that every endpoint is either a found entity or a node
      // declared in the same mental model. Reject hallucinated ids.
      if (!contentEntityIds.has(e.source) || !contentEntityIds.has(e.target)) {
        dropReasons.missingEndpoint++;
        logger.warn('Mental model edge references undeclared entity', {
          modelId: model.id,
          source: e.source,
          target: e.target,
          edgeType,
        });
        continue;
      }

      const shortLabel = typeof e.label === 'string' ? e.label : '';
      const label = shortLabel ? `${edgeType}: ${shortLabel}` : edgeType;
      const directedKey = `${e.source}|${e.target}|${label}`;
      if (seenDirectedEdges.has(directedKey)) {
        dropReasons.duplicate++;
        continue;
      }
      seenDirectedEdges.add(directedKey);

      edges.push({
        id: `mm-edge-${edgeIdx++}`,
        source: e.source,
        target: e.target,
        label,
        relationship_type: edgeType,
        label_long: typeof e.label_long === 'string' && e.label_long.length > 0 ? e.label_long : undefined,
        source_fact_ids: Array.isArray(e.source_fact_ids) ? e.source_fact_ids : [],
        edge_source: 'mental_model',
      });

      modelApplied = true;
      if (foundSet.has(e.source) || foundSet.has(e.target)) appliedEntityIds.add(entityId);
      if (!foundSet.has(e.source)) referencedEntityIds.add(e.source);
      if (!foundSet.has(e.target)) referencedEntityIds.add(e.target);
    }

    if (!modelApplied) {
      logger.warn('Mental model had edges but none connected to found set', {
        modelId: model.id,
        entityId,
        foundCount: foundSet.size,
      });
    }
  }

  // Coverage reporting: which requested entities had a matching mental model.
  const appliedEntityIdsArray = foundSet.size > 0
    ? entityIds.filter((id) => appliedEntityIds.has(id))
    : [];
  const missingEntityIdsArray = foundSet.size > 0
    ? entityIds.filter((id) => !appliedEntityIds.has(id))
    : [];

  // Referenced nodes for out-of-scope endpoints. Every referenced node comes
  // from content.nodes, so undeclared edge endpoints are rejected above.
  const referencedNodes = [];
  const referencedEntityIdsArray = [];
  for (const id of referencedEntityIds) {
    if (foundSet.has(id)) continue;
    const info = nodeInfoById.get(id);
    if (!info) continue;
    referencedEntityIdsArray.push(id);
    referencedNodes.push({
      id,
      label: info.label,
      type: info.type,
      category: info.category,
      mention_count: 0,
      source: 'mental_model_referenced',
    });
  }

  logger.info('Fetched mental model edges', {
    serverId,
    bankId,
    targetCount: foundSet.size,
    matchedModelCount: matchedModels.length,
    edgeCount: edges.length,
    appliedCount: appliedEntityIdsArray.length,
    missingCount: missingEntityIdsArray.length,
    referencedCount: referencedNodes.length,
    dropReasons,
    unmatchedReasons,
  });

  return {
    success: true,
    edges,
    appliedEntityIds: appliedEntityIdsArray,
    missingEntityIds: missingEntityIdsArray,
    referencedEntityIds: referencedEntityIdsArray,
    referencedNodes,
  };
}
