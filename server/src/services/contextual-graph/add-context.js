import { createLogger } from '../../utils/logger.js';
import { importHindsightSkeleton } from './import-hindsight-skeleton.js';
import { listNodes, listEdges, upsertNode, upsertEdge, getNode } from '../../db/crud/contextual-graph.js';
import {
  deriveContextualModelSpec,
  SCOPE_VALUES,
  CONTEXTUAL_GRAPH_ROLES,
} from './template-models.js';
import { deployMentalModelBatch } from './deploy-models.js';
import { getRoleScopeMap, MODEL_TYPE_TO_ROLE, isContextualGraphRole } from '../../db/crud/template-roles.js';

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
 * 2. Derives and deploys mental models for active graph elements based on the
 *    configured template roles in `template_roles` and the bank's
 *    `allowed_model_types`.
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
  const configuredRoleIds = new Set(
    [...scopeMap.keys()].filter((role) => isContextualGraphRole(role)),
  );

  const importSkeleton = options.import_skeleton !== false;
  const neighborhood = { ...DEFAULT_NEIGHBORHOOD, ...options.neighborhood };

  // Normalize allowed_model_types to role IDs. Accept legacy slugs and raw role IDs.
  // An empty array is treated as "no roles allowed", not "all roles allowed".
  let allowedRoleIds;
  if (Array.isArray(options.allowed_model_types)) {
    allowedRoleIds = new Set(
      options.allowed_model_types
        .map((t) => MODEL_TYPE_TO_ROLE[t] || (configuredRoleIds.has(t) ? t : null))
        .filter(Boolean)
        .filter((role) => isContextualGraphRole(role)),
    );
  } else {
    // Treat undefined/null as "all configured roles" for back-compat with callers
    // that do not pass the option at all. Explicit empty array means none.
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

  // Step 3: derive node-scoped models for active, grounded/canonical nodes
  // without an existing ref for each allowed node-scoped role.
  const nodeScopedRoles = [...scopeMap.entries()]
    .filter(([role, scope]) => scope === 'node' && allowedRoleIds.has(role))
    .map(([role]) => role);
  const specsByRole = new Map();
  for (const role of nodeScopedRoles) {
    specsByRole.set(role, []);
  }

  for (const node of filteredNodes) {
    if (!node.cgn_labels?.includes('active')) continue;
    if (!inSubset(node.cgn_id)) continue;
    // Candidate nodes and plain active edge-ctx endpoints must be promoted first.
    if (!node.cgn_labels?.includes('grounded') && !node.cgn_labels?.includes('canonical')) continue;

    const target = {
      id: node.cgn_id,
      displayName: node.cgn_properties?.display_name || node.cgn_id,
    };

    for (const role of nodeScopedRoles) {
      if (hasModelRef(node.cgn_properties, role)) continue;
      const values = SCOPE_VALUES.node(target);
      const spec = await deriveContextualModelSpec(db, role, 'node', values);
      specsByRole.get(role).push(spec);
    }
  }

  // Step 4: derive edge-scoped models for active undirected edge pairs
  // without an existing ref for each allowed edge-scoped role.
  const edgeScopedRoles = [...scopeMap.entries()]
    .filter(([role, scope]) => scope === 'edge' && allowedRoleIds.has(role))
    .map(([role]) => role);

  for (const role of edgeScopedRoles) {
    specsByRole.set(role, []);
  }

  const seenEdgePairs = new Set();
  for (const edge of filteredEdges) {
    // Only run on undirected skeleton edges.
    if (edge.cge_type !== null && edge.cge_properties?.directed !== false) continue;
    if (edge.cge_properties?.labels?.includes('candidate')) continue;

    // Endpoints must be grounded/canonical and active.
    const sourceNode = existingNodes.find((n) => n.cgn_id === edge.cge_source_id);
    const targetNode = existingNodes.find((n) => n.cgn_id === edge.cge_target_id);
    const sourceActive = sourceNode?.cgn_labels?.includes('active');
    const targetActive = targetNode?.cgn_labels?.includes('active');
    const sourceGroundedOrCanonical = sourceNode?.cgn_labels?.includes('grounded') || sourceNode?.cgn_labels?.includes('canonical');
    const targetGroundedOrCanonical = targetNode?.cgn_labels?.includes('grounded') || targetNode?.cgn_labels?.includes('canonical');

    if (!sourceActive || !targetActive) continue;
    if (!sourceGroundedOrCanonical || !targetGroundedOrCanonical) continue;
    if (!inSubset(edge.cge_source_id) || !inSubset(edge.cge_target_id)) continue;

    const pk = sortPair(edge.cge_source_id, edge.cge_target_id);
    if (seenEdgePairs.has(pk)) continue;
    seenEdgePairs.add(pk);

    for (const role of edgeScopedRoles) {
      if (hasModelRef(edge.cge_properties, role)) continue;
      const sourceTarget = {
        id: sourceNode.cgn_id,
        displayName: sourceNode.cgn_properties?.display_name || sourceNode.cgn_id,
      };
      const targetTarget = {
        id: targetNode.cgn_id,
        displayName: targetNode.cgn_properties?.display_name || targetNode.cgn_id,
      };
      const values = SCOPE_VALUES.edge(sourceTarget, targetTarget);
      const spec = await deriveContextualModelSpec(db, role, 'edge', values);
      specsByRole.get(role).push(spec);
    }
  }

  // Step 5: queue seed-scoped (discovery) models around seeds.
  const seedScopedRoles = [...scopeMap.entries()]
    .filter(([, scope]) => scope === 'seed')
    .map(([role]) => role);
  const allowedSeedScopedRoles = seedScopedRoles.filter((role) => allowedRoleIds.has(role));
  for (const role of seedScopedRoles) {
    if (!specsByRole.has(role)) specsByRole.set(role, []);
  }

  const discoverQueue = new Set();
  if (Array.isArray(options.seed_node_ids)) {
    for (const seedId of options.seed_node_ids) {
      if (existingNodeIds.has(seedId) && inSubset(seedId)) discoverQueue.add(seedId);
    }
  }

  // Auto-rank high-degree nodes as additional discovery seeds only when at
  // least one allowed seed-scoped role is configured.
  if (allowedSeedScopedRoles.length > 0) {
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
    const neighbors = filteredEdges
      .filter((e) => e.cge_source_id === seedId || e.cge_target_id === seedId)
      .map((e) => (e.cge_source_id === seedId ? e.cge_target_id : e.cge_source_id))
      .slice(0, neighborhood.top_k_neighbors);

    // Manual seeds always derive all configured seed-scoped roles; auto-ranked
    // seeds only derive roles explicitly allowed for the bank.
    const isManualSeed = Array.isArray(options.seed_node_ids) && options.seed_node_ids.includes(seedId);
    const rolesToDerive = isManualSeed ? seedScopedRoles : allowedSeedScopedRoles;

    for (const role of rolesToDerive) {
      if (hasModelRef(seedNode?.cgn_properties, role)) {
        logger.info('Skipping duplicate seed-scoped model for seed', { serverId, bankId, seedId, role });
        continue;
      }
      const seedTarget = {
        id: seedNode.cgn_id,
        displayName: seedNode.cgn_properties?.display_name || seedNode.cgn_id,
      };
      const values = SCOPE_VALUES.seed(seedTarget, neighbors);
      const spec = await deriveContextualModelSpec(db, role, 'seed', values);
      specsByRole.get(role).push(spec);
    }
  }

  // Step 6: dedupe, cap, deploy, and record provenance.
  const dedupedSpecsByRole = new Map();
  for (const [role, specs] of specsByRole) {
    dedupedSpecsByRole.set(role, dedupeSpecsByExtId(specs));
  }

  const entitySummarySpecs = dedupedSpecsByRole.get(CONTEXTUAL_GRAPH_ROLES.entitySummary) || [];
  const entityCapabilitiesSpecs = dedupedSpecsByRole.get(CONTEXTUAL_GRAPH_ROLES.entityCapabilities) || [];
  const edgeSpecs = dedupedSpecsByRole.get(CONTEXTUAL_GRAPH_ROLES.edge) || [];
  const discoverSpecs = dedupedSpecsByRole.get(CONTEXTUAL_GRAPH_ROLES.discover) || [];

  const roleOrder = [...scopeMap.keys()];
  const allUnrestrictedSpecs = [...dedupedSpecsByRole.entries()]
    .sort(([a], [b]) => roleOrder.indexOf(a) - roleOrder.indexOf(b))
    .flatMap(([, specs]) => specs);

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
      entitySummary: entitySummarySpecs.length,
      entityCapabilities: entityCapabilitiesSpecs.length,
      edge: edgeSpecs.length,
      discover: discoverSpecs.length,
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

function sortPair(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
