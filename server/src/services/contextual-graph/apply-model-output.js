import {
  getNode,
  upsertNode,
  listNodes,
  listEdges,
  upsertEdge,
  deleteEdge,
  deleteNode,
} from '../../db/crud/contextual-graph.js';
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
 * @param {object} output - normalized envelope from normalizeModelOutput.
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

function parseNodeIdFromExtId(extId, prefix) {
  if (!extId?.startsWith(prefix)) return null;
  return extId.slice(prefix.length);
}

function applyEntitySummary(db, serverId, bankId, model, output, timestamp) {
  const nodeId = parseNodeIdFromExtId(model.mm_ext_id, 'entity-summary-');
  if (!nodeId) {
    return { success: false, error: 'Cannot resolve node id from entity-summary ext_id', code: 'BAD_EXT_ID' };
  }

  const nodeResult = getNode(db, serverId, bankId, nodeId);
  if (!nodeResult?.success || !nodeResult.data) {
    return { success: false, error: `Node not found: ${nodeId}`, code: 'NODE_NOT_FOUND' };
  }
  const node = nodeResult.data;

  const warnings = [];
  if (output.graph.nodes.length > 0 || output.graph.edges.length > 0) {
    warnings.push('entity-summary model returned graph data; ignoring');
  }
  if (output.tables.length > 0) {
    warnings.push('entity-summary model returned tables; ignoring');
  }

  const modelRef = buildModelRef(model, output.raw, timestamp);
  const properties = {
    ...node.properties,
    summary: output.narrative || '',
    provenance: {
      ...(node.properties?.provenance || {}),
      source: 'contextual-graph',
      model_refs: mergeModelRefs(node.properties?.provenance?.model_refs, modelRef),
      updated_at: timestamp,
    },
    updated_at: timestamp,
  };

  upsertNode(db, serverId, bankId, nodeId, node.labels || [], properties);

  return { success: true, applied: { nodeId, summary: properties.summary }, warnings };
}

