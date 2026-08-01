import { createLogger } from '../../utils/logger.js';
import { importHindsightSkeleton } from './import-hindsight-skeleton.js';
import { listNodes, listEdges, upsertNode, upsertEdge, getNode } from '../../db/crud/contextual-graph.js';
import { dedupeCandidates, buildEdgeId } from './identity.js';
import { composeEntityContextModel } from './prompts/entity-ctx.js';
import { composeEdgeContextModel } from './prompts/edge-ctx.js';
import { composeDiscoverModel } from './prompts/discover.js';
import { deployMentalModelBatch } from './deploy-models.js';

const logger = createLogger('contextual-graph-add-context');

const DEFAULT_NEIGHBORHOOD = {
  top_k_neighbors: 5,
  min_weight: 0,
  min_count: 1,
  run_discovery: true,
};

/**
 * Add context to the working graph for a given Hindsight bank.
 *
 * This is a user-led job (not a daemon) that:
 * 1. Imports the current Hindsight entity graph skeleton.
 * 2. Queues `entity-ctx` models for any new or refreshed Hindsight nodes.
 * 3. Queues `edge-ctx` models for any new or refreshed Hindsight edges.
 * 4. Optionally runs `discover` models around prominent active/uncanonical nodes.
 * 5. Deploys all queued mental models to Hindsight and records provenance on
 *    the working graph nodes/edges.
 *
 * Existing working-graph nodes that are absent from the import are never deleted.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {number} [options.min_count] - passed to Hindsight /entities/graph
 * @param {number} [options.min_weight] - minimum edge weight to import
 * @param {string[]} [options.seed_node_ids] - manual seed nodes to discover around
 * @param {Object} [options.neighborhood] - discovery scope
 * @param {number} [options.neighborhood.top_k_neighbors]
 * @param {boolean} [options.neighborhood.run_discovery]
 * @param {Function} [options.fetchGraph] - override for testing
 * @param {Function} [options.runDiscovery] - override for testing
 * @param {Function} [options.deployBatch] - override for testing; receives (db, serverId, bankId, specs)
 * @returns {Promise<{success: boolean, queued?: {entity: number, edge: number, discover: number}, deployed?: string[], failed?: {ext_id: string, error: string}[], error?: string, code?: string}>}
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

  const neighborhood = { ...DEFAULT_NEIGHBORHOOD, ...options.neighborhood };

  // Step 1: import current Hindsight skeleton.
  const importResult = await importHindsightSkeleton(
    db,
    serverId,
    bankId,
    { min_count: options.min_count, min_weight: options.min_weight },
    options.fetchGraph,
  );
  if (!importResult.success) {
    return importResult;
  }

  // Step 2: load existing working graph and build canonical lookups.
  const [existingNodesResult, existingEdgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 10000 }),
    listEdges(db, serverId, bankId, { limit: 10000 }),
  ]);

  const existingNodes = existingNodesResult.data || [];
  const existingEdges = existingEdgesResult.data || [];

  const existingNodeIds = new Set(existingNodes.map((n) => n.cgn_id));
  const existingEdgeIds = new Set(existingEdges.map((e) => e.cge_id));
  const existingEdgePairs = new Set(existingEdges.map((e) => pairKey(e.cge_source_id, e.cge_target_id)));

  // Step 3: queue entity-ctx models for any node that is missing a cached model.
  const entitySpecs = [];
  for (const node of existingNodes) {
    if (node.cgn_properties?.provenance?.model_id) continue;
    if (!node.cgn_labels?.includes('active')) continue;

    const spec = composeEntityContextModel({
      nodeId: node.cgn_id,
      bankId,
      displayName: node.cgn_properties?.display_name || node.cgn_id,
      labels: node.cgn_labels || [],
    });
    entitySpecs.push(spec);
  }

  // Step 4: queue edge-ctx models for any active edge pair that is missing a model.
  const edgeSpecs = [];
  const seenEdgePairs = new Set();
  for (const edge of existingEdges) {
    if (edge.cge_properties?.provenance?.model_id) continue;

    // Only run edge-ctx on undirected working-graph edges (Hindsight skeleton or
    // candidate hypotheses). Directed edges are produced by edge-ctx itself.
    if (edge.cge_type !== null && edge.cge_properties?.directed !== false) continue;

    // Both endpoints must be active in the working graph.
    const sourceActive = existingNodes.some((n) => n.cgn_id === edge.cge_source_id && n.cgn_labels?.includes('active'));
    const targetActive = existingNodes.some((n) => n.cgn_id === edge.cge_target_id && n.cgn_labels?.includes('active'));
    if (!sourceActive || !targetActive) continue;

    const pk = pairKey(edge.cge_source_id, edge.cge_target_id);
    if (seenEdgePairs.has(pk)) continue;
    seenEdgePairs.add(pk);

    const sourceNode = existingNodes.find((n) => n.cgn_id === edge.cge_source_id);
    const targetNode = existingNodes.find((n) => n.cgn_id === edge.cge_target_id);

    const spec = composeEdgeContextModel({
      sourceId: edge.cge_source_id,
      targetId: edge.cge_target_id,
      bankId,
      sourceName: sourceNode?.cgn_properties?.display_name || edge.cge_source_id,
      targetName: targetNode?.cgn_properties?.display_name || edge.cge_target_id,
    });
    edgeSpecs.push(spec);
  }

  // Step 5: optionally run discovery around prominent or manual seed nodes.
  const discoverSpecs = [];
  const discoverQueue = new Set();

  // Always include manual seeds if provided.
  if (Array.isArray(options.seed_node_ids)) {
    for (const seedId of options.seed_node_ids) {
      if (existingNodeIds.has(seedId)) discoverQueue.add(seedId);
    }
  }

  // Add top-K prominent uncanonical/active nodes by degree.
  if (neighborhood.run_discovery) {
    const nodeDegrees = new Map();
    for (const edge of existingEdges) {
      nodeDegrees.set(edge.cge_source_id, (nodeDegrees.get(edge.cge_source_id) || 0) + 1);
      nodeDegrees.set(edge.cge_target_id, (nodeDegrees.get(edge.cge_target_id) || 0) + 1);
    }

    const ranked = existingNodes
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
    const neighbors = existingEdges
      .filter((e) => e.cge_source_id === seedId || e.cge_target_id === seedId)
      .map((e) => (e.cge_source_id === seedId ? e.cge_target_id : e.cge_source_id))
      .slice(0, neighborhood.top_k_neighbors);

    const spec = composeDiscoverModel({
      seedId,
      bankId,
      seedName: seedNode?.cgn_properties?.display_name || seedId,
      neighborIds: neighbors,
    });
    discoverSpecs.push(spec);

    // Process any discovery results if a runner was supplied.
    if (options.runDiscovery) {
      const discoveryResult = await options.runDiscovery(db, serverId, bankId, spec, { existingNodes, existingEdges });
      if (discoveryResult?.success && Array.isArray(discoveryResult.candidates)) {
        const candidateSpecs = await processDiscoveryCandidates(
          db,
          serverId,
          bankId,
          discoveryResult.candidates,
          { seedId, existingNodes, existingEdges },
        );
        entitySpecs.push(...candidateSpecs.entity);
        edgeSpecs.push(...candidateSpecs.edge);
      }
    }
  }

  // Reload graph after discovery may have inserted candidate nodes/edges.
  const refreshedNodesResult = await listNodes(db, serverId, bankId, { limit: 10000 });
  const refreshedEdgesResult = await listEdges(db, serverId, bankId, { limit: 10000 });
  const refreshedNodes = refreshedNodesResult.data || [];
  const refreshedEdges = refreshedEdgesResult.data || [];

  // Step 6: deploy all queued models to Hindsight and record provenance.
  const allSpecs = [...entitySpecs, ...edgeSpecs, ...discoverSpecs];
  const deployFn = options.deployBatch || deployMentalModelBatch;
  const deployResult = await deployFn(db, serverId, bankId, allSpecs);

  if (deployResult.failed.length > 0) {
    logger.warn('Some contextual models failed to deploy', {
      serverId,
      bankId,
      failedCount: deployResult.failed.length,
    });
  }

  // Record provenance for successfully deployed models.
  const now = new Date().toISOString();
  for (const modelId of deployResult.deployed) {
    await recordModelProvenance(db, serverId, bankId, modelId, refreshedNodes, refreshedEdges, now);
  }

  return {
    success: true,
    queued: {
      entity: entitySpecs.length,
      edge: edgeSpecs.length,
      discover: discoverSpecs.length,
    },
    deployed: deployResult.deployed,
    failed: deployResult.failed,
  };
}

async function recordModelProvenance(db, serverId, bankId, modelId, existingNodes, existingEdges, now) {
  const provenance = { model_id: modelId, source: 'contextual-graph', updated_at: now };

  // entity-ctx model
  if (modelId.startsWith('entity-ctx-')) {
    const nodeId = modelId.slice('entity-ctx-'.length);
    const node = existingNodes.find((n) => n.cgn_id === nodeId);
    if (!node) return;

    const properties = {
      ...node.cgn_properties,
      provenance: { ...(node.cgn_properties?.provenance || {}), ...provenance },
      updated_at: now,
    };
    upsertNode(db, serverId, bankId, nodeId, node.cgn_labels, properties);
    return;
  }

  // edge-ctx model
  if (modelId.startsWith('edge-ctx-')) {
    const pairPart = modelId.slice('edge-ctx-'.length);
    const edge = existingEdges.find((e) => pairKey(e.cge_source_id, e.cge_target_id) === pairPart);
    if (!edge) return;

    const properties = {
      ...edge.cge_properties,
      provenance: { ...(edge.cge_properties?.provenance || {}), ...provenance },
      updated_at: now,
    };
    upsertEdge(db, serverId, bankId, edge.cge_id, edge.cge_source_id, edge.cge_target_id, edge.cge_type, properties);
    return;
  }

  // discover model provenance is not recorded on a specific node/edge by default.
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

async function processDiscoveryCandidates(db, serverId, bankId, candidates, context) {
  const { seedId, existingNodes } = context;
  const entitySpecs = [];
  const edgeSpecs = [];
  const now = new Date().toISOString();

  const { unique } = await dedupeCandidates(db, serverId, bankId, { find: () => undefined }, candidates);

  for (const candidate of unique) {
    // Upsert candidate node with candidate labels.
    const labels = ['uncanonical', 'candidate', 'active'];
    const properties = {
      display_name: candidate.displayName,
      provenance: { source: 'discover', seed_id: seedId, discovered_at: now },
      aliases: candidate.displayName ? [candidate.displayName] : [],
      last_seen_at: now,
      updated_at: now,
    };
    upsertNode(db, serverId, bankId, candidate.id, labels, properties);

    entitySpecs.push(composeEntityContextModel({
      nodeId: candidate.id,
      bankId,
      displayName: candidate.displayName,
      labels,
    }));

    // Queue edge-ctx for hypothesized edges to known nodes.
    if (Array.isArray(candidate.hypothesizedEdges)) {
      for (const he of candidate.hypothesizedEdges) {
        if (!existingNodes.some((n) => n.cgn_id === he.target)) continue;

        const targetNode = existingNodes.find((n) => n.cgn_id === he.target);

        edgeSpecs.push(composeEdgeContextModel({
          sourceId: candidate.id,
          targetId: he.target,
          bankId,
          sourceName: candidate.displayName,
          targetName: targetNode?.cgn_properties?.display_name || he.target,
        }));

        // Also create an undirected candidate edge so the graph shows the hypothesis.
        const edgeId = buildEdgeId(candidate.id, he.target, null, 'discover');
        const edgeProperties = {
          directed: false,
          type: he.type || 'co-occurs',
          weight: 0.5,
          provenance: { source: 'discover', seed_id: seedId, evidence: he.evidence },
          last_seen_at: now,
          updated_at: now,
        };
        upsertEdge(db, serverId, bankId, edgeId, candidate.id, he.target, null, edgeProperties);
      }
    }
  }

  return { entity: entitySpecs, edge: edgeSpecs };
}
