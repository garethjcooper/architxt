import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { requireString, requireInt, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'servers';
const PK = 'svr_id';
const JSON_FIELDS = [];  // No JSON fields in this table

// Use base for generic operations with integer primary key
const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

// Export generated base functions
export const getServer = base.get;
export const listServers = base.list;
export const deleteServer = base.del;

/**
 * Create server - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {Object} data - Must have svr_base_url, optional svr_name, svr_api_key, svr_api_version
 */
export const createServer = (db, data) => dbExec(() => {
  // Route layer already validated API fields and translated to DB names
  const baseUrl = data.svr_base_url;
  
  // This should already be validated by route layer
  if (!baseUrl) throw new Error('Internal: svr_base_url is required');
  
  const sql = `INSERT INTO ${TABLE} (svr_base_url, svr_name, svr_api_key, svr_api_version) VALUES (?, ?, ?, ?)`;
  const result = stmt(db, sql).run(
    baseUrl,
    data.svr_name || null,
    data.svr_api_key || null,
    data.svr_api_version || null
  );
  
  return result.lastInsertRowid;
}, 'servers.create');

/**
 * Update server - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {number} id - Server ID (INTEGER primary key)
 * @param {Object} data - Fields to update (svr_base_url, svr_name, svr_api_key, svr_api_version)
 * @returns {Promise<{success: true, data: boolean}|{success: false, error: string, code: string}>}
 */
export const updateServer = (db, id, data) => dbExec(() => {
  // Build dynamic update based on provided fields
  const updates = [];
  const values = [];
  
  if (data.svr_base_url !== undefined) {
    requireString('svr_base_url', data.svr_base_url);
    updates.push('svr_base_url = ?');
    values.push(data.svr_base_url);
  }
  
  if (data.svr_name !== undefined) {
    updates.push('svr_name = ?');
    values.push(data.svr_name || null);
  }
  
  if (data.svr_api_key !== undefined) {
    updates.push('svr_api_key = ?');
    values.push(data.svr_api_key || null);
  }
  
  if (data.svr_api_version !== undefined) {
    updates.push('svr_api_version = ?');
    values.push(data.svr_api_version || null);
  }
  
  if (updates.length === 0) {
    throw new Error('No fields to update');
  }
  
  updates.push('svr_updated_at = CURRENT_TIMESTAMP');
  values.push(id);
  
  const sql = `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(...values);
  
  // Return null if no row was updated (not found), true otherwise
  return result.changes > 0 ? true : null;
}, 'servers.update');
