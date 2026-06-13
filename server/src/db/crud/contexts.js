import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { requireString, requireField, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'contexts';
const PK = 'ctxt_id';
const JSON_FIELDS = [];  // No JSON fields in this table

const base = createBaseCrud(TABLE, PK, JSON_FIELDS);

// Use base for generic operations
export const getContext = base.get;
export const listContexts = base.list;
export const deleteContext = base.del;

/**
 * Fetch context description by ID
 * @param {Object} db
 * @param {number} id
 * @returns {Promise<{success: true, data: string|null}>}
 */
export const getContextDescriptionById = (db, id) => dbExec(() => {
  const sql = 'SELECT ctxt_desc FROM contexts WHERE ctxt_id = ?';
  const row = stmt(db, sql).get(id);
  return row ? row.ctxt_desc : null;
}, 'contexts.getDescById');

/**
 * Get usage counts for a list of context IDs
 * @param {Object} db - Database connection
 * @param {number[]} ctxIds - Array of context IDs
 * @returns {Map<number, number>} Map of ctxt_id -> count
 */
export const getContextUsageCounts = (db, ctxIds) => dbExec(() => {
  const placeholders = ctxIds.map(() => '?').join(',');
  const sql = `SELECT ctxt_id, COUNT(*) as count FROM documents WHERE ctxt_id IN (${placeholders}) GROUP BY ctxt_id`;
  const rows = stmt(db, sql).all(...ctxIds);
  const map = new Map();
  for (const r of rows) map.set(r.ctxt_id, r.count);
  return map;
}, 'contexts.usageCounts');

/**
 * Create context - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {Object} data - Must have ctxt_desc, ctxt_generated_by
 */
export const createContext = (db, data) => dbExec(() => {
  // Route layer already validated API fields and translated to DB names
  // Just need to ensure required fields are present for SQL
  const desc = data.ctxt_desc;
  const generatedBy = data.ctxt_generated_by;
  
  // These should already be validated by route layer
  if (!desc) throw new Error('Internal: ctxt_desc is required');
  if (!generatedBy) throw new Error('Internal: ctxt_generated_by is required');
  
  const sql = `INSERT INTO ${TABLE} (ctxt_desc, ctxt_generated_by) VALUES (?, ?)`;
  const result = stmt(db, sql).run(desc, generatedBy);
  
  return result.lastInsertRowid;
}, 'contexts.create');

/**
 * Update context - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {number} id - Context ID
 * @param {Object} data - Fields to update (ctxt_desc only)
 * @returns {Promise<{success: true, data: boolean}|{success: false, error: string, code: string}>}
 */
export const updateContext = (db, id, data) => dbExec(() => {
  // Only ctxt_desc is updatable
  const desc = data.ctxt_desc;
  
  requireString(desc, 'ctxt_desc');
  
  const sql = `UPDATE ${TABLE} SET ctxt_desc = ?, ctxt_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(desc, id);
  
  // Return null if no row was updated (not found), true otherwise
  return result.changes > 0 ? true : null;
}, 'contexts.update');
