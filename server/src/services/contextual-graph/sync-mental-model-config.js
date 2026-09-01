import { listAllMentalModels } from '../../services/hindsight/mental-models.js';
import { pushMentalModel } from '../../services/hindsight/push-mental-model.js';
import { composeMentalModelPromptBatch } from '../../prompts/template-service.js';
import { buildMentalModelDivergence, hasDivergence } from '../../services/mental-model-divergence.js';
import { UNIFIED_RESPONSE_SCHEMA } from '../../services/contextual-graph/unified-response-schema.js';
import { createLogger } from '../../utils/logger.js';
import { getContextualGraphTemplate } from './template-models.js';
import { extractModelRefsFromDb } from './refresh-patches.js';
import { deriveSpecsForRefs } from './specs.js';

const logger = createLogger('contextual-graph-sync-mental-model-config');

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
 * Build the desired local candidate for a contextual-graph mental model.
 *
 * The desired state is always derived from the current system template and the
 * current working-graph node/edge. If the backing graph element is gone or no
 * longer qualifies, `deriveSpecForRef` returns null and this model is skipped.
 * No Hindsight-owned source_query is preserved.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Map<string, {type: 'node'|'edge', id: string, ref: object}>} refsByExtId
 * @returns {Promise<Array<{extId: string, spec: object}>>}
 */
async function buildDesiredSpecs(db, serverId, bankId, refsByExtId) {
  return deriveSpecsForRefs(db, serverId, bankId, refsByExtId);
}

/**
 * Sync the Hindsight-side configuration of all contextual mental models that
 * are referenced by the local working graph. Re-derives each desired spec from
 * the current system template and graph state, compares it to the live
 * Hindsight model, and pushes an update when they diverge.
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
    skippedNoBacking: 0,
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

    const desired = await buildDesiredSpecs(db, serverId, bankId, refs);
    stats.skippedNoSpec = refs.size - desired.length;

    // Compose all desired prompts in one batch to avoid repeated template/entity
    // catalog lookups. The batch helper keys templates by role.
    const composeInputs = desired.map(({ spec }) => ({ role: spec.role, source_query: spec.source_query }));
    const composedResults = await composeMentalModelPromptBatch(db, composeInputs);

    async function syncOne(entry, composed) {
      const { extId, spec } = entry;
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
        const archCandidate = buildArchCandidate(spec, composed);
        const hindCandidate = buildHindCandidate(hind);
        const divergence = buildMentalModelDivergence(archCandidate, hindCandidate);
        const shouldPush = hasDivergence(divergence);

        logger.info('Checked contextual mental model config', {
          extId,
          role,
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
        logger.info('Pushed contextual mental model config update', { extId, role, status: pushResult.status, operationId: pushResult.operationId });
      } catch (err) {
        stats.failed += 1;
        stats.errors.push({ extId, error: err.message });
        logger.error('Failed to sync contextual mental model config', { extId, error: err.message });
      }
    }

    for (let i = 0; i < desired.length; i += 1) {
      await syncOne(desired[i], composedResults[i]?.composed_query ?? null);
    }

    return { success: true, stats, updatedExtIds };
  } catch (err) {
    logger.error('syncContextualMentalModelConfig failed', { serverId, bankId, error: err.message });
    return { success: false, error: err.message, stats, updatedExtIds };
  }
}
