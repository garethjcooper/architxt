import { listAllMentalModels } from '../../services/hindsight/mental-models.js';
import { refreshMentalModel } from '../../services/hindsight/mental-models.js';
import { listNodes, getNode, listEdges, getEdge, upsertNode, upsertEdge, findEdgeByEndpoints } from '../../db/crud/contextual-graph.js';
import { normalizeModelOutput, contentHash } from './normalize-model-output.js';
import { applyModelOutput } from './apply-model-output.js';
import { createLogger } from '../../utils/logger.js';
import { CONTEXTUAL_GRAPH_ROLES } from './template-models.js';

const logger = createLogger('contextual-graph-refresh-patches');

function getModelContent(model) {
  const structuredOutput = model?.reflect_response?.structured_output;
  if (structuredOutput && typeof structuredOutput === 'object') {
    return structuredOutput;
  }
  throw new Error(`Mental model ${model?.id} has no reflect_response.structured_output`);
}

function getModelContentHashSource(model) {
  // Use the markdown content as the stable source for the hash so we detect
  // changes even if Hindsight's structured representation shifts slightly.
  if (typeof model?.content === 'string') return model.content;
  return JSON.stringify(model?.reflect_response?.structured_output || '');
}

function buildLocalModel(model, scope) {
  const refRole = scope?.ref?.role;
  if (!refRole || !Object.values(CONTEXTUAL_GRAPH_ROLES).includes(refRole)) {
    throw new Error(`Cannot build local model without known role: ${refRole}`);
  }
  return {
    mm_ext_id: model.id,
    mm_template_role: refRole,
    mm_dimension: refRole,
    mm_name: model.name || model.id,
    scope: scope?.ref?.scope,
  };
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function edgeContentEqual(props, modelEdge) {
  const label = modelEdge.label ?? '';
  const detail = modelEdge.detail ?? '';
  return (props.label ?? '') === label && (props.detail ?? '') === detail;
}

/**
 * Compare the normalized model output against the current working-graph state.
 * Returns true when the working graph does not match the model (i.e. should apply).
 *
 * Divergence is checked generically based on which envelope fields the model
 * produced, not on hardcoded role-specific mappings. Narrative is compared
 * against node.summary; tables are compared against node.capabilities; graph
 * edges are looked up in the working graph by endpoints and content.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {{type: 'node'|'edge', id: string, ref: object}} scope
 * @param {object} output - normalized model output
 * @returns {boolean}
 */
function hasDivergence(db, serverId, bankId, scope, output) {
  // Empty output = nothing to apply
  if (!output.narrative && output.graph.edges.length === 0 && output.tables.length === 0) {
    return false;
  }

  if (scope.type === 'node') {
    const current = scope.node?.properties || {};

    // Narrative divergence against summary
    if (output.narrative !== undefined && current.summary !== output.narrative) {
      return true;
    }

    // Table divergence against capabilities
    if (output.tables.length > 0) {
      const capabilitiesTable = output.tables.find((t) => t.name === 'capabilities');
      const modelCapabilities = capabilitiesTable?.rows || [];
      if (!arraysEqual(current.capabilities || [], modelCapabilities)) {
        return true;
      }
    }

    // Graph-edge divergence (e.g. edge-ctx model whose ref is attached to an endpoint node)
    if (output.graph.edges.length > 0) {
      for (const modelEdge of output.graph.edges) {
        if (!modelEdge.from || !modelEdge.to || !modelEdge.type) continue;
        const findResult = findEdgeByEndpoints(db, serverId, bankId, modelEdge.from, modelEdge.to, modelEdge.type);
        const existing = findResult?.success ? findResult.data : null;
        if (!existing) return true;
        if (!edgeContentEqual(existing.cge_properties || {}, modelEdge)) return true;
      }
      return false;
    }

    return false;
  }

  if (scope.type === 'edge') {
    if (output.graph.edges.length === 0) return true;

    for (const modelEdge of output.graph.edges) {
      if (!modelEdge.from || !modelEdge.to || !modelEdge.type) continue;
      const findResult = findEdgeByEndpoints(db, serverId, bankId, modelEdge.from, modelEdge.to, modelEdge.type);
      const existing = findResult?.success ? findResult.data : null;
      if (!existing) return true;
      if (!edgeContentEqual(existing.cge_properties || {}, modelEdge)) return true;
    }
    return false;
  }

  // Unknown scope type: if there is any output, consider diverged
  return true;
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
      if (!ref?.ext_id || !ref?.role) continue;
      byExtId.set(ref.ext_id, { type: 'node', id: node.cgn_id, ref, node });
    }
  }

  const edgesResult = listEdges(db, serverId, bankId, { limit: 100000 });
  const edges = edgesResult?.success ? edgesResult.data : [];
  for (const edge of edges) {
    const refs = edge.cge_properties?.provenance?.model_refs || [];
    for (const ref of refs) {
      if (!ref?.ext_id || !ref?.role) continue;
      byExtId.set(ref.ext_id, { type: 'edge', id: edge.cge_id, ref, edge });
    }
  }

  return byExtId;
}

