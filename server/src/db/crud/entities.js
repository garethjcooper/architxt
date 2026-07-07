import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { requireInt, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'entities';
const PK = 'ent_id';
const JSON_FIELDS = ['ent_aliases'];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

export const getEntity = base.get;
export const deleteEntity = base.del;

/**
 * Fetch all entities joined with their type names
 * @param {Object} db
 * @returns {Promise<{success: true, data: Array}>}
 */
export const getAllEntitiesWithTypes = (db) => dbExec(() => {
  const sql = `
    SELECT e.ent_id, e.ent_entity_id, e.ent_name, e.ent_description, e.ent_aliases, et.et_type_name, et.et_description
    FROM entities e
    JOIN entity_types et ON e.ent_type_id = et.et_id
    ORDER BY e.ent_entity_id
  `;
  return stmt(db, sql).all();
}, 'entities.getAllWithTypes');

/**
 * Get usage counts for a list of entity IDs (counts documents with entity in content)
 * @param {Object} db - Database connection
 * @param {string[]} entIds - Array of entity IDs
 * @returns {Map<string, number>} Map of ent_entity_id -> count
 */
export const getEntityUsageCounts = (db, entIds) => dbExec(() => {
  if (!entIds || entIds.length === 0) return new Map();
  const placeholders = entIds.map(() => '?').join(',');

  // Build a term list per entity: entity_id, name, and each alias.
  // Then join against the FTS5 index so counts reflect id/name/alias matches
  // consistently with findDocumentsForEntities.
  const sql = `
    WITH terms(ent_entity_id, term) AS (
      SELECT ent_entity_id, ent_entity_id
      FROM entities
      WHERE ent_entity_id IN (${placeholders})
      UNION ALL
      SELECT ent_entity_id, ent_name
      FROM entities
      WHERE ent_entity_id IN (${placeholders}) AND ent_name IS NOT NULL AND ent_name != ''
      UNION ALL
      SELECT e.ent_entity_id, j.value
      FROM entities e, json_each(e.ent_aliases) AS j
      WHERE e.ent_entity_id IN (${placeholders}) AND j.value IS NOT NULL AND j.value != ''
    )
    SELECT t.ent_entity_id, COUNT(DISTINCT d.doc_id) AS count
    FROM terms t
    JOIN documents_fts f ON f.doc_content MATCH '"' || t.term || '"'
    JOIN documents d ON d.doc_id = f.rowid
    GROUP BY t.ent_entity_id
  `;
  const params = [...entIds, ...entIds, ...entIds];
  const rows = stmt(db, sql).all(...params);
  const map = new Map();
  for (const r of rows) map.set(r.ent_entity_id, r.count);
  return map;
}, 'entities.usageCounts');

/**
 * Validate that name, id, and aliases don't conflict with existing rows.
 * Runs a SELECT for overlap so caller can see what collides.
 */
function checkUniqueConflicts(db, typeId, entityId, name, aliases, excludeId = null) {
  // Check ent_entity_id uniqueness
  const idSql = excludeId
    ? `SELECT ent_entity_id AS val FROM ${TABLE} WHERE ent_entity_id = ? AND ${PK} != ?`
    : `SELECT ent_entity_id AS val FROM ${TABLE} WHERE ent_entity_id = ?`;
  const idParams = excludeId ? [entityId, excludeId] : [entityId];
  const idDup = stmt(db, idSql).get(...idParams);
  if (idDup) {
    return { ok: false, field: 'entity_id', conflict: idDup.val };
  }

  // Check ent_name uniqueness
  const nameSql = excludeId
    ? `SELECT ent_name AS val FROM ${TABLE} WHERE ent_name = ? AND ${PK} != ?`
    : `SELECT ent_name AS val FROM ${TABLE} WHERE ent_name = ?`;
  const nameParams = excludeId ? [name, excludeId] : [name];
  const nameDup = stmt(db, nameSql).get(...nameParams);
  if (nameDup) {
    return { ok: false, field: 'name', conflict: nameDup.val };
  }

  // Check that none of {entity_id, name, aliases} collide with existing rows.
  // Each candidate text is checked individually so the error names the exact value.
  const allTexts = [entityId, name, ...(aliases || [])].filter(Boolean);
  for (const text of allTexts) {
    const dupSql = excludeId
      ? `SELECT ? AS val FROM ${TABLE} WHERE ${PK} != ? AND (
          ent_entity_id = ? OR ent_name = ? OR EXISTS(
            SELECT 1 FROM json_each(ent_aliases) WHERE value = ?
          )
        ) LIMIT 1`
      : `SELECT ? AS val FROM ${TABLE} WHERE (
          ent_entity_id = ? OR ent_name = ? OR EXISTS(
            SELECT 1 FROM json_each(ent_aliases) WHERE value = ?
          )
        ) LIMIT 1`;
    const dupParams = excludeId
      ? [text, excludeId, text, text, text]
      : [text, text, text, text];
    const dup = stmt(db, dupSql).get(...dupParams);
    if (dup) {
      return { ok: false, field: 'alias', conflict: dup.val };
    }
  }

  return { ok: true };
}

/**
 * Create entity with JSON aliases
 * @param {Object} db
 * @param {Object} data — { type_id, entity_id, name, description, aliases, generated_by }
 */
export const createEntity = (db, data) => dbExec(() => {
  const { type_id, entity_id, name, description, aliases = [], case_match, word_boundary_match, generated_by } = data;

  if (!entity_id) throw new Error('Internal: entity_id is required');
  if (!name) throw new Error('Internal: name is required');
  if (!type_id) throw new Error('Internal: type_id is required');

  const conflict = checkUniqueConflicts(db, type_id, entity_id, name, aliases);
  if (!conflict.ok) {
    throw new Error(`Duplicate ${conflict.field}: "${conflict.conflict}" already exists`);
  }

  const sql = `INSERT INTO ${TABLE} (ent_type_id, ent_entity_id, ent_name, ent_description, ent_aliases, ent_case_match, ent_word_boundary_match, ent_generated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const result = stmt(db, sql).run(
    type_id, entity_id, name, description || null,
    JSON.stringify(aliases), case_match ?? null, word_boundary_match ?? null, generated_by || null
  );
  return result.lastInsertRowid;
}, 'entities.create');

/**
 * Get entity with its type info
 * @param {Object} db
 * @param {number} id
 */
export const getEntityWithType = (db, id) => dbExec(() => {
  const sql = `
    SELECT e.*, t.et_type_name, t.et_id_label, t.et_name_label, t.et_case_match, t.et_word_boundary_match,
           t.et_uses_entity_id_pattern, t.et_id_format_prefix, t.et_min_id_digits, t.et_id_separator
    FROM ${TABLE} e
    JOIN entity_types t ON e.ent_type_id = t.et_id
    WHERE e.${PK} = ?
  `;
  const row = stmt(db, sql).get(requireInt(PK, id));
  if (!row) return null;

  return {
    ...row,
    ent_aliases: JSON.parse(row.ent_aliases || '[]'),
  };
}, 'entities.getWithType');

/**
 * List all entities with type name
 * @param {Object} db
 */
export const listEntitiesWithType = (db) => dbExec(() => {
  const rows = stmt(db, `
    SELECT e.*, t.et_type_name, t.et_id_label, t.et_name_label, t.et_case_match, t.et_word_boundary_match,
           t.et_uses_entity_id_pattern, t.et_id_format_prefix, t.et_min_id_digits, t.et_id_separator
    FROM ${TABLE} e
    JOIN entity_types t ON e.ent_type_id = t.et_id
    ORDER BY e.${PK} DESC
  `).all();

  return rows.map(r => ({
    ...r,
    ent_aliases: JSON.parse(r.ent_aliases || '[]'),
  }));
}, 'entities.listWithType');

/**
 * List entities scoped by type for detection matching
 * Returns flat { id, entity_id, name, aliases[], type_name }
 */
export const listEntitiesForDetection = (db) => dbExec(() => {
  const rows = stmt(db, `
    SELECT e.*, t.et_case_match AS type_case_match, t.et_word_boundary_match AS type_word_boundary_match
    FROM ${TABLE} e
    JOIN entity_types t ON e.ent_type_id = t.et_id
  `).all();
  return rows.map(r => ({
    id: r.ent_id,
    entity_id: r.ent_entity_id,
    name: r.ent_name,
    aliases: JSON.parse(r.ent_aliases || '[]'),
    type_id: r.ent_type_id,
    type_case_match: r.type_case_match,
    type_word_boundary_match: r.type_word_boundary_match,
    case_match: r.ent_case_match,
    word_boundary_match: r.ent_word_boundary_match,
    description: r.ent_description,
  }));
}, 'entities.listForDetection');

/**
 * Update entity
 * @param {Object} db
 * @param {number} id
 * @param {Object} data
 */
export const updateEntity = (db, id, data) => dbExec(() => {
  const { type_id, entity_id, name, description, aliases, case_match, word_boundary_match, generated_by } = data;

  const existing = stmt(db, `SELECT ent_type_id, ent_entity_id, ent_name, ent_aliases FROM ${TABLE} WHERE ${PK} = ?`).get(id);
  if (!existing) {
    throw new Error('Entity not found');
  }

  // Validate uniqueness if any of the identifier fields changed
  const newId = entity_id !== undefined ? entity_id : existing.ent_entity_id;
  const newName = name !== undefined ? name : existing.ent_name;
  const newAliases = aliases !== undefined ? aliases : JSON.parse(existing.ent_aliases || '[]');

  if (entity_id !== undefined || name !== undefined || aliases !== undefined) {
    const conflict = checkUniqueConflicts(db, existing.ent_type_id, newId, newName, newAliases, id);
    if (!conflict.ok) {
      throw new Error(`Duplicate ${conflict.field}: "${conflict.conflict}" already exists`);
    }
  }

  const updates = ['ent_updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (type_id !== undefined) { updates.push('ent_type_id = ?'); params.push(type_id); }
  if (entity_id !== undefined) { updates.push('ent_entity_id = ?'); params.push(entity_id); }
  if (name !== undefined) { updates.push('ent_name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('ent_description = ?'); params.push(description); }
  if (aliases !== undefined) { updates.push('ent_aliases = ?'); params.push(JSON.stringify(aliases)); }
  if (case_match !== undefined) { updates.push('ent_case_match = ?'); params.push(case_match); }
  if (word_boundary_match !== undefined) { updates.push('ent_word_boundary_match = ?'); params.push(word_boundary_match); }
  if (generated_by !== undefined) { updates.push('ent_generated_by = ?'); params.push(generated_by); }

  if (updates.length > 1) {
    params.push(id);
    stmt(db, `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE ${PK} = ?`).run(...params);
  }

  return true;
}, 'entities.update');

/**
 * Find documents whose indexed content contains any of the selected entities.
 * Uses the FTS5 virtual table on documents.doc_content, searching by entity_id
 * and aliases. Returns distinct { doc_id, doc_ext_id } rows.
 */
export const findDocumentsForEntities = (db, entIds, options = {}) => dbExec(() => {
  if (!entIds || entIds.length === 0) return [];

  const placeholders = entIds.map(() => '?').join(',');
  const entityRows = stmt(db, `
    SELECT e.ent_entity_id, e.ent_name, e.ent_aliases
    FROM entities e
    WHERE e.ent_id IN (${placeholders})
  `).all(...entIds);

  if (entityRows.length === 0) return [];

  const terms = new Set();
  for (const row of entityRows) {
    if (row.ent_entity_id) terms.add(row.ent_entity_id);
    if (row.ent_name) terms.add(row.ent_name);
    const aliases = JSON.parse(row.ent_aliases || '[]');
    for (const alias of aliases) {
      if (alias) terms.add(alias);
    }
  }

  if (terms.size === 0) return [];

  // Build an FTS5 OR query: "term1" OR "term2" ...
  const matchExpr = Array.from(terms)
    .map((t) => `"${String(t).replace(/"/g, '""')}"`)
    .join(' OR ');

  const limit = Math.max(1, Math.min(1000, options.limit ?? 1000));

  const docs = stmt(db, `
    SELECT DISTINCT d.doc_id, d.doc_ext_id, d.doc_filename
    FROM documents d
    JOIN documents_fts f ON f.rowid = d.doc_id
    WHERE f.doc_content MATCH ?
    ORDER BY d.doc_id DESC
    LIMIT ?
  `).all(matchExpr, limit);

  return docs.map((d) => ({
    id: d.doc_id,
    ext_id: d.doc_ext_id,
    filename: d.doc_filename,
  }));
}, 'entities.findDocuments');

