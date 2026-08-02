/**
 * Hindsight Service Client - Mental Model Push / Create
 *
 * - updateMentalModel: PATCH /v1/default/banks/{bank_id}/mental-models/{id}
 * - createMentalModel: POST  /v1/default/banks/{bank_id}/mental-models
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';
import { createPendingOperation } from '../../db/crud/pending-operations.js';
import {
  normaliseRefreshMode,
  normaliseTagsMatchMode,
  normaliseMaxTokens,
  toDbBool,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REFRESH_MODE,
  DEFAULT_TAGS_MATCH_MODE,
} from '../../db/crud/mental-models.js';

const logger = createLogger('hindsight-mental-model-push');

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

function normalizeCsv(value) {
  if (value == null || value === '') return [];
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Record a Hindsight operation in pending_operations so the poll daemon and UI
 * can track async build progress. Silently skips if no operation id or db.
 *
 * @param {Object|null} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} extId
 * @param {string|null|undefined} operationId
 * @param {string|null|undefined} status
 * @param {string} action
 * @returns {{success: boolean, popId?: number|null, error?: string}}
 */
function trackPendingOperation(db, serverId, bankId, extId, operationId, status, action) {
  if (!db || !operationId) {
    return { success: true, popId: null };
  }

  const pendingResult = createPendingOperation(db, {
    pop_operation_id: operationId,
    pop_server_id: serverId,
    pop_bank_id: bankId,
    pop_ext_id: extId,
    pop_action: action,
    pop_status: status || 'pending',
  });

  if (!pendingResult.success) {
    logger.warn('Failed to persist pending operation for mental model push', {
      serverId, bankId, extId, operationId, error: pendingResult.error, code: pendingResult.code,
    });
    return { success: false, error: pendingResult.error, popId: null };
  }

  return { success: true, popId: pendingResult.data };
}

function buildPayload(model) {
  if (typeof model.composed_query !== 'string' || model.composed_query.trim() === '') {
    throw new Error(`mental model ${model.ext_id || model.name || '(unknown)'} is missing composed_query; refusing to push raw source_query`);
  }

  return {
    name: model.name || null,
    source_query: model.composed_query,
    tags: Array.isArray(model.tags) ? model.tags : [],
    max_tokens: normaliseMaxTokens(model.max_tokens) ?? DEFAULT_MAX_TOKENS,
    trigger: {
      mode: normaliseRefreshMode(model.refresh_mode) ?? DEFAULT_REFRESH_MODE,
      refresh_after_consolidation: toDbBool(model.refresh_after_consolidation) === 'true',
      exclude_mental_models: toDbBool(model.exclude_all_mental_models) === 'true',
      exclude_mental_model_ids: normalizeCsv(model.exclude_mental_model_list),
      tags_match: normaliseTagsMatchMode(model.tags_match_mode) ?? DEFAULT_TAGS_MATCH_MODE,
    },
  };
}

async function getConfig(serverId, bankId, model, label) {
  if (!model || !model.ext_id) {
    return { success: false, error: 'mental model ext_id is required' };
  }

  logger.info(`${label} mental model on Hindsight`, {
    serverId,
    bankId,
    extId: model.ext_id,
    isDerived: model.is_derived === true,
  });

  const configResult = await getServerConfig(serverId);
  if (!configResult.success) {
    return { success: false, error: configResult.error };
  }

  return {
    success: true,
    config: configResult.config,
    baseUrl: `${configResult.config.serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/mental-models`,
    payload: buildPayload(model),
  };
}

/**
 * Update an existing mental model on Hindsight (PATCH by id).
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} model
 * @param {Object} [db] - Optional database connection; if provided, a pending_operations row is created for async tracking.
 * @returns {Promise<{success: boolean, operationId?: string|null, status?: string|null, popId?: number|null, error?: string}>}
 */
export async function pushMentalModel(serverId, bankId, model, db) {
  const setup = await getConfig(serverId, bankId, model, 'Updating');
  if (!setup.success) return setup;

  const url = `${setup.baseUrl}/${encodeURIComponent(model.ext_id)}`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: buildHeaders(setup.config),
      body: JSON.stringify(setup.payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight pushMentalModel failed', { serverId, bankId, extId: model.ext_id, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight pushMentalModel OK', { serverId, bankId, extId: model.ext_id });
    const data = await response.json().catch(() => ({}));
    const operationId = data.operation_id || data.operationId || null;
    const status = data.status || null;

    const tracking = trackPendingOperation(db, serverId, bankId, model.ext_id, operationId, status, 'push');

    return {
      success: true,
      operationId,
      status,
      popId: tracking.popId ?? null,
    };
  } catch (error) {
    logger.error('Hindsight pushMentalModel error', { serverId, bankId, extId: model.ext_id, error: error.message });
    return { success: false, error: error.message };
  }
}

function isConflictResponse(status, errorText) {
  if (status === 409) return true;
  if (typeof errorText !== 'string') return false;
  const normalised = errorText.toLowerCase();
  return (
    normalised.includes('already exists') ||
    normalised.includes('conflict') ||
    normalised.includes('duplicate')
  );
}

/**
 * Create a new mental model on Hindsight (POST).
 *
 * If the model already exists, fall back to pushMentalModel (PATCH) so the
 * local caller can treat the operation as a relink/update rather than a hard
 * failure. This prevents contextual-graph Add Context from orphaning nodes/edges
 * when the generated mental model is already present on Hindsight.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} model
 * @param {Object} [db] - Optional database connection; if provided, pending rows are created for async tracking.
 * @returns {Promise<{success: boolean, operationId?: string|null, status?: string|null, popId?: number|null, error?: string}>}
 */
export async function createMentalModel(serverId, bankId, model, db) {
  const setup = await getConfig(serverId, bankId, model, 'Creating');
  if (!setup.success) return setup;

  const createPayload = { id: model.ext_id, ...setup.payload };

  try {
    const response = await fetch(setup.baseUrl, {
      method: 'POST',
      headers: buildHeaders(setup.config),
      body: JSON.stringify(createPayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      const preview = errorText.slice(0, 500);

      if (isConflictResponse(response.status, errorText)) {
        logger.info('Hindsight createMentalModel conflict; falling back to PATCH', { serverId, bankId, extId: model.ext_id, status: response.status });
        return pushMentalModel(serverId, bankId, model, db);
      }

      logger.error('Hindsight createMentalModel failed', { serverId, bankId, extId: model.ext_id, status: response.status, error: preview });
      return { success: false, error: `HTTP ${response.status}: ${preview}` };
    }

    logger.info('Hindsight createMentalModel OK', { serverId, bankId, extId: model.ext_id });
    const data = await response.json().catch(() => ({}));
    const operationId = data.operation_id || data.operationId || null;
    const status = data.status || null;

    const tracking = trackPendingOperation(db, serverId, bankId, model.ext_id, operationId, status, 'push');

    return {
      success: true,
      operationId,
      status,
      popId: tracking.popId ?? null,
    };
  } catch (error) {
    logger.error('Hindsight createMentalModel error', { serverId, bankId, extId: model.ext_id, error: error.message });
    return { success: false, error: error.message };
  }
}
