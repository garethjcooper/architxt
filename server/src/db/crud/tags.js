import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { requireString, requireInt, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'tags';
const PK = 'tag_id';
const JSON_FIELDS = [];  // No JSON fields in this table

// Use base for generic operations with integer primary key (like contexts)
const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

// Export generated base functions
export const getTag = base.get;
export const listTags = base.list;
export const deleteTag = base.del;

/**
 * Get usage counts for a list of tag IDs
 * @param {Object} db - Database connection
 * @param {number[]} tagIds - Array of tag IDs
 * @returns {Map<number, number>} Map of tag_id -> count
 */
export const getTagUsageCounts = (db, tagIds) => dbExec(() => {
  const placeholders = tagIds.map(() => '?').join(',');
  const sql = `SELECT tag_id, COUNT(*) as count FROM document_tags WHERE tag_id IN (${placeholders}) GROUP BY tag_id`;
  const rows = stmt(db, sql).all(...tagIds);
  const map = new Map();
  for (const r of rows) map.set(r.tag_id, r.count);
  return map;
}, 'tags.usageCounts');

/**
 * Create tag - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {Object} data - Must have tag_name, tag_generated_by
 */
export const createTag = (db, data) => dbExec(() => {
  // Route layer already validated API fields and translated to DB names
  const tagName = data.tag_name;
  const generatedBy = data.tag_generated_by;
  
  // These should already be validated by route layer
  if (!tagName) throw new Error('Internal: tag_name is required');
  if (!generatedBy) throw new Error('Internal: tag_generated_by is required');
  
  const sql = `INSERT INTO ${TABLE} (tag_name, tag_generated_by) VALUES (?, ?)`;
  const result = stmt(db, sql).run(tagName, generatedBy);
  
  return result.lastInsertRowid;
}, 'tags.create');

/**
 * Get a tag by its name.
 * @param {Object} db - Database connection
 * @param {string} tagName - Tag name
 * @returns {Object|null} Tag row, or null if not found
 */
export const getTagByName = (db, tagName) => dbExec(() => {
  const name = requireString('tag_name', tagName);
  const sql = `SELECT * FROM ${TABLE} WHERE tag_name = ?`;
  return stmt(db, sql).get(name) || null;
}, 'tags.getByName');

/**
 * Resolve an existing tag by name, or create it if it does not exist.
 * @param {Object} db - Database connection
 * @param {string} tagName - Tag name
 * @param {string} generatedBy - Value for tag_generated_by when creating
 * @returns {number|null} tag_id, or null if creation failed
 */
export const getOrCreateTagByName = (db, tagName, generatedBy) => dbExec(() => {
  const existing = getTagByName(db, tagName).data;
  if (existing) return existing.tag_id;

  const createdId = createTag(db, {
    tag_name: tagName,
    tag_generated_by: generatedBy,
  });
  return createdId ?? null;
}, 'tags.getOrCreateByName');

/**
 * Update tag - expects DB field names from route layer
 * @param {Object} db - Database connection
 * @param {number} id - Tag ID (INTEGER primary key)
 * @param {Object} data - Fields to update (tag_name only)
 * @returns {Promise<{success: true, data: boolean}|{success: false, error: string, code: string}>}
 */
export const updateTag = (db, id, data) => dbExec(() => {
  // Only tag_name is updatable
  const tagName = data.tag_name;
  
  requireString('tag_name', tagName);
  
  const sql = `UPDATE ${TABLE} SET tag_name = ?, tag_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(tagName, id);
  
  // Return null if no row was updated (not found), true otherwise
  return result.changes > 0 ? true : null;
}, 'tags.update');
