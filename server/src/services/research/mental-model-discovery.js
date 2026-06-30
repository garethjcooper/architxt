/**
 * Mental model discovery service.
 *
 * Looks up dimension-classified mental models in the local (bank-agnostic) DB,
 * derives template instances for the requested entities, queries Hindsight for
 * each candidate ext_id, and merges/compiles found content per dimension.
 *
 * Contract:
 *   Input:  { db, serverId, bankId, entities: string[], dimensions: string[] }
 *   Output: { success, dimensions: { [dimension]: DimensionResult }, error?, code? }
 *
 *   DimensionResult:
 *   {
 *     candidates: Candidate[],
 *     found_count: number,
 *     missing_count: number,
 *     result?: { graph?: { nodes, edges }, narrative?: string },
 *   }
 */

import { listMentalModels as listLocalMentalModels, deriveMentalModels } from '../../db/crud/mental-models.js';
import { getMentalModel as getHindsightMentalModel } from '../hindsight/mental-models.js';
import {
  extractGraph,
  extractNarrative,
  modelMatchesEntities,
} from './mental-model-results.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('research-mental-model-discovery');

const DEFAULT_TIMEOUT_MS = 15000;

function normalizeDbBool(value) {
  return value === true || value === 'true';
}

function normalizeLocalModel(dbRow) {
  if (!dbRow) return null;
  const entities = Array.isArray(dbRow.mm_entities)
    ? dbRow.mm_entities.map((e) => ({
        id: e.id ?? e.ent_id,
        name: e.name ?? e.ent_name,
        entity_id: e.entity_id ?? e.ent_entity_id,
        type_name: e.type_name ?? e.et_type_name ?? null,
        overrides: e.overrides,
      }))
    : [];

  return {
    id: dbRow.mm_id,
    ext_id: dbRow.mm_ext_id,
    name: dbRow.mm_name,
    source_query: dbRow.mm_source_query,
    dimension: dbRow.mm_dimension,
    returns: dbRow.mm_returns,
    concatenation: dbRow.mm_concatenation,
    is_template: normalizeDbBool(dbRow.mm_is_template),
    entities,
    tags: dbRow.mm_tags || [],
    refresh_mode: dbRow.mm_refresh_mode,
    max_tokens: dbRow.mm_max_tokens,
    exclude_all_mental_models: dbRow.mm_exclude_all_mental_models,
    exclude_mental_model_list: dbRow.mm_exclude_mental_model_list,
  };
}

function stripTypePrefix(value) {
  if (typeof value !== 'string') return value;
  const colonIdx = value.indexOf(':');
  return colonIdx > 0 ? value.slice(colonIdx + 1) : value;
}

function buildCandidatesForDimension(localModels, entityIds) {
  const queryEntitySet = new Set(entityIds.map(stripTypePrefix));
  const hasEntityFilter = entityIds.length > 0;
  const candidates = [];

  for (const raw of localModels) {
    const model = normalizeLocalModel(raw);
    if (!model) continue;
    const isTemplate = model.is_template;
    const base = {
      id: model.id,
      ext_id: model.ext_id,
      name: model.name,
      dimension: model.dimension,
      returns: model.returns || 'json',
      concatenation: model.concatenation || 'merge',
      is_template: isTemplate,
      is_derived: false,
    };

    if (isTemplate) {
      const derived = deriveMentalModels(model);
      for (const d of derived) {
        const derivedEntityId = stripTypePrefix(d.derived_entity?.entity_id);
        if (hasEntityFilter && !queryEntitySet.has(derivedEntityId)) {
          continue;
        }
        candidates.push({
          ...base,
          id: d.id,
          ext_id: d.ext_id,
          name: d.name,
          is_derived: true,
          derived_entity_id: derivedEntityId,
        });
      }
    } else {
      candidates.push(base);
    }
  }

  return candidates;
}

async function fetchCandidateContents(serverId, bankId, candidates, timeoutMs) {
  return Promise.all(
    candidates.map(async (candidate) => {
      const extId = candidate.ext_id;
      if (!extId) {
        return {
          ...candidate,
          found: false,
          error: 'Candidate has no ext_id',
        };
      }

      const result = await getHindsightMentalModel(serverId, bankId, extId, {
        detail: 'content',
        timeoutMs,
      });

      if (!result.success) {
        return {
          ...candidate,
          found: false,
          error: result.error,
        };
      }

      const mentalModel = result.mentalModel;
      if (!mentalModel) {
        return {
          ...candidate,
          found: false,
          error: 'Hindsight returned empty mental model',
        };
      }

      return {
        ...candidate,
        found: true,
        content: mentalModel.content ?? null,
      };
    })
  );
}

