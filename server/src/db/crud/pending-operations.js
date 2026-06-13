import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { requireInt, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'pending_operations';
const PK = 'pop_id';
const JSON_FIELDS = [];

// Base operations (use sparingly — prefer curated list below)
const base = createBaseCrud(TABLE, PK, JSON_FIELDS);
export const getPendingOperation = base.get;
export const deletePendingOperation = base.del;

/**
 * Create a pending operation record after initiating an async Hindsight operation.
 * @param {Object} db - Database connection
 * @param {Object} data - Operation fields (DB column names)
 *   pop_operation_id, pop_server_id, pop_bank_id, pop_doc_id, pop_ext_id, pop_action, pop_status
 * @returns {{success: boolean, data?: number, error?: string, code?: string}} pop_id on success
 */
export const createPendingOperation = (db, data) => dbExec(() => {
  const cols = [
    'pop_operation_id', 'pop_server_id', 'pop_bank_id', 'pop_doc_id',
    'pop_ext_id', 'pop_action', 'pop_status'
  ];
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT INTO ${TABLE} (${cols.join(',')}) VALUES (${placeholders})`;
  const values = [
    data.pop_operation_id,
    requireInt('pop_server_id', data.pop_server_id),
    data.pop_bank_id,
    requireInt('pop_doc_id', data.pop_doc_id),
    data.pop_ext_id || null,
    data.pop_action || 'push',
    data.pop_status || 'pending',
  ];
  const result = stmt(db, sql).run(...values);
  return result.lastInsertRowid;
}, `${TABLE}.create`);

/**
 * List ALL pending operations across all servers/banks, excluding acknowledged.
 * Used by the global status indicator in the top bar.
 * @param {Object} db
 * @returns {{success: boolean, data?: Array, error?: string, code?: string}}
 */
export const listAllPending = (db) => dbExec(() => {
  const sql = `
    SELECT ${PK}, pop_operation_id, pop_server_id, pop_bank_id, pop_doc_id,
           pop_ext_id, pop_action, pop_status, pop_error_message,
           pop_created_at, pop_updated_at
    FROM ${TABLE}
    WHERE pop_status NOT IN ('completed', 'failed', 'acknowledged')
    ORDER BY pop_created_at DESC
  `;
  return stmt(db, sql).all();
}, `${TABLE}.listAllPending`);

/**
 * List pending operations for a specific server + bank, excluding acknowledged.
 * Ordered by most recent first.
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @returns {{success: boolean, data?: Array, error?: string, code?: string}}
 */
export const listPendingByServerBank = (db, serverId, bankId) => dbExec(() => {
  const sql = `
    SELECT ${PK}, pop_operation_id, pop_server_id, pop_bank_id, pop_doc_id,
           pop_ext_id, pop_action, pop_status, pop_error_message,
           pop_created_at, pop_updated_at
    FROM ${TABLE}
    WHERE pop_server_id = ? AND pop_bank_id = ? AND pop_status NOT IN ('completed', 'failed', 'acknowledged')
    ORDER BY pop_created_at DESC
  `;
  return stmt(db, sql).all(requireInt('pop_server_id', serverId), bankId);
}, `${TABLE}.listPendingByServerBank`);

/**
 * Update operation status (and optional error message) after polling Hindsight.
 * @param {Object} db
 * @param {number} id - pop_id (NOT operation_id)
 * @param {Object} data - { pop_status, pop_error_message }
 * @returns {{success: boolean, data?: boolean, error?: string, code?: string}}
 */
export const updatePendingOperationStatus = (db, id, data) => dbExec(() => {
  const status = data.pop_status;
  if (!status) throw new Error('Internal: pop_status is required');
  const errorMsg = data.pop_error_message;

  let setClause = 'pop_status = ?';
  let values = [status];

  if (errorMsg !== undefined) {
    setClause += ', pop_error_message = ?';
    values.push(errorMsg);
  }

  const sql = `UPDATE ${TABLE} SET ${setClause}, pop_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  values.push(requireInt('pop_id', id));

  const result = stmt(db, sql).run(...values);
  return result.changes > 0;
}, `${TABLE}.updateStatus`);

/**
 * Dismiss a failed/completed operation by setting status to 'acknowledged'.
 * Removes it from active overlays on the frontend.
 * @param {Object} db
 * @param {number} id - pop_id
 * @returns {{success: boolean, data?: boolean, error?: string, code?: string}}
 */
export const dismissPendingOperation = (db, id) => dbExec(() => {
  const sql = `UPDATE ${TABLE} SET pop_status = 'acknowledged', pop_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(requireInt('pop_id', id));
  return result.changes > 0;
}, `${TABLE}.dismiss`);

/**
 * Delete an acknowledged operation permanently.
 * @param {Object} db
 * @param {number} id - pop_id
 * @returns {{success: boolean, data?: boolean, error?: string, code?: string}}
 */
export const deleteAcknowledgedOperation = (db, id) => dbExec(() => {
  const sql = `DELETE FROM ${TABLE} WHERE ${PK} = ? AND pop_status = 'acknowledged'`;
  const result = stmt(db, sql).run(requireInt('pop_id', id));
  return result.changes > 0;
}, `${TABLE}.deleteAcknowledged`);

/**
 * Find a pending operation by its Hindsight operation_id.
 * @param {Object} db
 * @param {string} operationId
 * @returns {{success: boolean, data?: Object, error?: string, code?: string}}
 */
export const findByOperationId = (db, operationId) => dbExec(() => {
  const sql = `
    SELECT ${PK}, pop_operation_id, pop_server_id, pop_bank_id, pop_doc_id,
           pop_ext_id, pop_action, pop_status, pop_error_message,
           pop_created_at, pop_updated_at
    FROM ${TABLE}
    WHERE pop_operation_id = ?
    LIMIT 1
  `;
  return stmt(db, sql).get(operationId);
}, `${TABLE}.findByOperationId`);
