/**
 * System source-type tags.
 *
 * Every newly created document is stamped with one system tag matching its
 * source_type (forward-only; existing documents are not backfilled):
 *   document   -> ARCHITXT-DOC
 *   trace      -> ARCHITXT-TRACE
 *   repository -> ARCHITXT-REPO
 */
import { getOrCreateTagByName } from '../db/crud/tags.js';
import { batchUpdateDocumentTags } from '../db/crud/document-tags.js';

export const SYSTEM_SOURCE_TAGS = {
  document: 'ARCHITXT-DOC',
  trace: 'ARCHITXT-TRACE',
  repository: 'ARCHITXT-REPO',
};

export function systemTagNameForSourceType(sourceType) {
  return SYSTEM_SOURCE_TAGS[sourceType] || null;
}

/**
 * Stamp the system source-type tag on a document. Idempotent (INSERT OR IGNORE).
 * @param {Object} db - Database connection
 * @param {number} docId
 * @param {string} sourceType - 'document' | 'trace' | 'repository'
 * @returns {Promise<number|null>} tag_id applied, or null when no tag maps
 */
export async function applySystemSourceTag(db, docId, sourceType) {
  const name = systemTagNameForSourceType(sourceType);
  if (!name) return null;
  const tagId = getOrCreateTagByName(db, name, 'system').data;
  if (!tagId) return null;
  batchUpdateDocumentTags(db, [docId], [tagId], []);
  return tagId;
}
