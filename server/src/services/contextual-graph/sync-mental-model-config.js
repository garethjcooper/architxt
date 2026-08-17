import { listAllMentalModels } from '../../services/hindsight/mental-models.js';
import { pushMentalModel } from '../../services/hindsight/push-mental-model.js';
import { composeMentalModelPrompt } from '../../prompts/template-service.js';
import { buildMentalModelDivergence, hasDivergence } from '../../services/mental-model-divergence.js';
import { UNIFIED_RESPONSE_SCHEMA } from '../../services/contextual-graph/unified-response-schema.js';
import { createLogger } from '../../utils/logger.js';
import { getContextualGraphTemplate } from './template-models.js';
import { extractModelRefsFromDb } from './refresh-patches.js';
import { deriveSpecsForRefs } from './specs.js';

const logger = createLogger('contextual-graph-sync-mental-model-config');

function roleFromExtId(extId) {
  if (extId.startsWith('entity-summary-')) return 'sys_entity_summary';
  if (extId.startsWith('entity-capabilities-')) return 'sys_entity_capabilities';
  if (extId.startsWith('edge-ctx-')) return 'sys_edge_context';
  if (extId.startsWith('discover-')) return 'sys_discovery_context';
  return null;
}

function buildFallbackSpecFromTemplate(template, hind, role, extId) {
  return {
    ext_id: extId,
    role,
    name: hind.name || template.data.name || null,
    source_query: hind.source_query || template.data.source_query || '',
    max_tokens: template.data.max_tokens,
    refresh_mode: template.data.refresh_mode,
    refresh_after_consolidation: template.data.refresh_after_consolidation,
    exclude_all_mental_models: template.data.exclude_all_mental_models,
    exclude_mental_model_list: template.data.exclude_mental_model_list,
    tags_match_mode: template.data.tags_match_mode,
    tags: Array.isArray(hind.tags) ? hind.tags : [],
  };
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
    response_schema: UNIFIED_RESPONSE_SCHEMA,
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
    response_schema: hind.trigger?.response_schema || null,
  };
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
 * @returns {Promise<{success: boolean, stats: object, updatedExtIds: string[], error?: string}>}
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
    skippedNoSpec: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };
  const updatedExtIds = [];

  try {
    const refs = extractModelRefsFromDb(db, serverId, bankId);
    if (refs.size === 0) {
      return { success: true, stats, updatedExtIds };
    }

    const listResult = await listModels(serverId, bankId, { detail: 'content' });
    if (!listResult.success) {
      return { success: false, error: listResult.error, stats, updatedExtIds };
    }

    const hindByExtId = new Map();
    for (const mm of listResult.mentalModels || []) {
      if (mm.id) hindByExtId.set(mm.id, mm);
    }

    const derived = await deriveSpecsForRefs(db, serverId, bankId, refs);

    async function syncOne(extId, spec, reason) {
      const role = spec.role;
      stats.checked += 1;

      const template = getContextualGraphTemplate(db, role);
      if (!template?.data) {
        stats.skippedNoTemplate += 1;
        return;
      }

      const hind = hindByExtId.get(extId);
      if (!hind) {
        stats.skippedMissingRemote += 1;
        return;
      }

      try {
        // For existing Hindsight models, do not recompose the prompt body every
        // cycle. Local prompt/template drift would otherwise push the same model
        // repeatedly because Hindsight may normalize the stored query differently
        // than our composed output. Preserve the remote query and only patch
        // trigger-level config (schema, tokens, mode, tags, excludes).
        let composed;
        if (hind.source_query) {
          composed = hind.source_query;
        } else {
          composed = await composeMentalModelPrompt(db, role, spec.source_query);
        }
        const archCandidate = buildArchCandidate(spec, composed);
        const hindCandidate = buildHindCandidate(hind);
        const divergence = buildMentalModelDivergence(archCandidate, hindCandidate);
        const shouldPush = hasDivergence(divergence);

        logger.info('Checked contextual mental model config', {
          extId,
          role,
          reason,
          shouldPush,
          divergence,
          archResponseSchema: archCandidate.response_schema,
          hindResponseSchema: hindCandidate.response_schema,
        });

        if (!shouldPush) {
          stats.skippedNoChange += 1;
          return;
        }

        if (dryRun) {
          stats.updated += 1;
          updatedExtIds.push(extId);
          return;
        }

        const pushResult = await pushFn(serverId, bankId, { ...spec, composed_query: composed }, db);
        if (!pushResult.success) {
          stats.failed += 1;
          stats.errors.push({ extId, error: pushResult.error });
          logger.error('Failed to push contextual mental model config update', { extId, error: pushResult.error });
          return;
        }

        stats.updated += 1;
        updatedExtIds.push(extId);
        logger.info('Pushed contextual mental model config update', { extId, role, reason, status: pushResult.status, operationId: pushResult.operationId });
      } catch (err) {
        stats.failed += 1;
        stats.errors.push({ extId, error: err.message });
        logger.error('Failed to sync contextual mental model config', { extId, error: err.message });
      }
    }

    for (const { extId, spec } of derived) {
      await syncOne(extId, spec, 'derived');
    }

    for (const [extId, { ref }] of refs) {
      if (derived.some((d) => d.extId === extId)) continue;
      if (!hindByExtId.has(extId)) continue;
      const role = ref.role || roleFromExtId(extId);
      if (!role) continue;
      const template = getContextualGraphTemplate(db, role);
      if (!template?.data) continue;
      const fallbackSpec = buildFallbackSpecFromTemplate(template, hindByExtId.get(extId), role, extId);
      await syncOne(extId, fallbackSpec, 'fallback');
    }

    stats.skippedNoSpec = refs.size - derived.length;
    return { success: true, stats, updatedExtIds };
  } catch (err) {
    logger.error('syncContextualMentalModelConfig failed', { serverId, bankId, error: err.message });
    return { success: false, error: err.message, stats, updatedExtIds };
  }
}
