// Full-text search adapter — isolates SQLite FTS5 specifics so the rest of the
// codebase does not depend on FTS5 syntax. When we migrate to PostgreSQL, only
// this module needs to change (swap virtual-table SQL for tsvector/tsquery).

import { stmt } from '../../cache.js';
import { requireInt, dbExec } from '../../utils/db-helpers.js';

const FTS_TABLE = 'documents_fts';
const FTS_COLUMN = 'doc_content';
const FTS_CONTENT_TABLE = 'documents';
const FTS_CONTENT_ROWID = 'doc_id';

/**
 * Create/rebuild the FTS index.
 * In SQLite this drops and recreates the FTS5 virtual table then backfills.
 */
export const createFtsIndex = (db) => dbExec(() => {
  const exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(FTS_TABLE);

  if (exists) {
    db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
  }

  db.exec(`
    CREATE VIRTUAL TABLE ${FTS_TABLE} USING fts5(
      ${FTS_COLUMN},
      content='${FTS_CONTENT_TABLE}',
      content_rowid='${FTS_CONTENT_ROWID}',
      tokenize="unicode61 tokenchars '-_:'"
    )
  `);

  const docCount = db.prepare('SELECT COUNT(*) AS c FROM documents').get().c;
  if (docCount > 0) {
    db.exec(`
      INSERT INTO ${FTS_TABLE}(rowid, ${FTS_COLUMN})
      SELECT doc_id, doc_content FROM documents
    `);
  }

  return true;
}, 'fts.createIndex');

/**
 * Drop the FTS index entirely.
 */
export const dropFtsIndex = (db) => dbExec(() => {
  db.exec(`DROP TABLE IF EXISTS ${FTS_TABLE}`);
  return true;
}, 'fts.dropIndex');

/**
 * Rebuild the FTS index from scratch.
 */
export const rebuildFtsIndex = (db) => dbExec(() => {
  dropFtsIndex(db);
  return createFtsIndex(db).data;
}, 'fts.rebuildIndex');

/**
 * Insert or replace a document in the FTS index.
 * Use this on document create/update.
 */
export const upsertFtsDocument = (db, docId, content) => dbExec(() => {
  const id = requireInt('doc_id', docId);
  if (content === undefined || content === null) {
    stmt(db, `DELETE FROM ${FTS_TABLE} WHERE rowid = ?`).run(id);
    return { action: 'deleted' };
  }
  stmt(db, `INSERT OR REPLACE INTO ${FTS_TABLE}(rowid, ${FTS_COLUMN}) VALUES (?, ?)`)
    .run(id, content);
  return { action: 'upserted' };
}, 'fts.upsertDocument');

/**
 * Remove a document from the FTS index.
 * Use this on document delete.
 */
export const deleteFtsDocument = (db, docId) => dbExec(() => {
  const id = requireInt('doc_id', docId);
  stmt(db, `DELETE FROM ${FTS_TABLE} WHERE rowid = ?`).run(id);
  return { action: 'deleted' };
}, 'fts.deleteDocument');

/**
 * Escape a single term for inclusion in an FTS5 MATCH expression.
 * Wraps in double quotes and escapes embedded quotes.
 */
function escapeFtsTerm(term) {
  return `"${String(term).replace(/"/g, '""')}"`;
}

/**
 * Build an FTS5 OR query from an array of terms.
 */
function buildFtsOrQuery(terms) {
  return Array.from(terms)
    .filter((t) => t && String(t).trim().length > 0)
    .map(escapeFtsTerm)
    .join(' OR ');
}

/**
 * Count how many distinct documents match each of the supplied terms.
 * Returns a Map of term -> count.
 *
 * @param {Object} db
 * @param {Array<{entityId: string, term: string}>} termGroups
 *   Each group identifies an entity and a term to search for. The same entity
 *   may appear multiple times with different terms.
 * @returns {Map<string, number>} Map of entityId -> count
 */
export const countDocumentsForTerms = (db, termGroups) => dbExec(() => {
  if (!termGroups || termGroups.length === 0) return new Map();

  const terms = termGroups.map((g) => g.term);
  const placeholders = terms.map(() => '?').join(',');

  const sql = `
    WITH terms(entity_id, term) AS (
      VALUES ${termGroups.map(() => '(?, ?)').join(',')}
    )
    SELECT t.entity_id, COUNT(DISTINCT d.doc_id) AS count
    FROM terms t
    JOIN ${FTS_TABLE} f ON f.${FTS_COLUMN} MATCH '"' || t.term || '"'
    JOIN documents d ON d.doc_id = f.rowid
    GROUP BY t.entity_id
  `;

  const params = termGroups.flatMap((g) => [g.entityId, g.term]);
  const rows = stmt(db, sql).all(...params);
  const map = new Map();
  for (const r of rows) map.set(r.entity_id, r.count);
  return map;
}, 'fts.countDocumentsForTerms');

/**
 * Find documents whose indexed content contains any of the supplied terms.
 *
 * @param {Object} db
 * @param {string[]} terms
 * @param {Object} options
 * @param {number} options.limit — max rows to return (default 1000, capped at 1000)
 * @returns {Array<{id: number, ext_id: string, filename: string}>}
 */
export const findDocumentsByTerms = (db, terms, options = {}) => dbExec(() => {
  if (!terms || terms.length === 0) return [];

  const matchExpr = buildFtsOrQuery(terms);
  if (!matchExpr) return [];

  const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));

  const docs = stmt(db, `
    SELECT DISTINCT d.doc_id, d.doc_ext_id, d.doc_filename
    FROM documents d
    JOIN ${FTS_TABLE} f ON f.rowid = d.doc_id
    WHERE f.${FTS_COLUMN} MATCH ?
    ORDER BY d.doc_id DESC
    LIMIT ?
  `).all(matchExpr, limit);

  return docs.map((d) => ({
    id: d.doc_id,
    ext_id: d.doc_ext_id,
    filename: d.doc_filename,
  }));
}, 'fts.findDocumentsByTerms');
