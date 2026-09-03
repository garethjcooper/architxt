import { createLogger } from '../../utils/logger.js';
import { importHindsightSkeleton } from './import-hindsight-skeleton.js';
import { listNodes, listEdges, upsertNode, upsertEdge, getNode, getEdge } from '../../db/crud/contextual-graph.js';
import {
  deriveEntitySummaryModel,
  deriveEntityCapabilitiesModel,
  deriveEdgeContextModel,
  deriveDiscoverContextModel,
  CONTEXTUAL_GRAPH_ROLES,
} from './template-models.js';
import { deployMentalModelBatch } from './deploy-models.js';
import { getRoleScopeMap, MODEL_TYPE_TO_ROLE } from '../../db/crud/template-roles.js';

const logger = createLogger('contextual-graph-add-context');

const DEFAULT_NEIGHBORHOOD = {
  top_k_neighbors: 5,
  min_weight: 0,
  min_count: 1,
};

/**
 * Add context to the working graph for a given Hindsight bank.
 *
 * User-led job that:
 * 1. Imports the current Hindsight entity graph skeleton.
 * 2. Derives and deploys mental models for active nodes based on configured node-scoped template roles.
 * 3. Derives and deploys mental models for active undirected edges based on configured edge-scoped template roles.
 * 4. Optionally derives and deploys mental models around seeds based on configured seed-scoped template roles.
 *
 * Derived models are rendered from templates (mm_template_role) and pushed
 * directly to Hindsight; no per-instance mental_models rows are created.
 *
 * Existing working-graph nodes that are absent from the import are never deleted.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {number} [options.min_count] - passed to Hindsight /entities/graph
 * @param {number} [options.min_weight] - minimum edge weight to import
 * @param {string[]} [options.node_ids] - explicit subset of working-graph nodes to contextualize
 * @param {boolean} [options.import_skeleton] - whether to re-import the Hindsight skeleton first
 * @param {string[]} [options.seed_node_ids] - manual seed nodes to discover around
 * @param {Object} [options.neighborhood] - discovery scope
 * @param {number} [options.neighborhood.top_k_neighbors]
 * @param {string[]} [options.allowed_model_types] - which model roles to deploy; defaults to all configured roles
 * @param {number} [options.max_models_per_run] - cap total models deployed in one run
 * @param {string[]} [options.exclude_node_ids] - never deploy models for these nodes
 * @param {string[]} [options.include_node_ids] - if provided, only deploy models for these nodes
 * @returns {Promise<{success: boolean, queued?: {entitySummary: number, entityCapabilities: number, edge: number, discover: number, total: number}, composed?: string[], failed?: {ext_id: string, error: string, code?: string}[], unchanged?: string[], pushed?: string[], skipped_by_restriction?: number, error?: string, code?: string}>}
 */
