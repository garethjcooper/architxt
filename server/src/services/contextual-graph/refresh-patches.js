import { listAllMentalModels } from '../../services/hindsight/mental-models.js';
import { listNodes, listEdges, upsertNode, upsertEdge, getNode, getEdge } from '../../db/crud/contextual-graph.js';
import { normalizeModelOutput, contentHash } from './normalize-model-output.js';
import { applyModelOutput } from './apply-model-output.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('contextual-graph-refresh-patches');

const ROLE_PREFIXES = [
  { role: 'sys_entity_summary', prefix: 'entity-summary-' },
  { role: 'sys_entity_capabilities', prefix: 'entity-capabilities-' },
  { role: 'sys_edge_context', prefix: 'edge-ctx-' },
  { role: 'sys_discovery_context', prefix: 'discover-' },
];

function inferRole(extId) {
  for (const { role, prefix } of ROLE_PREFIXES) {
    if (extId?.startsWith(prefix)) return role;
  }
  return null;
}

function getModelContent(model) {
  if (typeof model?.content === 'string' && model.content.length > 0) {
    return model.content;
  }
  throw new Error(`Mental model ${model?.id} has no content`);
}

function buildLocalModel(model) {
  return {
    mm_ext_id: model.id,
    mm_template_role: inferRole(model.id),
    mm_dimension: inferRole(model.id),
    mm_name: model.name || model.id,
  };
}

/**
 * Extract all contextual-graph model_refs attached to nodes and edges in the bank.
 *
 * @returns {Map<string, {type: 'node'|'edge', id: string, ref: object}>}
 */
export function extractModelRefsFromDb(db, serverId, bankId) {
  const byExtId = new Map();

  const nodesResult = listNodes(db, serverId, bankId, { limit: 100000 });
  const nodes = nodesResult?.success ? nodesResult.data : [];
  for (const node of nodes) {
    const refs = node.properties?.provenance?.model_refs || [];
    for (const ref of refs) {
      if (!ref?.ext_id || !inferRole(ref.ext_id)) continue;
      byExtId.set(ref.ext_id, { type: 'node', id: node.cgn_id, ref });
    }
  }

  const edgesResult = listEdges(db, serverId, bankId, { limit: 100000 });
  const edges = edgesResult?.success ? edgesResult.data : [];
  for (const edge of edges) {
    const refs = edge.cge_properties?.provenance?.model_refs || [];
    for (const ref of refs) {
      if (!ref?.ext_id || !inferRole(ref.ext_id)) continue;
      byExtId.set(ref.ext_id, { type: 'edge', id: edge.cge_id, ref });
    }
  }

  return byExtId;
}

function updateRefTimestampOnScope(db, serverId, bankId, scope, ref, timestamp) {
  if (scope.type === 'node') {
    const nodeResult = getNode(db, serverId, bankId, scope.id);
    const node = nodeResult?.success ? nodeResult.data : null;
    if (!node) return;
    const provenance = { ...(node.properties?.provenance || {}) };
    const refs = provenance.model_refs || [];
    const existing = refs.find((r) => r.ext_id === ref.ext_id);
    if (existing) {
      existing.fetched_at = timestamp;
      if (ref.content_hash) existing.content_hash = ref.content_hash;
    } else {
      refs.push({ ...ref, fetched_at: timestamp });
    }
    provenance.model_refs = refs;
    const properties = { ...node.properties, provenance, updated_at: timestamp };
    upsertNode(db, serverId, bankId, node.cgn_id, node.labels || [], properties);
    return;
  }

  const edgeResult = getEdge(db, serverId, bankId, scope.id);
  const edge = edgeResult?.success ? edgeResult.data : null;
  if (!edge) return;
  const provenance = { ...(edge.cge_properties?.provenance || {}) };
  const refs = provenance.model_refs || [];
  const existing = refs.find((r) => r.ext_id === ref.ext_id);
  if (existing) {
    existing.fetched_at = timestamp;
    if (ref.content_hash) existing.content_hash = ref.content_hash;
  } else {
    refs.push({ ...ref, fetched_at: timestamp });
  }
  provenance.model_refs = refs;
  const properties = { ...edge.cge_properties, provenance, updated_at: timestamp };
  upsertEdge(db, serverId, bankId, edge.cge_id, edge.cge_source_id, edge.cge_target_id, edge.cge_type, properties);
}

/**
 * Refresh contextual-graph patches from Hindsight.
 *
 * Fetches mental models (detail=full) for every model_ref attached to the local
 * graph, compares content_hash, normalizes the output, and applies it when it
 * has changed. Disabled roles are skipped but still get their fetched_at updated.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - when true, compare hashes but do not apply.
 * @returns {Promise<{success: boolean, stats: object, error?: string}>}
 */
export async function refreshContextualGraphPatches(db, serverId, bankId, options = {}) {
  const dryRun = options.dryRun === true;
  const timestamp = new Date().toISOString();
  const patchRoles = config.contextualGraph?.patchRoles || {};
  const listModels = options.listAllMentalModels || listAllMentalModels;

  const stats = {
    fetched: 0,
    matched: 0,
    skippedDisabled: 0,
    skippedUnchanged: 0,
    applied: 0,
    failed: 0,
    errors: [],
  };

  try {
    const localRefs = extractModelRefsFromDb(db, serverId, bankId);
    if (localRefs.size === 0) {
      return { success: true, stats };
    }

    const listResult = await listModels(serverId, bankId, { detail: 'content' });
    if (!listResult.success) {
      return { success: false, error: listResult.error, stats };
    }

    const models = listResult.mentalModels || [];
    stats.fetched = models.length;

    for (const model of models) {
      const scope = localRefs.get(model.id);
      if (!scope) continue;
      stats.matched += 1;

      const role = inferRole(model.id);
      const enabled = patchRoles[role] === true;

      if (!enabled) {
        stats.skippedDisabled += 1;
        updateRefTimestampOnScope(db, serverId, bankId, scope, scope.ref, timestamp);
        continue;
      }

      const content = getModelContent(model);
      const newHash = contentHash(content);
      const oldHash = scope.ref.content_hash;

      if (oldHash && oldHash === newHash) {
        stats.skippedUnchanged += 1;
        updateRefTimestampOnScope(db, serverId, bankId, scope, scope.ref, timestamp);
        continue;
      }

      if (dryRun) {
        updateRefTimestampOnScope(db, serverId, bankId, scope, scope.ref, timestamp);
        continue;
      }

      const localModel = buildLocalModel(model);
      const output = normalizeModelOutput(content);
      if (output.errors.length > 0) {
        logger.warn('Normalized output has errors', { extId: model.id, errors: output.errors });
      }

      const applyResult = await applyModelOutput(db, serverId, bankId, localModel, output, { now: timestamp });
      if (!applyResult.success) {
        stats.failed += 1;
        stats.errors.push({ extId: model.id, error: applyResult.error, code: applyResult.code });
        logger.error('Failed to apply contextual model output', { extId: model.id, error: applyResult.error });
        continue;
      }

      // Record the new content hash + fetched_at on the scope.
      const updatedRef = { ...scope.ref, content_hash: newHash, fetched_at: timestamp, attached_at: scope.ref.attached_at || timestamp };
      updateRefTimestampOnScope(db, serverId, bankId, scope, updatedRef, timestamp);
      stats.applied += 1;
    }

    return { success: true, stats };
  } catch (err) {
    logger.error('refreshContextualGraphPatches failed', { serverId, bankId, error: err.message });
    return { success: false, error: err.message, stats };
  }
}
