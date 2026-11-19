import { stmt } from '../../cache.js';
import { fromJson, toJson, requireInt, requireField, requireNonEmpty, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'trace_profiles';
const PK = 'tfp_id';
const JSON_FIELDS = ['tfp_config', 'tfp_versions'];

function profileColumns() {
  return `${PK}, tfp_name, tfp_description, tfp_config, tfp_versions, tfp_used_version_id, tfp_config_updated_at, tfp_created_at, tfp_updated_at`;
}

export const getTraceProfile = (db, id) => dbExec(() => {
  const row = stmt(db, `SELECT * FROM ${TABLE} WHERE ${PK} = ?`).get(requireInt('tfp_id', id));
  return fromJson(row, JSON_FIELDS);
}, 'trace-profiles.get');

export const getTraceProfileByName = (db, name) => dbExec(() => {
  const row = stmt(db, `SELECT * FROM ${TABLE} WHERE tfp_name = ?`).get(name);
  return fromJson(row, JSON_FIELDS);
}, 'trace-profiles.getByName');

export const listTraceProfiles = (db) => dbExec(() => {
  const rows = stmt(db, `SELECT ${profileColumns()} FROM ${TABLE} ORDER BY tfp_name`).all();
  return rows.map((r) => fromJson(r, JSON_FIELDS));
}, 'trace-profiles.list');

export const createTraceProfile = (db, data) => dbExec(() => {
  requireField(data, 'tfp_name');
  requireField(data, 'tfp_config');
  const jsonData = toJson(data, JSON_FIELDS);
  const cols = Object.keys(jsonData);
  const placeholders = cols.map(() => '?').join(',');
  const sql = `INSERT INTO ${TABLE} (${cols.join(',')}) VALUES (${placeholders})`;
  const values = cols.map((c) => jsonData[c]);
  const result = stmt(db, sql).run(...values);
  return result.lastInsertRowid;
}, 'trace-profiles.create');

export const updateTraceProfile = (db, id, data) => dbExec(() => {
  const cols = requireNonEmpty(data, 'fields');
  const jsonData = toJson(data, JSON_FIELDS);
  const setClause = cols.map((c) => `${c} = ?`).join(',');
  const sql = `UPDATE ${TABLE} SET ${setClause}, tfp_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const values = [...cols.map((c) => jsonData[c]), requireInt('tfp_id', id)];
  const result = stmt(db, sql).run(...values);
  return result.changes > 0;
}, 'trace-profiles.update');

export const deleteTraceProfile = (db, id) => dbExec(() => {
  const result = stmt(db, `DELETE FROM ${TABLE} WHERE ${PK} = ?`).run(requireInt('tfp_id', id));
  return result.changes > 0;
}, 'trace-profiles.delete');
