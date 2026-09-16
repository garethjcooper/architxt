/**
 * Hindsight Service Client — Bank Config
 *
 * Fetches and updates a bank's configuration for push/pull synchronization
 * with Architxt master bank settings.
 *
 * GET {serviceUrl}/v1/default/banks/{bank_id}/config
 * PATCH {serviceUrl}/v1/default/banks/{bank_id}/config
 *
 * Note: the legacy /profile endpoints have been removed from Hindsight.
 * Disposition traits and reflect_mission now live in /config.
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-client');

/**
 * Normalize multiline text for stable comparison.
 * - Trims leading/trailing blank space
 * - Normalizes line endings to LF
 * - Removes trailing whitespace from each line
 * - Collapses multiple blank lines to a single blank line
 */
export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Extract disposition traits from a Hindsight config response.
 *
 * Hindsight exposes disposition as flat keys on the /config endpoint:
 * `{ disposition_empathy, disposition_literalism, disposition_skepticism }`.
 *
 * `null` or missing traits are coalesced to the neutral default `3`, because
 * that is the effective Hindsight value when no bank-specific override exists.
 * Only integer values in 1..5 are accepted for explicitly set traits.
 *
 * @param {Object} source - A Hindsight config object
 * @returns {{ empathy: number, literalism: number, skepticism: number } | null}
 */
export function extractHindsightDisposition(source) {
  if (!source || typeof source !== 'object') return null;

  const DEFAULT_NEUTRAL_TRAIT = 3;
  const isValidTrait = (v) => Number.isInteger(v) && v >= 1 && v <= 5;
  const resolveTrait = (v) => (isValidTrait(v) ? v : DEFAULT_NEUTRAL_TRAIT);

  if (
    source.disposition_empathy !== undefined ||
    source.disposition_literalism !== undefined ||
    source.disposition_skepticism !== undefined
  ) {
    return {
      empathy: resolveTrait(source.disposition_empathy),
      literalism: resolveTrait(source.disposition_literalism),
      skepticism: resolveTrait(source.disposition_skepticism),
    };
  }

  return null;
}

function buildHeaders(serverConfig) {
  const headers = { 'Content-Type': 'application/json' };
  if (serverConfig.apiKey) {
    headers['Authorization'] = `Bearer ${serverConfig.apiKey}`;
  }
  return headers;
}

/**
 * Fetch bank configuration from Hindsight server.
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @returns {Promise<{success: boolean, config?: Object, error?: string}>}
 */
export async function getBankConfig(serverId, bankId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/config`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getBankConfig failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const body = await response.json();
    logger.info('Hindsight getBankConfig OK', { serverId, bankId, url });
    return { success: true, config: body };
  } catch (error) {
    logger.error('Hindsight getBankConfig error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Fetch bank profile from Hindsight server (disposition traits live here).
 *
 * @param {number} serverId - Server ID from servers table
 * @param {string} bankId - Bank identifier
 * @returns {Promise<{success: boolean, profile?: Object, error?: string}>}
 */
export async function getBankProfile(serverId, bankId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/profile`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildHeaders(configResult.config),
    });

    if (response.status === 404) {
      // Older Hindsight servers may not expose a profile endpoint.
      return { success: true, profile: null };
    }
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight getBankProfile failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const body = await response.json();
    logger.info('Hindsight getBankProfile OK', { serverId, bankId, url });
    return { success: true, profile: body };
  } catch (error) {
    logger.error('Hindsight getBankProfile error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Patch bank configuration on Hindsight server.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} configUpdate - Object to send as the new `config` block
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function patchBankConfig(serverId, bankId, configUpdate) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/config`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: buildHeaders(configResult.config),
      body: JSON.stringify({ updates: configUpdate }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight patchBankConfig failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight patchBankConfig OK', { serverId, bankId, url });
    return { success: true };
  } catch (error) {
    logger.error('Hindsight patchBankConfig error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * Patch bank profile on Hindsight server.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} profileUpdate - Object to send as the new `profile` block
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function patchBankProfile(serverId, bankId, profileUpdate) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) return configResult;
  if (!bankId) return { success: false, error: 'bankId is required' };

  const { serviceUrl } = configResult.config;
  const url = `${serviceUrl}/v1/default/banks/${encodeURIComponent(bankId)}/profile`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: buildHeaders(configResult.config),
      body: JSON.stringify({ updates: profileUpdate }),
    });

    if (response.status === 404) {
      // If the profile endpoint is missing, treat it as a no-op rather than a hard failure.
      return { success: true, skipped: true };
    }
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Hindsight patchBankProfile failed', { serverId, bankId, status: response.status, error: errorText });
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    logger.info('Hindsight patchBankProfile OK', { serverId, bankId, url });
    return { success: true };
  } catch (error) {
    logger.error('Hindsight patchBankProfile error', { serverId, bankId, error: error.message });
    return { success: false, error: error.message };
  }
}
