import { stmt } from '../cache.js';
import { fromJson, requireInt, requireString, dbExec } from '../utils/db-helpers.js';

// Default validators by type
const VALIDATORS = {
  integer: requireInt,
  string: (name, value) => requireString(name, value)
};

// Base CRUD generator for truly generic operations
// All functions return { success, data?, error?, code? }
// pkType can be 'integer' (default), 'string', or a custom validator function
export const createBaseCrud = (table, pk, jsonFields = [], options = {}) => {
  const { pkType = 'integer' } = options;
  const validateId = typeof pkType === 'function' 
    ? pkType 
    : (VALIDATORS[pkType] || requireInt);

  return {
    // Get by primary key
    get: (db, id) => dbExec(() => {
      const row = stmt(db, `SELECT * FROM ${table} WHERE ${pk} = ?`).get(validateId(pk, id));
      return fromJson(row, jsonFields);
    }, `${table}.get`),

    // Basic list with pagination
    list: (db, opts = {}) => dbExec(() => {
      const { limit = 100, offset = 0 } = opts;
      const sql = `SELECT * FROM ${table} ORDER BY ${pk} DESC LIMIT ? OFFSET ?`;
      const rows = stmt(db, sql).all(requireInt('limit', limit), requireInt('offset', offset));
      return rows.map(r => fromJson(r, jsonFields));
    }, `${table}.list`),

    // Delete by primary key
    del: (db, id) => dbExec(() => {
      const result = stmt(db, `DELETE FROM ${table} WHERE ${pk} = ?`).run(validateId(pk, id));
      return result.changes > 0;
    }, `${table}.delete`)
  };
};
