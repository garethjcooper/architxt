import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { fromJson, requireString, requireInt, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'directives';
const PK = 'dir_id';
const JSON_FIELDS = [];  // No JSON fields in this table

const VALID_BOOLEAN_STRINGS = new Set(['true', 'false']);

function toDbBool(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (value === 1) return 'true';
    if (value === 0) return 'false';
  }
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (VALID_BOOLEAN_STRINGS.has(normalised)) return normalised;
  }
  if (value === null || value === undefined) {
    return null;
  }
  throw new Error(`Invalid boolean value: ${JSON.stringify(value)}`);
}

function normalisePriority(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid priority: ${JSON.stringify(value)}`);
  const truncated = Math.trunc(n);
  if (n !== truncated) throw new Error('Priority must be an integer');
  return truncated;
}

const base = createBaseCrud(TABLE, PK, JSON_FIELDS);

// Use base for generic operations
export const getDirective = base.get;
export const listDirectives = base.list;
export const deleteDirective = base.del;

/**
 * Create directive - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {Object} data - Must have dir_name, dir_statement, dir_generated_by
 */
export const createDirective = (db, data) => dbExec(() => {
  const extId = data.dir_ext_id ?? null;
  const name = data.dir_name;
  const statement = data.dir_statement;
  const generatedBy = data.dir_generated_by;
  const isActive = data.dir_is_active;
  const priority = data.dir_priority;

  if (!name) throw new Error('Internal: dir_name is required');
  if (!statement) throw new Error('Internal: dir_statement is required');
  if (!generatedBy) throw new Error('Internal: dir_generated_by is required');

  if (extId) {
    const dup = stmt(db, `SELECT ${PK} FROM ${TABLE} WHERE dir_ext_id = ?`).get(extId);
    if (dup) {
      const error = new Error(`A directive with ext_id "${extId}" already exists`);
      error.code = 'CONFLICT';
      throw error;
    }
  }

  const sql = `INSERT INTO ${TABLE} (dir_ext_id, dir_name, dir_statement, dir_is_active, dir_priority, dir_generated_by) VALUES (?, ?, ?, ?, ?, ?)`;
  const result = stmt(db, sql).run(extId, name, statement, toDbBool(isActive ?? true), normalisePriority(priority ?? 0), generatedBy);

  return result.lastInsertRowid;
}, 'directives.create');

/**
 * Update directive - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {number} id - Directive ID
 * @param {Object} data - Fields to update
 * @returns {Promise<{success: true, data: boolean}|{success: false, error: string, code: string}>}
 */
export const updateDirective = (db, id, data) => dbExec(() => {
  const name = data.dir_name;
  const statement = data.dir_statement;
  const isActive = data.dir_is_active;
  const priority = data.dir_priority;

  const fields = [];
  const values = [];

  if (name !== undefined) {
    if (!name) throw new Error('Internal: dir_name cannot be empty');
    fields.push('dir_name = ?');
    values.push(name);
  }
  if (statement !== undefined) {
    if (!statement) throw new Error('Internal: dir_statement cannot be empty');
    fields.push('dir_statement = ?');
    values.push(statement);
  }
  if (isActive !== undefined) {
    fields.push('dir_is_active = ?');
    values.push(toDbBool(isActive));
  }
  if (priority !== undefined) {
    fields.push('dir_priority = ?');
    values.push(normalisePriority(priority));
  }

  if (fields.length === 0) {
    return true;
  }

  fields.push('dir_updated_at = CURRENT_TIMESTAMP');
  const sql = `UPDATE ${TABLE} SET ${fields.join(', ')} WHERE ${PK} = ?`;
  values.push(id);
  const result = stmt(db, sql).run(...values);

  return result.changes > 0 ? true : null;
}, 'directives.update');

/**
 * Update a directive's external id (e.g. after a successful Hindsight push).
 */
export const updateDirectiveExtId = (db, id, extId) => dbExec(() => {
  if (extId !== null && extId !== undefined) {
    requireString(extId, 'dir_ext_id');
    const dup = stmt(db, `SELECT ${PK} FROM ${TABLE} WHERE dir_ext_id = ? AND ${PK} != ?`).get(extId, id);
    if (dup) {
      const error = new Error(`Another directive with ext_id "${extId}" already exists`);
      error.code = 'CONFLICT';
      throw error;
    }
  }
  const sql = `UPDATE ${TABLE} SET dir_ext_id = ?, dir_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(extId ?? null, id);
  return result.changes > 0 ? true : null;
}, 'directives.updateExtId');

