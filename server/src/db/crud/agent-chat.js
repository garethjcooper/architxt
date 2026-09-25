import { stmt } from '../../cache.js';
import { dbExec, requireInt, requireString, fromJson, toJson } from '../../utils/db-helpers.js';

const THREAD_TABLE = 'agent_chat_threads';
const THREAD_PK = 'act_id';
const MESSAGE_TABLE = 'agent_chat_messages';
const MESSAGE_PK = 'acm_id';
const MESSAGE_JSON_FIELDS = ['acm_context_snapshot', 'acm_tool_log', 'acm_envelope', 'acm_contextual_items'];

export const getMessage = (db, messageId) => dbExec(() => {
  const id = requireInt('messageId', messageId);
  const sql = `SELECT * FROM ${MESSAGE_TABLE} WHERE ${MESSAGE_PK} = ?`;
  const row = stmt(db, sql).get(id);
  return row ? fromJson(row, MESSAGE_JSON_FIELDS) : null;
}, 'agentChat.getMessage');

/**
 * List chat threads for a research session, newest first.
 * @param {Object} db
 * @param {number} sessionId
 */
export const listThreadsForSession = (db, sessionId) => dbExec(() => {
  const id = requireInt('sessionId', sessionId);
  const sql = `SELECT * FROM ${THREAD_TABLE} WHERE rs_id = ? ORDER BY act_updated_at DESC, act_id DESC`;
  const rows = stmt(db, sql).all(id);
  return rows;
}, 'agentChat.listThreadsForSession');

/**
 * Get a chat thread by id.
 * @param {Object} db
 * @param {number} threadId
 */
export const getThread = (db, threadId) => dbExec(() => {
  const id = requireInt('threadId', threadId);
  const sql = `SELECT * FROM ${THREAD_TABLE} WHERE ${THREAD_PK} = ?`;
  return stmt(db, sql).get(id) || null;
}, 'agentChat.getThread');

/**
 * Create a chat thread.
 * @param {Object} db
 * @param {Object} data - { rs_id, act_title }
 */
export const createThread = (db, data) => dbExec(() => {
  const rsId = requireInt('rs_id', data.rs_id);
  requireString('act_title', data.act_title);
  const sql = `INSERT INTO ${THREAD_TABLE} (rs_id, act_title) VALUES (?, ?)`;
  const result = stmt(db, sql).run(rsId, data.act_title);
  return result.lastInsertRowid;
}, 'agentChat.createThread');

/**
 * Update a chat thread title.
 * @param {Object} db
 * @param {number} threadId
 * @param {Object} data - { act_title }
 */
export const updateThread = (db, threadId, data) => dbExec(() => {
  const id = requireInt('threadId', threadId);
  const allowedFields = new Set(['act_title']);
  const entries = Object.entries(data).filter(([key]) => allowedFields.has(key));
  if (entries.length === 0) {
    throw new Error('No allowed fields to update');
  }
  const columns = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([key]) => data[key]);
  const sql = `UPDATE ${THREAD_TABLE} SET ${columns}, act_updated_at = CURRENT_TIMESTAMP WHERE ${THREAD_PK} = ?`;
  const result = stmt(db, sql).run(...values, id);
  if (result.changes === 0) {
    throw new Error('Thread not found');
  }
  return true;
}, 'agentChat.updateThread');

/**
 * Delete a chat thread and cascade its messages.
 * @param {Object} db
 * @param {number} threadId
 */
export const deleteThread = (db, threadId) => dbExec(() => {
  const id = requireInt('threadId', threadId);
  const result = stmt(db, `DELETE FROM ${THREAD_TABLE} WHERE ${THREAD_PK} = ?`).run(id);
  return result.changes;
}, 'agentChat.deleteThread');

/**
 * List chat messages for a thread, oldest first.
 * @param {Object} db
 * @param {number} threadId
 */
export const listMessagesForThread = (db, threadId) => dbExec(() => {
  const id = requireInt('threadId', threadId);
  const sql = `SELECT * FROM ${MESSAGE_TABLE} WHERE act_id = ? ORDER BY acm_id ASC`;
  const rows = stmt(db, sql).all(id);
  return rows.map(r => fromJson(r, MESSAGE_JSON_FIELDS));
}, 'agentChat.listMessagesForThread');

/**
/**
 * Create a chat message.
 * @param {Object} db
 * @param {Object} data - { act_id, rs_id, acm_role, acm_content, acm_context_snapshot?, acm_tool_log?, acm_envelope?, acm_contextual_items? }
 */
export const createMessage = (db, data) => dbExec(() => {
  requireInt('act_id', data.act_id);
  requireInt('rs_id', data.rs_id);
  requireString('acm_role', data.acm_role);
  requireString('acm_content', data.acm_content);

  const allowedRoles = ['user', 'agent', 'system'];
  if (!allowedRoles.includes(data.acm_role)) {
    throw new Error(`acm_role must be one of ${allowedRoles.join(', ')}; got: ${data.acm_role}`);
  }

  const prepared = toJson(data, MESSAGE_JSON_FIELDS);
  const sql = `INSERT INTO ${MESSAGE_TABLE} (
    act_id, rs_id, acm_role, acm_content, acm_context_snapshot, acm_tool_log, acm_envelope, acm_contextual_items
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  const result = stmt(db, sql).run(
    prepared.act_id,
    prepared.rs_id,
    prepared.acm_role,
    prepared.acm_content,
    prepared.acm_context_snapshot ?? null,
    prepared.acm_tool_log ?? null,
    prepared.acm_envelope ?? null,
    prepared.acm_contextual_items ?? null
  );
  return result.lastInsertRowid;
}, 'agentChat.createMessage');

/**
 * Delete a single chat message by id.
 * @param {Object} db
 * @param {number} messageId
 */
export const deleteMessage = (db, messageId) => dbExec(() => {
  const id = requireInt('messageId', messageId);
  const result = stmt(db, `DELETE FROM ${MESSAGE_TABLE} WHERE ${MESSAGE_PK} = ?`).run(id);
  return result.changes;
}, 'agentChat.deleteMessage');

/**
 * Delete all chat messages for a thread.
 * @param {Object} db
 * @param {number} threadId
 */
export const deleteMessagesForThread = (db, threadId) => dbExec(() => {
  const id = requireInt('threadId', threadId);
  const result = stmt(db, `DELETE FROM ${MESSAGE_TABLE} WHERE act_id = ?`).run(id);
  return result.changes;
}, 'agentChat.deleteMessagesForThread');

/**
 * Count messages in a thread.
 * @param {Object} db
 * @param {number} threadId
 */
export const countMessagesForThread = (db, threadId) => dbExec(() => {
  const id = requireInt('threadId', threadId);
  const row = stmt(db, `SELECT COUNT(*) AS cnt FROM ${MESSAGE_TABLE} WHERE act_id = ?`).get(id);
  return row?.cnt ?? 0;
}, 'agentChat.countMessagesForThread');