function updateRefOnScope(db, serverId, bankId, scope, ref, timestamp, refreshState = {}) {
  const { status, error } = refreshState;
  const updatedRef = {
    ...ref,
    fetched_at: timestamp,
    attached_at: ref.attached_at || timestamp,
    last_refresh_at: timestamp,
  };
  if (status) {
    updatedRef.last_refresh_status = status;
    if (status === 'ok') {
      delete updatedRef.last_refresh_error;
    } else if (error) {
      updatedRef.last_refresh_error = error;
    }
  }
  if (ref.content_hash) updatedRef.content_hash = ref.content_hash;

  if (scope.type === 'node') {
    const nodeResult = getNode(db, serverId, bankId, scope.id);
    const node = nodeResult?.success ? nodeResult.data : null;
    if (!node) return;
    scope.node = node;
    const provenance = { ...(node.properties?.provenance || {}) };
    const refs = provenance.model_refs || [];
    const idx = refs.findIndex((r) => r.ext_id === ref.ext_id);
    if (idx >= 0) {
      refs[idx] = updatedRef;
    } else {
      refs.push(updatedRef);
    }
    provenance.model_refs = refs;
    const properties = { ...node.properties, provenance, updated_at: timestamp };
    upsertNode(db, serverId, bankId, node.cgn_id, node.labels || [], properties);
    return;
  }

  const edgeResult = getEdge(db, serverId, bankId, scope.id);
  const edge = edgeResult?.success ? edgeResult.data : null;
  if (!edge) return;
  scope.edge = edge;
  const provenance = { ...(edge.cge_properties?.provenance || {}) };
  const refs = provenance.model_refs || [];
  const idx = refs.findIndex((r) => r.ext_id === ref.ext_id);
  if (idx >= 0) {
    refs[idx] = updatedRef;
  } else {
    refs.push(updatedRef);
  }
  provenance.model_refs = refs;
  const properties = { ...edge.cge_properties, provenance, updated_at: timestamp };
  upsertEdge(db, serverId, bankId, edge.cge_id, edge.cge_source_id, edge.cge_target_id, edge.cge_type, properties);
}

/**
 * Refresh contextual-graph patches from Hindsight.
 *
 * Fetches mental models (detail=full) for every model_ref attached to the local
 * graph, compares normalized output against current working-graph state, and applies
 * only when they diverge. Disabled roles are skipped but still get fetched_at updated.
 *
 * If `rerunExtIds` is provided, the function asks Hindsight to regenerate those
 * models before fetching their content. This is the explicit step required when the
 * prompt/config changed: pushing a config update does not automatically produce new
 * content, so the caller must request a refresh for changed models.
 *
 * If `newlyDeployedExtIds` is provided, those models are skipped without error and
 * marked as `pending_build` on the local scope. They were just submitted to Hindsight
 * and are not expected to have usable content yet, so attempting to fetch would only
 * produce "can not read envelope" errors. The next refresh (or poll daemon) will
 * pick them up once they are ready.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - when true, compare but do not apply.
 * @param {string[]} [options.rerunExtIds=[]] - ext_ids to refresh in Hindsight before fetch.
 * @param {string[]} [options.newlyDeployedExtIds=[]] - ext_ids that were just deployed and
 *   whose Hindsight content is not yet ready. They are skipped without error and marked
 *   as 'pending_build' on the local scope so a later refresh can fetch them.
 * @param {Function} [options.listAllMentalModels]
 * @param {Function} [options.refreshMentalModel]
 * @returns {Promise<{success: boolean, stats: object, error?: string}>}
 */
