import { stmt } from '../../cache.js';
import { dbExec, requireInt } from '../../utils/db-helpers.js';

const TABLE = 'document_metadata';

// ---------------------------------------------------------------------------
// System metadata expanders — compute per-document values for system presets
// ---------------------------------------------------------------------------

/** Maps system preset keys to functions that extract live values from a document row */
const DOCUMENT_FIELD_EXPANDERS = {
  'architxt-document-full-path': (doc) => doc.doc_full_path,
  'architxt-file-name':          (doc) => doc.doc_filename,
  'architxt-document-date':      (doc) => doc.doc_timestamp,
  'architxt-author': (doc) => {
    if (!doc.doc_authors) return null;
    try {
      const parsed = JSON.parse(doc.doc_authors);
      return Array.isArray(parsed) ? parsed.join(', ') : String(parsed);
    } catch {
      return String(doc.doc_authors);
    }
  },
  'architxt-document-size': (doc) => {
    if (!doc.doc_content) return null;
    const bytes = doc.doc_content.length;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  },
  'architxt-tags': (doc, db) => {
    const sql = `
      SELECT t.tag_name FROM document_tags dt
      JOIN tags t ON dt.tag_id = t.tag_id
      WHERE dt.doc_id = ?
    `;
    const rows = stmt(db, sql).all(doc.doc_id);
    return rows.map(r => r.tag_name).join(', ') || null;
  },
  'architxt-entities': (doc, db) => {
    if (!doc.doc_content) return null;
    // Active format: v2-single → [[MatchedText (EntityId)]]
    const regex = /\[\[(.*?)\s*(?:\(([^)]*)\))?\]\]/g;
    const ids = new Set();
    let m;
    while ((m = regex.exec(doc.doc_content)) !== null) {
      const paren = m[2];
      if (paren) {
        const trimmed = paren.trim();
        if (trimmed.includes(',')) {
          // v1-dual: "name, id" → id is the second part
          const parts = trimmed.split(',').map((s) => s.trim());
          if (parts[1]) ids.add(parts[1]);
        } else {
          // v2-single: "entityId"
          if (trimmed) ids.add(trimmed);
        }
      }
    }
    if (ids.size === 0) return null;

    // Look up entity types for the discovered IDs
    const idList = Array.from(ids);
    const placeholders = idList.map(() => '?').join(',');
    const sql = `
      SELECT e.ent_entity_id, t.et_type_name
      FROM entities e
      JOIN entity_types t ON e.ent_type_id = t.et_id
      WHERE e.ent_entity_id IN (${placeholders})
    `;
    const rows = stmt(db, sql).all(...idList);

    // Build prefix map: entity_id → type abbreviation
    const prefixMap = new Map();
    for (const row of rows) {
      prefixMap.set(row.ent_entity_id, row.et_type_name);
    }

    return idList
      .map((id) => {
        const prefix = prefixMap.get(id);
        return prefix ? `${prefix}:${id}` : id;
      })
      .join(', ');
  },
  'architxt-entity-match-pattern': (doc) => {
    // Return the regex pattern used to detect entity tags in doc_content
    // Matches both v1-dual [[Text (name, id)]] and v2-single [[Text (id)]]
    if (!doc.doc_content) return null;
    return '\\[\\[(.*?)\\s*(?:\\(([^)]*)\\))?\\]\\]';
  },
};

// List all metadata for a specific document
export const getDocumentMetadata = (db, docId) => dbExec(() => {
  const sql = `
    SELECT m.* FROM metadata m
    JOIN ${TABLE} dm ON m.meta_id = dm.meta_id
    WHERE dm.doc_id = ?
  `;
  const rows = stmt(db, sql).all(requireInt('doc_id', docId));
  return rows;
}, 'document_metadata.getDocumentMetadata');

/**
 * Get expanded metadata for a document — returns only metadata that is
 * actually linked to the document, but computes live values for system
 * presets from the document's current fields.
 *
 * @param {Object} db — better-sqlite3 database instance
 * @param {number} docId — document ID
 * @param {Object} [docRow] — optional pre-fetched document row (avoids extra query)
 * @returns {Array} metadata rows with an `expanded` boolean flag
 */
