/**
 * Fetch labelled directed edges from Hindsight mental models for a set of
 * found entities. These edges are transient: they live only in the research
 * step canvas and are never persisted to the canonical bank graph.
 *
 * Schema contract (stable):
 *   content.nodes[]  -> { id: string, name: string, type?: string }
 *   content.edges[]  -> { from: string, to: string, type: string,
 *                         label?: string, detail?: string, source_fact_ids?: string[] }
 *
 * Because content is LLM-generated it may be wrapped in Markdown or stored in
 * a wrapper object such as { answer: "..." }. This module extracts the graph
 * data defensively and logs the shape of anything it cannot parse.
 */

import { createLogger } from '../../utils/logger.js';
import { listAllMentalModels } from '../hindsight/mental-models.js';
import { extractGraph, normalizeNode, normalizeEdge } from '../../prompts/graph-parser.js';

const logger = createLogger('research-mental-model-edges');

const MENTAL_MODEL_ID_PATTERN = /^architxt-sequences-json-(.+)$/i;

/**
 * Parse mental-model content into a graph using the shared parser.
 * Unlike the strict normalizer, this keeps any node with an id and any edge with
 * from/to/type for edge-fetch purposes.
 * @param {string|object|null} value
 * @returns {{ nodes: object[], edges: object[] } | null}
 */
function parseMentalModelContent(value) {
  if (!value) return null;
  const graph = extractGraph(value);
  if (!graph || (graph.nodes.length === 0 && graph.edges.length === 0)) return null;

  // relax normalization: keep any valid id/from/to/type so edge fetch works
  const nodes = (graph.nodes || [])
    .filter((n) => n && typeof n === 'object' && typeof n.id === 'string' && n.id.length > 0)
    .map((n) => normalizeNode(n) || { id: n.id, name: n.name || n.id });
  const edges = (graph.edges || [])
    .filter((e) => e && typeof e === 'object' && typeof e.from === 'string' && typeof e.to === 'string' && typeof e.type === 'string')
    .map((e) => normalizeEdge(e) || {
      id: e.id || `${e.from}|${e.to}|${e.type}|${e.label || ''}`,
      from: e.from,
      to: e.to,
      type: e.type,
      label: e.label,
      detail: e.detail,
      source_fact_ids: Array.isArray(e.source_fact_ids) ? e.source_fact_ids : [],
    });

  if (nodes.length === 0 || edges.length === 0) return null;
  return { nodes, edges };
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
  return n && typeof n === 'object' && typeof n.id === 'string' && n.id.length > 0;
}

function isValidEdge(e) {
  return (
    e &&
    typeof e === 'object' &&
    typeof e.from === 'string' && e.from.length > 0 &&
    typeof e.to === 'string' && e.to.length > 0 &&
    typeof e.type === 'string' && e.type.length > 0
  );
}

function nodeInfoFromModel(content, nameById) {
  const infoById = new Map();
  for (const n of content.nodes) {
    if (!isValidNode(n)) continue;
    if (infoById.has(n.id)) continue;
    const canonicalName = nameById[n.id];
    const nodeName = typeof n.name === 'string' && n.name.length > 0 ? n.name : null;
    if (!canonicalName && !nodeName) {
      logger.warn('Mental model node missing name', { entityId: n.id });
      continue;
    }
    infoById.set(n.id, {
      id: n.id,
      name: canonicalName || nodeName,
      type: typeof n.type === 'string' ? n.type : undefined,
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
 *     from: string,
 *     to: string,
 *     type: string,
 *     label?: string,
 *     detail?: string,
 *     source_fact_ids: string[],
 *   }>,
 *   appliedEntityIds?: string[],
 *   missingEntityIds?: string[],
 *   referencedEntityIds?: string[],
 *   referencedNodes?: Array<{
 *     id: string,
 *     name: string,
 *     type?: string,
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

  const listResult = await listAllMentalModels(serverId, bankId, { detail: 'content' });
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
      content.nodes.filter(isValidNode).map((n) => n.id),
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
      if (e.from === e.to) {
        dropReasons.selfLoop++;
        continue;
      }

      const edgeType = e.type;
      // Scope rule: at least one endpoint must be in the found set. This keeps
      // the edge list tied to the query while still surfacing neighbours.
      if (foundSet.size > 0 && !foundSet.has(e.from) && !foundSet.has(e.to)) {
        dropReasons.outOfScope++;
        continue;
      }

      // Validate that every endpoint is either a found entity or a node
      // declared in the same mental model. Reject hallucinated ids.
      if (!contentEntityIds.has(e.from) || !contentEntityIds.has(e.to)) {
        dropReasons.missingEndpoint++;
        logger.warn('Mental model edge references undeclared entity', {
          modelId: model.id,
          from: e.from,
          to: e.to,
          edgeType,
        });
        continue;
      }

      const shortLabel = typeof e.label === 'string' ? e.label : '';
      const label = shortLabel ? `${edgeType}: ${shortLabel}` : edgeType;
      const directedKey = `${e.from}|${e.to}|${edgeType}|${shortLabel}`;
      if (seenDirectedEdges.has(directedKey)) {
        dropReasons.duplicate++;
        continue;
      }
      seenDirectedEdges.add(directedKey);

      edges.push({
        id: `mm-edge-${edgeIdx++}`,
        from: e.from,
        to: e.to,
        type: edgeType,
        label,
        detail: typeof e.detail === 'string' && e.detail.length > 0 ? e.detail : undefined,
        source_fact_ids: Array.isArray(e.source_fact_ids) ? e.source_fact_ids : [],
      });

      modelApplied = true;
      if (foundSet.has(e.from) || foundSet.has(e.to)) appliedEntityIds.add(entityId);
      if (!foundSet.has(e.from)) referencedEntityIds.add(e.from);
      if (!foundSet.has(e.to)) referencedEntityIds.add(e.to);
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
      name: info.name,
      type: info.type,
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
