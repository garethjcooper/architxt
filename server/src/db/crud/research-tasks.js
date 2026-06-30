import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { dbExec, requireString, requireInt, fromJson, toJson } from '../../utils/db-helpers.js';

const TABLE = 'research_tasks';
const PK = 'rt_id';
const JSON_FIELDS = ['rt_payload', 'rt_result'];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'string' });

export const getTask = base.get;
export const listTasksForStep = (db, stepId) => dbExec(() => {
  const id = requireInt('stepId', stepId);
  const sql = `SELECT * FROM ${TABLE} WHERE rstep_id = ? ORDER BY rt_created_at ASC`;
  const rows = stmt(db, sql).all(id);
  return rows.map((r) => fromJson(r, JSON_FIELDS));
}, 'research.listTasksForStep');

export const listPendingTasks = (db) => dbExec(() => {
  const sql = `SELECT * FROM ${TABLE} WHERE rt_status IN ('pending', 'running') ORDER BY rt_created_at ASC`;
  const rows = stmt(db, sql).all();
  return rows.map((r) => fromJson(r, JSON_FIELDS));
}, 'research.listPendingTasks');

export const createTask = (db, data) => dbExec(() => {
  requireString('rt_id', data.rt_id);
  requireInt('rs_id', data.rs_id);
  requireInt('rstep_id', data.rstep_id);
  requireString('rt_type', data.rt_type);

  const prepared = toJson(data, JSON_FIELDS);
  const sql = `INSERT INTO ${TABLE} (
    rt_id, rs_id, rstep_id, rt_type, rt_status, rt_payload, rt_result, rt_error, rt_code
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const result = stmt(db, sql).run(
    prepared.rt_id,
    prepared.rs_id,
    prepared.rstep_id,
    prepared.rt_type,
    prepared.rt_status ?? 'pending',
    prepared.rt_payload ?? null,
    prepared.rt_result ?? null,
    prepared.rt_error ?? null,
    prepared.rt_code ?? null
  );
  return result.lastInsertRowid;
}, 'research.createTask');

export const updateTaskStatus = (db, taskId, { status, result, error, code }) => dbExec(() => {
  requireString('taskId', taskId);
  requireString('status', status);

  const preparedResult = result !== undefined && result !== null ? JSON.stringify(result) : null;
  const sql = `UPDATE ${TABLE} SET
    rt_status = ?, rt_result = ?, rt_error = ?, rt_code = ?, rt_updated_at = CURRENT_TIMESTAMP
    WHERE rt_id = ?`;
  const changes = stmt(db, sql).run(status, preparedResult, error ?? null, code ?? null, taskId).changes;
  return changes > 0;
}, 'research.updateTaskStatus');

export const acknowledgeTask = (db, taskId) => dbExec(() => {
  requireString('taskId', taskId);
  const sql = `UPDATE ${TABLE} SET rt_status = 'acknowledged', rt_updated_at = CURRENT_TIMESTAMP WHERE rt_id = ?`;
  return stmt(db, sql).run(taskId).changes > 0;
}, 'research.acknowledgeTask');
