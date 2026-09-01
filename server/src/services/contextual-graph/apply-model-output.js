import {
  upsertNode,
  upsertEdge,
  listNodes,
  listEdges,
  getNode,
  getEdge,
  deleteEdge,
  deleteNode,
  findEdgeByEndpoints,
} from '../../db/crud/contextual-graph.js';
import { buildDirectedEdgeId, normalizeModelNodeId, modelNodeLookupKeys, stripDiscoveryPrefix } from './identity.js';
import { createLogger } from '../../utils/logger.js';
import { contentHash } from './normalize-model-output.js';

const logger = createLogger('contextual-graph-apply-model-output');

const ROLES = {
  entitySummary: 'sys_entity_summary',
  entityCapabilities: 'sys_entity_capabilities',
  edgeContext: 'sys_edge_context',
  discoveryContext: 'sys_discovery_context',
};

/**
 * Build a model_ref entry for provenance.
 *
 * @param {object} model
 * @param {string} model.mm_ext_id
 * @param {string} model.mm_template_role
 * @param {string} rawContent
 * @param {string} [now]
 * @returns {object}
 */
function buildModelRef(model, rawContent, now = new Date().toISOString()) {
  return {
    role: model.mm_template_role,
    ext_id: model.mm_ext_id,
    scope: model.scope,
    attached_at: now,
    fetched_at: now,
    content_hash: contentHash(rawContent),
  };
}

function mergeModelRefs(currentRefs, newRef) {
  const existing = Array.isArray(currentRefs) ? currentRefs : [];
  const deduped = existing.filter((ref) => ref?.ext_id !== newRef.ext_id);
  return [...deduped, newRef];
}

function now() {
  return new Date().toISOString();
}

/**
 * Apply a normalized contextual-graph model output to the working graph.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {object} model - mental_model row from Hindsight-ish shape:
 *   mm_ext_id, mm_template_role, mm_dimension, mm_name, etc.
 * @param {object} output - unified envelope from Hindsight reflect_response.structured_output.
 * @param {object} [options]
 * @param {string} [options.now] - ISO timestamp override.
 * @returns {Promise<{success: boolean, applied: object, warnings?: string[], error?: string, code?: string}>}
 */
export async function applyModelOutput(db, serverId, bankId, model, output, options = {}) {
  const timestamp = options.now || now();
  const role = model.mm_template_role;

  try {
    if (role === ROLES.entitySummary) {
      return applyEntitySummary(db, serverId, bankId, model, output, timestamp);
    }
    if (role === ROLES.entityCapabilities) {
      return applyEntityCapabilities(db, serverId, bankId, model, output, timestamp);
    }
    if (role === ROLES.edgeContext) {
      return applyEdgeContext(db, serverId, bankId, model, output, timestamp);
    }
    if (role === ROLES.discoveryContext) {
      return applyDiscoveryContext(db, serverId, bankId, model, output, timestamp);
    }

    return { success: false, error: `Unsupported contextual-graph role: ${role}`, code: 'UNSUPPORTED_ROLE' };
  } catch (err) {
    logger.error('applyModelOutput failed', { serverId, bankId, extId: model.mm_ext_id, role, error: err.message });
    return { success: false, error: err.message, code: 'APPLY_FAILED' };
  }
}

function firstNarrativeText(output) {
  return output?.narratives?.[0]?.narrative ?? '';
}

function applyEntitySummary(db, serverId, bankId, model, output, timestamp) {
  const nodeId = model.scope?.node_id;
  if (!nodeId) {
    return { success: false, error: 'Cannot resolve node id from entity-summary model scope', code: 'BAD_SCOPE' };
  }

  const nodeResult = getNode(db, serverId, bankId, nodeId);
  if (!nodeResult?.success || !nodeResult.data) {
    return { success: false, error: `Node not found: ${nodeId}`, code: 'NODE_NOT_FOUND' };
  }
  const node = nodeResult.data;

  const modelRef = buildModelRef(model, output.raw, timestamp);
  const firstNarrative = firstNarrativeText(output);
  const properties = {
    ...node.properties,
    summary: firstNarrative,
    provenance: {
      ...(node.properties?.provenance || {}),
      source: 'contextual-graph',
      model_refs: mergeModelRefs(node.properties?.provenance?.model_refs, modelRef),
      updated_at: timestamp,
    },
    updated_at: timestamp,
  };

  // Also apply tables if the model produced them (e.g. capabilities alongside summary).
  if (output.tables.length > 0) {
    const capabilitiesTable = output.tables.find((t) => t.name === 'capabilities');
    if (capabilitiesTable) {
      properties.capabilities = capabilitiesTable.rows || [];
    }
  }

  upsertNode(db, serverId, bankId, nodeId, node.labels || [], properties);

  return { success: true, applied: { nodeId, summary: properties.summary, capabilities: properties.capabilities } };
}

