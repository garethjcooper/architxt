/**
 * Mental model discovery service.
 *
 * Looks up role-classified mental models in the local (bank-agnostic) DB,
 * derives template instances for the requested entities, queries Hindsight for
 * each candidate ext_id, and merges/compiles found content per role.
 *
 * Contract:
 *   Input:  { db, serverId, bankId, entities: string[], roles: string[] }
 *   Output: { success, roles: { [role]: RoleResult }, error?, code? }
 *
 *   RoleResult:
 *   {
 *     candidates: Candidate[],
 *     found_count: number,
 *     missing_count: number,
 *     result?: { graph?: { nodes, edges }, narrative?: string },
 *   }
 */

import { listMentalModels as listLocalMentalModels, deriveMentalModels } from '../../db/crud/mental-models.js';
import { getMentalModel as getHindsightMentalModel } from '../hindsight/mental-models.js';
import { normalizeModelOutput } from '../contextual-graph/normalize-model-output.js';
import { normalizeGraph } from '../../prompts/normalize-graph.js';
import { modelMatchesEntities } from '../../prompts/graph-parser.js';
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
    template_role: dbRow.mm_template_role,
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

function buildCandidatesForRole(localModels, entityIds) {
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
      template_role: model.template_role,
      returns: model.returns || 'json',
      concatenation: model.concatenation || 'merge',
      is_template: isTemplate,
      is_derived: false,
    };

    if (isTemplate) {
      const derived = deriveMentalModels(model, {}, { includeSystemTemplates: true });
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

async function mergeRoleResult(candidates, entityIds) {
  const nodeById = new Map();
  const edgeKeys = new Set();
  const edges = [];
  const narratives = [];
  const errors = [];

  for (const candidate of candidates) {
    if (!candidate.found || !candidate.content) continue;
    if (!modelMatchesEntities({ content: candidate.content }, entityIds)) continue;

    const { narrative, graph, errors: modelErrors } = normalizeModelOutput(candidate.content);

    if (narrative) {
      narratives.push(narrative);
    }

    if (graph.nodes.length > 0 || graph.edges.length > 0) {
      for (const n of graph.nodes) {
        if (!nodeById.has(n.id)) nodeById.set(n.id, n);
      }
      for (const e of graph.edges) {
        const key = `${e.from}|${e.to}|${e.label}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        edges.push(e);
      }
    } else if (modelErrors?.length) {
      errors.push({ model: candidate.name || candidate.ext_id, error: modelErrors.join('; ') });
    }
  }

  const result = {};
  if (nodeById.size > 0 || edges.length > 0) {
    result.graph = { nodes: Array.from(nodeById.values()), edges };
  }
  if (narratives.length > 0) {
    result.narrative = narratives.join('\n\n');
  }
  if (errors.length > 0) {
    result.errors = errors;
  }
  return result;
}

export async function discoverMentalModelsByRoles(db, serverId, bankId, options = {}) {
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
  const roles = Array.isArray(options.roles) && options.roles.length > 0
    ? options.roles
    : ['sys_entity_summary'];
  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  const roleResults = {};

  for (const role of roles) {
    const localResult = await listLocalMentalModels(db, { templateRole: role, limit: 1000 });
    if (!localResult.success) {
      logger.error('Failed to list local mental models', { role, error: localResult.error, code: localResult.code });
      return { success: false, error: localResult.error, code: localResult.code || 'DATABASE_ERROR' };
    }

    const candidates = buildCandidatesForRole(localResult.data || [], entityIds);
    const populated = await fetchCandidateContents(serverId, bankId, candidates, timeoutMs);

    const found = populated.filter((c) => c.found);
    const missing = populated.filter((c) => !c.found);

    logger.info('Discovered mental models for role', {
      serverId,
      bankId,
      role,
      entityCount: entityIds.length,
      candidateCount: populated.length,
      foundCount: found.length,
      missingCount: missing.length,
      candidateExtIds: populated.map((c) => ({ ext_id: c.ext_id, found: c.found, error: c.error })),
    });

    roleResults[role] = {
      candidates: populated,
      found_count: found.length,
      missing_count: missing.length,
      result: await mergeRoleResult(populated, entityIds),
    };
  }

  return {
    success: true,
    entities: entityIds,
    roles: roleResults,
  };
}
