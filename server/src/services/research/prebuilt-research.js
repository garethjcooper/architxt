/**
 * Prebuilt research runner.
 *
 * Takes eligible derived mental models (local DB only), fetches each model's
 * content from Hindsight by ext_id, and merges the outputs according to each
 * model's declared `returns` and `concatenation` metadata.
 *
 * Contract:
 *   Input:  { db, serverId, bankId, entities: string[], roles: string[] }
 *   Output: { success, entities, roles[] }
 *
 *   RoleResult:
 *   {
 *     role: string,
 *     entities: EntityResult[],
 *     found_count: number,
 *     missing_count: number,
 *     result: { narrative?, json_result? }
 *   }
 */

import { discoverMentalModelsByRoles } from './mental-model-discovery.js';
import { getMentalModel as getHindsightMentalModel } from '../hindsight/mental-models.js';
import { normalizeModelOutput } from '../contextual-graph/normalize-model-output.js';
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

  const mentalModel = hindsightResult.mentalModel;
  const content = mentalModel.content ?? null;
  const contentLength = typeof content === 'string' ? content.length : content ? JSON.stringify(content).length : 0;

  if (!content) {
    logger.info('Prebuilt candidate content missing', {
      serverId,
      bankId,
      extId,
      candidateId: candidate.id,
      contentKeys: Object.keys(mentalModel),
    });
    return {
      ...candidate,
      found: true,
      content: null,
      narrative: '',
      graph: { nodes: [], edges: [] },
      graph_error: 'Mental-model content is empty or missing.',
    };
  }

  const { narrative, graph, tables, errors: modelErrors } = normalizeModelOutput(content);
  logger.info('Prebuilt candidate envelope extracted', {
    serverId,
    bankId,
    extId,
    candidateId: candidate.id,
    contentLength,
    narrativeLength: narrative.length,
    nodeCount: graph?.nodes.length ?? 0,
    edgeCount: graph?.edges.length ?? 0,
    tableCount: tables?.length ?? 0,
    modelError: modelErrors?.length ? modelErrors.join('; ') : null,
  });
  return {
    ...candidate,
    found: true,
    content: null,
    narrative,
    graph,
    tables: tables || [],
    graph_error: modelErrors?.length ? modelErrors.join('; ') : null,
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
      const key = e.id || `${e.from}|${e.to}|${e.type}`;
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
  const result = { ...base };
  if (candidate.narrative != null) {
    result.narrative = candidate.narrative;
  }
  if (candidate.graph) {
    result.graph = candidate.graph;
  }
  if (candidate.tables && candidate.tables.length > 0) {
    result.tables = candidate.tables;
  }
  if (candidate.graph_error) {
    result.graph_error = candidate.graph_error;
  }
  return result;
}

function aggregateRoleResults(entityResults) {
  const narratives = [];
  const graphs = [];
  const tables = [];
  const errors = [];
  let effectiveConcatenation = 'merge';

  for (const entityResult of entityResults) {
    for (const candidate of entityResult.model_results) {
      if (!candidate.found) continue;
      if (candidate.narrative) {
        narratives.push(candidate.narrative);
      }
      if (candidate.graph) {
        if (candidate.graph.nodes.length > 0 || candidate.graph.edges.length > 0) {
          graphs.push(candidate.graph);
          effectiveConcatenation = candidate.concatenation || effectiveConcatenation;
        } else if (candidate.graph_error) {
          errors.push({ model: candidate.name || candidate.ext_id, error: candidate.graph_error });
        }
      }
      if (candidate.tables && candidate.tables.length > 0) {
        tables.push(...candidate.tables);
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
  if (tables.length > 0) {
    result.tables = tables;
  }
  if (errors.length > 0) {
    result.errors = errors;
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

  const roles = Array.isArray(options.roles) && options.roles.length > 0
    ? options.roles
    : [];
  if (roles.length === 0) {
    return { success: false, error: 'roles must be a non-empty array', code: 'VALIDATION_ERROR' };
  }

  const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  const discovery = await discoverMentalModelsByRoles(db, serverId, bankId, {
    entities: entityIds,
    roles,
    timeoutMs,
  });
  if (!discovery.success) {
    return { success: false, error: discovery.error, code: discovery.code };
  }

  const roleOutputs = [];
  const entitySummaryMap = new Map();

  for (const role of roles) {
    const candidates = discovery.roles[role]?.candidates || [];
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
      const key = `${entityId}|${role}`;
      if (!entitySummaryMap.has(key)) {
        entitySummaryMap.set(key, { entity: entityId, role, found });
      }
      return {
        entity: entityId,
        found,
        model_results: modelResults,
      };
    });

    const foundCount = entityResults.filter((e) => e.found).length;
    const missingCount = entityResults.length - foundCount;

    logger.info('Ran prebuilt research for role', {
      serverId,
      bankId,
      role,
      entityCount: entityIds.length,
      candidateCount: populated.length,
      foundCount,
      missingCount,
    });

    roleOutputs.push({
      role,
      entities: entityResults,
      found_count: foundCount,
      missing_count: missingCount,
      result: aggregateRoleResults(entityResults),
    });
  }

  return {
    success: true,
    entities: entityIds,
    entity_summary: Array.from(entitySummaryMap.values()),
    roles: roleOutputs,
  };
}