async function mergeDimensionResult(candidates, entityIds) {
  const nodeById = new Map();
  const edgeKeys = new Set();
  const edges = [];
  const narratives = [];

  for (const candidate of candidates) {
    if (!candidate.found || !candidate.content) continue;
    if (!modelMatchesEntities({ content: candidate.content }, entityIds)) continue;

    const returns = (candidate.returns || 'json').toLowerCase();
    if (returns === 'json') {
      const graph = extractGraph(candidate.content);
      if (graph) {
        for (const n of graph.nodes) {
          if (!nodeById.has(n.id)) nodeById.set(n.id, n);
        }
        for (const e of graph.edges) {
          const key = `${e.source}|${e.target}|${e.label}`;
          if (edgeKeys.has(key)) continue;
          edgeKeys.add(key);
          edges.push(e);
        }
      }
    } else if (returns === 'narrative') {
      const narrative = extractNarrative(candidate.content);
      if (narrative) {
        narratives.push(narrative);
      }
    }
  }

  const result = {};
  if (nodeById.size > 0 || edges.length > 0) {
    result.graph = { nodes: Array.from(nodeById.values()), edges };
  }
  if (narratives.length > 0) {
    result.narrative = narratives.join('\n\n');
  }
  return result;
}

export async function listEligibleMentalModels(db, options = {}) {
  if (!db) {
    return { success: false, error: 'db is required', code: 'MISSING_DB' };
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

  const localResult = await listLocalMentalModels(db, { dimensions, limit: 1000 });
  if (!localResult.success) {
    logger.error('Failed to list local mental models', { dimensions, error: localResult.error, code: localResult.code });
    return { success: false, error: localResult.error, code: localResult.code || 'DATABASE_ERROR' };
  }

  const modelsByDimension = {};
  for (const model of localResult.data || []) {
    const dim = model.dimension || model.mm_dimension;
    if (!dim) continue;
    if (!modelsByDimension[dim]) modelsByDimension[dim] = [];
    modelsByDimension[dim].push(model);
  }

  const dimensionResults = {};
  for (const dimension of dimensions) {
    dimensionResults[dimension] = buildCandidatesForDimension(modelsByDimension[dimension] || [], entityIds);
  }

  logger.info('Listed eligible mental models', {
    entityCount: entityIds.length,
    dimensions,
    candidateCount: Object.values(dimensionResults).flat().length,
  });

  return {
    success: true,
    entities: entityIds,
    dimensions: dimensionResults,
  };
}

export async function discoverMentalModelsByDimensions(db, serverId, bankId, options = {}) {
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
  const dimensions = Array.isArray(options.dimensions) && options.dimensions.length > 0
    ? options.dimensions
    : ['interface'];
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  const dimensionResults = {};

  for (const dimension of dimensions) {
    const localResult = await listLocalMentalModels(db, { dimension, limit: 1000 });
    if (!localResult.success) {
      logger.error('Failed to list local mental models', { dimension, error: localResult.error, code: localResult.code });
      return { success: false, error: localResult.error, code: localResult.code || 'DATABASE_ERROR' };
    }

    const candidates = buildCandidatesForDimension(localResult.data || [], entityIds);
    const populated = await fetchCandidateContents(serverId, bankId, candidates, timeoutMs);

    const found = populated.filter((c) => c.found);
    const missing = populated.filter((c) => !c.found);

    logger.info('Discovered mental models for dimension', {
      serverId,
      bankId,
      dimension,
      entityCount: entityIds.length,
      candidateCount: populated.length,
      foundCount: found.length,
      missingCount: missing.length,
      candidateExtIds: populated.map((c) => ({ ext_id: c.ext_id, found: c.found, error: c.error })),
    });

    dimensionResults[dimension] = {
      candidates: populated,
      found_count: found.length,
      missing_count: missing.length,
      result: await mergeDimensionResult(populated, entityIds),
    };
  }

  return {
    success: true,
    entities: entityIds,
    dimensions: dimensionResults,
  };
}