export async function addContext(
  db,
  serverId,
  bankId,
  options = {},
) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const scopeMap = getRoleScopeMap(db);
  const configuredRoleIds = new Set(scopeMap.keys());

  const importSkeleton = options.import_skeleton !== false;
  const neighborhood = { ...DEFAULT_NEIGHBORHOOD, ...options.neighborhood };

  // Normalize allowed_model_types to role IDs. Accept legacy slugs and raw role IDs.
  let allowedRoleIds;
  if (Array.isArray(options.allowed_model_types) && options.allowed_model_types.length > 0) {
    allowedRoleIds = new Set(
      options.allowed_model_types
        .map((t) => MODEL_TYPE_TO_ROLE[t] || (configuredRoleIds.has(t) ? t : null))
        .filter(Boolean),
    );
  } else {
    allowedRoleIds = new Set(configuredRoleIds);
  }

  const maxModelsPerRun = typeof options.max_models_per_run === 'number' && options.max_models_per_run > 0
    ? options.max_models_per_run
    : Infinity;
  const excludeNodeIds = new Set(Array.isArray(options.exclude_node_ids) ? options.exclude_node_ids : []);
  const includeNodeIds = Array.isArray(options.include_node_ids) && options.include_node_ids.length > 0
    ? new Set(options.include_node_ids)
    : null;
  const restrictNode = (id) => !excludeNodeIds.has(id) && (!includeNodeIds || includeNodeIds.has(id));

  // Step 1: optionally import current Hindsight skeleton.
  let importResult = { success: true, imported: { nodes: 0, edges: 0 } };
  if (importSkeleton) {
    importResult = await importHindsightSkeleton(
      db,
      serverId,
      bankId,
      {
        min_count: options.min_count,
        min_weight: options.min_weight,
        top_k_nodes: options.top_k_nodes,
        include_patterns: options.include_patterns,
        exclude_patterns: options.exclude_patterns,
      },
      options.fetchGraph,
    );
    if (!importResult.success) {
      return importResult;
    }
  }

  // Step 2: load existing working graph.
  const [existingNodesResult, existingEdgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 10000 }),
    listEdges(db, serverId, bankId, { limit: 10000 }),
  ]);

  const existingNodes = existingNodesResult.data || [];
  const existingEdges = existingEdgesResult.data || [];

  const existingNodeIds = new Set(existingNodes.map((n) => n.cgn_id));

  // Subset filter. If node_ids is provided, only operate on those nodes and
  // edges whose both endpoints are in the subset.
  const subsetNodeIds = Array.isArray(options.node_ids)
    ? new Set(options.node_ids.filter((id) => existingNodeIds.has(id)))
    : null;
  const inSubset = (id) => {
    if (!restrictNode(id)) return false;
    return subsetNodeIds ? subsetNodeIds.has(id) : true;
  };
  const filteredNodes = subsetNodeIds
    ? existingNodes.filter((n) => subsetNodeIds.has(n.cgn_id) && restrictNode(n.cgn_id))
    : existingNodes.filter((n) => restrictNode(n.cgn_id));
  const filteredEdges = subsetNodeIds
    ? existingEdges.filter((e) => subsetNodeIds.has(e.cge_source_id) && subsetNodeIds.has(e.cge_target_id))
    : existingEdges;

  // Step 3: derive node-scoped models for active nodes without an existing ref for the same role.
  const nodeScopedRoles = [...scopeMap.entries()].filter(([, scope]) => scope === 'node').map(([role]) => role);
  const entitySummarySpecs = [];
  const entityCapabilitiesSpecs = [];
  for (const node of filteredNodes) {
    if (!node.cgn_labels?.includes('active')) continue;
    if (!inSubset(node.cgn_id)) continue;
    // Only derive mental models for explicitly grounded or canonical nodes.
    // Candidate nodes and plain active edge-ctx endpoints must be promoted first.
    if (!node.cgn_labels?.includes('grounded') && !node.cgn_labels?.includes('canonical')) continue;

    const nodeDisplayName = node.cgn_properties?.display_name || node.cgn_id;

    // Entity summary is the legacy sys_entity_summary role; skip if a node-scoped role is not allowed.
    if (allowedRoleIds.has(CONTEXTUAL_GRAPH_ROLES.entitySummary) && !hasModelRef(node.cgn_properties, CONTEXTUAL_GRAPH_ROLES.entitySummary)) {
      const summarySpec = await deriveEntitySummaryModel(db, {
        id: node.cgn_id,
        displayName: nodeDisplayName,
      });
      entitySummarySpecs.push(summarySpec);
    }

    if (allowedRoleIds.has(CONTEXTUAL_GRAPH_ROLES.entityCapabilities) && !hasModelRef(node.cgn_properties, CONTEXTUAL_GRAPH_ROLES.entityCapabilities)) {
      const capabilitiesSpec = await deriveEntityCapabilitiesModel(db, {
        id: node.cgn_id,
        displayName: nodeDisplayName,
      });
      entityCapabilitiesSpecs.push(capabilitiesSpec);
    }
  }

  // Step 4: derive edge-scoped models for active undirected edge pairs without an edge-scoped ref.
  const edgeScopedRoles = [...scopeMap.entries()].filter(([, scope]) => scope === 'edge').map(([role]) => role);
  const hasAnyAllowedEdgeRole = edgeScopedRoles.some((role) => allowedRoleIds.has(role));
  const edgeSpecs = [];
  const seenEdgePairs = new Set();
  for (const edge of filteredEdges) {
    if (!hasAnyAllowedEdgeRole) continue;

    if (hasModelRef(edge.cge_properties, CONTEXTUAL_GRAPH_ROLES.edge)) continue;

    // Only run edge-ctx on grounded/canonical working-graph edges. Directed
    // edges are produced by edge-ctx itself; candidate edges are not eligible.
    if (edge.cge_type !== null && edge.cge_properties?.directed !== false) continue;

    // Candidate edges (or edges touching only candidate endpoints) are not
    // eligible for edge-ctx.
    if (edge.cge_properties?.labels?.includes('candidate')) continue;

    // Only run on edges whose endpoints are grounded or canonical.
    const sourceGroundedOrCanonical = existingNodes.some(
      (n) => n.cgn_id === edge.cge_source_id && (n.cgn_labels?.includes('grounded') || n.cgn_labels?.includes('canonical')),
    );
    const targetGroundedOrCanonical = existingNodes.some(
      (n) => n.cgn_id === edge.cge_target_id && (n.cgn_labels?.includes('grounded') || n.cgn_labels?.includes('canonical')),
    );
    if (!sourceGroundedOrCanonical || !targetGroundedOrCanonical) continue;

    if (!inSubset(edge.cge_source_id) || !inSubset(edge.cge_target_id)) continue;

    const sourceActive = existingNodes.some((n) => n.cgn_id === edge.cge_source_id && n.cgn_labels?.includes('active'));
    const targetActive = existingNodes.some((n) => n.cgn_id === edge.cge_target_id && n.cgn_labels?.includes('active'));
    if (!sourceActive || !targetActive) continue;

    const pk = `${edge.cge_source_id}|${edge.cge_target_id}`;
    if (seenEdgePairs.has(pk)) continue;
    seenEdgePairs.add(pk);

    const sourceNode = existingNodes.find((n) => n.cgn_id === edge.cge_source_id);
    const targetNode = existingNodes.find((n) => n.cgn_id === edge.cge_target_id);

    const spec = await deriveEdgeContextModel(db, {
      id: edge.cge_source_id,
      displayName: sourceNode?.cgn_properties?.display_name || edge.cge_source_id,
    }, {
      id: edge.cge_target_id,
      displayName: targetNode?.cgn_properties?.display_name || edge.cge_target_id,
    });
    edgeSpecs.push(spec);
  }

  // Step 5: queue discovery models around seeds (no LLM call here; candidates
  // are fetched later from the discover-ctx mental model content).
  const discoverQueue = new Set();
  const discoverSpecs = [];

  if (Array.isArray(options.seed_node_ids)) {
    for (const seedId of options.seed_node_ids) {
      if (existingNodeIds.has(seedId) && inSubset(seedId)) discoverQueue.add(seedId);
    }
  }

  // Auto-rank high-degree nodes as additional discovery seeds when discovery is
  // an allowed model type.
  if (allowedRoleIds.has(CONTEXTUAL_GRAPH_ROLES.discover)) {
    const nodeDegrees = new Map();
    for (const edge of filteredEdges) {
      nodeDegrees.set(edge.cge_source_id, (nodeDegrees.get(edge.cge_source_id) || 0) + 1);
      nodeDegrees.set(edge.cge_target_id, (nodeDegrees.get(edge.cge_target_id) || 0) + 1);
    }

    const ranked = filteredNodes
      .filter((n) => !n.cgn_labels?.includes('candidate') && (n.cgn_labels?.includes('grounded') || n.cgn_labels?.includes('canonical')))
      .map((n) => ({ id: n.cgn_id, degree: nodeDegrees.get(n.cgn_id) || 0 }))
      .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
      .slice(0, neighborhood.top_k_neighbors);

    for (const { id } of ranked) {
      discoverQueue.add(id);
    }
  }

  for (const seedId of discoverQueue) {
    const seedNode = existingNodes.find((n) => n.cgn_id === seedId);
    const hasExistingDiscoverModel = hasModelRef(seedNode?.cgn_properties, CONTEXTUAL_GRAPH_ROLES.discover);

    // Only mint a new discover mental model the first time a seed is run.
    if (!hasExistingDiscoverModel) {
      const neighbors = filteredEdges
        .filter((e) => e.cge_source_id === seedId || e.cge_target_id === seedId)
        .map((e) => (e.cge_source_id === seedId ? e.cge_target_id : e.cge_source_id))
        .slice(0, neighborhood.top_k_neighbors);

      discoverSpecs.push(await deriveDiscoverContextModel(db, {
        id: seedId,
        displayName: seedNode?.cgn_properties?.display_name || seedId,
      }, neighbors));
    } else {
      logger.info('Skipping duplicate discover model for seed', { serverId, bankId, seedId });
    }
  }

  // Step 5: deploy all queued models to Hindsight and record provenance.
  const dedupedSummarySpecs = dedupeSpecsByExtId(entitySummarySpecs);
  const dedupedCapabilitiesSpecs = dedupeSpecsByExtId(entityCapabilitiesSpecs);
  const dedupedEdgeSpecs = dedupeSpecsByExtId(edgeSpecs);
  const dedupedDiscoverSpecs = dedupeSpecsByExtId(discoverSpecs);

  const allUnrestrictedSpecs = [
    ...dedupedSummarySpecs,
    ...dedupedCapabilitiesSpecs,
    ...dedupedEdgeSpecs,
    ...dedupedDiscoverSpecs,
  ];

  // Apply the max-models-per-run cap, preserving the order above (entities
  // first, edges second, discovery last) so the most useful models are
  // deployed first.
  const skippedByRestriction = Math.max(0, allUnrestrictedSpecs.length - maxModelsPerRun);
  const allSpecs = allUnrestrictedSpecs.slice(0, maxModelsPerRun);

  const deployFn = options.deployBatch || deployMentalModelBatch;
  const deployResult = await deployFn(db, serverId, bankId, allSpecs);

  if (deployResult.failed.length > 0) {
    logger.warn('Some contextual models failed to deploy', {
      serverId,
      bankId,
      failedCount: deployResult.failed.length,
    });
  }

  const now = new Date().toISOString();
  for (const spec of allSpecs) {
    if (!deployResult.composed.includes(spec.ext_id)) continue;
    await recordModelProvenance(db, serverId, bankId, spec, now);
  }

  return {
    success: true,
    queued: {
      entitySummary: dedupedSummarySpecs.length,
      entityCapabilities: dedupedCapabilitiesSpecs.length,
      edge: dedupedEdgeSpecs.length,
      discover: dedupedDiscoverSpecs.length,
      total: allUnrestrictedSpecs.length,
    },
    composed: deployResult.composed,
    pushed: deployResult.pushed || [],
    unchanged: deployResult.unchanged || [],
    failed: deployResult.failed,
    skipped_by_restriction: skippedByRestriction,
  };
}