function applyEntityCapabilities(db, serverId, bankId, model, output, timestamp) {
  const nodeId = model.scope?.node_id;
  if (!nodeId) {
    return { success: false, error: 'Cannot resolve node id from entity-capabilities model scope', code: 'BAD_SCOPE' };
  }

  const nodeResult = getNode(db, serverId, bankId, nodeId);
  if (!nodeResult?.success || !nodeResult.data) {
    return { success: false, error: `Node not found: ${nodeId}`, code: 'NODE_NOT_FOUND' };
  }
  const node = nodeResult.data;

  const capabilitiesTable = output.tables.find((t) => t.name === 'capabilities');
  const capabilities = capabilitiesTable?.rows || [];

  // Also apply narrative if the model produced one.
  const modelRef = buildModelRef(model, output.raw, timestamp);
  const properties = {
    ...node.properties,
    capabilities,
    provenance: {
      ...(node.properties?.provenance || {}),
      source: 'contextual-graph',
      model_refs: mergeModelRefs(node.properties?.provenance?.model_refs, modelRef),
      updated_at: timestamp,
    },
    updated_at: timestamp,
  };

  if (firstNarrativeText(output).trim()) {
    properties.summary = firstNarrativeText(output);
  }

  upsertNode(db, serverId, bankId, nodeId, node.labels || [], properties);

  return { success: true, applied: { nodeId, capabilities, summary: properties.summary } };
}

