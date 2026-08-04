import { listAllMentalModels } from '../../services/hindsight/mental-models.js';
import { pushMentalModel } from '../../services/hindsight/push-mental-model.js';
import { getNode, listNodes, listEdges } from '../../db/crud/contextual-graph.js';
import { composeMentalModelPrompt } from '../../prompts/template-service.js';
import { buildMentalModelDivergence, hasDivergence } from '../../services/mental-model-divergence.js';
import { createLogger } from '../../utils/logger.js';
import {
  getContextualGraphTemplate,
  deriveEntitySummaryModel,
  deriveEntityCapabilitiesModel,
  deriveEdgeContextModel,
  deriveDiscoverContextModel,
} from './template-models.js';
import { extractModelRefsFromDb } from './refresh-patches.js';

const logger = createLogger('contextual-graph-sync-mental-model-config');

const ROLE_HANDLERS = [
  { role: 'sys_entity_summary', prefix: 'entity-summary-' },
  { role: 'sys_entity_capabilities', prefix: 'entity-capabilities-' },
  { role: 'sys_edge_context', prefix: 'edge-ctx-' },
  { role: 'sys_discovery_context', prefix: 'discover-' },
];

function inferRole(extId) {
  for (const { role, prefix } of ROLE_HANDLERS) {
    if (extId?.startsWith(prefix)) return role;
  }
  return null;
}