function applyEntityCapabilities(db, serverId, bankId, model, output, timestamp) {
  const nodeId = parseNodeIdFromExtId(model.mm_ext_id, 'entity-capabilities-');
  if (!nodeId) {
    return { success: false, error: 'Cannot resolve node id from entity-capabilities ext_id', code: 'BAD_EXT_ID' };
  }

  const nodeResult = getNode(db, serverId, bankId, nodeId);
  if (!nodeResult?.success || !nodeResult.data) {
    return { success: false, error: `Node not found: ${nodeId}`, code: 'NODE_NOT_FOUND' };
  }
  const node = nodeResult.data;

  const warnings = [];
  if (output.narrative.trim()) {
    warnings.push('entity-capabilities model returned narrative; ignoring');
  }
  if (output.graph.nodes.length > 0 || output.graph.edges.length > 0) {
    warnings.push('entity-capabilities model returned graph data; ignoring');
  }

  const capabilitiesTable = output.tables.find((t) => t.name === 'capabilities');
  const capabilities = capabilitiesTable?.rows || [];
  if (output.tables.length > 0 && !capabilitiesTable) {
    warnings.push('entity-capabilities model returned tables other than capabilities; ignoring');
  }

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

  upsertNode(db, serverId, bankId, nodeId, node.labels || [], properties);

  return { success: true, applied: { nodeId, capabilities }, warnings };
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function applyEdgeContext(db, serverId, bankId, model, output, timestamp) {
  const pairPart = parseNodeIdFromExtId(model.mm_ext_id, 'edge-ctx-');
  if (!pairPart) {
    return { success: false, error: 'Cannot resolve pair from edge-ctx ext_id', code: 'BAD_EXT_ID' };
  }

  // The ext_id may be source|target or a sorted pair key.
  let sourceId;
  let targetId;
  if (pairPart.includes('|')) {
    const parts = pairPart.split('|');
    if (parts.length === 2) {
      [sourceId, targetId] = parts;
    }
  }

  if (!sourceId || !targetId) {
    return { success: false, error: 'edge-ctx ext_id does not contain a node pair', code: 'BAD_EXT_ID' };
  }

  const allEdgesResult = listEdges(db, serverId, bankId, { limit: 10000 });
  const allEdges = allEdgesResult?.success ? allEdgesResult.data : [];
  const matchingEdges = allEdges.filter((e) =>
    (e.cge_source_id === sourceId && e.cge_target_id === targetId) ||
    (e.cge_source_id === targetId && e.cge_target_id === sourceId)
  );

  if (matchingEdges.length === 0) {
    return { success: false, error: `No edge found for pair ${sourceId}|${targetId}`, code: 'EDGE_NOT_FOUND' };
  }

  const warnings = [];
  if (output.narrative.trim()) {
    warnings.push('edge-ctx model returned narrative; ignoring');
  }
  if (output.tables.length > 0) {
    warnings.push('edge-ctx model returned tables; ignoring');
  }

  // The model should return at least one edge whose from/to match the scope.
  // If multiple edges are returned, prefer one matching the scope direction.
  const candidateEdges = output.graph.edges.filter((edge) =>
    (edge.from === sourceId && edge.to === targetId) ||
    (edge.from === targetId && edge.to === sourceId)
  );

  if (candidateEdges.length === 0 && output.graph.edges.length > 0) {
    warnings.push(`edge-ctx model returned ${output.graph.edges.length} edge(s) that do not match the scope; ignoring`);
  }

  const modelRef = buildModelRef(model, output.raw, timestamp);
  const appliedEdges = [];

  for (const edgeRow of matchingEdges) {
    const scoped = candidateEdges.find((e) => e.from === edgeRow.cge_source_id && e.to === edgeRow.cge_target_id);
    const properties = {
      ...edgeRow.cge_properties,
      provenance: {
        ...(edgeRow.cge_properties?.provenance || {}),
        source: 'contextual-graph',
        model_refs: mergeModelRefs(edgeRow.cge_properties?.provenance?.model_refs, modelRef),
        updated_at: timestamp,
      },
      updated_at: timestamp,
    };

    if (scoped) {
      properties.label = scoped.label;
      properties.detail = scoped.detail;
      properties.evidence = scoped.evidence;
    }

    upsertEdge(
      db,
      serverId,
      bankId,
      edgeRow.cge_id,
      edgeRow.cge_source_id,
      edgeRow.cge_target_id,
      scoped ? scoped.type : edgeRow.cge_type,
      properties,
    );

    appliedEdges.push(edgeRow.cge_id);
  }

  return { success: true, applied: { edgeIds: appliedEdges }, warnings };
}

function applyDiscoveryContext(db, serverId, bankId, model, output, timestamp) {
  const seedId = parseNodeIdFromExtId(model.mm_ext_id, 'discover-');
  if (!seedId) {
    return { success: false, error: 'Cannot resolve seed id from discover ext_id', code: 'BAD_EXT_ID' };
  }

  const seedNodeResult = getNode(db, serverId, bankId, seedId);
  if (!seedNodeResult?.success || !seedNodeResult.data) {
    return { success: false, error: `Seed node not found: ${seedId}`, code: 'NODE_NOT_FOUND' };
  }
  const seedNode = seedNodeResult.data;

  const warnings = [];
  if (output.narrative.trim()) {
    warnings.push('discovery model returned narrative; ignoring');
  }

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
    if (refs.some((ref) => ref?.ext_id === model.mm_ext_id)) {
      deleteNode(db, serverId, bankId, node.cgn_id);
    }
  }

  // Upsert new discovered nodes and edges.
  const nodeIds = new Set([seedId]);
  let createdNodes = 0;
  let createdEdges = 0;

  for (const node of output.graph.nodes) {
    nodeIds.add(node.id);
    const discoveredProperties = {
      display_name: node.name,
      type: node.type,
      provenance: {
        source: 'contextual-graph',
        discovery: 'discovered',
        model_refs: [modelRef],
        updated_at: timestamp,
      },
      updated_at: timestamp,
    };
    upsertNode(db, serverId, bankId, node.id, ['candidate', 'active'], discoveredProperties);
    createdNodes += 1;
  }

  for (const edge of output.graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      warnings.push(`Discovery edge ${edge.from} -> ${edge.to} references a node not emitted by the model; skipping`);
      continue;
    }

    const edgeId = `discovered-${seedId}-${edge.from}-${edge.to}-${edge.type}`;
    const edgeProperties = {
      label: edge.label,
      detail: edge.detail,
      evidence: edge.evidence,
      provenance: {
        source: 'contextual-graph',
        discovery: 'discovered',
        model_refs: [modelRef],
        updated_at: timestamp,
      },
      updated_at: timestamp,
    };
    upsertEdge(db, serverId, bankId, edgeId, edge.from, edge.to, edge.type, edgeProperties);
    createdEdges += 1;
  }

  return { success: true, applied: { seedId, nodeCount: createdNodes, edgeCount: createdEdges }, warnings };
}
