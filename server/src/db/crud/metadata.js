import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { requireInt, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'metadata';
const PK = 'meta_id';
const JSON_FIELDS = [];  // No JSON fields in this table

// Reserved system metadata keys — cannot be created or renamed to by users
export const RESERVED_METADATA_KEYS = [
  'architxt-tags',
  'architxt-entity-match-pattern',
  'architxt-entities',
  'architxt-document-size',
  'architxt-document-full-path',
  'architxt-file-name',
  'architxt-document-date',
  'architxt-author',
];

const RESERVED_KEY_SET = new Set(RESERVED_METADATA_KEYS);

// Use base for generic operations with integer primary key
const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

// Export generated base functions
export const getMetadata = base.get;
export const listMetadata = base.list;

/**
 * Get usage counts for a list of metadata IDs
 * @param {Object} db - Database connection
 * @param {number[]} metaIds - Array of metadata IDs
 * @returns {Map<number, number>} Map of meta_id -> count
 */
export const getMetadataUsageCounts = (db, metaIds) => dbExec(() => {
  const placeholders = metaIds.map(() => '?').join(',');
  const sql = `SELECT meta_id, COUNT(*) as count FROM document_metadata WHERE meta_id IN (${placeholders}) GROUP BY meta_id`;
  const rows = stmt(db, sql).all(...metaIds);
  const map = new Map();
  for (const r of rows) map.set(r.meta_id, r.count);
  return map;
}, 'metadata.usageCounts');
// Override delete to prevent removing system metadata
export const deleteMetadata = (db, id) => dbExec(() => {
  // Read first to check if system
  const row = stmt(db, `SELECT meta_generated_by FROM ${TABLE} WHERE ${PK} = ?`).get(id);
  if (!row) return false; // Not found — base.del would also return false
  if (row.meta_generated_by === 'system') {
    const err = new Error('System metadata presets cannot be deleted');
    err.code = 'FORBIDDEN';
    throw err;
  }
  const result = stmt(db, `DELETE FROM ${TABLE} WHERE ${PK} = ?`).run(id);
  return result.changes > 0;
}, 'metadata.delete');

/**
 * Create metadata - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {Object} data - Must have meta_key, optional meta_value, meta_generated_by
 */
export const createMetadata = (db, data) => dbExec(() => {
  // Route layer already validated API fields and translated to DB names
  const key = data.meta_key;
  const value = data.meta_value || null;
  const generatedBy = data.meta_generated_by || null;

  // Guard: reserved keys are only creatable by system (seed)
  if (RESERVED_KEY_SET.has(key) && generatedBy !== 'system') {
    const err = new Error(`Key '${key}' is reserved for system use`);
    err.code = 'CONFLICT';
    throw err;
  }

  const sql = `INSERT INTO ${TABLE} (meta_key, meta_value, meta_generated_by) VALUES (?, ?, ?)`;
  const result = stmt(db, sql).run(key, value, generatedBy);

  return result.lastInsertRowid;
}, 'metadata.create');

/**
 * Update metadata - expects DB field names from route layer
 * System metadata (generated_by = 'system') is read-only
 * @param {Object} db - Database connection
 * @param {number} id - Metadata ID (INTEGER primary key)
 * @param {Object} data - Fields to update (meta_key, meta_value, meta_generated_by)
 * @returns {Promise<<{success: true, data: boolean}|{success: false, error: string, code: string}>}
 */
export const updateMetadata = (db, id, data) => dbExec(() => {
  // Check if system metadata — reject any updates
  const existing = stmt(db, `SELECT meta_generated_by FROM ${TABLE} WHERE ${PK} = ?`).get(id);
  if (existing && existing.meta_generated_by === 'system') {
    const err = new Error('System metadata presets are read-only');
    err.code = 'FORBIDDEN';
    throw err;
  }
  // meta_key, meta_value, and meta_generated_by are all updatable
  const key = data.meta_key;
  const value = data.meta_value;
  const generatedBy = data.meta_generated_by;
  
  // Build dynamic update
  const updates = ['meta_updated_at = CURRENT_TIMESTAMP'];
  const values = [];
  
  if (key !== undefined) {
    updates.push('meta_key = ?');
    values.push(key);
  }
  
  if (value !== undefined) {
    updates.push('meta_value = ?');
    values.push(value);
  }
  
  if (generatedBy !== undefined) {
    updates.push('meta_generated_by = ?');
    values.push(generatedBy);
  }
  
  if (updates.length === 1) {
    throw new Error('No fields to update');
  }

  // Guard: cannot rename a user/import entry TO a reserved key
  if (key !== undefined && RESERVED_KEY_SET.has(key)) {
    const err = new Error(`Key '${key}' is reserved for system use`);
    err.code = 'CONFLICT';
    throw err;
  }

  values.push(id);
  
  const sql = `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(...values);
  
  // Return null if no row was updated (not found), true otherwise
  return result.changes > 0 ? true : null;
}, 'metadata.update');

/**
 * Get metadata by key and value
 * @param {Object} db - Database connection
 * @param {string} key - Metadata key
 * @param {string|null} value - Metadata value
 */
export const getMetadataByKeyValue = (db, key, value) => dbExec(() => {
  const sql = `SELECT * FROM ${TABLE} WHERE meta_key = ? AND meta_value = ?`;
  const result = stmt(db, sql).get(key, value);
  
  return result || null;
}, 'metadata.getByKeyValue');
