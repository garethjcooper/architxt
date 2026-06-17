import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { fromJson, toJson, requireInt, requireField, requireNonEmpty, dbExec } from '../../utils/db-helpers.js';
import { getSqlPresenceExpression } from '../../entity-tag-format.js';

const TABLE = 'documents';
const PK = 'doc_id';
const JSON_FIELDS = ['doc_processing_history', 'doc_processing_progress', 'doc_tags', 'doc_metadata', 'doc_context', 'doc_content_blocks'];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS);

// Use base for generic delete
export const deleteDocument = (db, id) => dbExec(() => {
  const result = base.del(db, id);

  // Keep FTS5 index in sync by removing entries for deleted document
  stmt(db, `DELETE FROM documents_fts WHERE rowid = ?`).run(requireInt('doc_id', id));

  return result;
}, 'documents.delete');

// Tag/metadata subqueries for list/get
const DOC_TAGS_SQL = `
  (SELECT json_group_array(json_object('id', t.tag_id, 'name', t.tag_name))
   FROM document_tags dt
   JOIN tags t ON dt.tag_id = t.tag_id
   WHERE dt.doc_id = d.doc_id)`;

const DOC_METADATA_SQL = `
  (SELECT json_group_array(json_object('id', m.meta_id, 'key', m.meta_key, 'value', m.meta_value))
   FROM document_metadata dm
   JOIN metadata m ON dm.meta_id = m.meta_id
   WHERE dm.doc_id = d.doc_id)`;

const DOC_CONTEXT_SQL = `
  (SELECT json_object('id', c.ctxt_id, 'description', c.ctxt_desc)
   FROM contexts c
   WHERE c.ctxt_id = d.ctxt_id)`;

// Override get - include tags/metadata/content
export const getDocument = (db, id) => dbExec(() => {
  const sql = `
    SELECT d.*,
      ${DOC_TAGS_SQL} AS doc_tags,
      ${DOC_METADATA_SQL} AS doc_metadata,
      ${DOC_CONTEXT_SQL} AS doc_context
    FROM documents d
    WHERE d.doc_id = ?
  `;
  const row = stmt(db, sql).get(requireInt('doc_id', id));
  return fromJson(row, JSON_FIELDS);
}, 'documents.get');

// Fetch all documents with fields needed for diff comparison
export const getDocumentsForDiff = (db) => dbExec(() => {
  const sql = `
    SELECT doc_id, doc_ext_id, doc_content_hash, doc_filename, doc_status,
           doc_timestamp, ctxt_id, doc_full_path, doc_authors, doc_content
    FROM documents
    WHERE doc_ext_id IS NOT NULL
    ORDER BY doc_ext_id
  `;
  return stmt(db, sql).all();
}, 'documents.getForDiff');

// Fetch all document-context associations for diff comparison
export const getAllDocumentContexts = (db) => dbExec(() => {
  const sql = `
    SELECT d.doc_id, c.ctxt_desc
    FROM documents d
    JOIN contexts c ON d.ctxt_id = c.ctxt_id
    WHERE d.ctxt_id IS NOT NULL
  `;
  return stmt(db, sql).all();
}, 'documents.getAllContexts');

// Fetch document by external ID
export const getDocumentByExtId = (db, extId) => dbExec(() => {
  const sql = `
    SELECT doc_id, doc_ext_id, doc_content_hash, doc_filename, doc_timestamp, ctxt_id
    FROM documents WHERE doc_ext_id = ?
  `;
  return stmt(db, sql).get(extId);
}, 'documents.getByExtId');