function applyEdgeContext(db, serverId, bankId, model, output, timestamp) {
  const sourceId = model.scope?.source_id;
  const targetId = model.scope?.target_id;
  if (!sourceId || !targetId) {
    return { success: false, error: 'Cannot resolve pair from edge-ctx model scope', code: 'BAD_SCOPE' };
  }

  const warnings = [];
  if (output.graph.edges.length === 0) {
    return { success: false, error: 'edge-ctx model returned no edges', code: 'NO_EDGES' };
  }

  const allEdgesResult = listEdges(db, serverId, bankId, { limit: 10000 });
  const allEdges = allEdgesResult?.success ? allEdgesResult.data : [];
  const allNodesResult = listNodes(db, serverId, bankId, { limit: 10000 });
  const allNodes = allNodesResult?.success ? allNodesResult.data : [];
  const existingNodeIds = new Set(allNodes.map((n) => n.cgn_id));
  const nodeIdByModelId = buildNodeIdByModelIdMap(allNodes);

  const modelRef = buildModelRef(model, output.raw, timestamp);

  // Remove any edges previously produced by this edge-context model so that
  // each refresh yields a clean replacement rather than accumulating stale
  // or partially-overlapping edges.
  const edgesToRemove = allEdges.filter((edge) => {
    const refs = edge.cge_properties?.provenance?.model_refs || [];
    return refs.some((ref) => ref?.ext_id === model.mm_ext_id);
  });
  for (const edge of edgesToRemove) {
    deleteEdge(db, serverId, bankId, edge.cge_id);
  }

  // Ensure endpoint nodes emitted by the model exist in the working graph.
  // If a node is missing, create it from the model output so asserted edges have endpoints.
  // We always normalize model-emitted ids through buildNodeId so a bare
  // "mozart-api" resolves to an existing "svc:mozart-api" or "uncanonical:mozart-api"
  // node instead of creating a new duplicate.
  let createdNodes = 0;
  const idRemap = new Map();
  for (const node of output.graph.nodes) {
    const resolvedId = resolveModelNodeId(node.id, existingNodeIds, nodeIdByModelId);
    idRemap.set(node.id, resolvedId);
    if (existingNodeIds.has(resolvedId)) continue;
    const properties = {
      display_name: node.name,
      type: node.type,
      provenance: {
        source: 'contextual-graph',
        inferred: 'edge-context',
        model_refs: [modelRef],
        updated_at: timestamp,
      },
      updated_at: timestamp,
    };
    upsertNode(db, serverId, bankId, resolvedId, ['active'], properties);
    existingNodeIds.add(resolvedId);
    nodeIdByModelId.set(resolvedId, resolvedId);
    nodeIdByModelId.set(normalizeModelNodeId(resolvedId), resolvedId);
    createdNodes += 1;
  }

  // Merge the edge-context model_ref into existing nodes that the model
  // resolved to, so the provenance chain is complete even when the model only
  // emitted a bare name such as "mozart-api" that matched an existing node.
  for (const [modelId, resolvedId] of idRemap.entries()) {
    if (modelId === resolvedId) continue;
    const existingResult = getNode(db, serverId, bankId, resolvedId);
    const existingNode = existingResult?.success ? existingResult.data : null;
    if (!existingNode) continue;
    const properties = { ...existingNode.properties };
    const provenance = { ...(properties.provenance || {}) };
    provenance.source = 'contextual-graph';
    provenance.inferred = 'edge-context';
    provenance.model_refs = mergeModelRefs(provenance.model_refs, modelRef);
    provenance.updated_at = timestamp;
    properties.provenance = provenance;
    properties.updated_at = timestamp;
    upsertNode(db, serverId, bankId, resolvedId, existingNode.labels, properties);
  }

  const appliedEdges = [];
  const touchedEdgeIds = new Set();

  for (const modelEdge of output.graph.edges) {
    if (!modelEdge.from || !modelEdge.to || !modelEdge.type) {
      warnings.push('Skipping malformed model edge missing from/to/type');
      continue;
    }

    const fromId = idRemap.get(modelEdge.from) || resolveModelNodeId(modelEdge.from, existingNodeIds, nodeIdByModelId);
    const toId = idRemap.get(modelEdge.to) || resolveModelNodeId(modelEdge.to, existingNodeIds, nodeIdByModelId);

    // Look for an existing edge between the same endpoints and type. We query
    // the DB directly so large banks don't miss edges due to an in-memory page
    // limit. Edges touched earlier in this same call are ignored so parallel
    // edges of the same type but different labels remain distinct.
    const findResult = findEdgeByEndpoints(db, serverId, bankId, fromId, toId, modelEdge.type);
    let existing = findResult?.success ? findResult.data : null;
    if (existing && touchedEdgeIds.has(existing.cge_id)) {
      existing = null;
    }

    let edgeId;
    let source;
    let target;
    let properties;

    if (existing) {
      edgeId = existing.cge_id;
      source = existing.cge_source_id;
      target = existing.cge_target_id;
      properties = {
        ...existing.cge_properties,
        provenance: {
          ...(existing.cge_properties?.provenance || {}),
          source: 'contextual-graph',
          model_refs: mergeModelRefs(existing.cge_properties?.provenance?.model_refs, modelRef),
          updated_at: timestamp,
        },
        updated_at: timestamp,
      };
    } else {
      edgeId = buildDirectedEdgeId(fromId, toId, modelEdge.type, modelEdge.label, 'edge-ctx');
      source = fromId;
      target = toId;
      properties = {
        directed: true,
        label: modelEdge.label,
        detail: modelEdge.detail,
        evidence: modelEdge.evidence,
        provenance: {
          source: 'contextual-graph',
          model_refs: [modelRef],
          updated_at: timestamp,
        },
        updated_at: timestamp,
      };
    }

    // Always overwrite label/detail/evidence with the model's values when present.
    if (modelEdge.label !== undefined) properties.label = modelEdge.label;
    if (modelEdge.detail !== undefined) properties.detail = modelEdge.detail;
    if (modelEdge.evidence !== undefined) properties.evidence = modelEdge.evidence;

    upsertEdge(db, serverId, bankId, edgeId, source, target, modelEdge.type, properties);
    touchedEdgeIds.add(edgeId);
    appliedEdges.push(edgeId);
  }

  return { success: true, applied: { edgeIds: appliedEdges, createdNodes }, warnings };
}

/**
 * Build a map from normalized model-emitted node ids to the actual existing
 * working-graph node id that best represents the same entity. This lets a bare
 * "mozart-api" emitted by a model resolve to an existing "svc:mozart-api" or
 * "uncanonical:mozart-api" node, and lets a discovery alias like
 * "found:mozart-api" resolve to the same existing node.
 *
 * @param {Array} allNodes
 * @returns {Map<string, string>}
 */
