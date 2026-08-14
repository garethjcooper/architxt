/**
 * Prebuilt handler for research discovery.
 *
 * Extracts explicit entity tokens from the query (or uses selections), fetches
 * matching mental models for the requested template role, and merges JSON results
 * into a graph while compiling narrative results into the narrative panel.
 */

import { db } from '../../../db/connection.js';
import { extractEntityIds } from '../tokens.js';
import { fetchPrebuiltMentalModels } from '../prebuilt-fetch.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('research-handler-prebuilt');

export async function handlePrebuilt(serverId, bankId, query, options = {}) {
  if (!serverId || !bankId || !query) {
    return { success: false, error: 'server_id, bank_id, and query are required', code: 'MISSING_PARAMS' };
  }

  const selections = options.selections || [];
  const entityIds = selections
    .filter((s) => s.kind === 'entity')
    .map((s) => (s.id ? String(s.id) : undefined))
    .filter(Boolean);

  // Fall back to extracting from query text if no explicit selections
  if (entityIds.length === 0) {
    entityIds.push(...extractEntityIds(query));
  }

  const role = options.role || 'sys_entity_summary';

  logger.info('Prebuilt research query', {
    serverId,
    bankId,
    entityCount: entityIds.length,
    role,
  });

  if (entityIds.length === 0) {
    return {
      success: false,
      error: 'Prebuilt mode requires at least one explicit entity token like [[Label (id)]].',
      code: 'MISSING_ENTITIES',
    };
  }

  const result = await fetchPrebuiltMentalModels(db, serverId, bankId, { entityIds, role });
  if (!result.success) {
    return result;
  }

  const { graph, narrative, missingEntityIds } = result;

  let finalNarrative = narrative || '';
  if (missingEntityIds.length > 0) {
    const missingNote = `\n\n_No mental model found for: ${missingEntityIds.join(', ')}_`;
    finalNarrative = finalNarrative ? finalNarrative + missingNote : missingNote.trim();
  }
  if (!finalNarrative) {
    finalNarrative = `Found mental-model data for ${graph.nodes.length} nodes and ${graph.edges.length} edges.`;
  }

  return {
    success: true,
    narrative: finalNarrative,
    graph,
    calls_used: ['list_mental_models'],
  };
}
