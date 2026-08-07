import { stmt } from '../../cache.js';
import { requireInt, dbExec } from '../../utils/db-helpers.js';

const JOBS_TABLE = 'contextual_graph_jobs';
const LOGS_TABLE = 'contextual_graph_job_logs';

const PUBLIC_FIELDS = [
  'cgj_id',
  'cgj_server_id',
  'cgj_bank_id',
  'cgj_status',
  'cgj_stages',
  'cgj_options',
  'cgj_stats',
  'cgj_error_message',
  'cgj_error_code',
  'cgj_created_at',
  'cgj_started_at',
  'cgj_finished_at',
  'cgj_updated_at',
].join(',');

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.cgj_id,
    server_id: row.cgj_server_id,
    bank_id: row.cgj_bank_id,
    status: row.cgj_status,
    stages: safeJsonParse(row.cgj_stages, []),
    options: safeJsonParse(row.cgj_options, {}),
    stats: safeJsonParse(row.cgj_stats, null),
    error_message: row.cgj_error_message,
    error_code: row.cgj_error_code,
    created_at: row.cgj_created_at,
    started_at: row.cgj_started_at,
    finished_at: row.cgj_finished_at,
    updated_at: row.cgj_updated_at,
  };
}

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Insert a new job row.
 * @param {Object} db
 * @param {Object} data
 * @returns {{success: boolean, data?: Object, error?: string}}
 */
