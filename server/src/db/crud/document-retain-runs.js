import { stmt } from '../../cache.js';
import { requireInt, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'document_retain_runs';

const PUBLIC_FIELDS = [
  'drr_id',
  'drr_doc_id',
  'drr_run_label',
  'drr_server_id',
  'drr_bank_id',
  'drr_context',
  'drr_retain_mission',
  'drr_extraction_mode',
  'drr_timestamp',
  'drr_entity_label_source',
  'drr_entities_allow_free_form',
  'drr_content_snapshot',
  'drr_content_hash',
  'drr_facts_json',
  'drr_usage_json',
  'drr_model',
  'drr_created_at',
  'drr_updated_at',
].join(',');

function safeJsonParse(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToRun(row) {
  if (!row) return null;
  return {
    id: row.drr_id,
    doc_id: row.drr_doc_id,
    run_label: row.drr_run_label,
    server_id: row.drr_server_id,
    bank_id: row.drr_bank_id,
    context: row.drr_context,
    retain_mission: row.drr_retain_mission,
    extraction_mode: row.drr_extraction_mode,
    timestamp: row.drr_timestamp,
    entity_label_source: row.drr_entity_label_source,
    free_form_entities: !!row.drr_entities_allow_free_form,
    content_snapshot: row.drr_content_snapshot,
    content_hash: row.drr_content_hash,
    facts: safeJsonParse(row.drr_facts_json, []),
    usage: safeJsonParse(row.drr_usage_json, null),
    model: row.drr_model,
    created_at: row.drr_created_at,
    updated_at: row.drr_updated_at,
  };
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Persist a new retain dry-run output.
 * @param {Object} db
 * @param {Object} data
 * @returns {{success: boolean, data?: Object, error?: string}}
 */
export const createRun = (db, data) => dbExec(() => {
  const docId = requireInt('drr_doc_id', data.doc_id);
  const sql = `
    INSERT INTO ${TABLE} (
      drr_doc_id, drr_run_label, drr_server_id, drr_bank_id, drr_context,
      drr_retain_mission, drr_extraction_mode, drr_timestamp, drr_entity_label_source,
      drr_entities_allow_free_form, drr_content_snapshot, drr_content_hash,
      drr_facts_json, drr_usage_json, drr_model, drr_created_at, drr_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const now = nowIso();
  const result = stmt(db, sql).run(
    docId,
    data.run_label ?? null,
    data.server_id ?? null,
    data.bank_id ?? null,
    data.context ?? null,
    data.retain_mission ?? null,
    data.extraction_mode ?? null,
    data.timestamp ?? now,
    data.entity_label_source ?? null,
    data.free_form_entities ?? data.entities_allow_free_form ? 1 : 0,
    data.content_snapshot ?? null,
    data.content_hash ?? null,
    JSON.stringify(data.facts ?? []),
    data.usage ? JSON.stringify(data.usage) : null,
    data.model ?? null,
    now,
    now
  );
  return result.lastInsertRowid;
}, `${TABLE}.create`);

/**
 * List runs for a document, newest first.
 */
export const listRunsByDocument = (db, docId, { limit = 50, offset = 0 } = {}) => dbExec(() => {
  const id = requireInt('drr_doc_id', docId);
  const sql = `
    SELECT ${PUBLIC_FIELDS}
    FROM ${TABLE}
    WHERE drr_doc_id = ?
    ORDER BY drr_created_at DESC, drr_id DESC
    LIMIT ? OFFSET ?
  `;
  const rows = stmt(db, sql).all(id, limit, offset);
  return rows.map(rowToRun);
}, `${TABLE}.listByDocument`);

/**
 * Get a single run by id (and optionally verify it belongs to a document).
 */
export const getRun = (db, runId, docId = null) => dbExec(() => {
  const id = requireInt('drr_id', runId);
  let sql = `SELECT ${PUBLIC_FIELDS} FROM ${TABLE} WHERE drr_id = ?`;
  const values = [id];
  if (docId !== null && docId !== undefined) {
    sql += ' AND drr_doc_id = ?';
    values.push(requireInt('drr_doc_id', docId));
  }
  const row = stmt(db, sql).get(...values);
  return rowToRun(row);
}, `${TABLE}.get`);

/**
 * Delete a run.
 */
export const deleteRun = (db, runId) => dbExec(() => {
  const id = requireInt('drr_id', runId);
  const sql = `DELETE FROM ${TABLE} WHERE drr_id = ?`;
  const result = stmt(db, sql).run(id);
  return result.changes > 0;
}, `${TABLE}.delete`);
