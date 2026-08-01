import { createMentalModel as createMentalModelRow, getMentalModelIdByExtId, updateMentalModel } from '../../db/crud/mental-models.js';
import { syncMentalModelTags, addMentalModelEntity } from '../../db/crud/mental-models.js';
import { createMentalModel as createHindsightModel, pushMentalModel } from '../../services/hindsight/push-mental-model.js';
import { composeMentalModelPrompt } from '../../prompts/template-service.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('contextual-graph-deploy-models');

/**
 * Ensure a mental model row exists in Architxt and push it to Hindsight.
 *
 * If the model already exists (by ext_id), update the source_query and push an
 * update. Otherwise create a new row + push to Hindsight.
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
 * @returns {Promise<{success: boolean, model_id?: string, error?: string, code?: string}>}
 */
export async function deployMentalModel(db, serverId, bankId, spec) {
  if (!spec?.ext_id) {
    return { success: false, error: 'mental model spec requires ext_id', code: 'MISSING_EXT_ID' };
  }

  try {
    const composed = await composeMentalModelPrompt(db, spec.returns, spec.source_query);
    const modelForPush = {
      ...spec,
      composed_query: composed,
      refresh_mode: 'delta',
      refresh_after_consolidation: false,
      exclude_all_mental_models: false,
      tags_match_mode: 'any',
    };

    const existingId = getMentalModelIdByExtId(db, spec.ext_id);
    if (existingId) {
      updateMentalModel(db, existingId, {
        mm_name: spec.name,
        mm_source_query: spec.source_query,
        mm_returns: spec.returns,
        mm_dimension: spec.dimension,
        mm_max_tokens: spec.max_tokens,
      });
      await syncMentalModelTags(db, existingId, spec.tags);

      const pushResult = await pushMentalModel(serverId, bankId, modelForPush);
      if (!pushResult.success) {
        return { success: false, error: pushResult.error, code: 'HINDSIGHT_PUSH_FAILED' };
      }
      return { success: true, model_id: spec.ext_id };
    }

    const mmId = createMentalModelRow(db, {
      mm_ext_id: spec.ext_id,
      mm_name: spec.name,
      mm_source_query: spec.source_query,
      mm_returns: spec.returns,
      mm_dimension: spec.dimension,
      mm_max_tokens: spec.max_tokens,
    });
    await syncMentalModelTags(db, mmId, spec.tags);

    const pushResult = await createHindsightModel(serverId, bankId, modelForPush);
    if (!pushResult.success) {
      return { success: false, error: pushResult.error, code: 'HINDSIGHT_CREATE_FAILED' };
    }
    return { success: true, model_id: spec.ext_id };
  } catch (err) {
    logger.error('deployMentalModel failed', { extId: spec.ext_id, error: err.message });
    return { success: false, error: err.message, code: 'DEPLOY_FAILED' };
  }
}

/**
 * Deploy a batch of mental model specs.
 *
 * @returns {Promise<{success: true, deployed: string[], failed: {ext_id: string, error: string}[]}>}
 */
export async function deployMentalModelBatch(db, serverId, bankId, specs) {
  const deployed = [];
  const failed = [];

  for (const spec of specs) {
    const result = await deployMentalModel(db, serverId, bankId, spec);
    if (result.success) {
      deployed.push(result.model_id);
    } else {
      failed.push({ ext_id: spec.ext_id, error: result.error, code: result.code });
    }
  }

  return { success: true, deployed, failed };
}