// Override list - exclude doc_content and doc_content_blocks
export const listDocuments = (db, options = {}) => dbExec(() => {
  const { status, limit = 100, offset = 0 } = options;

  let conditions = [];
  let params = [];

  if (status !== undefined) {
    conditions.push('doc_status = ?');
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT d.doc_id, d.doc_ext_id, d.doc_status, d.doc_content_hash,
      d.doc_source_path, d.doc_filename, d.doc_full_path, d.doc_authors, d.doc_generated_by, d.ctxt_id,
      d.doc_processing_progress, d.doc_processing_history,
      d.doc_timestamp, d.doc_created_at, d.doc_updated_at,
      ROUND(LENGTH(d.doc_content) / 1000.0, 1) AS doc_content_length_k,
      CASE WHEN ${getSqlPresenceExpression('d.doc_content')} THEN 1 ELSE 0 END AS doc_has_entities,
      ${DOC_TAGS_SQL} AS doc_tags,
      ${DOC_METADATA_SQL} AS doc_metadata,
      ${DOC_CONTEXT_SQL} AS doc_context
    FROM documents d
    ${whereClause}
    ORDER BY doc_created_at DESC
    LIMIT ? OFFSET ?
  `;
  const rows = stmt(db, sql).all(...params, requireInt('limit', limit), requireInt('offset', offset));
  return rows.map(r => fromJson(r, JSON_FIELDS));
}, 'documents.list');

// Explicit - needs JSON handling
export const createDocument = (db, data) => dbExec(() => {
  requireField(data, 'doc_source_path');
  
  const jsonData = toJson(data, JSON_FIELDS);
  const cols = Object.keys(jsonData);
  const placeholders = cols.map(() => '?').join(',');

  const sql = `INSERT INTO ${TABLE} (${cols.join(',')}) VALUES (${placeholders})`;
  const values = cols.map(c => jsonData[c]);

  const result = stmt(db, sql).run(...values);

  // Keep FTS5 index in sync for newly inserted content
  const docId = result.lastInsertRowid;
  if (jsonData.doc_content !== undefined && jsonData.doc_content !== null) {
    stmt(db, `INSERT INTO documents_fts(rowid, doc_content) VALUES (?, ?)`)
      .run(docId, jsonData.doc_content);
  }

  return docId;
}, 'documents.create');

// Explicit - needs partial update logic
export const updateDocument = (db, id, data) => dbExec(() => {
  const cols = requireNonEmpty(data, 'fields');
  const jsonData = toJson(data, JSON_FIELDS);

  const setClause = cols.map(c => `${c} = ?`).join(',');
  const sql = `UPDATE ${TABLE} SET ${setClause}, doc_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const values = [...cols.map(c => jsonData[c]), requireInt('doc_id', id)];

  const result = stmt(db, sql).run(...values);

  // Keep FTS5 index in sync if doc_content changed
  if (cols.includes('doc_content')) {
    const newContent = jsonData.doc_content;
    if (newContent === undefined || newContent === null) {
      stmt(db, `DELETE FROM documents_fts WHERE rowid = ?`).run(id);
    } else {
      stmt(db, `INSERT INTO documents_fts(rowid, doc_content) VALUES (?, ?)
                ON CONFLICT(rowid) DO UPDATE SET doc_content = excluded.doc_content`)
        .run(id, newContent);
    }
  }

  return result.changes > 0;
}, 'documents.update');

// Custom - find next document ready for extraction (no state change)
export const getNextReadyToExtractDocument = (db) => dbExec(() => {
  const sql = `SELECT ${PK} FROM ${TABLE} WHERE doc_status = 'ready_to_extract' ORDER BY doc_created_at ASC LIMIT 1`;
  const row = stmt(db, sql).get();
  return row ? row.doc_id : null;
}, 'documents.getNextReady');

// Custom - atomic claim: update status only if currently ready_to_extract
export const claimDocument = (db, id) => dbExec(() => {
  const sql = `UPDATE ${TABLE} SET doc_status = 'processing_extract', doc_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ? AND doc_status = 'ready_to_extract'`;
  const result = stmt(db, sql).run(requireInt('doc_id', id));
  return result.changes > 0;
}, 'documents.claim');

// Custom - atomic transition to ready_to_extract (only from allowed states)
export const markDocumentReadyToExtract = (db, id) => dbExec(() => {
  // Allowed source states for manual process trigger
  const allowedStatuses = ['uploaded', 'processed_extract_failed', 'processed_extract_success'];
  const placeholders = allowedStatuses.map(() => '?').join(',');
  
  const sql = `UPDATE ${TABLE} SET doc_status = 'ready_to_extract', doc_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ? AND doc_status IN (${placeholders})`;
  const result = stmt(db, sql).run(requireInt('doc_id', id), ...allowedStatuses);
  return result.changes > 0;
}, 'documents.markReady');

// Custom - get currently processing document for monitoring
export const getDocumentProcessing = (db) => dbExec(() => {
  const sql = `SELECT ${PK}, doc_ext_id, doc_filename, doc_status, doc_processing_progress, doc_processing_history
               FROM ${TABLE} WHERE doc_status = 'processing_extract' ORDER BY doc_updated_at DESC LIMIT 1`;
  const row = stmt(db, sql).get();
  return fromJson(row, JSON_FIELDS);
}, 'documents.getProcessing');

// Custom - batch update document context (sets ctxt_id for multiple documents)
export const batchUpdateDocumentContext = (db, docIds, contextId) => dbExec(() => {
  const ids = docIds.map((id) => requireInt('doc_id', id));
  const ctxId = contextId === null ? null : requireInt('context_id', contextId);
  const sql = `UPDATE ${TABLE} SET ctxt_id = ?, doc_updated_at = CURRENT_TIMESTAMP WHERE ${PK} IN (${ids.map(() => '?').join(',')})`;
  const result = stmt(db, sql).run(ctxId, ...ids);
  return { docsUpdated: result.changes };
}, 'documents.batchUpdateContext');