export const createJob = (db, data) => dbExec(() => {
  const sql = `
    INSERT INTO ${JOBS_TABLE} (
      cgj_id, cgj_server_id, cgj_bank_id, cgj_status, cgj_stages, cgj_logs, cgj_options, cgj_stats, cgj_created_at, cgj_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const id = data.cgj_id;
  const serverId = requireInt('cgj_server_id', data.cgj_server_id);
  const bankId = data.cgj_bank_id;
  const status = data.cgj_status || 'pending';
  const stages = JSON.stringify(data.cgj_stages || []);
  const logs = JSON.stringify(data.cgj_logs || []);
  const options = data.cgj_options ? JSON.stringify(data.cgj_options) : null;
  const stats = data.cgj_stats ? JSON.stringify(data.cgj_stats) : null;
  const now = nowIso();
  stmt(db, sql).run(id, serverId, bankId, status, stages, logs, options, stats, now, now);
  return id;
}, `${JOBS_TABLE}.create`);

/**
 * Check whether a job is already active (pending or running) for a server/bank.
 */
export const hasActiveJob = (db, serverId, bankId) => dbExec(() => {
  const sql = `
    SELECT 1 FROM ${JOBS_TABLE}
    WHERE cgj_server_id = ? AND cgj_bank_id = ? AND cgj_status IN ('pending','running')
    LIMIT 1
  `;
  return !!stmt(db, sql).get(requireInt('cgj_server_id', serverId), bankId);
}, `${JOBS_TABLE}.hasActive`);

/**
 * Check whether any sync job is active globally, regardless of server/bank.
 */
export const hasAnyActiveJob = (db) => dbExec(() => {
  const sql = `
    SELECT 1 FROM ${JOBS_TABLE}
    WHERE cgj_status IN ('pending','running')
    LIMIT 1
  `;
  return !!stmt(db, sql).get();
}, `${JOBS_TABLE}.hasAnyActive`);

/**
 * Get a single job by id.
 */
export const getJob = (db, id) => dbExec(() => {
  const sql = `SELECT ${PUBLIC_FIELDS} FROM ${JOBS_TABLE} WHERE cgj_id = ?`;
  const row = stmt(db, sql).get(id);
  return rowToJob(row);
}, `${JOBS_TABLE}.get`);

/**
 * List jobs, optionally filtered by server/bank/status/date range.
 *
 * Date filters are inclusive ISO strings compared against cgj_created_at.
 */
export const listJobs = (db, { serverId, bankId, status, since, until, limit = 50, offset = 0 } = {}) => dbExec(() => {
  const conditions = [];
  const values = [];
  if (serverId !== undefined) {
    conditions.push('cgj_server_id = ?');
    values.push(requireInt('cgj_server_id', serverId));
  }
  if (bankId !== undefined) {
    conditions.push('cgj_bank_id = ?');
    values.push(bankId);
  }
  if (status !== undefined) {
    conditions.push('cgj_status = ?');
    values.push(status);
  }
  if (since !== undefined && since !== null && since !== '') {
    conditions.push('cgj_created_at >= ?');
    values.push(since);
  }
  if (until !== undefined && until !== null && until !== '') {
    conditions.push('cgj_created_at <= ?');
    values.push(until);
  }

  let sql = `SELECT ${PUBLIC_FIELDS} FROM ${JOBS_TABLE}`;
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ` ORDER BY cgj_created_at DESC LIMIT ? OFFSET ?`;
  values.push(limit, offset);

  const rows = stmt(db, sql).all(...values);
  return rows.map(rowToJob);
}, `${JOBS_TABLE}.list`);

/**
 * Update job status and stage state.
 */
export const updateJob = (db, id, data) => dbExec(() => {
  const sets = [];
  const values = [];

  if (data.status !== undefined) {
    sets.push('cgj_status = ?');
    values.push(data.status);
  }
  if (data.stages !== undefined) {
    sets.push('cgj_stages = ?');
    values.push(JSON.stringify(data.stages));
  }
  if (data.logs !== undefined) {
    sets.push('cgj_logs = ?');
    values.push(JSON.stringify(data.logs));
  }
  if (data.stats !== undefined) {
    sets.push('cgj_stats = ?');
    values.push(data.stats === null ? null : JSON.stringify(data.stats));
  }
  if (data.error_message !== undefined) {
    sets.push('cgj_error_message = ?');
    values.push(data.error_message);
  }
  if (data.error_code !== undefined) {
    sets.push('cgj_error_code = ?');
    values.push(data.error_code);
  }
  if (data.started_at !== undefined) {
    sets.push('cgj_started_at = ?');
    values.push(data.started_at);
  }
  if (data.finished_at !== undefined) {
    sets.push('cgj_finished_at = ?');
    values.push(data.finished_at);
  }

  if (sets.length === 0) return false;

  sets.push('cgj_updated_at = ?');
  values.push(nowIso());
  values.push(id);

  const sql = `UPDATE ${JOBS_TABLE} SET ${sets.join(', ')} WHERE cgj_id = ?`;
  const result = stmt(db, sql).run(...values);
  return result.changes > 0;
}, `${JOBS_TABLE}.update`);

/**
 * Mark a running/pending job as cancelled.
 */
export const requestCancel = (db, id) => dbExec(() => {
  const sql = `
    UPDATE ${JOBS_TABLE}
    SET cgj_status = 'cancelled', cgj_finished_at = ?, cgj_updated_at = ?
    WHERE cgj_id = ? AND cgj_status IN ('pending','running')
  `;
  const now = nowIso();
  const result = stmt(db, sql).run(now, now, id);
  return result.changes > 0;
}, `${JOBS_TABLE}.cancel`);

/**
 * Append a log entry to the job log table.
 */
export const appendLog = (db, jobId, { stage, level, message, details }) => dbExec(() => {
  const sql = `
    INSERT INTO ${LOGS_TABLE} (cgj_id, cgjl_stage, cgjl_level, cgjl_message, cgjl_details, cgjl_created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const detailsJson = details ? JSON.stringify(details) : null;
  stmt(db, sql).run(jobId, stage || null, level, message, detailsJson, nowIso());
  return true;
}, `${LOGS_TABLE}.append`);

/**
 * Fetch paginated logs for a job.
 */
export const listLogs = (db, jobId, { limit = 200, offset = 0 } = {}) => dbExec(() => {
  const sql = `
    SELECT cgjl_id, cgj_id, cgjl_stage, cgjl_level, cgjl_message, cgjl_details, cgjl_created_at
    FROM ${LOGS_TABLE}
    WHERE cgj_id = ?
    ORDER BY cgjl_created_at ASC, cgjl_id ASC
    LIMIT ? OFFSET ?
  `;
  const rows = stmt(db, sql).all(jobId, limit, offset);
  return rows.map((row) => ({
    id: row.cgjl_id,
    job_id: row.cgj_id,
    stage: row.cgjl_stage,
    level: row.cgjl_level,
    message: row.cgjl_message,
    details: safeJsonParse(row.cgjl_details, null),
    created_at: row.cgjl_created_at,
  }));
}, `${LOGS_TABLE}.list`);

/**
 * Count active jobs for a scope. Returns { count }.
 */
export const countActiveJobs = (db, serverId, bankId) => dbExec(() => {
  const sql = `
    SELECT COUNT(*) AS count FROM ${JOBS_TABLE}
    WHERE cgj_server_id = ? AND cgj_bank_id = ? AND cgj_status IN ('pending','running')
  `;
  const row = stmt(db, sql).get(requireInt('cgj_server_id', serverId), bankId);
  return row?.count ?? 0;
}, `${JOBS_TABLE}.countActive`);
