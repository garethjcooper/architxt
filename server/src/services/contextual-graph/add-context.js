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
import { runDiscovery as defaultRunDiscovery } from './discovery.js';

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
 * @param {string[]} [options.node_ids] - explicit subset of working-graph nodes to contextualize
 * @param {boolean} [options.run_discovery] - whether to run discovery around seeds/subset
 * @param {boolean} [options.import_skeleton] - whether to re-import the Hindsight skeleton first
 * @param {string[]} [options.seed_node_ids] - manual seed nodes to discover around
 * @param {Object} [options.neighborhood] - discovery scope
 * @param {number} [options.neighborhood.top_k_neighbors]
 * @param {boolean} [options.run_discovery] - deprecated alias for top-level option
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

  const importSkeleton = options.import_skeleton !== false;
  let runDiscovery = options.run_discovery !== false;
  const neighborhood = { ...DEFAULT_NEIGHBORHOOD, ...options.neighborhood };
  if (options.neighborhood?.run_discovery !== undefined) {
    // Deprecated nesting: top-level option wins.
    if (options.run_discovery === undefined) {
      runDiscovery = options.neighborhood.run_discovery;
    }
  }

  // Step 1: optionally import current Hindsight skeleton.
  let importResult = { success: true, imported: { nodes: 0, edges: 0 } };
  if (importSkeleton) {
    importResult = await importHindsightSkeleton(
      db,
      serverId,
      bankId,
      { min_count: options.min_count, min_weight: options.min_weight },
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
  const inSubset = (id) => (subsetNodeIds ? subsetNodeIds.has(id) : true);
  const filteredNodes = subsetNodeIds
    ? existingNodes.filter((n) => subsetNodeIds.has(n.cgn_id))
    : existingNodes;
  const filteredEdges = subsetNodeIds
    ? existingEdges.filter((e) => subsetNodeIds.has(e.cge_source_id) && subsetNodeIds.has(e.cge_target_id))
    : existingEdges;

  // Step 3: derive entity-ctx models for active nodes without an entity-ctx ref.
  const entitySpecs = [];
  for (const node of filteredNodes) {
    if (hasModelRef(node.cgn_properties, 'entity-ctx')) continue;
    if (!node.cgn_labels?.includes('active')) continue;

    const spec = await deriveEntityContextModel(db, {
      id: node.cgn_id,
      displayName: node.cgn_properties?.display_name || node.cgn_id,
    }, bankId);
    entitySpecs.push(spec);
  }

  // Step 4: derive edge-ctx models for active undirected edge pairs without an edge-ctx ref.
  const edgeSpecs = [];
  const seenEdgePairs = new Set();
  for (const edge of filteredEdges) {
    if (hasModelRef(edge.cge_properties, 'edge-ctx')) continue;

    // Only run edge-ctx on undirected working-graph edges (Hindsight skeleton or
    // candidate hypotheses). Directed edges are produced by edge-ctx itself.
    if (edge.cge_type !== null && edge.cge_properties?.directed !== false) continue;

    const sourceActive = existingNodes.some((n) => n.cgn_id === edge.cge_source_id && n.cgn_labels?.includes('active') && inSubset(n.cgn_id));
    const targetActive = existingNodes.some((n) => n.cgn_id === edge.cge_target_id && n.cgn_labels?.includes('active') && inSubset(n.cgn_id));
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
    }, bankId);
    edgeSpecs.push(spec);
  }

  // Step 5: optionally derive discover models around seeds.
  const discoverSpecs = [];
  const discoverQueue = new Set();

  if (Array.isArray(options.seed_node_ids)) {
    for (const seedId of options.seed_node_ids) {
      if (existingNodeIds.has(seedId) && inSubset(seedId)) discoverQueue.add(seedId);
    }
  }

  if (runDiscovery) {
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
    const neighbors = filteredEdges
      .filter((e) => e.cge_source_id === seedId || e.cge_target_id === seedId)
      .map((e) => (e.cge_source_id === seedId ? e.cge_target_id : e.cge_source_id))
      .slice(0, neighborhood.top_k_neighbors);

    const spec = await deriveDiscoverContextModel(db, {
      id: seedId,
      displayName: seedNode?.cgn_properties?.display_name || seedId,
    }, neighbors, Date.now(), bankId);
    discoverSpecs.push(spec);

    if (runDiscovery) {
      const discoveryFn = typeof options.runDiscovery === 'function'
        ? options.runDiscovery
        : defaultRunDiscovery;
      const discoveryResult = await discoveryFn(db, serverId, bankId, spec, { existingNodes, existingEdges, generateCompletion: options.generateCompletion });
      if (discoveryResult?.success && Array.isArray(discoveryResult.candidates)) {
        const candidateSpecs = await processDiscoveryCandidates(
          db,
          serverId,
          bankId,
          discoveryResult.candidates,
          { seedId, existingNodes: filteredNodes, existingEdges: filteredEdges },
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
  const dedupedEntitySpecs = dedupeSpecsByExtId(entitySpecs);
  const dedupedEdgeSpecs = dedupeSpecsByExtId(edgeSpecs);
  const allSpecs = [...dedupedEntitySpecs, ...dedupedEdgeSpecs, ...discoverSpecs];
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
      entity: dedupedEntitySpecs.length,
      edge: dedupedEdgeSpecs.length,
      discover: discoverSpecs.length,
    },
    deployed: deployResult.deployed,
    failed: deployResult.failed,
  };
}

async function recordModelProvenance(db, serverId, bankId, modelId, existingNodes, existingEdges, now) {
  const role = modelIdToRole(modelId);
  const provenance = {
    model_id: modelId,
    source: 'contextual-graph',
    updated_at: now,
  };

  if (modelId.startsWith('entity-ctx-')) {
    const nodeId = modelId.slice('entity-ctx-'.length);
    const node = existingNodes.find((n) => n.cgn_id === nodeId);
    if (!node) return;

    const properties = mergeProperties(node.cgn_properties, modelId, role, now);
    upsertNode(db, serverId, bankId, nodeId, node.cgn_labels, properties);
    return;
  }

  if (modelId.startsWith('edge-ctx-')) {
    const pairPart = modelId.slice('edge-ctx-'.length);
    const edge = existingEdges.find((e) => {
      const raw = `${e.cge_source_id}|${e.cge_target_id}`;
      return raw === pairPart || pairKey(e.cge_source_id, e.cge_target_id) === pairPart;
    });
    if (!edge) return;

    const properties = mergeProperties(edge.cge_properties, modelId, role, now);
    upsertEdge(db, serverId, bankId, edge.cge_id, edge.cge_source_id, edge.cge_target_id, edge.cge_type, properties);
    return;
  }
}

function hasModelRef(properties, rolePrefix) {
  const refs = properties?.provenance?.model_refs;
  if (Array.isArray(refs)) {
    if (refs.some((ref) => ref?.role?.startsWith?.(rolePrefix))) return true;
  }
  // Backward compatibility: legacy single-model_id provenance.
  const legacyModelId = properties?.provenance?.model_id;
  if (legacyModelId && typeof legacyModelId === 'string') {
    const legacyRole = modelIdToRole(legacyModelId);
    return legacyRole.startsWith(rolePrefix);
  }
  return false;
}

function modelIdToRole(modelId) {
  if (modelId.startsWith('entity-ctx-')) return 'entity-ctx';
  if (modelId.startsWith('edge-ctx-')) return 'edge-ctx';
  if (modelId.startsWith('discover-')) return 'discover-ctx';
  return 'model';
}

function mergeProperties(current, modelId, role, now) {
  const existingRefs = current?.provenance?.model_refs || [];
  const dedupedRefs = existingRefs.filter((ref) => ref?.ext_id !== modelId);
  const modelRefs = [...dedupedRefs, { role, ext_id: modelId, attached_at: now }];
  return {
    ...current,
    provenance: {
      ...(current?.provenance || {}),
      model_id: modelId,
      model_refs: modelRefs,
      source: 'contextual-graph',
      updated_at: now,
    },
    updated_at: now,
  };
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function dedupeSpecsByExtId(specs) {
  const seen = new Set();
  return specs.filter((spec) => {
    if (!spec?.ext_id || seen.has(spec.ext_id)) return false;
    seen.add(spec.ext_id);
    return true;
  });
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
      provenance: { source: 'discover', seed_id: seedId, discovered_at: now, model_refs: [] },
      aliases: candidate.displayName ? [candidate.displayName] : [],
      last_seen_at: now,
      updated_at: now,
    };
    upsertNode(db, serverId, bankId, candidate.id, labels, properties);

    entitySpecs.push(await deriveEntityContextModel(db, {
      id: candidate.id,
      displayName: candidate.displayName,
    }, bankId));

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
        }, bankId));

        const edgeId = buildEdgeId(candidate.id, he.target, null, 'discover');
        const edgeProperties = {
          directed: false,
          type: he.type || 'co-occurs',
          weight: 0.5,
          provenance: { source: 'discover', seed_id: seedId, evidence: he.evidence, model_refs: [] },
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
    if (existing && !hasModelRef(existing.cgn_properties, 'entity-ctx')) {
      entitySpecs.push(await deriveEntityContextModel(db, {
        id: existing.cgn_id,
        displayName: existing.cgn_properties?.display_name || existing.cgn_id,
      }, bankId));
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
        }, bankId));

        const edgeId = buildEdgeId(candidate.id, he.target, null, 'discover');
        const edgeProperties = {
          directed: false,
          type: he.type || 'co-occurs',
          weight: 0.5,
          provenance: { source: 'discover', seed_id: seedId, evidence: he.evidence, model_refs: [] },
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