/**
 * Get directive by external id.
 */
export const getDirectiveByExtId = (db, extId) => dbExec(() => {
  requireString(extId, 'dir_ext_id');
  const sql = `SELECT * FROM ${TABLE} WHERE dir_ext_id = ?`;
  const row = stmt(db, sql).get(extId);
  return row || null;
}, 'directives.getByExtId');

/**
 * Get all tags for a specific directive.
 */
export const getDirectiveTags = (db, dirId) => dbExec(() => {
  const sql = `
    SELECT t.* FROM tags t
    JOIN directive_tags dt ON t.tag_id = dt.tag_id
    WHERE dt.dir_id = ?
  `;
  return stmt(db, sql).all(requireInt('dir_id', dirId));
}, 'directiveTags.getByDirective');

/**
 * List directives suitable for a Hindsight diff.
 * Returns tag names as a plain string array for easy set comparison.
 */
export const listDirectivesForDiff = (db, options = {}) => dbExec(() => {
  const { limit = 1000, offset = 0 } = options;
  const sql = `
    SELECT d.dir_id, d.dir_ext_id, d.dir_name, d.dir_statement, d.dir_is_active, d.dir_priority,
      (SELECT json_group_array(t.tag_name)
       FROM directive_tags dt
       JOIN tags t ON dt.tag_id = t.tag_id
       WHERE dt.dir_id = d.dir_id) AS dir_tag_names
    FROM directives d
    ORDER BY d.dir_id
    LIMIT ? OFFSET ?
  `;
  const rows = stmt(db, sql).all(requireInt('limit', limit), requireInt('offset', offset));
  return rows.map((r) => fromJson(r, ['dir_tag_names']));
}, 'directives.listForDiff');

/**
 * Get all directive-tag associations for diff comparison.
 */
export const getAllDirectiveTags = (db) => dbExec(() => {
  const sql = `
    SELECT dt.dir_id, t.tag_name
    FROM directive_tags dt
    JOIN tags t ON dt.tag_id = t.tag_id
  `;
  return stmt(db, sql).all();
}, 'directiveTags.getAll');

/**
 * Add a tag to a directive.
 */
export const addDirectiveTag = (db, dirId, tagId) => dbExec(() => {
  const dId = requireInt('dir_id', dirId);
  const tId = requireInt('tag_id', tagId);
  const sql = `INSERT OR IGNORE INTO directive_tags (dir_id, tag_id) VALUES (?, ?)`;
  stmt(db, sql).run(dId, tId);
  return { dir_id: dId, tag_id: tId };
}, 'directiveTags.add');

/**
 * Remove a tag from a directive.
 */
export const removeDirectiveTag = (db, dirId, tagId) => dbExec(() => {
  const dId = requireInt('dir_id', dirId);
  const tId = requireInt('tag_id', tagId);
  const sql = `DELETE FROM directive_tags WHERE dir_id = ? AND tag_id = ?`;
  const result = stmt(db, sql).run(dId, tId);
  return result.changes > 0;
}, 'directiveTags.remove');

/**
 * Batch add/remove tags across directives.
 * @returns {Promise<{modelsUpdated: number, tagsAdded: number, tagsRemoved: number}>}
 */
export const batchUpdateDirectiveTags = (db, dirIds, tagsToAdd, tagsToRemove) => dbExec(() => {
  const validDirIds = dirIds.map((id) => requireInt('dir_id', id));
  const validAddTags = (tagsToAdd || []).map((id) => requireInt('tag_id', id));
  const validRemoveTags = (tagsToRemove || []).map((id) => requireInt('tag_id', id));

  let tagsAdded = 0;
  let tagsRemoved = 0;

  // Track unique directives touched
  const touched = new Set();

  for (const dirId of validDirIds) {
    for (const tagId of validAddTags) {
      const sql = `INSERT OR IGNORE INTO directive_tags (dir_id, tag_id) VALUES (?, ?)`;
      const result = stmt(db, sql).run(dirId, tagId);
      if (result.changes > 0) {
        tagsAdded++;
        touched.add(dirId);
      }
    }
    for (const tagId of validRemoveTags) {
      const sql = `DELETE FROM directive_tags WHERE dir_id = ? AND tag_id = ?`;
      const result = stmt(db, sql).run(dirId, tagId);
      if (result.changes > 0) {
        tagsRemoved++;
        touched.add(dirId);
      }
    }
  }

  return { modelsUpdated: touched.size, tagsAdded, tagsRemoved };
}, 'directiveTags.batchUpdate');
