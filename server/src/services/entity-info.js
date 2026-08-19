import { stmt } from '../cache.js';
import { dbExec } from '../utils/db-helpers.js';
import { createLogger } from '../utils/logger.js';
import { listEdges } from '../db/crud/contextual-graph.js';
import { deriveMentalModels, isSystemTemplateRole } from '../db/crud/mental-models.js';
import { getMentalModel } from '../services/hindsight/mental-models.js';

const logger = createLogger('entity-info');

const CONTEXTUAL_ROLES = new Set([
  'sys_entity_summary',
  'sys_entity_capabilities',
  'sys_edge_context',
  'sys_discovery_context',
]);

/**
 * Validate the incoming entity-info request payload.
 */
export function validateEntityInfoPayload(body) {
  const serverId = Number(body?.server_id);
  const bankId = body?.bank_id;
  const entityIds = body?.entity_ids;
  const includeContent = body?.include_content === true;

  if (!Number.isFinite(serverId) || serverId <= 0) {
    return { valid: false, error: 'server_id must be a positive integer', code: 'VALIDATION_ERROR' };
  }
  if (!bankId || typeof bankId !== 'string' || bankId.trim() === '') {
    return { valid: false, error: 'bank_id is required', code: 'VALIDATION_ERROR' };
  }
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    return { valid: false, error: 'entity_ids must be a non-empty array', code: 'VALIDATION_ERROR' };
  }
  if (entityIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
    return { valid: false, error: 'entity_ids must contain non-empty strings', code: 'VALIDATION_ERROR' };
  }
  if (entityIds.length > 100) {
    return { valid: false, error: 'entity_ids may not contain more than 100 ids', code: 'VALIDATION_ERROR' };
  }

  return {
    valid: true,
    serverId,
    bankId: bankId.trim(),
    entityIds: entityIds.map((id) => id.trim()),
    includeContent,
  };
}

/**
 * Split an entity id into prefix and local id, if it has one.
 * Used for catalog lookup only; the full id is the graph node identity.
 */
function parseEntityId(id) {
  if (!id || typeof id !== 'string') return { prefix: null, localId: id };
  const idx = id.indexOf(':');
  if (idx <= 0 || idx === id.length - 1) return { prefix: null, localId: id };
  return {
    prefix: id.slice(0, idx),
    localId: id.slice(idx + 1),
  };
}

/**
 * Load catalog entities for the requested ids. Matching is by the local part
 * after the prefix, or by the full id when no prefix is present.
 */
function loadCatalogEntities(db, entityIds) {
  return dbExec(() => {
    if (entityIds.length === 0) return [];

    const localIds = entityIds.map((id) => parseEntityId(id).localId);
    const uniqueIds = [...new Set(localIds)];
    const placeholders = uniqueIds.map(() => '?').join(',');

    const sql = `
      SELECT e.ent_id, e.ent_entity_id, e.ent_name, e.ent_description,
             e.ent_aliases, et.et_type_name
      FROM entities e
      JOIN entity_types et ON e.ent_type_id = et.et_id
      WHERE e.ent_entity_id IN (${placeholders})
    `;
    const rows = stmt(db, sql).all(...uniqueIds);
    return rows.map((r) => ({
      id: r.ent_id,
      entity_id: r.ent_entity_id,
      name: r.ent_name,
      description: r.ent_description,
      aliases: JSON.parse(r.ent_aliases || '[]'),
      type_name: r.et_type_name,
    }));
  }, 'entityInfo.loadCatalogEntities');
}

/**
 * Load graph nodes for the requested entity ids in a single query.
 */
function loadGraphNodes(db, serverId, bankId, entityIds) {
  return dbExec(() => {
    if (entityIds.length === 0) return [];
    const placeholders = entityIds.map(() => '?').join(',');
    const sql = `
      SELECT cgn_id, cgn_labels, cgn_properties
      FROM contextual_graph_nodes
      WHERE cgn_server_id = ? AND cgn_bank_id = ? AND cgn_id IN (${placeholders})
    `;
    const rows = stmt(db, sql).all(serverId, bankId, ...entityIds);
    return rows.map((r) => ({
      id: r.cgn_id,
      labels: JSON.parse(r.cgn_labels || '[]'),
      properties: JSON.parse(r.cgn_properties || '{}'),
    }));
  }, 'entityInfo.loadGraphNodes');
}

