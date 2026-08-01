import { createLogger } from '../../utils/logger.js';
import { importHindsightSkeleton } from './import-hindsight-skeleton.js';
import { listNodes, listEdges, upsertNode, upsertEdge } from '../../db/crud/contextual-graph.js';
import { dedupeCandidates, buildEdgeId } from './identity.js';
import {
  deriveEntityContextModel,
  deriveEdgeContextModel,
  deriveDiscoverContextModel,
} from './template-models.js';
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
 * User-led job that:
 * 1. Imports the current Hindsight entity graph skeleton.
 * 2. Derives and deploys `entity-ctx` mental models for active nodes.
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
 * @param {string[]} [options.seed_node_ids] - manual seed nodes to discover around
 * @param {Object} [options.neighborhood] - discovery scope
 * @param {number} [options.neighborhood.top_k_neighbors]
 * @param {boolean} [options.neighborhood.run_discovery]
 * @param {Function} [options.fetchGraph] - override for testing
 * @param {Function} [options.runDiscovery] - override for testing; receives spec, returns { candidates }
 * @param {Function} [options.deployBatch] - override for testing; receives (db, serverId, bankId, specs)
 * @returns {Promise<{success: boolean, queued?: {entity: number, edge: number, discover: number}, deployed?: string[], failed?: {ext_id: string, error: string, code?: string}[], error?: string, code?: string}>}
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

  // Step 2: load existing working graph.
  const [existingNodesResult, existingEdgesResult] = await Promise.all([
    listNodes(db, serverId, bankId, { limit: 10000 }),
    listEdges(db, serverId, bankId, { limit: 10000 }),
  ]);

  const existingNodes = existingNodesResult.data || [];
  const existingEdges = existingEdgesResult.data || [];

  const existingNodeIds = new Set(existingNodes.map((n) => n.cgn_id));

  // Step 3: derive entity-ctx models for active nodes without provenance.
  const entitySpecs = [];
  for (const node of existingNodes) {
    if (node.cgn_properties?.provenance?.model_id) continue;
    if (!node.cgn_labels?.includes('active')) continue;

    const spec = await deriveEntityContextModel(db, {
      id: node.cgn_id,
      displayName: node.cgn_properties?.display_name || node.cgn_id,
    });
    entitySpecs.push(spec);
  }

  // Step 4: derive edge-ctx models for active undirected edge pairs without provenance.
  const edgeSpecs = [];
  const seenEdgePairs = new Set();
  for (const edge of existingEdges) {
    if (edge.cge_properties?.provenance?.model_id) continue;

    // Only run edge-ctx on undirected working-graph edges (Hindsight skeleton or
    // candidate hypotheses). Directed edges are produced by edge-ctx itself.
    if (edge.cge_type !== null && edge.cge_properties?.directed !== false) continue;

    const sourceActive = existingNodes.some((n) => n.cgn_id === edge.cge_source_id && n.cgn_labels?.includes('active'));
    const targetActive = existingNodes.some((n) => n.cgn_id === edge.cge_target_id && n.cgn_labels?.includes('active'));
    if (!sourceActive || !targetActive) continue;

    const pk = pairKey(edge.cge_source_id, edge.cge_target_id);
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

  // Step 5: optionally derive discover models around seeds.
  const discoverSpecs = [];
  const discoverQueue = new Set();

  if (Array.isArray(options.seed_node_ids)) {
    for (const seedId of options.seed_node_ids) {
      if (existingNodeIds.has(seedId)) discoverQueue.add(seedId);
    }
  }

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

    const spec = await deriveDiscoverContextModel(db, {
      id: seedId,
      displayName: seedNode?.cgn_properties?.display_name || seedId,
    }, neighbors);
    discoverSpecs.push(spec);

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

  if (modelId.startsWith('entity-ctx-')) {
    const nodeId = modelId.slice('entity-ctx-'.length);
    const node = existingNodes.find((n) => n.cgn_id === nodeId);
    if (!node) return;

    const properties = mergeProperties(node.cgn_properties, provenance, now);
    upsertNode(db, serverId, bankId, nodeId, node.cgn_labels, properties);
    return;
  }

  if (modelId.startsWith('edge-ctx-')) {
    const pairPart = modelId.slice('edge-ctx-'.length);
    const edge = existingEdges.find((e) => pairKey(e.cge_source_id, e.cge_target_id) === pairPart);
    if (!edge) return;

    const properties = mergeProperties(edge.cge_properties, provenance, now);
    upsertEdge(db, serverId, bankId, edge.cge_id, edge.cge_source_id, edge.cge_target_id, edge.cge_type, properties);
    return;
  }
}

