import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { dbExec } from '../../utils/db-helpers.js';

const TABLE = 'entity_types';
const PK = 'et_id';
const JSON_FIELDS = [];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

export const getEntityType = base.get;
export const listEntityTypes = base.list;
export const deleteEntityType = base.del;

/**
 * Create entity type
 * @param {Object} db
 * @param {Object} data — { type_name, description, id_label, name_label }
 */
export const createEntityType = (db, data) => dbExec(() => {
  const { type_name, description, id_label, name_label, case_match } = data;
  if (!type_name) throw new Error('Internal: type_name is required');

  const sql = `INSERT INTO ${TABLE} (et_type_name, et_description, et_id_label, et_name_label, et_case_match) VALUES (?, ?, ?, ?, ?)`;
  const result = stmt(db, sql).run(type_name, description || null, id_label || null, name_label || null, case_match || 'insensitive');
  return result.lastInsertRowid;
}, 'entity_types.create');

/**
 * Update entity type
 * @param {Object} db
 * @param {number} id
 * @param {Object} data
 */
export const updateEntityType = (db, id, data) => dbExec(() => {
  const { type_name, description, id_label, name_label, case_match } = data;
  const updates = ['et_updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (type_name !== undefined) { updates.push('et_type_name = ?'); params.push(type_name); }
  if (description !== undefined) { updates.push('et_description = ?'); params.push(description); }
  if (id_label !== undefined) { updates.push('et_id_label = ?'); params.push(id_label); }
  if (name_label !== undefined) { updates.push('et_name_label = ?'); params.push(name_label); }
  if (case_match !== undefined) { updates.push('et_case_match = ?'); params.push(case_match); }

  if (updates.length > 1) {
    params.push(id);
    stmt(db, `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE ${PK} = ?`).run(...params);
  }
  return true;
}, 'entity_types.update');
