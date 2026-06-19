/**
 * Hindsight Directive Pull Service
 *
 * Pulls a directive from a Hindsight server into architxt.
 */

import { createLogger } from '../../utils/logger.js';
import { db } from '../../db/connection.js';
import { getDirective as getHindsightDirective } from './directives.js';
import {
  getDirectiveByExtId,
  createDirective,
  updateDirective,
  addDirectiveTag,
} from '../../db/crud/directives.js';
import { createTag } from '../../db/crud/tags.js';

const logger = createLogger('hindsight-directive-pull');

/**
 * Resolve or create a tag by name.
 */
function resolveTagId(tagName) {
  const existing = db.prepare('SELECT tag_id FROM tags WHERE tag_name = ?').get(tagName);
  if (existing) return existing.tag_id;

  const tagResult = createTag(db, {
    tag_name: tagName,
    tag_generated_by: 'import'
  });
  return tagResult.success && tagResult.data ? tagResult.data : null;
}

/**
 * Replace all tags on a directive with the given tag names.
 */
function syncDirectiveTags(dirId, tagNames) {
  db.prepare('DELETE FROM directive_tags WHERE dir_id = ?').run(dirId);

  if (!tagNames || tagNames.length === 0) return;

  for (const tagName of tagNames) {
    const tagId = resolveTagId(tagName);
    if (!tagId) {
      logger.warn('syncDirectiveTags: tag creation failed', { tagName });
      continue;
    }
    addDirectiveTag(db, dirId, tagId);
  }
}

/**
 * Pull a single directive from Hindsight into architxt.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} directiveId - Hindsight directive id (ext_id)
 * @returns {Promise<{success: boolean, directive?: Object, error?: string, created: boolean}>}
 */
export async function pullDirective(serverId, bankId, directiveId) {
  logger.info('Pulling directive from Hindsight', { serverId, bankId, directiveId });

  const hindsightResult = await getHindsightDirective(serverId, bankId, directiveId);
  if (!hindsightResult.success) {
    logger.error('Hindsight getDirective failed', { serverId, bankId, directiveId, error: hindsightResult.error });
    return { success: false, error: hindsightResult.error };
  }

  const h = hindsightResult.directive;
  if (!h || !h.id) {
    return { success: false, error: 'Hindsight directive missing id' };
  }

  const name = h.name || '';
  const statement = h.content || '';
  const priority = h.priority ?? 0;
  const isActive = h.is_active === true;
  const tags = Array.isArray(h.tags) ? h.tags : [];

  if (!name) {
    return { success: false, error: 'Hindsight directive missing name' };
  }
  if (!statement) {
    return { success: false, error: 'Hindsight directive missing content' };
  }

  const existingResult = await getDirectiveByExtId(db, h.id);
  const existing = existingResult.success ? existingResult.data : null;

  if (existing) {
    logger.info('Updating existing architxt directive', { dirId: existing.dir_id, extId: h.id });

    const updateResult = await updateDirective(db, existing.dir_id, {
      dir_name: name,
      dir_statement: statement,
      dir_priority: priority,
      dir_is_active: isActive,
    });
    if (!updateResult.success) {
      return { success: false, error: updateResult.error };
    }

    syncDirectiveTags(existing.dir_id, tags);

    return { success: true, directive: existing, created: false };
  }

  logger.info('Creating new architxt directive from Hindsight', { extId: h.id });

  const createResult = await createDirective(db, {
    dir_ext_id: h.id,
    dir_name: name,
    dir_statement: statement,
    dir_priority: priority,
    dir_is_active: isActive,
    dir_generated_by: 'import',
  });
  if (!createResult.success) {
    return { success: false, error: createResult.error };
  }

  const newDirId = createResult.data;
  syncDirectiveTags(newDirId, tags);

  return { success: true, directive: { dir_id: newDirId }, created: true };
}
