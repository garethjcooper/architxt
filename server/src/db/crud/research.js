import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { dbExec, requireString, requireInt, requireField, fromJson, toJson } from '../../utils/db-helpers.js';

// research_sessions
const SESSION_TABLE = 'research_sessions';
const SESSION_PK = 'rs_id';
const SESSION_JSON_FIELDS = [
  'rs_viewpoint_ids',
  'rs_scope_entity_ids',
];

// research_steps
const STEP_TABLE = 'research_steps';
const STEP_PK = 'rstep_id';
const STEP_JSON_FIELDS = [
  'rstep_selections',
  'rstep_parameters',
  'rstep_viewpoint_ids',
  'rstep_canvas_state',
  'rstep_synthesis',
  'rstep_envelope',
  'rstep_calls',
];

const sessionBase = createBaseCrud(SESSION_TABLE, SESSION_PK, SESSION_JSON_FIELDS);
const stepBase = createBaseCrud(STEP_TABLE, STEP_PK, STEP_JSON_FIELDS);

// Generic operations
export const getSession = sessionBase.get;
export const listSessions = sessionBase.list;
export const deleteSession = sessionBase.del;
export const getStep = stepBase.get;
export const updateStep = (db, stepId, data) => dbExec(() => {
  const id = requireInt('stepId', stepId);
  const allowedFields = new Set([...STEP_JSON_FIELDS, 'rstep_status', 'rstep_error_message', 'rstep_raw_query', 'rstep_created_at']);
  const entries = Object.entries(data).filter(([key]) => allowedFields.has(key));
  if (entries.length === 0) {
    throw new Error('No allowed fields to update');
  }
  const prepared = toJson(Object.fromEntries(entries), STEP_JSON_FIELDS);
  const columns = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([key]) => prepared[key] ?? data[key]);
  const sql = `UPDATE ${STEP_TABLE} SET ${columns} WHERE ${STEP_PK} = ?`;
  const result = stmt(db, sql).run(...values, id);
  return result.changes > 0 ? true : null;
}, 'research.updateStep');
export const listStepsForSession = (db, sessionId) => dbExec(() => {
  const id = requireInt('sessionId', sessionId);
  const sql = `SELECT * FROM ${STEP_TABLE} WHERE rs_id = ? ORDER BY rstep_id ASC`;
  const rows = stmt(db, sql).all(id);
  return rows.map(r => fromJson(r, STEP_JSON_FIELDS));
}, 'research.listSteps');
export const deleteStep = stepBase.del;

/**
 * Delete a research step and return its session plus the remaining step count.
 * Cascading FK on rstep_parent_step_id removes dependent child steps.
 * rs_current_step_id is set NULL automatically by ON DELETE SET NULL.
 *
 * @param {Object} db
 * @param {number} stepId
 * @returns {{ session_id: number, remaining_step_count: number } | null}
 */
export const deleteStepWithSession = (db, stepId) => dbExec(() => {
  const id = requireInt('stepId', stepId);

  const stepRow = stmt(db, `SELECT rs_id FROM ${STEP_TABLE} WHERE ${STEP_PK} = ?`).get(id);
  if (!stepRow) return null;

  const sessionId = stepRow.rs_id;

  stmt(db, `DELETE FROM ${STEP_TABLE} WHERE ${STEP_PK} = ?`).run(id);

  const countRow = stmt(db, `SELECT COUNT(*) AS cnt FROM ${STEP_TABLE} WHERE rs_id = ?`).get(sessionId);

  return {
    session_id: sessionId,
    remaining_step_count: countRow?.cnt ?? 0,
  };
}, 'research.deleteStepWithSession');

/**
 * Create a research session.
 * @param {Object} db
 * @param {Object} data - DB field names (rs_title, rs_server_id, rs_bank_id, rs_viewpoint_ids, rs_description)
 */
