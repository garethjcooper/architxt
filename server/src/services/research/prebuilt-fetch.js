/**
 * Prebuilt mental-model fetcher.
 *
 * Wraps mental-model discovery for the research Prebuilt query type and merges
 * discovered results into the shape expected by the prebuilt handler.
 */

import { discoverMentalModelsByRoles } from './mental-model-discovery.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('research-prebuilt-fetch');

/**
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} options
 * @param {string} [options.role='sys_entity_summary']
 * @param {string[]} [options.entityIds=[]]
 * @returns {Promise<{
 *   success: boolean,
 *   graph?: { nodes: object[], edges: object[] },
 *   narrative?: string,
 *   appliedEntityIds?: string[],
 *   missingEntityIds?: string[],
 *   error?: string,
 *   code?: string,
 *   errors?: string[]
 * }>}
 */
export async function fetchPrebuiltMentalModels(db, serverId, bankId, options = {}) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const role = options.role || 'sys_entity_summary';
  const entityIds = Array.isArray(options.entityIds) ? options.entityIds : [];

  const discovery = await discoverMentalModelsByRoles(db, serverId, bankId, {
    entities: entityIds,
    roles: [role],
    timeoutMs: options.timeoutMs,
  });

  if (!discovery.success) {
    return { success: false, error: discovery.error, code: discovery.code };
  }

  const roleResult = discovery.roles[role];
  if (!roleResult) {
    return { success: false, error: `Role '${role}' not found in discovery result`, code: 'ROLE_MISSING' };
  }

  const result = roleResult.result || {};
  const appliedEntityIds = new Set();

  if (result.graph) {
    const graphText = JSON.stringify(result.graph.nodes) + JSON.stringify(result.graph.edges);
    for (const id of entityIds) {
      if (graphText.includes(id)) appliedEntityIds.add(id);
    }
  }
  if (result.narrative) {
    for (const id of entityIds) {
      if (result.narrative.includes(id)) appliedEntityIds.add(id);
    }
  }

  const missingEntityIds = entityIds.length > 0
    ? entityIds.filter((id) => !appliedEntityIds.has(id))
    : [];

  logger.info('Merged prebuilt mental models', {
    role,
    foundCount: roleResult.found_count,
    missingCount: roleResult.missing_count,
    nodeCount: result.graph?.nodes?.length ?? 0,
    edgeCount: result.graph?.edges?.length ?? 0,
    appliedCount: appliedEntityIds.size,
    missingEntityCount: missingEntityIds.length,
  });

  return {
    success: true,
    graph: result.graph || { nodes: [], edges: [] },
    narrative: result.narrative || '',
    appliedEntityIds: Array.from(appliedEntityIds),
    missingEntityIds,
    errors: result.errors || [],
  };
}
