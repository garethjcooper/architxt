/**
 * Hindsight Service Client - Health Check
 *
 * GET {server_url}/health
 */

import { createLogger } from '../../utils/logger.js';
import { getServerConfig } from './config.js';

const logger = createLogger('hindsight-client');

/**
 * Health check - GET {server_url}/health
 * Returns service status and version info
 *
 * @param {number} serverId - Server ID from servers table
 * @returns {Promise<{
 *   success: boolean,
 *   healthy?: boolean,
 *   version?: string,
 *   status?: string,
 *   error?: string
 * }>}
 */
export async function healthCheck(serverId) {
  const configResult = await getServerConfig(serverId);
  if (!configResult.success) {
    return configResult;
  }
  
  const { serviceUrl } = configResult.config;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${serviceUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn('Hindsight health check failed', {
        serverId,
        status: response.status,
        statusText: response.statusText,
      });
      return { success: true, healthy: false };
    }

    const data = await response.json();

    logger.debug('Hindsight health check passed', {
      serverId,
      version: data.version,
      status: data.status,
    });

    return {
      success: true,
      healthy: true,
      version: data.version,
      status: data.status,
    };
  } catch (error) {
    logger.error('Hindsight health check error', { serverId, error: error.message });
    return { success: true, healthy: false };
  }
}