/**
 * Extract model refs from a node/edge properties object, keeping only known
 * contextual roles. Returns full ref objects including role/ext_id/scope.
 */
function extractContextualRefs(properties) {
  if (!properties || typeof properties !== 'object') return [];
  const provenance = properties.provenance;
  if (!provenance || typeof provenance !== 'object') return [];
  const refs = provenance.model_refs;
  if (!Array.isArray(refs)) return [];

  return refs
    .filter((ref) => ref && typeof ref.ext_id === 'string' && CONTEXTUAL_ROLES.has(ref.role))
    .map((ref) => ({
      role: ref.role,
      ext_id: ref.ext_id,
      scope: ref.scope || null,
      attached_at: ref.attached_at || null,
      fetched_at: ref.fetched_at || null,
      content_hash: ref.content_hash || null,
      last_refresh_status: ref.last_refresh_status || null,
      last_refresh_at: ref.last_refresh_at || null,
      last_refresh_error: ref.last_refresh_error || null,
    }));
}

/**
 * Load mental models associated with a set of entity integer ids.
 * Returns both template and non-template rows with their linked entities.
 */
function loadMentalModelsByEntities(db, entIds) {
  return dbExec(() => {
    if (entIds.length === 0) return [];

    const placeholders = entIds.map(() => '?').join(',');
    const sql = `
      SELECT m.mm_id, m.mm_ext_id, m.mm_name, m.mm_source_query,
             m.mm_template_role, m.mm_is_template, m.mm_dimension,
             m.mm_returns, m.mm_refresh_mode, m.mm_refresh_after_consolidation,
             m.mm_exclude_all_mental_models, m.mm_exclude_mental_model_list,
             m.mm_max_tokens, m.mm_tags_match_mode,
             e.ent_id, e.ent_entity_id, e.ent_name, e.ent_description,
             e.ent_aliases, et.et_type_name,
             mme.mm_ent_refresh_mode, mme.mm_ent_refresh_after_consolidation,
             mme.mm_ent_exclude_all_mental_models, mme.mm_ent_max_tokens
      FROM mental_models m
      JOIN mental_model_entities mme ON m.mm_id = mme.mm_id
      JOIN entities e ON mme.ent_id = e.ent_id
      JOIN entity_types et ON e.ent_type_id = et.et_id
      WHERE e.ent_id IN (${placeholders})
      ORDER BY m.mm_id, e.ent_id
    `;
    const rows = stmt(db, sql).all(...entIds);

    const byModelId = new Map();
    for (const r of rows) {
      if (!byModelId.has(r.mm_id)) {
        byModelId.set(r.mm_id, {
          id: r.mm_id,
          ext_id: r.mm_ext_id,
          name: r.mm_name,
          source_query: r.mm_source_query,
          template_role: r.mm_template_role,
          is_template: r.mm_is_template === 'true',
          dimension: r.mm_dimension,
          returns: r.mm_returns,
          refresh_mode: r.mm_refresh_mode,
          refresh_after_consolidation: r.mm_refresh_after_consolidation === 'true',
          exclude_all_mental_models: r.mm_exclude_all_mental_models === 'true',
          exclude_mental_model_list: r.mm_exclude_mental_model_list,
          max_tokens: r.mm_max_tokens,
          tags_match_mode: r.mm_tags_match_mode,
          entities: [],
        });
      }
      const model = byModelId.get(r.mm_id);
      const aliases = JSON.parse(r.ent_aliases || '[]');
      model.entities.push({
        id: r.ent_id,
        entity_id: r.ent_entity_id,
        name: r.ent_name,
        description: r.ent_description,
        aliases,
        type_name: r.et_type_name,
        overrides: {
          refresh_mode: r.mm_ent_refresh_mode,
          refresh_after_consolidation: r.mm_ent_refresh_after_consolidation === 'true',
          exclude_all_mental_models: r.mm_ent_exclude_all_mental_models === 'true',
          max_tokens: r.mm_ent_max_tokens,
        },
      });
    }

    return Array.from(byModelId.values());
  }, 'entityInfo.loadMentalModelsByEntities');
}

/**
 * Derive per-entity instances for a user-defined template.
 */