function parseNodeIdFromExtId(extId, prefix) {
  if (!extId?.startsWith(prefix)) return null;
  return extId.slice(prefix.length);
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function buildArchCandidate(spec, composed) {
  return {
    name: spec.name || null,
    composed_query: composed,
    max_tokens: spec.max_tokens || 2048,
    refresh_mode: spec.refresh_mode || 'delta',
    refresh_after_consolidation: spec.refresh_after_consolidation ?? false,
    exclude_all_mental_models: spec.exclude_all_mental_models ?? false,
    exclude_mental_model_list: spec.exclude_mental_model_list || '',
    tags_match_mode: spec.tags_match_mode || 'any',
    tags: Array.isArray(spec.tags) ? spec.tags : [],
  };
}

function buildHindCandidate(hind) {
  return {
    name: hind.name || null,
    source_query: hind.source_query || null,
    max_tokens: hind.max_tokens,
    refresh_mode: hind.trigger?.mode || 'delta',
    refresh_after_consolidation: !!hind.trigger?.refresh_after_consolidation,
    exclude_all_mental_models: !!hind.trigger?.exclude_mental_models,
    exclude_mental_model_ids: Array.isArray(hind.trigger?.exclude_mental_model_ids) ? hind.trigger.exclude_mental_model_ids : [],
    tags_match_mode: hind.trigger?.tags_match || 'any',
    tags: Array.isArray(hind.tags) ? hind.tags : [],
  };
}

async function deriveSpecFromRef(db, ref, bankId) {
  const role = inferRole(ref.ext_id);
  const template = getContextualGraphTemplate(db, role);
  if (!template?.data) {
    throw new Error(`Missing system template for role ${role}`);
  }

  if (role === 'sys_entity_summary') {
    const nodeId = parseNodeIdFromExtId(ref.ext_id, 'entity-summary-');
    const node = getNode(db, ref.server_id, bankId, nodeId)?.data;
    return deriveEntitySummaryModel(db, {
      id: nodeId,
      displayName: node?.cgn_properties?.display_name || nodeId,
    }, bankId);
  }

  if (role === 'sys_entity_capabilities') {
    const nodeId = parseNodeIdFromExtId(ref.ext_id, 'entity-capabilities-');
    const node = getNode(db, ref.server_id, bankId, nodeId)?.data;
    return deriveEntityCapabilitiesModel(db, {
      id: nodeId,
      displayName: node?.cgn_properties?.display_name || nodeId,
    }, bankId);
  }

  if (role === 'sys_edge_context') {
    const pairPart = parseNodeIdFromExtId(ref.ext_id, 'edge-ctx-');
    if (!pairPart?.includes('|')) {
      throw new Error(`edge-ctx ext_id does not contain a node pair: ${ref.ext_id}`);
    }
    const [sourceId, targetId] = pairPart.split('|');
    const nodes = listNodes(db, ref.server_id, bankId, { limit: 10000 })?.data || [];
    const sourceNode = nodes.find((n) => n.cgn_id === sourceId);
    const targetNode = nodes.find((n) => n.cgn_id === targetId);
    return deriveEdgeContextModel(db, {
      id: sourceId,
      displayName: sourceNode?.cgn_properties?.display_name || sourceId,
    }, {
      id: targetId,
      displayName: targetNode?.cgn_properties?.display_name || targetId,
    }, bankId);
  }

  if (role === 'sys_discovery_context') {
    const seedId = parseNodeIdFromExtId(ref.ext_id, 'discover-');
    const seedNode = getNode(db, ref.server_id, bankId, seedId)?.data;
    return deriveDiscoverContextModel(db, {
      id: seedId,
      displayName: seedNode?.cgn_properties?.display_name || seedId,
    }, [], bankId);
  }

  throw new Error(`Unsupported contextual-graph role: ${role}`);
}

/**
 * Sync the Hindsight-side configuration of all contextual mental models that
 * are referenced by the local working graph. Re-derives each spec from the
 * current system template in the DB, compares it to the live Hindsight model,
 * and pushes an update when they diverge.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false]
 * @param {Function} [options.listAllMentalModels]
 * @param {Function} [options.pushMentalModel]
 * @returns {Promise<{success: boolean, stats: object, error?: string}>}
 */
export async function syncContextualMentalModelConfig(db, serverId, bankId, options = {}) {
  const dryRun = options.dryRun === true;
  const listModels = options.listAllMentalModels || listAllMentalModels;
  const pushFn = options.pushMentalModel || pushMentalModel;

  const stats = {
    checked: 0,
    skippedNoChange: 0,
    skippedMissingRemote: 0,
    skippedNoTemplate: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  try {
    const refs = extractModelRefsFromDb(db, serverId, bankId);
    if (refs.size === 0) {
      return { success: true, stats };
    }

    const listResult = await listModels(serverId, bankId, { detail: 'content' });
    if (!listResult.success) {
      return { success: false, error: listResult.error, stats };
    }

    const hindByExtId = new Map();
    for (const mm of listResult.mentalModels || []) {
      if (mm.id) hindByExtId.set(mm.id, mm);
    }

    for (const [extId, scope] of refs) {
      const role = inferRole(extId);
      if (!role) continue;

      stats.checked += 1;

      const template = getContextualGraphTemplate(db, role);
      if (!template?.data) {
        stats.skippedNoTemplate += 1;
        continue;
      }

      const hind = hindByExtId.get(extId);
      if (!hind) {
        stats.skippedMissingRemote += 1;
        continue;
      }

      try {
        const spec = await deriveSpecFromRef(db, { ext_id: extId, server_id: serverId }, bankId);
        const composed = await composeMentalModelPrompt(db, role, spec.source_query);
        const archCandidate = buildArchCandidate(spec, composed);
        const hindCandidate = buildHindCandidate(hind);
        const divergence = buildMentalModelDivergence(archCandidate, hindCandidate);

        if (!hasDivergence(divergence)) {
          stats.skippedNoChange += 1;
          continue;
        }

        if (dryRun) {
          stats.updated += 1;
          continue;
        }

        const pushResult = await pushFn(serverId, bankId, { ...spec, composed_query: composed }, db);
        if (!pushResult.success) {
          stats.failed += 1;
          stats.errors.push({ extId, error: pushResult.error });
          logger.error('Failed to push contextual mental model config update', { extId, error: pushResult.error });
          continue;
        }

        stats.updated += 1;
        logger.info('Pushed contextual mental model config update', { extId, role });
      } catch (err) {
        stats.failed += 1;
        stats.errors.push({ extId, error: err.message });
        logger.error('Failed to sync contextual mental model config', { extId, error: err.message });
      }
    }

    return { success: true, stats };
  } catch (err) {
    logger.error('syncContextualMentalModelConfig failed', { serverId, bankId, error: err.message });
    return { success: false, error: err.message, stats };
  }
}
