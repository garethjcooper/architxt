import { stmt } from '../../cache.js';
import { dbExec, requireInt } from '../../utils/db-helpers.js';

const TABLE = 'document_tags';

// List all tags for a specific document
export const getDocumentTags = (db, docId) => dbExec(() => {
  const sql = `
    SELECT t.* FROM tags t
    JOIN ${TABLE} dt ON t.tag_id = dt.tag_id
    WHERE dt.doc_id = ?
  `;
  const rows = stmt(db, sql).all(requireInt('doc_id', docId));
  return rows;
}, 'document_tags.getDocumentTags');

// List all documents for a specific tag
export const getTagDocuments = (db, tagId) => dbExec(() => {
  const sql = `
    SELECT d.* FROM documents d
    JOIN ${TABLE} dt ON d.doc_id = dt.doc_id
    WHERE dt.tag_id = ?
  `;
  const rows = stmt(db, sql).all(requireInt('tag_id', tagId));
  return rows;
}, 'document_tags.getTagDocuments');

// Add a tag to a document
export const addDocumentTag = (db, docId, tagId) => dbExec(() => {
  const dId = requireInt('doc_id', docId);
  const tId = requireInt('tag_id', tagId);
  const sql = `INSERT INTO ${TABLE} (doc_id, tag_id) VALUES (?, ?)`;
  const result = stmt(db, sql).run(dId, tId);
  return { doc_id: dId, tag_id: tId };
}, 'document_tags.add');

// Remove a tag from a document
export const removeDocumentTag = (db, docId, tagId) => dbExec(() => {
  const dId = requireInt('doc_id', docId);
  const tId = requireInt('tag_id', tagId);
  const sql = `DELETE FROM ${TABLE} WHERE doc_id = ? AND tag_id = ?`;
  const result = stmt(db, sql).run(dId, tId);
  return result.changes > 0;
}, 'document_tags.remove');

// Remove all tags from a document
export const removeAllDocumentTags = (db, docId) => dbExec(() => {
  const dId = requireInt('doc_id', docId);
  const sql = `DELETE FROM ${TABLE} WHERE doc_id = ?`;
  const result = stmt(db, sql).run(dId);
  return result.changes;
}, 'document_tags.removeAll');

// Remove a tag from all documents
export const removeTagFromAllDocuments = (db, tagId) => dbExec(() => {
  const tId = requireInt('tag_id', tagId);
  const sql = `DELETE FROM ${TABLE} WHERE tag_id = ?`;
  const result = stmt(db, sql).run(tId);
  return result.changes;
}, 'document_tags.removeTagFromAll');

// Batch update tags for multiple documents (transactional)
export const batchUpdateDocumentTags = (db, docIds, tagsToAdd, tagsToRemove) => dbExec(() => {
  const ids = docIds.map((id) => requireInt('doc_id', id));
  let tagsAdded = 0;
  let tagsRemoved = 0;

  // Remove tags
  if (tagsToRemove && tagsToRemove.length > 0) {
    for (const rawTagId of tagsToRemove) {
      const tagId = requireInt('tag_id', rawTagId);
      const sql = `DELETE FROM ${TABLE} WHERE doc_id IN (${ids.map(() => '?').join(',')}) AND tag_id = ?`;
      const result = stmt(db, sql).run(...ids, tagId);
      tagsRemoved += result.changes;
    }
  }

  // Add tags
  if (tagsToAdd && tagsToAdd.length > 0) {
    for (const rawTagId of tagsToAdd) {
      const tagId = requireInt('tag_id', rawTagId);
      for (const docId of ids) {
        const sql = `INSERT OR IGNORE INTO ${TABLE} (doc_id, tag_id) VALUES (?, ?)`;
        try {
          stmt(db, sql).run(docId, tagId);
          tagsAdded++;
        } catch (err) {
          if (!err.message.includes('UNIQUE')) throw err;
        }
      }
    }
  }

  return { docsUpdated: ids.length, tagsAdded, tagsRemoved };
}, 'document_tags.batchUpdate');


/**
 * Fetch all document-tag associations for diff comparison
 * @param {Object} db
 * @returns {Promise<{success: true, data: Array}>}
 */
export const getAllDocumentTags = (db) => dbExec(() => {
  const sql = `
    SELECT dt.doc_id, t.tag_name
    FROM document_tags dt
    JOIN tags t ON dt.tag_id = t.tag_id
  `;
  return stmt(db, sql).all();
}, 'documentTags.getAll');

/**
 * Fetch tags for a specific document
 * @param {Object} db
 * @param {number} docId
 * @returns {Promise<{success: true, data: Array}>}
 */
export const getDocumentTagsByDocId = (db, docId) => dbExec(() => {
  const sql = `
    SELECT t.tag_name FROM tags t
    JOIN document_tags dt ON t.tag_id = dt.tag_id
    WHERE dt.doc_id = ?
  `;
  return stmt(db, sql).all(docId);
}, 'documentTags.getByDocId');