function deriveInstancesForEntity(template, entity, serverId, bankId) {
  const derived = deriveMentalModels(
    {
      ...template,
      tags: template.tags || [],
      created_at: null,
      updated_at: null,
    },
    { serverId, bankId },
    { includeSystemTemplates: true },
  );
  return derived.find((d) => d.derived_entity?.id === entity.id) || null;
}

/**
 * Find edges between any pair of requested entity ids and return edge-context refs.
 *
 * NOTE: this scans edges for the (server_id, bank_id) scope and filters in
 * memory. For very large graphs, switch to an IN-clause query on endpoints.
 */
async function loadEdgeContextsForPairs(db, serverId, bankId, entityIdSet) {
  const edgesResult = await listEdges(db, serverId, bankId, { limit: 10000 });
  if (!edgesResult.success) {
    logger.warn('Failed to load edges for entity info', { serverId, bankId, error: edgesResult.error });
    return [];
  }

  const results = [];
  for (const edge of edgesResult.data || []) {
    const sourceInSet = entityIdSet.has(edge.cge_source_id);
    const targetInSet = entityIdSet.has(edge.cge_target_id);
    if (!sourceInSet || !targetInSet || edge.cge_source_id === edge.cge_target_id) continue;

    const refs = extractContextualRefs(edge.properties).filter((r) => r.role === 'sys_edge_context');
    if (refs.length === 0) continue;

    results.push({
      source_id: edge.cge_source_id,
      target_id: edge.cge_target_id,
      edge_id: edge.cge_id,
      edge_type: edge.cge_type,
      refs,
    });
  }
  return results;
}

/**
 * Build a single consolidated entity info object.
 */
function buildEntityInfo({
  graphNode,
  catalogEntity,
  contextualRefs,
  derivedModels,
  plainModels,
  edgeContexts,
}) {
  return {
    graph_node: graphNode
      ? {
          id: graphNode.id,
          labels: graphNode.labels,
          display_name: graphNode.properties.display_name || catalogEntity?.name || graphNode.id,
          is_grounded: graphNode.labels.includes('grounded') || graphNode.labels.includes('canonical'),
          is_candidate: graphNode.labels.includes('candidate'),
        }
      : null,
    catalog: catalogEntity
      ? {
          id: catalogEntity.id,
          entity_id: catalogEntity.entity_id,
          name: catalogEntity.name,
          type_name: catalogEntity.type_name,
          description: catalogEntity.description,
          aliases: catalogEntity.aliases,
        }
      : null,
    contextual_refs: contextualRefs,
    derived_models: derivedModels,
    plain_models: plainModels,
    edge_contexts: edgeContexts,
  };
}

/**
 * Build the consolidated entity-info view for a list of entity ids.
 *
 * This is a read-only aggregation across:
 *   - the contextual graph node (labels, properties, system model refs)
 *   - the catalog entity (name, type, aliases)
 *   - user-defined template-derived mental models for this entity
 *   - plain mental models tagged with this entity
 *   - edge-context refs between any two requested entities
 *
 * It does not write graph state or deploy/sync models.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} entityIds
 * @param {Object} [options]
 * @param {boolean} [options.includeContent] - if true, fetch Hindsight content for each ext_id
 * @returns {Promise<{success: boolean, data?: object, error?: string, code?: string}>}
 */