async function recordModelProvenance(db, serverId, bankId, spec, now) {
  const role = spec.role;
  const scope = spec.scope;
  const scopeMap = getRoleScopeMap(db);
  const roleScope = scopeMap.get(role);

  if (roleScope === 'node') {
    const nodeId = scope?.node_id;
    if (!nodeId) return;
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) return;

    const properties = mergeProperties(node.cgn_properties, spec, now);
    upsertNode(db, serverId, bankId, nodeId, node.cgn_labels, properties);
    return;
  }

  if (roleScope === 'edge') {
    const sourceId = scope?.source_id;
    const targetId = scope?.target_id;
    if (!sourceId || !targetId) return;

    // Attach the edge-ctx ref to the undirected, grounded skeleton edge. Edge-ctx
    // models may later produce directed typed edges; the model ref must live on
    // the original undirected edge so the derivation loop can find it consistently.
    const edge = listEdges(db, serverId, bankId, { limit: 10000 })?.data?.find((e) => {
      const matchesEndpoints =
        (e.cge_source_id === sourceId && e.cge_target_id === targetId) ||
        (e.cge_source_id === targetId && e.cge_target_id === sourceId);
      return matchesEndpoints && e.cge_type === null && e.cge_properties?.directed === false;
    });
    if (!edge) return;

    const properties = mergeProperties(edge.cge_properties, spec, now);
    upsertEdge(db, serverId, bankId, edge.cge_id, edge.cge_source_id, edge.cge_target_id, edge.cge_type, properties);
    return;
  }

  if (roleScope === 'seed') {
    const seedId = scope?.seed_id;
    if (!seedId) return;

    // Attach to the seed node that triggered discovery.
    const seedNode = getNode(db, serverId, bankId, seedId)?.data;
    if (seedNode) {
      const properties = mergeProperties(seedNode.cgn_properties, spec, now);
      upsertNode(db, serverId, bankId, seedId, seedNode.cgn_labels, properties);
    }

    return;
  }
}

function hasModelRef(properties, role) {
  const refs = properties?.provenance?.model_refs;
  if (Array.isArray(refs)) {
    return refs.some((ref) => ref?.role === role);
  }
  return false;
}

function mergeProperties(current, spec, now) {
  const existingRefs = current?.provenance?.model_refs || [];
  const dedupedRefs = existingRefs.filter((ref) => ref?.ext_id !== spec.ext_id);
  const modelRefs = [...dedupedRefs, { role: spec.role, ext_id: spec.ext_id, scope: spec.scope, attached_at: now }];
  return {
    ...current,
    provenance: {
      ...(current?.provenance || {}),
      model_refs: modelRefs,
      source: 'contextual-graph',
      updated_at: now,
    },
    updated_at: now,
  };
}

function dedupeSpecsByExtId(specs) {
  const seen = new Set();
  return specs.filter((spec) => {
    if (!spec?.ext_id || seen.has(spec.ext_id)) return false;
    seen.add(spec.ext_id);
    return true;
  });
}
