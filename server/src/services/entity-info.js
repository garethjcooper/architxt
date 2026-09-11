import { stmt } from '../cache.js';
import { dbExec } from '../utils/db-helpers.js';
import { createLogger } from '../utils/logger.js';
import { listEdges } from '../db/crud/contextual-graph.js';
import { deriveMentalModels } from '../db/crud/mental-models.js';
import { getRoleScopeMap, isContextualGraphRole } from '../db/crud/template-roles.js';
import { getContextualGraphTemplate, SCOPE_VALUES, substituteTemplateFields } from './contextual-graph/template-models.js';
import { getMentalModel } from '../services/hindsight/mental-models.js';

const logger = createLogger('entity-info');

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
 * Batch-fetch mental-model display names by external id.
 * Returns a Map keyed by ext_id.
 */
function loadMentalModelNamesByExtIds(db, extIds) {
  return dbExec(() => {
    if (!extIds || extIds.length === 0) return new Map();
    const placeholders = extIds.map(() => '?').join(',');
    const sql = `SELECT mm_ext_id, mm_name FROM mental_models WHERE mm_ext_id IN (${placeholders})`;
    const rows = stmt(db, sql).all(...extIds);
    const map = new Map();
    for (const r of rows) {
      map.set(r.mm_ext_id, r.mm_name || r.mm_ext_id);
    }
    return map;
  });
}

/**
 * Extract model refs from a node/edge properties object, keeping only refs
 * whose role is a known template role. Returns full ref objects including
 * role/ext_id/scope.
 */