export const createSession = (db, data) => dbExec(() => {
  requireString('rs_title', data.rs_title);
  requireString('rs_bank_id', data.rs_bank_id);
  requireField(data, 'rs_viewpoint_ids');

  if (data.rs_status !== undefined && data.rs_status !== null && !['active', 'closed', 'archived'].includes(data.rs_status)) {
    throw new Error(`rs_status must be one of active, closed, archived; got: ${data.rs_status}`);
  }

  const prepared = toJson(data, SESSION_JSON_FIELDS);
  const sql = `INSERT INTO ${SESSION_TABLE} (
    rs_title, rs_description, rs_server_id, rs_bank_id, rs_viewpoint_ids, rs_scope_entity_ids, rs_status, rs_current_step_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  const result = stmt(db, sql).run(
    prepared.rs_title ?? '',
    prepared.rs_description ?? null,
    prepared.rs_server_id ?? null,
    prepared.rs_bank_id,
    prepared.rs_viewpoint_ids,
    prepared.rs_scope_entity_ids ?? null,
    prepared.rs_status ?? 'active',
    prepared.rs_current_step_id ?? null
  );
  return result.lastInsertRowid;
}, 'research.createSession');

export const listSessionsByServerBank = (db, serverId, bankId) => dbExec(() => {
  const sid = requireInt('serverId', serverId);
  const bid = requireString('bankId', bankId);
  // Legacy rows created before the rs_server_id migration have a NULL server id.
  // Show them as a fallback so existing sessions remain visible until they are
  // re-associated with a specific server.
  const sql = `SELECT * FROM ${SESSION_TABLE} WHERE rs_bank_id = ? AND (rs_server_id = ? OR rs_server_id IS NULL) ORDER BY rs_updated_at DESC, rs_id DESC`;
  const rows = stmt(db, sql).all(bid, sid);
  return rows.map(r => fromJson(r, SESSION_JSON_FIELDS));
}, 'research.listSessionsByServerBank');

/**
 * Update session's current step pointer.
 * @param {Object} db
 * @param {number} sessionId
 * @param {number|null} currentStepId
 */
export const updateSessionCurrentStep = (db, sessionId, currentStepId) => dbExec(() => {
  const id = requireInt('sessionId', sessionId);
  const stepId = currentStepId === null ? null : requireInt('currentStepId', currentStepId);
  const sql = `UPDATE ${SESSION_TABLE} SET rs_current_step_id = ?, rs_updated_at = CURRENT_TIMESTAMP WHERE ${SESSION_PK} = ?`;
  const result = stmt(db, sql).run(stepId, id);
  return result.changes > 0 ? true : null;
}, 'research.updateSessionCurrentStep');

export const updateSession = (db, sessionId, data) => dbExec(() => {
  const id = requireInt('sessionId', sessionId);
  const allowedFields = new Set([...SESSION_JSON_FIELDS, 'rs_title', 'rs_description', 'rs_status', 'rs_current_step_id']);
  const entries = Object.entries(data).filter(([key]) => allowedFields.has(key));
  if (entries.length === 0) {
    throw new Error('No allowed fields to update');
  }
  if (data.rs_status !== undefined && data.rs_status !== null && !['active', 'closed', 'archived'].includes(data.rs_status)) {
    throw new Error(`rs_status must be one of active, closed, archived; got: ${data.rs_status}`);
  }
  const prepared = toJson(Object.fromEntries(entries), SESSION_JSON_FIELDS);
  const columns = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([key]) => prepared[key] ?? data[key]);
  const sql = `UPDATE ${SESSION_TABLE} SET ${columns}, rs_updated_at = CURRENT_TIMESTAMP WHERE ${SESSION_PK} = ?`;
  const result = stmt(db, sql).run(...values, id);
  return result.changes > 0 ? true : null;
}, 'research.updateSession');

/**
 * Delete a research session and cascade delete its steps.
 */
export const deleteSessionWithSteps = (db, sessionId) => dbExec(() => {
  const id = requireInt('sessionId', sessionId);
  stmt(db, `DELETE FROM ${STEP_TABLE} WHERE rs_id = ?`).run(id);
  stmt(db, `DELETE FROM research_session_tags WHERE rs_id = ?`).run(id);
  const result = stmt(db, `DELETE FROM ${SESSION_TABLE} WHERE ${SESSION_PK} = ?`).run(id);
  return result.changes > 0;
}, 'research.deleteSessionWithSteps');

/**
 * Create a research step.
 * @param {Object} db
 * @param {Object} data - DB field names
 */
export const createStep = (db, data) => dbExec(() => {
  requireInt('rs_id', data.rs_id);
  requireString('rstep_intent_text', data.rstep_intent_text);
  requireField(data, 'rstep_action_type');

  const prepared = toJson(data, STEP_JSON_FIELDS);
  const sql = `INSERT INTO ${STEP_TABLE} (
    rs_id, rstep_parent_step_id, rstep_intent_text, rstep_raw_query, rstep_selections,
    rstep_action_type, rstep_parameters, rstep_viewpoint_ids, rstep_canvas_state,
    rstep_synthesis, rstep_status, rstep_error_message,
    rstep_tool_calls_used, rstep_calls
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const result = stmt(db, sql).run(
    prepared.rs_id,
    prepared.rstep_parent_step_id ?? null,
    prepared.rstep_intent_text,
    prepared.rstep_raw_query ?? null,
    prepared.rstep_selections ?? null,
    prepared.rstep_action_type,
    prepared.rstep_parameters ?? null,
    prepared.rstep_viewpoint_ids ?? null,
    prepared.rstep_canvas_state ?? null,
    prepared.rstep_synthesis ?? null,
    data.rstep_status ?? 'running',
    data.rstep_error_message ?? null,
    prepared.rstep_tool_calls_used ?? 0,
    prepared.rstep_calls ?? null
  );
  return result.lastInsertRowid;
}, 'research.createStep');

/**
 * Get a full session with tags and its current step.
 * @param {Object} db
 * @param {number} sessionId
 */
export const createSessionPage = (db, sessionId, title) => dbExec(() => {
  const rsId = requireInt('sessionId', sessionId);
  requireString('title', title);

  const sql = `INSERT INTO ${STEP_TABLE} (
    rs_id, rstep_parent_step_id, rstep_intent_text, rstep_raw_query, rstep_selections,
    rstep_action_type, rstep_parameters, rstep_viewpoint_ids, rstep_canvas_state,
    rstep_synthesis, rstep_envelope, rstep_status, rstep_error_message,
    rstep_tool_calls_used, rstep_calls
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const blankEnvelope = JSON.stringify({ narrative: '', graph: { nodes: [], edges: [] }, tables: [], diagrams: [] });
  const result = stmt(db, sql).run(
    rsId,
    null,
    title,
    null,
    null,
    'curated_page',
    null,
    null,
    JSON.stringify({ graph: { nodes: [], edges: [] }, tables: [], diagrams: [] }),
    JSON.stringify({ narrative: '' }),
    blankEnvelope,
    'completed',
    null,
    0,
    null
  );
  return result.lastInsertRowid;
}, 'research.createSessionPage');

/**
 * Update a curated_page step. Unlike updateStep, this allows renaming the page
 * by updating rstep_intent_text.
 */
export const updateCuratedPage = (db, stepId, data) => dbExec(() => {
  const id = requireInt('stepId', stepId);
  const allowedFields = new Set([...STEP_JSON_FIELDS, 'rstep_intent_text', 'rstep_status', 'rstep_error_message']);
  const entries = Object.entries(data).filter(([key]) => allowedFields.has(key));
  if (entries.length === 0) {
    throw new Error('No allowed fields to update');
  }

  // For curated pages, an rstep_envelope update is the canonical write. Keep the
  // legacy split fields in sync so older consumers continue to work until the
  // full migration is complete.
  const updateData = Object.fromEntries(entries);
  if (updateData.rstep_envelope) {
    const envelope = typeof updateData.rstep_envelope === 'string'
      ? JSON.parse(updateData.rstep_envelope)
      : updateData.rstep_envelope;
    updateData.rstep_synthesis = { narrative: typeof envelope.narrative === 'string' ? envelope.narrative : '' };
    updateData.rstep_canvas_state = {
      graph: envelope.graph ?? { nodes: [], edges: [] },
      tables: envelope.tables ?? [],
      diagrams: envelope.diagrams ?? [],
    };
  }

  const prepared = toJson(updateData, STEP_JSON_FIELDS);
  const columns = Object.keys(updateData).map((key) => `${key} = ?`).join(', ');
  const values = Object.keys(updateData).map((key) => prepared[key] ?? updateData[key]);
  const sql = `UPDATE ${STEP_TABLE} SET ${columns} WHERE ${STEP_PK} = ? AND rstep_action_type = 'curated_page'`;
  const result = stmt(db, sql).run(...values, id);
  if (result.changes === 0) {
    throw new Error('Step not found or is not a curated_page');
  }
  return true;
}, 'research.updateCuratedPage');

/**
 * Get a full session with tags and its current step.
 * @param {Object} db
 * @param {number} sessionId
 */
export const getSessionWithCurrentStep = (db, sessionId) => dbExec(() => {
  const id = requireInt('sessionId', sessionId);
  const sessionSql = `SELECT * FROM ${SESSION_TABLE} WHERE ${SESSION_PK} = ?`;
  const sessionRow = stmt(db, sessionSql).get(id);
  if (!sessionRow) return null;

  const tagsSql = `SELECT tag_id FROM research_session_tags WHERE rs_id = ?`;
  const tagRows = stmt(db, tagsSql).all(id);
  const tagIds = tagRows.map(r => r.tag_id);

  const step = sessionRow.rs_current_step_id
    ? fromJson(stmt(db, `SELECT * FROM ${STEP_TABLE} WHERE ${STEP_PK} = ?`).get(sessionRow.rs_current_step_id), STEP_JSON_FIELDS)
    : null;

  return {
    ...fromJson(sessionRow, SESSION_JSON_FIELDS),
    tag_ids: tagIds,
    current_step: step
  };
}, 'research.getSessionWithCurrentStep');
