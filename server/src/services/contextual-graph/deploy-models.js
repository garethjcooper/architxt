import { createMentalModel } from '../../services/hindsight/push-mental-model.js';
import { composeMentalModelPromptBatch } from '../../prompts/template-service.js';
import { getMentalModel } from '../../services/hindsight/mental-models.js';
import { buildMentalModelDivergence, hasDivergence } from '../../services/mental-model-divergence.js';
import { createLogger } from '../../utils/logger.js';
import { UNIFIED_RESPONSE_SCHEMA } from '../../services/contextual-graph/unified-response-schema.js';

const logger = createLogger('contextual-graph-deploy-models');

/**
 * Deploy a single contextual-graph mental model to Hindsight.
 *
 * No local mental_models row is created per instance; the working graph node/edge
 * properties record the model ext_id as provenance.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} spec
 * @param {string} spec.ext_id
 * @param {string} spec.name
 * @param {string} spec.source_query
 * @param {string} spec.returns
 * @param {string} spec.dimension
 * @param {number} spec.max_tokens
 * @param {string[]} spec.tags
 * @param {string} spec.composed - pre-composed prompt text (batch caller must supply)
 * @returns {Promise<{success: boolean, model_id?: string, operationId?: string|null, status?: string|null, popId?: number|null, error?: string, code?: string}>}
 */
export async function deployMentalModel(db, serverId, bankId, spec, composed) {
  if (!spec?.ext_id) {
    return { success: false, error: 'mental model spec requires ext_id', code: 'MISSING_EXT_ID' };
  }

  try {
    // Build the local candidate the same way /hindsight/diff builds arch rows.
    const archCandidate = {
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

    // Prompt-drift guard: skip re-pushing if Hindsight already has an identical model.
    const existingResult = await getMentalModel(serverId, bankId, spec.ext_id, { detail: 'content' });
    if (existingResult.success && existingResult.mentalModel) {
      const hind = existingResult.mentalModel;
      const hindCandidate = {
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
      const divergence = buildMentalModelDivergence(archCandidate, hindCandidate);
      if (!hasDivergence(divergence)) {
        logger.info('Skipping unchanged contextual mental model', { extId: spec.ext_id, role: spec.role });
        return { success: true, model_id: spec.ext_id, skipped: true, divergence };
      }
    }

    const modelForPush = {
      ...spec,
      composed_query: composed,
      refresh_mode: spec.refresh_mode || 'delta',
      refresh_after_consolidation: spec.refresh_after_consolidation ?? false,
      exclude_all_mental_models: spec.exclude_all_mental_models ?? false,
      tags_match_mode: spec.tags_match_mode || 'any',
    };

    const pushResult = await createMentalModel(serverId, bankId, modelForPush, db);
    if (!pushResult.success) {
      return { success: false, error: pushResult.error, code: 'HINDSIGHT_CREATE_FAILED' };
    }
    return {
      success: true,
      model_id: spec.ext_id,
      operationId: pushResult.operationId || null,
      status: pushResult.status || null,
      popId: pushResult.popId || null,
    };
  } catch (err) {
    logger.error('deployMentalModel failed', { extId: spec.ext_id, error: err.message });
    return { success: false, error: err.message, code: 'DEPLOY_FAILED' };
  }
}

/**
 * Deploy a batch of mental model specs to Hindsight.
 *
 * @returns {Promise<{success: true, composed: string[], pushed: string[], unchanged: string[], failed: {ext_id: string, error: string, code?: string}[]}>}
 */
export async function deployMentalModelBatch(db, serverId, bankId, specs) {
  const composed = [];
  const pushed = [];
  const failed = [];
  const unchanged = [];

  const composeInputs = specs.map((spec) => ({ role: spec.role, source_query: spec.source_query }));
  const composedResults = await composeMentalModelPromptBatch(db, composeInputs);

  for (let i = 0; i < specs.length; i += 1) {
    const spec = specs[i];
    const composedQuery = composedResults[i]?.composed_query ?? null;
    if (!composedQuery) {
      failed.push({
        ext_id: spec.ext_id,
        error: composedResults[i]?.compose_error || 'Failed to compose prompt',
        code: 'COMPOSE_FAILED',
      });
      continue;
    }
    const result = await deployMentalModel(db, serverId, bankId, spec, composedQuery);
    if (result.success) {
      composed.push(result.model_id);
      if (result.skipped) {
        unchanged.push(result.model_id);
      } else {
        pushed.push(result.model_id);
      }
    } else {
      failed.push({ ext_id: spec.ext_id, error: result.error, code: result.code });
    }
  }

  return { success: true, composed, pushed, unchanged, failed };
}