function mergeProperties(current, provenance, now) {
  return {
    ...current,
    provenance: { ...(current?.provenance || {}), ...provenance },
    updated_at: now,
  };
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

async function processDiscoveryCandidates(db, serverId, bankId, candidates, context) {
  const { seedId, existingNodes } = context;
  const entitySpecs = [];
  const edgeSpecs = [];
  const now = new Date().toISOString();

  const lookups = buildLookupsFromGraph(existingNodes);
  const { unique, mergedIntoExisting } = await dedupeCandidates(db, serverId, bankId, lookups, candidates);

  for (const candidate of unique) {
    const labels = ['uncanonical', 'candidate', 'active'];
    const properties = {
      display_name: candidate.displayName,
      provenance: { source: 'discover', seed_id: seedId, discovered_at: now },
      aliases: candidate.displayName ? [candidate.displayName] : [],
      last_seen_at: now,
      updated_at: now,
    };
    upsertNode(db, serverId, bankId, candidate.id, labels, properties);

    entitySpecs.push(await deriveEntityContextModel(db, {
      id: candidate.id,
      displayName: candidate.displayName,
    }));

    if (Array.isArray(candidate.hypothesizedEdges)) {
      for (const he of candidate.hypothesizedEdges) {
        if (!existingNodes.some((n) => n.cgn_id === he.target)) continue;

        const targetNode = existingNodes.find((n) => n.cgn_id === he.target);

        edgeSpecs.push(await deriveEdgeContextModel(db, {
          id: candidate.id,
          displayName: candidate.displayName,
        }, {
          id: he.target,
          displayName: targetNode?.cgn_properties?.display_name || he.target,
        }));

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

  // Candidates that merged into existing nodes should still get entity-ctx if missing,
  // and edge-ctx for their hypothesized edges.
  for (const { candidate } of mergedIntoExisting) {
    const existingId = existingNodes.find((n) => n.cgn_id === candidate.id)?.cgn_id;
    const existing = existingId ? existingNodes.find((n) => n.cgn_id === existingId) : null;
    if (existing && !existing.cgn_properties?.provenance?.model_id) {
      entitySpecs.push(await deriveEntityContextModel(db, {
        id: existing.cgn_id,
        displayName: existing.cgn_properties?.display_name || existing.cgn_id,
      }));
    }

    if (Array.isArray(candidate.hypothesized_edges)) {
      for (const he of candidate.hypothesized_edges) {
        if (!existingNodes.some((n) => n.cgn_id === he.target)) continue;
        const targetNode = existingNodes.find((n) => n.cgn_id === he.target);

        edgeSpecs.push(await deriveEdgeContextModel(db, {
          id: candidate.id,
          displayName: candidate.displayName || candidate.id,
        }, {
          id: he.target,
          displayName: targetNode?.cgn_properties?.display_name || he.target,
        }));

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

function buildLookupsFromGraph(nodes) {
  const byName = new Map();
  const byId = new Map();
  for (const n of nodes) {
    const display = n.cgn_properties?.display_name;
    if (display) byName.set(display.toLowerCase(), n.cgn_id);
    for (const alias of n.cgn_properties?.aliases || []) {
      if (alias) byName.set(alias.toLowerCase(), n.cgn_id);
    }
    byId.set(n.cgn_id, n.cgn_id);
  }
  return {
    find: (nameOrId) => {
      if (!nameOrId) return undefined;
      const id = byId.get(nameOrId) || byName.get(String(nameOrId).toLowerCase());
      if (!id) return undefined;
      return { id };
    },
  };
}
