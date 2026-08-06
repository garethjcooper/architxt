import { createLogger } from '../../utils/logger.js';
import { importHindsightSkeleton } from './import-hindsight-skeleton.js';
import { listNodes, listEdges, upsertNode, upsertEdge, getNode, getEdge } from '../../db/crud/contextual-graph.js';
import {
  deriveEntitySummaryModel,
  deriveEntityCapabilitiesModel,
  deriveEdgeContextModel,
  deriveDiscoverContextModel,
} from './template-models.js';
import { deployMentalModelBatch } from './deploy-models.js';
import { inferRole } from './specs.js';

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
 * 2. Derives and deploys `entity-summary` and `entity-capabilities` mental models for active nodes.
 * 3. Derives and deploys `edge-ctx` mental models for active undirected edges.
 * 4. Optionally derives and deploys `discover` mental models around seeds.
 *
 * Derived models are rendered from system templates (mm_template_role) and pushed
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
 * @param {string[]} [options.allowed_model_types] - which model roles to deploy; defaults to all
 * @param {number} [options.max_models_per_run] - cap total models deployed in one run
 * @param {string[]} [options.exclude_node_ids] - never deploy models for these nodes
 * @param {string[]} [options.include_node_ids] - if provided, only deploy models for these nodes
 * @returns {Promise<{success: boolean, queued?: {entitySummary: number, entityCapabilities: number, edge: number, discover: number, total: number}, deployed?: string[], failed?: {ext_id: string, error: string, code?: string}[], skipped_by_restriction?: number, error?: string, code?: string}>}
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

  const importSkeleton = options.import_skeleton !== false;
  const neighborhood = { ...DEFAULT_NEIGHBORHOOD, ...options.neighborhood };
  const allowedModelTypes = new Set(Array.isArray(options.allowed_model_types) ? options.allowed_model_types : [
    'entity-summary',
    'entity-capabilities',
    'edge-ctx',
    'discover',
  ]);
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

  // Step 3: derive entity-summary and entity-capabilities models for active nodes
  // without an existing ref for the same role.
  const entitySummarySpecs = [];
  const entityCapabilitiesSpecs = [];
  for (const node of filteredNodes) {
    if (!node.cgn_labels?.includes('active')) continue;
    if (!inSubset(node.cgn_id)) continue;

    if (allowedModelTypes.has('entity-summary') && !hasModelRef(node.cgn_properties, 'sys_entity_summary')) {
      const summarySpec = await deriveEntitySummaryModel(db, {
        id: node.cgn_id,
        displayName: node.cgn_properties?.display_name || node.cgn_id,
      });
      entitySummarySpecs.push(summarySpec);
    }

    if (allowedModelTypes.has('entity-capabilities') && !hasModelRef(node.cgn_properties, 'sys_entity_capabilities')) {
      const capabilitiesSpec = await deriveEntityCapabilitiesModel(db, {
        id: node.cgn_id,
        displayName: node.cgn_properties?.display_name || node.cgn_id,
      });
      entityCapabilitiesSpecs.push(capabilitiesSpec);
    }
  }

  // Step 4: derive edge-ctx models for active undirected edge pairs without an edge-ctx ref.
  const edgeSpecs = [];
  const seenEdgePairs = new Set();
  for (const edge of filteredEdges) {
    if (allowedModelTypes.has('edge-ctx')) {
      if (hasModelRef(edge.cge_properties, 'sys_edge_context')) continue;

      // Only run edge-ctx on undirected working-graph edges (Hindsight skeleton or
      // candidate hypotheses). Directed edges are produced by edge-ctx itself.
      if (edge.cge_type !== null && edge.cge_properties?.directed !== false) continue;

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
  if (allowedModelTypes.has('discover')) {
    const nodeDegrees = new Map();
    for (const edge of filteredEdges) {
      nodeDegrees.set(edge.cge_source_id, (nodeDegrees.get(edge.cge_source_id) || 0) + 1);
      nodeDegrees.set(edge.cge_target_id, (nodeDegrees.get(edge.cge_target_id) || 0) + 1);
    }

    const ranked = filteredNodes
      .filter((n) => n.cgn_labels?.includes('uncanonical') || n.cgn_labels?.includes('active'))
      .map((n) => ({ id: n.cgn_id, degree: nodeDegrees.get(n.cgn_id) || 0 }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, neighborhood.top_k_neighbors);

    for (const { id } of ranked) {
      discoverQueue.add(id);
    }
  }

  for (const seedId of discoverQueue) {
    const seedNode = existingNodes.find((n) => n.cgn_id === seedId);
    const hasExistingDiscoverModel = hasModelRef(seedNode?.cgn_properties, 'sys_discovery_context');

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
  for (const modelId of deployResult.deployed) {
    await recordModelProvenance(db, serverId, bankId, modelId, now);
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
    deployed: deployResult.deployed,
    failed: deployResult.failed,
    skipped_by_restriction: skippedByRestriction,
  };
}

async function recordModelProvenance(db, serverId, bankId, modelId, now) {
  const role = modelIdToRole(modelId);

  if (modelId.startsWith('entity-summary-')) {
    const nodeId = modelId.slice('entity-summary-'.length);
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) return;

    const properties = mergeProperties(node.cgn_properties, modelId, role, now);
    upsertNode(db, serverId, bankId, nodeId, node.cgn_labels, properties);
    return;
  }

  if (modelId.startsWith('entity-capabilities-')) {
    const nodeId = modelId.slice('entity-capabilities-'.length);
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) return;

    const properties = mergeProperties(node.cgn_properties, modelId, role, now);
    upsertNode(db, serverId, bankId, nodeId, node.cgn_labels, properties);
    return;
  }

  if (modelId.startsWith('edge-ctx-')) {
    const pairPart = modelId.slice('edge-ctx-'.length);
    const edge = listEdges(db, serverId, bankId)?.data?.find((e) => {
      const raw = `${e.cge_source_id}|${e.cge_target_id}`;
      return raw === pairPart;
    });
    if (!edge) return;

    const properties = mergeProperties(edge.cge_properties, modelId, role, now);
    upsertEdge(db, serverId, bankId, edge.cge_id, edge.cge_source_id, edge.cge_target_id, edge.cge_type, properties);
    return;
  }

  if (modelId.startsWith('discover-')) {
    const seedId = modelId.slice('discover-'.length);
    if (!seedId) return;

    // Attach to the seed node that triggered discovery.
    const seedNode = getNode(db, serverId, bankId, seedId)?.data;
    if (seedNode) {
      const properties = mergeProperties(seedNode.cgn_properties, modelId, role, now);
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

function modelIdToRole(modelId) {
  return inferRole(modelId) || 'model';
}

function mergeProperties(current, modelId, role, now) {
  const existingRefs = current?.provenance?.model_refs || [];
  const dedupedRefs = existingRefs.filter((ref) => ref?.ext_id !== modelId);
  const modelRefs = [...dedupedRefs, { role, ext_id: modelId, attached_at: now }];
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