export const getExpandedDocumentMetadata = (db, docId, docRow) => dbExec(() => {
  const dId = requireInt('doc_id', docId);

  // 1. Fetch the document row (need full_path, filename, timestamp, authors, content, etc.)
  let doc = docRow;
  if (!doc) {
    const docSql = `
      SELECT doc_id, doc_full_path, doc_filename, doc_timestamp,
             doc_authors, doc_content
      FROM documents WHERE doc_id = ?
    `;
    doc = stmt(db, docSql).get(dId);
    if (!doc) return []; // Document not found
  } else if (doc.doc_id !== dId) {
    // Sanity check: if caller passes a mismatched row, fall back to DB
    const docSql = `
      SELECT doc_id, doc_full_path, doc_filename, doc_timestamp,
             doc_authors, doc_content
      FROM documents WHERE doc_id = ?
    `;
    doc = stmt(db, docSql).get(dId);
    if (!doc) return [];
  }

  // 2. All metadata linked to this document (via junction table)
  const linkedSql = `
    SELECT m.* FROM metadata m
    JOIN ${TABLE} dm ON m.meta_id = dm.meta_id
    WHERE dm.doc_id = ?
  `;
  const rows = stmt(db, linkedSql).all(dId);

  // 3. For system presets, compute live values from document fields.
  //    If a system expander returns null/undefined (value not available),
  //    omit the row entirely — never fall back to the seed placeholder.
  return rows.map((row) => {
    if (row.meta_generated_by !== 'system') {
      return { ...row, expanded: 0 };
    }
    const expander = DOCUMENT_FIELD_EXPANDERS[row.meta_key];
    if (!expander) {
      return { ...row, expanded: 0 };
    }
    const expandedValue = expander(doc, db);
    if (expandedValue === null || expandedValue === undefined) {
      return null; // Filtered out below
    }
    return {
      ...row,
      meta_value: expandedValue,
      expanded: 1,
    };
  }).filter(Boolean);
}, 'document_metadata.getExpanded');

// List all documents for a specific metadata entry
export const getMetadataDocuments = (db, metaId) => dbExec(() => {
  const sql = `
    SELECT d.* FROM documents d
    JOIN ${TABLE} dm ON d.doc_id = dm.doc_id
    WHERE dm.meta_id = ?
  `;
  const rows = stmt(db, sql).all(requireInt('meta_id', metaId));
  return rows;
}, 'document_metadata.getMetadataDocuments');

// Add metadata to a document
export const addDocumentMetadata = (db, docId, metaId) => dbExec(() => {
  const dId = requireInt('doc_id', docId);
  const mId = requireInt('meta_id', metaId);
  const sql = `INSERT INTO ${TABLE} (doc_id, meta_id) VALUES (?, ?)`;
  const result = stmt(db, sql).run(dId, mId);
  return { doc_id: dId, meta_id: mId };
}, 'document_metadata.add');

// Remove metadata from a document
export const removeDocumentMetadata = (db, docId, metaId) => dbExec(() => {
  const dId = requireInt('doc_id', docId);
  const mId = requireInt('meta_id', metaId);
  const sql = `DELETE FROM ${TABLE} WHERE doc_id = ? AND meta_id = ?`;
  const result = stmt(db, sql).run(dId, mId);
  return result.changes > 0;
}, 'document_metadata.remove');

// Remove all metadata from a document
export const removeAllDocumentMetadata = (db, docId) => dbExec(() => {
  const dId = requireInt('doc_id', docId);
  const sql = `DELETE FROM ${TABLE} WHERE doc_id = ?`;
  const result = stmt(db, sql).run(dId);
  return result.changes;
}, 'document_metadata.removeAll');

// Remove metadata from all documents
export const removeMetadataFromAllDocuments = (db, metaId) => dbExec(() => {
  const mId = requireInt('meta_id', metaId);
  const sql = `DELETE FROM ${TABLE} WHERE meta_id = ?`;
  const result = stmt(db, sql).run(mId);
  return result.changes;
}, 'document_metadata.removeMetadataFromAll');

// Batch update metadata for multiple documents (transactional)
export const batchUpdateDocumentMetadata = (db, docIds, metadataToAdd, metadataToRemove) => dbExec(() => {
  const ids = docIds.map((id) => requireInt('doc_id', id));
  let metadataAdded = 0;
  let metadataRemoved = 0;

  // Remove metadata
  if (metadataToRemove && metadataToRemove.length > 0) {
    for (const rawMetaId of metadataToRemove) {
      const metaId = requireInt('meta_id', rawMetaId);
      const sql = `DELETE FROM ${TABLE} WHERE doc_id IN (${ids.map(() => '?').join(',')}) AND meta_id = ?`;
      const result = stmt(db, sql).run(...ids, metaId);
      metadataRemoved += result.changes;
    }
  }

  // Add metadata
  if (metadataToAdd && metadataToAdd.length > 0) {
    for (const rawMetaId of metadataToAdd) {
      const metaId = requireInt('meta_id', rawMetaId);
      for (const docId of ids) {
        const sql = `INSERT OR IGNORE INTO ${TABLE} (doc_id, meta_id) VALUES (?, ?)`;
        try {
          stmt(db, sql).run(docId, metaId);
          metadataAdded++;
        } catch (err) {
          if (!err.message.includes('UNIQUE')) throw err;
        }
      }
    }
  }

  return { docsUpdated: ids.length, metadataAdded, metadataRemoved };
}, 'document_metadata.batchUpdate');
