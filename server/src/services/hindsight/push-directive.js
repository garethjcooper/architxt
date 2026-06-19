/**
 * Hindsight Directive Push Service
 *
 * Pushes an architxt directive to a Hindsight bank.
 */

import { createLogger } from '../../utils/logger.js';
import { db } from '../../db/connection.js';
import { getDirective as getArchitxtDirective } from '../../db/crud/directives.js';
import { updateDirectiveExtId } from '../../db/crud/directives.js';
import { pushDirective as updateHindsightDirective, createDirective as createHindsightDirective } from './directives.js';
import { stmt } from '../../cache.js';

const logger = createLogger('hindsight-directive-push');

/**
 * Fetch a directive with full tag names for push.
 */
function getDirectiveWithTags(dirId) {
  const result = getArchitxtDirective(db, dirId);
  if (!result || !result.success || !result.data) return null;
  const directive = result.data;

  const tagRows = stmt(db, `
    SELECT t.tag_name FROM tags t
    JOIN directive_tags dt ON t.tag_id = dt.tag_id
    WHERE dt.dir_id = ?
  `).all(dirId);

  return {
    ...directive,
    tags: tagRows.map((r) => r.tag_name),
  };
}

/**
 * Push an architxt directive to Hindsight.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {number} dirId - architxt directive id
 * @returns {Promise<{success: boolean, ext_id?: string, error?: string}>}
 */
export async function pushDirective(serverId, bankId, dirId) {
  logger.info('Pushing directive to Hindsight', { serverId, bankId, dirId });

  const directive = getDirectiveWithTags(dirId);
  if (!directive) {
    return { success: false, error: `Directive ${dirId} not found` };
  }

  const payload = {
    name: directive.dir_name || null,
    statement: directive.dir_statement || null,
    priority: directive.dir_priority ?? 0,
    is_active: directive.dir_is_active === 'true',
    tags: directive.tags,
  };

  // Existing directive on bank — PATCH by ext_id
  if (directive.dir_ext_id) {
    const result = await updateHindsightDirective(serverId, bankId, { ...payload, ext_id: directive.dir_ext_id });
    if (!result.success) {
      return result;
    }
    logger.info('Directive push update OK', { serverId, bankId, dirId, extId: directive.dir_ext_id });
    return { success: true, ext_id: directive.dir_ext_id };
  }

  // New directive on bank — POST and store returned id locally
  const result = await createHindsightDirective(serverId, bankId, payload);
  if (!result.success) {
    return result;
  }

  const returnedId = result.directive?.id;
  if (!returnedId) {
    logger.error('Hindsight createDirective returned no id', { serverId, bankId, dirId, response: result.directive });
    return { success: false, error: 'Hindsight did not return directive id' };
  }

  const updateResult = await updateDirectiveExtId(db, dirId, returnedId);
  if (!updateResult.success) {
    logger.error('Failed to store returned ext_id after push', { serverId, bankId, dirId, returnedId, error: updateResult.error });
    return { success: false, error: `Push succeeded but failed to store ext_id: ${updateResult.error}` };
  }

  logger.info('Directive push create OK', { serverId, bankId, dirId, extId: returnedId });
  return { success: true, ext_id: returnedId };
}