/**
 * Compute the next entity id for a given entity type.
 */
export const getNextEntityIdForType = (db, type, options = {}) => dbExec(() => {
  if (!type?.et_uses_entity_id_pattern) return null;

  const { excludeEntityId } = options;
  const prefix = (type.et_id_format_prefix || '').trim();
  const separator = type.et_id_separator === '-' ? '-' : '';
  const digits = Math.max(1, Math.min(10, type.et_min_id_digits ?? 3));
  const typeId = requireInt('type_id', type.et_id);

  // Select all entity ids for this type so we can find the max numeric suffix.
  const rows = stmt(db, `SELECT ent_entity_id FROM ${TABLE} WHERE ent_type_id = ?`).all(typeId);
  const existingIds = new Set(rows.map((r) => r.ent_entity_id));

  // Build a regex matching the type pattern so we only consider conforming ids.
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedSep = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedPrefix}${escapedSep}\\d{${digits},}$`);

  let max = 0;
  for (const { ent_entity_id: id } of rows) {
    if (excludeEntityId && id === excludeEntityId) continue;
    if (!pattern.test(id)) continue;
    const match = id.match(/(\d+)$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n >= 0 && n > max) {
      max = n;
    }
  }

  let next = max + 1;
  let candidate = `${prefix}${separator}${String(next).padStart(digits, '0')}`;
  while (existingIds.has(candidate) && next < Number.MAX_SAFE_INTEGER) {
    if (candidate === excludeEntityId) {
      next += 1;
      candidate = `${prefix}${separator}${String(next).padStart(digits, '0')}`;
      continue;
    }
    next += 1;
    candidate = `${prefix}${separator}${String(next).padStart(digits, '0')}`;
  }

  return candidate;
}, 'entities.getNextEntityIdForType');

export const batchUpdateEntityConfig = (db, entIds, config) => dbExec(() => {
  const ids = entIds.map((id) => requireInt('ent_id', id));

  const updates = [];
  const values = [];

  if (config.type_id !== undefined && config.type_id !== null) {
    updates.push('ent_type_id = ?');
    values.push(requireInt('type_id', config.type_id));
  }
  if (config.case_match !== undefined && config.case_match !== null) {
    updates.push('ent_case_match = ?');
    values.push(config.case_match);
  }
  if (config.word_boundary_match !== undefined && config.word_boundary_match !== null) {
    updates.push('ent_word_boundary_match = ?');
    values.push(config.word_boundary_match);
  }

  if (updates.length === 0 || ids.length === 0) {
    return { entitiesUpdated: 0 };
  }

  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE ${TABLE} SET ${updates.join(', ')}, ent_updated_at = CURRENT_TIMESTAMP WHERE ${PK} IN (${placeholders})`;
  const result = stmt(db, sql).run(...values, ...ids);

  return { entitiesUpdated: result.changes };
}, 'entities.batchUpdateConfig');
