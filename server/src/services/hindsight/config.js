/**
 * Hindsight Service Client - Config Helper
 *
 * Reads server configuration from database
 */

import { getServer } from '../../db/crud/servers.js';
import { db } from '../../db/connection.js';

/**
 * Get hindsight server configuration from database
 * @param {number} serverId - Server ID from servers table
 * @returns {Promise<{success: boolean, config?: Object, error?: string}>}
 */
export async function getServerConfig(serverId) {
  const result = await getServer(db, serverId);
  
  if (!result.success) {
    return { success: false, error: result.error };
  }
  
  if (!result.data) {
    return { success: false, error: `Server ${serverId} not found` };
  }
  
  const server = result.data;
  
  if (!server.svr_base_url) {
    return { success: false, error: `Server ${serverId} has no base_url configured` };
  }
  
  return {
    success: true,
    config: {
      serviceUrl: server.svr_base_url,
      apiKey: server.svr_api_key,
      apiVersion: server.svr_api_version,
    }
  };
}