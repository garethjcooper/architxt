/**
 * Prebuilt research runner.
 *
 * Takes eligible derived mental models (local DB only), fetches each model's
 * content from Hindsight by ext_id, and merges the outputs according to each
 * model's declared `returns` and `concatenation` metadata.
 *
 * Contract:
 *   Input:  { db, serverId, bankId, entities: string[], dimensions: string[] }
 *   Output: { success, entities, dimensions[] }
 *
 *   DimensionResult:
 *   {
 *     dimension: string,
 *     entities: EntityResult[],
 *     found_count: number,
 *     missing_count: number,
 *     result: { narrative?, json_result? }
 *   }
 */

import { listEligibleMentalModels } from './mental-model-discovery.js';
import { getMentalModel as getHindsightMentalModel } from '../hindsight/mental-models.js';
import { extractGraph, extractNarrative } from './mental-model-results.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('research-prebuilt');

const DEFAULT_TIMEOUT_MS = 15000;

function stripTypePrefix(value) {
  if (typeof value !== 'string') return value;
  const colonIdx = value.indexOf(':');
  return colonIdx > 0 ? value.slice(colonIdx + 1) : value;
}

async function fetchModelResult(serverId, bankId, candidate, timeoutMs) {
  const extId = candidate.ext_id;
  if (!extId) {
    return {
      ...candidate,
      found: false,
      error: 'Candidate has no ext_id',
    };
  }

  const hindsightResult = await getHindsightMentalModel(serverId, bankId, extId, {
    detail: 'content',
    timeoutMs,
  });

  if (!hindsightResult.success || !hindsightResult.mentalModel) {
    return {
      ...candidate,
      found: false,
      error: hindsightResult.error || 'Hindsight returned empty mental model',
    };
  }

  const content = hindsightResult.mentalModel.content ?? null;
  const returns = (candidate.returns || 'json').toLowerCase();

  if (returns === 'narrative') {
    return {
      ...candidate,
      found: true,
      content,
      narrative: extractNarrative(content) || '',
    };
  }

  return {
    ...candidate,
    found: true,
    content,
    graph: extractGraph(content) || { nodes: [], edges: [] },
  };
}

function mergeGraphs(graphs) {
  const nodeById = new Map();
  const edgeKeys = new Set();
  const edges = [];

  for (const graph of graphs) {
    if (!graph) continue;
    for (const n of graph.nodes || []) {
      if (!nodeById.has(n.id)) nodeById.set(n.id, n);
    }
    for (const e of graph.edges || []) {
      const key = e.id || `${e.source}|${e.target}|${e.label}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push(e);
    }
  }

  return {
    nodes: Array.from(nodeById.values()),
    edges,
  };
}

function toApiModelResult(candidate) {
  const base = {
    id: candidate.id,
    ext_id: candidate.ext_id,
    name: candidate.name,
    returns: candidate.returns,
    concatenation: candidate.concatenation,
    found: candidate.found,
  };
  if (!candidate.found) {
    return { ...base, error: candidate.error || 'Not found' };
  }
  if (candidate.returns === 'narrative') {
    return { ...base, narrative: candidate.narrative };
  }
  return { ...base, graph: candidate.graph };
}

function aggregateDimensionResults(entityResults) {
  const narratives = [];
  const graphs = [];
  let effectiveConcatenation = 'merge';

  for (const entityResult of entityResults) {
    for (const candidate of entityResult.model_results) {
      if (!candidate.found) continue;
      if (candidate.narrative) {
        narratives.push(candidate.narrative);
      }
      if (candidate.graph) {
        graphs.push(candidate.graph);
        effectiveConcatenation = candidate.concatenation || effectiveConcatenation;
      }
    }
  }

  const result = {};
  if (narratives.length > 0) {
    result.narrative = narratives.join('\n\n');
  }
  if (graphs.length > 0) {
    result.json_result = effectiveConcatenation === 'compile'
      ? graphs
      : mergeGraphs(graphs);
  }
  return result;
}

export async function runPrebuiltResearch(db, serverId, bankId, options = {}) {
  if (!db) {
    return { success: false, error: 'db is required', code: 'MISSING_DB' };
  }
  if (!serverId) {
    return { success: false, error: 'server_id is required', code: 'MISSING_SERVER' };
  }
  if (!bankId) {
    return { success: false, error: 'bank_id is required', code: 'MISSING_BANK' };
  }

  const entityIds = Array.isArray(options.entities) ? options.entities : [];
  if (entityIds.length === 0) {
    return { success: false, error: 'entities must be a non-empty array', code: 'VALIDATION_ERROR' };
  }

  const dimensions = Array.isArray(options.dimensions) && options.dimensions.length > 0
    ? options.dimensions
    : [];
  if (dimensions.length === 0) {
    return { success: false, error: 'dimensions must be a non-empty array', code: 'VALIDATION_ERROR' };
  }

  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  const eligible = await listEligibleMentalModels(db, { entities: entityIds, dimensions });
  if (!eligible.success) {
    return eligible;
  }

  const dimensionOutputs = [];
  const entitySummaryMap = new Map();

  for (const dimension of dimensions) {
    const candidates = eligible.dimensions[dimension] || [];
    const populated = await Promise.all(
      candidates.map((c) => fetchModelResult(serverId, bankId, c, timeoutMs)),
    );

    const byEntity = {};
    for (const entityId of entityIds) {
      byEntity[stripTypePrefix(entityId)] = { originalId: entityId, candidates: [] };
    }
    for (const candidate of populated) {
      const entityId = candidate.derived_entity_id;
      if (entityId && Object.prototype.hasOwnProperty.call(byEntity, entityId)) {
        byEntity[entityId].candidates.push(candidate);
      }
    }

    const entityResults = entityIds.map((entityId) => {
      const bucket = byEntity[stripTypePrefix(entityId)];
      const modelResults = bucket ? bucket.candidates.map(toApiModelResult) : [];
      const found = modelResults.some((m) => m.found);
      const key = `${entityId}|${dimension}`;
      if (!entitySummaryMap.has(key)) {
        entitySummaryMap.set(key, { entity: entityId, dimension, found });
      }
      return {
        entity: entityId,
        found,
        model_results: modelResults,
      };
    });

    const foundCount = entityResults.filter((e) => e.found).length;
    const missingCount = entityResults.length - foundCount;

    logger.info('Ran prebuilt research for dimension', {
      serverId,
      bankId,
      dimension,
      entityCount: entityIds.length,
      candidateCount: populated.length,
      foundCount,
      missingCount,
    });

    dimensionOutputs.push({
      dimension,
      entities: entityResults,
      found_count: foundCount,
      missing_count: missingCount,
      result: aggregateDimensionResults(entityResults),
    });
  }

  return {
    success: true,
    entities: entityIds,
    entity_summary: Array.from(entitySummaryMap.values()),
    dimensions: dimensionOutputs,
  };
}
