import { createMentalModel, pushMentalModel } from '../../services/hindsight/push-mental-model.js';
import { composeMentalModelPrompt } from '../../prompts/template-service.js';
import { createLogger } from '../../utils/logger.js';

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
 * @returns {Promise<{success: boolean, model_id?: string, operationId?: string|null, status?: string|null, popId?: number|null, error?: string, code?: string}>}
 */
export async function deployMentalModel(db, serverId, bankId, spec) {
  if (!spec?.ext_id) {
    return { success: false, error: 'mental model spec requires ext_id', code: 'MISSING_EXT_ID' };
  }

  try {
    // Contextual-graph prompts are looked up by mm_template_role, not by mm_returns.
    const composed = await composeMentalModelPrompt(db, spec.role, spec.source_query);
    const modelForPush = {
      ...spec,
      composed_query: composed,
      refresh_mode: 'delta',
      refresh_after_consolidation: false,
      exclude_all_mental_models: false,
      tags_match_mode: 'any',
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
 * @returns {Promise<{success: true, deployed: string[], failed: {ext_id: string, error: string, code?: string}[]}>}
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