function buildNodeIdByModelIdMap(allNodes) {
  const map = new Map();
  for (const node of allNodes) {
    const id = node.cgn_id;

    // Register every lookup key for this existing node: normalized id,
    // discovery-prefixed aliases, display name, and aliases.
    for (const key of modelNodeLookupKeys(id).concat([id])) {
      if (!map.has(key)) {
        map.set(key, id);
      }
    }

    const display = node.cgn_properties?.display_name;
    if (display) {
      for (const key of modelNodeLookupKeys(display)) {
        if (!map.has(key)) {
          map.set(key, id);
        }
      }
    }

    for (const alias of node.cgn_properties?.aliases || []) {
      for (const key of modelNodeLookupKeys(alias)) {
        if (!map.has(key)) {
          map.set(key, id);
        }
      }
    }
  }
  return map;
}

/**
 * Resolve a node id emitted by a model to the canonical working-graph node id.
 * First try exact match, then all normalized lookup keys, then display
 * name/alias match.
 *
 * @param {string} modelId
 * @param {Set<string>|Map<string, *>} existingNodeIdsOrMap
 * @param {Map<string, string>} nodeIdByModelId
 * @returns {string}
 */
function resolveModelNodeId(modelId, existingNodeIdsOrMap, nodeIdByModelId) {
  const keys = [modelId, ...modelNodeLookupKeys(modelId)];
  for (const key of keys) {
    if (existingNodeIdsOrMap instanceof Map) {
      if (existingNodeIdsOrMap.has(key)) return key;
    } else if (existingNodeIdsOrMap.has(key)) {
      return key;
    }
  }
  for (const key of keys) {
    if (nodeIdByModelId.has(key)) {
      return nodeIdByModelId.get(key);
    }
  }
  return modelId;
}