export async function buildEntityInfoMap(db, serverId, bankId, entityIds, options = {}) {
  try {
    const includeContent = options.includeContent === true;

    const [graphNodesResult, catalogEntitiesResult] = await Promise.all([
      loadGraphNodes(db, serverId, bankId, entityIds),
      loadCatalogEntities(db, entityIds),
    ]);

    if (!graphNodesResult.success) {
      return { success: false, error: graphNodesResult.error, code: graphNodesResult.code };
    }
    if (!catalogEntitiesResult.success) {
      return { success: false, error: catalogEntitiesResult.error, code: catalogEntitiesResult.code };
    }

    const graphNodes = graphNodesResult.data;
    const catalogEntities = catalogEntitiesResult.data;

    const graphNodeById = new Map();
    for (const n of graphNodes) graphNodeById.set(n.id, n);

    const catalogByEntityId = new Map();
    for (const e of catalogEntities) {
      catalogByEntityId.set(e.entity_id, e);
    }

    const requestedEntityIdSet = new Set(entityIds);

    // Determine which catalog entity (if any) matches each requested id.
    const requestedToCatalog = new Map();
    for (const id of entityIds) {
      const localId = parseEntityId(id).localId;
      const catalog = catalogByEntityId.get(localId) || null;
      if (catalog) requestedToCatalog.set(id, catalog);
    }

    const linkedEntIds = Array.from(requestedToCatalog.values()).map((e) => e.id);
    const mentalModelsResult = linkedEntIds.length > 0
      ? loadMentalModelsByEntities(db, linkedEntIds)
      : { success: true, data: [] };

    if (!mentalModelsResult.success) {
      return { success: false, error: mentalModelsResult.error, code: mentalModelsResult.code };
    }

    const mentalModels = mentalModelsResult.data;

    // Classify models.
    const derivedByEntityId = new Map();
    const plainByEntityId = new Map();

    for (const model of mentalModels) {
      if (model.is_template) {
        // Skip system templates; their instances are surfaced via contextual_refs.
        if (isSystemTemplateRole(model.template_role)) continue;

        for (const entity of model.entities) {
          const derived = deriveInstancesForEntity(model, entity, serverId, bankId);
          if (!derived) continue;

          const key = entity.entity_id;
          if (!derivedByEntityId.has(key)) derivedByEntityId.set(key, []);
          derivedByEntityId.get(key).push({
            template_id: model.id,
            template_role: model.template_role,
            ext_id: derived.ext_id,
            name: derived.name,
            source_query: derived.source_query,
            refresh_mode: derived.refresh_mode,
            max_tokens: derived.max_tokens,
            dimension: model.dimension,
            returns: model.returns,
          });
        }
      } else {
        for (const entity of model.entities) {
          const key = entity.entity_id;
          if (!plainByEntityId.has(key)) plainByEntityId.set(key, []);
          plainByEntityId.get(key).push({
            model_id: model.id,
            ext_id: model.ext_id,
            name: model.name,
            template_role: model.template_role,
            dimension: model.dimension,
            returns: model.returns,
          });
        }
      }
    }

    const edgeContexts = await loadEdgeContextsForPairs(db, serverId, bankId, requestedEntityIdSet);

    // Build per-requested-id result.
    const entities = {};
    const allExtIds = new Set();

    for (const id of entityIds) {
      const graphNode = graphNodeById.get(id) || null;
      const catalog = requestedToCatalog.get(id) || null;
      const localId = parseEntityId(id).localId;

      const contextualRefs = graphNode ? extractContextualRefs(graphNode.properties) : [];
      for (const ref of contextualRefs) allExtIds.add(ref.ext_id);

      const catalogEntityId = catalog?.entity_id || localId;
      const derivedModels = derivedByEntityId.get(catalogEntityId) || [];
      const plainModels = plainByEntityId.get(catalogEntityId) || [];
      for (const m of derivedModels) allExtIds.add(m.ext_id);
      for (const m of plainModels) allExtIds.add(m.ext_id);

      const entityEdgeContexts = edgeContexts.filter(
        (ec) => ec.source_id === id || ec.target_id === id,
      );

      entities[id] = buildEntityInfo({
        graphNode,
        catalogEntity: catalog,
        contextualRefs,
        derivedModels,
        plainModels,
        edgeContexts: entityEdgeContexts,
      });
    }

    const result = {
      entities,
      meta: {
        server_id: serverId,
        bank_id: bankId,
        requested_count: entityIds.length,
        graph_nodes_found: graphNodes.length,
        catalog_entities_found: catalogEntities.length,
      },
    };

    if (includeContent) {
      const contentEntries = await Promise.all(
        Array.from(allExtIds).map(async (extId) => {
          const mmResult = await getMentalModel(serverId, bankId, extId, { detail: 'content' });
          return [extId, mmResult.success ? { found: true, mental_model: mmResult.mentalModel } : { found: false, error: mmResult.error }];
        }),
      );
      result.content = Object.fromEntries(contentEntries);
    }

    return { success: true, data: result };
  } catch (err) {
    logger.error('buildEntityInfoMap failed', { serverId, bankId, entityIds, error: err.message, stack: err.stack });
    return { success: false, error: err.message, code: 'INTERNAL_ERROR' };
  }
}

export default buildEntityInfoMap;