export async function refreshContextualGraphPatches(db, serverId, bankId, options = {}) {
  const dryRun = options.dryRun === true;
  const rerunExtIds = Array.isArray(options.rerunExtIds) ? options.rerunExtIds : [];
  const newlyDeployedExtIds = new Set(
    Array.isArray(options.newlyDeployedExtIds) ? options.newlyDeployedExtIds : [],
  );
  const timestamp = new Date().toISOString();
  const listModels = options.listAllMentalModels || listAllMentalModels;
  const refreshFn = options.refreshMentalModel || refreshMentalModel;

  const stats = {
    fetched: 0,
    matched: 0,
    skippedUnchanged: 0,
    skippedBuilding: 0,
    applied: 0,
    failed: 0,
    rerunRequested: 0,
    rerunCompleted: 0,
    rerunFailed: 0,
    rerunPending: 0,
    errors: [],
  };

  try {
    const localRefs = extractModelRefsFromDb(db, serverId, bankId);
    if (localRefs.size === 0) {
      return { success: true, stats };
    }

    // Mark any models that were deployed in this sync as still building. We do
    // this before the Hindsight list so we don't accidentally treat a missing
    // entry as a failure, and so the next refresh knows these need content.
    for (const extId of newlyDeployedExtIds) {
      const scope = localRefs.get(extId);
      if (!scope) continue;
      stats.skippedBuilding += 1;
      updateRefOnScope(db, serverId, bankId, scope, scope.ref, timestamp, {
        status: 'pending_build',
        error: 'Model is still building after initial deploy',
      });
    }

    // Explicitly request fresh Hindsight output for models whose config just changed.
    // A prompt/config change does not automatically regenerate content; this is the
    // caller's way of saying "these models need to run under the new config".
    // Mental-model refresh is long-running and async; refreshMentalModel records a
    // pending_operations row so the existing Hindsight poll daemon monitors it.
    // We do not inline-poll here; the UI should poll pending operations (or simply
    // call refresh again after a reasonable delay) to fetch the refreshed content.
    for (const extId of rerunExtIds) {
      if (!localRefs.has(extId)) continue;
      stats.rerunRequested += 1;
      const refreshResult = await refreshFn(serverId, bankId, extId);
      if (!refreshResult.success) {
        stats.rerunFailed += 1;
        stats.errors.push({ extId, error: refreshResult.error, phase: 'rerun' });
        logger.error('Failed to queue contextual mental model re-run', { extId, error: refreshResult.error });
        continue;
      }

      // If the refresh already completed synchronously (unusual, but possible if
      // Hindsight returns a terminal status), reflect that. Otherwise it is
      // pending and the daemon will update it.
      if (['completed', 'success', 'done'].includes(refreshResult.status)) {
        stats.rerunCompleted += 1;
      } else {
        stats.rerunPending += 1;
      }
    }

    // We now fetch whatever content is currently available. Re-run operations that
    // are still pending will not yet have fresh content; the caller can refresh
    // again once the daemon marks those operations completed.
    const listResult = await listModels(serverId, bankId, { detail: 'full' });
    if (!listResult.success) {
      return { success: false, error: listResult.error, stats };
    }

    const models = listResult.mentalModels || [];
    stats.fetched = models.length;

    for (const model of models) {
      const scope = localRefs.get(model.id);
      if (!scope) continue;
      stats.matched += 1;

      // Skip models that were just deployed in this sync; their Hindsight content
      // is not expected to be ready yet. They are already marked pending_build above.
      if (newlyDeployedExtIds.has(model.id)) {
        continue;
      }

      let content;
      try {
        content = getModelContent(model);
      } catch (err) {
        stats.failed += 1;
        const error = `Missing structured output: ${err.message}`;
        stats.errors.push({ extId: model.id, error });
        updateRefOnScope(db, serverId, bankId, scope, scope.ref, timestamp, { status: 'error', error });
        logger.warn('Mental model has no structured output; treating as failed', { extId: model.id, error: err.message });
        continue;
      }

      const newHash = contentHash(getModelContentHashSource(model));

      // Dry-run still fetches and normalizes, but never applies.
      if (dryRun) {
        updateRefOnScope(db, serverId, bankId, scope, { ...scope.ref, content_hash: newHash }, timestamp, { status: 'ok' });
        continue;
      }

      const output = normalizeModelOutput(content);
      if (output.errors.length > 0) {
        stats.failed += 1;
        const error = output.errors.map((e) => (typeof e === 'string' ? e : e.message)).join('; ');
        stats.errors.push({ extId: model.id, errors: output.errors });
        updateRefOnScope(db, serverId, bankId, scope, scope.ref, timestamp, { status: 'error', error });
        logger.warn('Normalized output has errors; treating as failed', { extId: model.id, errors: output.errors });
        continue;
      }

      const oldHash = scope.ref.content_hash;
      const hashChanged = !oldHash || oldHash !== newHash;
      const diverged = hasDivergence(db, serverId, bankId, scope, output);

      if (!hashChanged && !diverged) {
        stats.skippedUnchanged += 1;
        updateRefOnScope(db, serverId, bankId, scope, { ...scope.ref, content_hash: newHash }, timestamp, { status: 'ok' });
        continue;
      }

      const localModel = buildLocalModel(model, scope);
      const applyResult = await applyModelOutput(db, serverId, bankId, localModel, output, { now: timestamp });
      if (!applyResult.success) {
        stats.failed += 1;
        const error = applyResult.error || applyResult.code || 'apply failed';
        stats.errors.push({ extId: model.id, error: applyResult.error, code: applyResult.code });
        updateRefOnScope(db, serverId, bankId, scope, scope.ref, timestamp, { status: 'error', error });
        logger.error('Failed to apply contextual model output', { extId: model.id, error: applyResult.error });
        continue;
      }

      // Record the new content hash + fetched_at on the scope.
      const updatedRef = { ...scope.ref, content_hash: newHash, fetched_at: timestamp, attached_at: scope.ref.attached_at || timestamp };
      updateRefOnScope(db, serverId, bankId, scope, updatedRef, timestamp, { status: 'ok' });
      stats.applied += 1;
    }

    return { success: true, stats };
  } catch (err) {
    logger.error('refreshContextualGraphPatches failed', { serverId, bankId, error: err.message });
    return { success: false, error: err.message, stats };
  }
}