function applyDiscoveryContext(db, serverId, bankId, model, output, timestamp) {
  const seedId = model.scope?.seed_id;
  if (!seedId) {
    return { success: false, error: 'Cannot resolve seed id from discover model scope', code: 'BAD_SCOPE' };
  }

  const seedNodeResult = getNode(db, serverId, bankId, seedId);
  if (!seedNodeResult?.success || !seedNodeResult.data) {
    return { success: false, error: `Seed node not found: ${seedId}`, code: 'NODE_NOT_FOUND' };
  }
  const seedNode = seedNodeResult.data;

  const modelRef = buildModelRef(model, output.raw, timestamp);

  // Attach/refresh the model ref on the seed node.
  const seedProperties = {
    ...seedNode.properties,
    provenance: {
      ...(seedNode.properties?.provenance || {}),
      source: 'contextual-graph',
      model_refs: mergeModelRefs(seedNode.properties?.provenance?.model_refs, modelRef),
      updated_at: timestamp,
    },
    updated_at: timestamp,
  };
  upsertNode(db, serverId, bankId, seedId, seedNode.labels || [], seedProperties);

  // Remove old discovered nodes/edges attached to this model ref.
  const allNodesResult = listNodes(db, serverId, bankId, { limit: 10000 });
  const allEdgesResult = listEdges(db, serverId, bankId, { limit: 10000 });
  const allNodes = allNodesResult?.success ? allNodesResult.data : [];
  const allEdges = allEdgesResult?.success ? allEdgesResult.data : [];

  for (const edge of allEdges) {
    const refs = edge.cge_properties?.provenance?.model_refs || [];
    if (refs.some((ref) => ref?.ext_id === model.mm_ext_id)) {
      deleteEdge(db, serverId, bankId, edge.cge_id);
    }
  }

  for (const node of allNodes) {
    if (node.cgn_id === seedId) continue;
    const refs = node.cgn_properties?.provenance?.model_refs || [];
    // Preserve nodes that are seeds for their own discovery model; they are not
    // disposable discovered nodes for this ref.
    const isOwnSeed = refs.some((ref) =>
      ref?.role === 'sys_discovery_context' && ref?.scope?.seed_id === node.cgn_id,
    );
    if (isOwnSeed) continue;
    if (refs.some((ref) => ref?.ext_id === model.mm_ext_id)) {
      deleteNode(db, serverId, bankId, node.cgn_id);
    }
  }

  // Upsert new discovered nodes and edges.
  const allNodesMap = new Map(allNodes.map((n) => [n.cgn_id, n]));
  const nodeIdByModelId = buildNodeIdByModelIdMap(allNodes);
  const nodeIds = new Set([seedId]);
  const idRemap = new Map();
  let createdNodes = 0;
  let createdEdges = 0;

  for (const node of output.graph.nodes) {
    const strippedId = stripDiscoveryPrefix(node.id);
    const resolvedId = resolveModelNodeId(strippedId, allNodesMap, nodeIdByModelId);
    idRemap.set(strippedId, resolvedId);
    nodeIds.add(resolvedId);
    nodeIdByModelId.set(normalizeModelNodeId(resolvedId), resolvedId);
    const existingNodeResult = getNode(db, serverId, bankId, resolvedId);
    const existingNode = existingNodeResult?.success ? existingNodeResult.data : null;
    const existingProperties = existingNode?.properties || {};
    const existingLabels = existingNode?.labels || [];

    const isExistingNode = allNodesMap.has(resolvedId);
    const isGroundedOrCanonical = existingLabels.includes('grounded') || existingLabels.includes('canonical');

    const discoveredProperties = {
      ...existingProperties,
      // Only set name/type from the discovery output for new candidate nodes.
      // Canonical and grounded nodes keep their existing display_name/type.
      ...(!isExistingNode ? { display_name: node.name, type: node.type } : {}),
      provenance: {
        ...(existingProperties.provenance || {}),
        source: 'contextual-graph',
        discovery: 'discovered',
        model_refs: mergeModelRefs(existingProperties.provenance?.model_refs, modelRef),
        updated_at: timestamp,
      },
      updated_at: timestamp,
    };
    // Discovery owns a node unless it is already grounded/canonical. This covers
    // brand-new nodes and nodes that were previously created by edge-ctx/etc.
    const discoveredLabels = isGroundedOrCanonical
      ? [...new Set([...existingLabels, 'active'])]
      : [...new Set([...existingLabels, 'candidate', 'active'])];
    upsertNode(db, serverId, bankId, resolvedId, discoveredLabels, discoveredProperties);
    createdNodes += 1;
  }

  for (const edge of output.graph.edges) {
    const fromId = idRemap.get(stripDiscoveryPrefix(edge.from)) || resolveModelNodeId(stripDiscoveryPrefix(edge.from), allNodesMap, nodeIdByModelId);
    const toId = idRemap.get(stripDiscoveryPrefix(edge.to)) || resolveModelNodeId(stripDiscoveryPrefix(edge.to), allNodesMap, nodeIdByModelId);

    if (!nodeIds.has(fromId) || !nodeIds.has(toId)) {
      warnings.push(`Discovery edge ${edge.from} -> ${edge.to} references a node not emitted by the model; skipping`);
      continue;
    }

    // A discovered relationship between two grounded/canonical nodes is itself
    // grounded; only edges that touch at least one candidate remain candidates.
    const fromNode = allNodesMap.get(fromId);
    const toNode = allNodesMap.get(toId);
    const fromGroundedOrCanonical = fromNode?.cgn_labels?.includes('grounded') || fromNode?.cgn_labels?.includes('canonical');
    const toGroundedOrCanonical = toNode?.cgn_labels?.includes('grounded') || toNode?.cgn_labels?.includes('canonical');
    const edgeLabels = fromGroundedOrCanonical && toGroundedOrCanonical ? ['grounded'] : ['candidate'];

    const edgeId = `discovered-${seedId}-${fromId}-${toId}-${edge.type}`;
    const existingEdgeResult = getEdge(db, serverId, bankId, edgeId);
    const existingEdge = existingEdgeResult?.success ? existingEdgeResult.data : null;
    const existingProperties = existingEdge?.cge_properties || {};
    const edgeProperties = {
      ...existingProperties,
      labels: edgeLabels,
      label: edge.label,
      detail: edge.detail,
      evidence: edge.evidence,
      provenance: {
        ...(existingProperties.provenance || {}),
        source: 'contextual-graph',
        discovery: 'discovered',
        model_refs: mergeModelRefs(existingProperties.provenance?.model_refs, modelRef),
        updated_at: timestamp,
      },
      updated_at: timestamp,
    };
    upsertEdge(db, serverId, bankId, edgeId, fromId, toId, edge.type, edgeProperties);
    createdEdges += 1;
  }

  return { success: true, applied: { seedId, nodeCount: createdNodes, edgeCount: createdEdges } };
}
