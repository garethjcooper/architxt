/**
 * Hindsight Service Client - Mental Model Push / Create
 *
 * - updateMentalModel: PATCH /v1/default/banks/{bank_id}/mental-models/{id}
 * - createMentalModel: POST  /v1/default/banks/{bank_id}/mental-models
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';
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

function buildPayload(model) {
  return {
    name: model.name || null,
    source_query: model.source_query || null,
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
 */
export async function pushMentalModel(serverId, bankId, model) {
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
    return { success: true };
  } catch (error) {
    logger.error('Hindsight pushMentalModel error', { serverId, bankId, extId: model.ext_id, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Create a new mental model on Hindsight (POST).
 */
export async function createMentalModel(serverId, bankId, model) {
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
      logger.error('Hindsight createMentalModel failed', { serverId, bankId, extId: model.ext_id, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight createMentalModel OK', { serverId, bankId, extId: model.ext_id });
    return { success: true };
  } catch (error) {
    logger.error('Hindsight createMentalModel error', { serverId, bankId, extId: model.ext_id, error: error.message });
    return { success: false, error: error.message };
  }
}