function extractContextualRefs(properties, knownRoleIds) {
  const provenance = properties.provenance;
  if (!provenance || typeof provenance !== 'object') return [];
  const refs = provenance.model_refs;
  if (!Array.isArray(refs)) return [];

  return refs
    .filter((ref) => ref && typeof ref.ext_id === 'string' && knownRoleIds.has(ref.role))
    .map((ref) => ({
      role: ref.role,
      ext_id: ref.ext_id,
      name: null,
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
 * Build a target-like object from a graph node and optional catalog entity.
 */
function targetFromGraphNode(node, catalog) {
  const displayName = node?.properties?.display_name || catalog?.name || node?.id || '';
  return {
    id: node?.id || '',
    displayName,
  };
}

/**
 * Derive the display name for a contextual-graph model ref from its template.
 *
 * This uses the same substitution path as deriveContextualModelSpec so that
 * system and user-created contextual template roles produce consistent names.
 */
function deriveContextualRefName(db, ref, graphNodeById, catalogByEntityId, templateCache) {
  const scope = ref.scope || {};
  const role = ref.role;
  if (!role) return null;

  let template = templateCache.get(role);
  if (template === undefined) {
    const result = getContextualGraphTemplate(db, role);
    template = result?.success ? result.data : null;
    templateCache.set(role, template);
  }
  if (!template || typeof template.name !== 'string') return null;

  const scopeType = scope.source_id && scope.target_id ? 'edge'
    : scope.seed_id ? 'seed'
    : 'node';

  let values;
  if (scopeType === 'edge') {
    const sourceNode = graphNodeById.get(scope.source_id);
    const targetNode = graphNodeById.get(scope.target_id);
    const sourceLocalId = parseEntityId(scope.source_id).localId;
    const targetLocalId = parseEntityId(scope.target_id).localId;
    const sourceCatalog = sourceLocalId ? catalogByEntityId.get(sourceLocalId) : null;
    const targetCatalog = targetLocalId ? catalogByEntityId.get(targetLocalId) : null;
    values = SCOPE_VALUES.edge(
      targetFromGraphNode(sourceNode, sourceCatalog),
      targetFromGraphNode(targetNode, targetCatalog),
    );
  } else if (scopeType === 'seed') {
    const seedNode = graphNodeById.get(scope.seed_id);
    const seedLocalId = parseEntityId(scope.seed_id).localId;
    const seedCatalog = seedLocalId ? catalogByEntityId.get(seedLocalId) : null;
    values = SCOPE_VALUES.seed(targetFromGraphNode(seedNode, seedCatalog));
  } else {
    const node = graphNodeById.get(scope.node_id);
    const localId = parseEntityId(scope.node_id).localId;
    const catalog = localId ? catalogByEntityId.get(localId) : null;
    values = SCOPE_VALUES.node(targetFromGraphNode(node, catalog));
  }

  try {
    return substituteTemplateFields(template.name, values);
  } catch (err) {
    logger.warn('Failed to derive contextual ref name', { role, ext_id: ref.ext_id, error: err.message });
    return null;
  }
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
      SELECT m.*,
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
          returns: r.mm_returns,
          refresh_mode: r.mm_refresh_mode,
          refresh_after_consolidation: r.mm_refresh_after_consolidation === 'true',
          exclude_all_mental_models: r.mm_exclude_all_mental_models === 'true',
          exclude_mental_model_list: r.mm_exclude_mental_model_list,
          max_tokens: r.mm_max_tokens,
          tags_match_mode: r.mm_tags_match_mode,
          description: r.mm_viewp_description,
          meta: JSON.parse(r.mm_viewp_meta || '{}'),
          concatenation: r.mm_concatenation,
          created_at: r.mm_created_at,
          updated_at: r.mm_updated_at,
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
function deriveInstancesForEntity(template, entity, db, serverId, bankId) {
  const derived = deriveMentalModels(
    {
      ...template,
      tags: template.tags || [],
      created_at: null,
      updated_at: null,
    },
    { db, serverId, bankId },
    { includeSystemTemplates: true },
  );
  return derived.find((d) => d.derived_entity?.id === entity.id) || null;
}

/**
 * Load edge-context refs for the requested entity ids.
 *
 * Returns every physical edge in the bank whose provenance includes a
 * contextual ref for an edge-scoped role where the requested entity appears
 * as one of the physical edge's endpoints. The other endpoint in the scope need
 * not be part of the request.
 *
 * For very large graphs, switch the edge scan to an IN-clause query on endpoints.
 */
async function loadEdgeContextsForEntities(db, serverId, bankId, requestedEntityIds, roleScopes) {
  const edgesResult = await listEdges(db, serverId, bankId, { limit: 10000 });
  if (!edgesResult.success) {
    logger.warn('Failed to load edges for entity info', { serverId, bankId, error: edgesResult.error });
    return { success: true, data: new Map() };
  }

  const edgeRoleIds = new Set(
    Array.from(roleScopes.entries())
      .filter(([, scope]) => scope === 'edge')
      .map(([roleId]) => roleId),
  );

  const byEntityId = new Map();
  for (const entityId of requestedEntityIds) byEntityId.set(entityId, []);

  for (const edge of edgesResult.data || []) {
    const refs = extractContextualRefs(edge.properties, new Set(roleScopes.keys()))
      .filter((r) => edgeRoleIds.has(r.role));
    if (refs.length === 0) continue;

    for (const ref of refs) {
      const scopeSource = ref.scope?.source_id;
      const scopeTarget = ref.scope?.target_id;
      if (typeof scopeSource !== 'string' || typeof scopeTarget !== 'string') continue;

      for (const entityId of requestedEntityIds) {
        // Attach this edge-context record to the entity only if the entity is
        // actually one of the physical edge's endpoints. Using the model ref's
        // scope would attribute every edge produced by the model to both
        // scoped entities, inflating counts in the workspace panel.
        if (edge.cge_source_id === entityId || edge.cge_target_id === entityId) {
          const isHindsightEdge = edge.cge_id.startsWith('hindsight-');
          byEntityId.get(entityId).push({
            source_id: edge.cge_source_id,
            target_id: edge.cge_target_id,
            edge_id: edge.cge_id,
            edge_type: edge.cge_type,
            origin: isHindsightEdge ? 'hindsight' : 'derived',
            scope: { source_id: scopeSource, target_id: scopeTarget },
            refs: [ref],
          });
        }
      }
    }
  }

  return { success: true, data: byEntityId };
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
        // Contextual-graph template roles (system + user-defined) are never
        // derived from mental_model_entities; add-context renders their instances
        // directly from the working graph. Skip them here so we don't create
        // stale local rows whose mm_name shadows the derived display name.
        if (isContextualGraphRole(model.template_role)) continue;

        for (const entity of model.entities) {
          const derived = deriveInstancesForEntity(model, entity, db, serverId, bankId);
          if (!derived) continue;

          const key = entity.entity_id;
          if (!derivedByEntityId.has(key)) derivedByEntityId.set(key, []);
          derivedByEntityId.get(key).push({
            id: derived.id,
            ext_id: derived.ext_id,
            name: derived.name,
            source_query: derived.source_query,
            template_role: model.template_role,
            is_template: true,
            returns: model.returns,
            refresh_mode: derived.refresh_mode,
            refresh_after_consolidation: model.refresh_after_consolidation,
            exclude_all_mental_models: model.exclude_all_mental_models,
            exclude_mental_model_list: model.exclude_mental_model_list,
            max_tokens: derived.max_tokens,
            tags_match_mode: model.tags_match_mode,
            description: model.description,
            meta: {
              ...model.meta,
              derived_from: {
                template_id: model.id,
                template_ext_id: model.ext_id,
              },
            },
            concatenation: model.concatenation,
            created_at: model.created_at,
            updated_at: model.updated_at,
            overrides: {
              refresh_mode: entity.overrides.refresh_mode,
              refresh_after_consolidation: entity.overrides.refresh_after_consolidation,
              exclude_all_mental_models: entity.overrides.exclude_all_mental_models,
              max_tokens: entity.overrides.max_tokens,
            },
          });
        }
      } else {
        for (const entity of model.entities) {
          const key = entity.entity_id;
          if (!plainByEntityId.has(key)) plainByEntityId.set(key, []);
          plainByEntityId.get(key).push({
            id: model.id,
            ext_id: model.ext_id,
            name: model.name,
            source_query: model.source_query,
            template_role: model.template_role,
            is_template: model.is_template,
            returns: model.returns,
            refresh_mode: model.refresh_mode,
            refresh_after_consolidation: model.refresh_after_consolidation,
            exclude_all_mental_models: model.exclude_all_mental_models,
            exclude_mental_model_list: model.exclude_mental_model_list,
            max_tokens: model.max_tokens,
            tags_match_mode: model.tags_match_mode,
            description: model.description,
            meta: model.meta,
            concatenation: model.concatenation,
            created_at: model.created_at,
            updated_at: model.updated_at,
            overrides: {
              refresh_mode: entity.overrides.refresh_mode,
              refresh_after_consolidation: entity.overrides.refresh_after_consolidation,
              exclude_all_mental_models: entity.overrides.exclude_all_mental_models,
              max_tokens: entity.overrides.max_tokens,
            },
          });
        }
      }
    }

    const roleScopes = getRoleScopeMap(db);
    const knownRoleIds = new Set(roleScopes.keys());

    const edgeContextsResult = await loadEdgeContextsForEntities(db, serverId, bankId, entityIds, roleScopes);
    if (!edgeContextsResult.success) {
      return { success: false, error: edgeContextsResult.error, code: edgeContextsResult.code };
    }
    const edgeContextsByEntityId = edgeContextsResult.data;

    // Build per-requested-id result.
    const entities = {};
    const allExtIds = new Set();

    for (const id of entityIds) {
      const graphNode = graphNodeById.get(id) || null;
      const catalog = requestedToCatalog.get(id) || null;
      const localId = parseEntityId(id).localId;

      const catalogEntityId = catalog?.entity_id || localId;
      const contextualRefs = graphNode ? extractContextualRefs(graphNode.properties, knownRoleIds) : [];
      const attachedContextualRoles = new Set(contextualRefs.map((r) => r.role));

      for (const ref of contextualRefs) {
        if (ref.ext_id) allExtIds.add(ref.ext_id);
      }

      const rawDerivedModels = derivedByEntityId.get(catalogEntityId) || [];
      const derivedModels = rawDerivedModels.filter((m) => {
        // Standard user entity derived models are always surfaced.
        if (!m.template_role || m.template_role === 'user_entity_derived') return true;
        // Contextual-graph template-role models (system + custom) are only
        // surfaced when the graph node actually carries a model ref for that role.
        if (isContextualGraphRole(m.template_role)) return attachedContextualRoles.has(m.template_role);
        return true;
      });

      const plainModels = plainByEntityId.get(catalogEntityId) || [];
      for (const m of derivedModels) allExtIds.add(m.ext_id);
      for (const m of plainModels) allExtIds.add(m.ext_id);

      const entityEdgeContexts = edgeContextsByEntityId.get(id) || [];
      for (const ctx of entityEdgeContexts) {
        for (const ref of ctx.refs || []) {
          if (ref.ext_id) allExtIds.add(ref.ext_id);
        }
      }

      entities[id] = buildEntityInfo({
        graphNode,
        catalogEntity: catalog,
        contextualRefs,
        derivedModels,
        plainModels,
        edgeContexts: entityEdgeContexts,
      });
    }

    // Enrich all model refs with display names. Derived/plain models still get
    // theirs from the local mental_models table. Contextual-graph refs derive
    // their name from the template + graph entity so user-created template
    // roles are handled the same way as system template roles.

    // Make sure graph nodes for edge/seed scopes are available for name derivation.
    const scopeNodeIds = new Set();
    for (const id of Object.keys(entities)) {
      for (const ref of entities[id].contextual_refs) {
        const scope = ref.scope || {};
        if (scope.node_id) scopeNodeIds.add(scope.node_id);
        if (scope.seed_id) scopeNodeIds.add(scope.seed_id);
      }
      for (const ctx of entities[id].edge_contexts) {
        for (const ref of ctx.refs || []) {
          const scope = ref.scope || {};
          if (scope.source_id) scopeNodeIds.add(scope.source_id);
          if (scope.target_id) scopeNodeIds.add(scope.target_id);
        }
      }
    }
    const scopeNodeIdsToLoad = Array.from(scopeNodeIds).filter((id) => !graphNodeById.has(id));
    if (scopeNodeIdsToLoad.length > 0) {
      const scopeNodesResult = loadGraphNodes(db, serverId, bankId, scopeNodeIdsToLoad);
      if (scopeNodesResult.success) {
        for (const node of scopeNodesResult.data) {
          graphNodeById.set(node.id, node);
        }
      }
    }

    const namesResult = loadMentalModelNamesByExtIds(db, Array.from(allExtIds));
    if (!namesResult.success) {
      return { success: false, error: namesResult.error, code: namesResult.code };
    }
    const extIdToName = namesResult.data;

    const templateCache = new Map();
    for (const id of Object.keys(entities)) {
      for (const ref of entities[id].contextual_refs) {
        if (ref.ext_id && extIdToName.has(ref.ext_id)) {
          ref.name = extIdToName.get(ref.ext_id);
        }
        const derivedName = deriveContextualRefName(db, ref, graphNodeById, catalogByEntityId, templateCache);
        if (derivedName) {
          ref.name = derivedName;
        }
      }
      for (const ctx of entities[id].edge_contexts) {
        for (const ref of ctx.refs || []) {
          if (ref.ext_id && extIdToName.has(ref.ext_id)) {
            ref.name = extIdToName.get(ref.ext_id);
          }
          const derivedName = deriveContextualRefName(db, ref, graphNodeById, catalogByEntityId, templateCache);
          if (derivedName) {
            ref.name = derivedName;
          }
        }
      }
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
          const mmResult = await getMentalModel(serverId, bankId, extId, { detail: 'full' });
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
