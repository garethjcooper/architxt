import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { fromJson, requireInt, requireString, dbExec } from '../../utils/db-helpers.js';

const TABLE = 'mental_models';
const PK = 'mm_id';
const JSON_FIELDS = [];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

export const getMentalModel = base.get;
export const deleteMentalModel = base.del;

/** Placeholders supported in template fields (ext_id, name, source_query). */
const ENTITY_NAME_PLACEHOLDER = '{entity-name}';
const ENTITY_ID_PLACEHOLDER = '{entity-id}';
const ENTITY_TYPE_PLACEHOLDER = '{entity-type}';
const PLACEHOLDER_PATTERN = new RegExp(
  `\\${ENTITY_NAME_PLACEHOLDER}|\\${ENTITY_ID_PLACEHOLDER}|\\${ENTITY_TYPE_PLACEHOLDER}`,
  'g'
);

const VALID_REFRESH_MODES = new Set(['full', 'delta']);
const VALID_TAGS_MATCH_MODES = new Set(['all_strict', 'any_strict', 'all', 'any', 'exact']);
export const VALID_RETURNS = new Set(['json', 'narrative']);
export const VALID_CONCATENATIONS = new Set(['merge', 'compile']);
export const STANDARD_DIMENSIONS = ['none', 'interface', 'summary', 'interface-found', 'capability'];
const VALID_BOOLEAN_STRINGS = new Set(['true', 'false']);
const MIN_MAX_TOKENS = 256;
const MAX_MAX_TOKENS = 8192;
export const DEFAULT_MAX_TOKENS = 2048;
export const DEFAULT_REFRESH_MODE = 'full';
export const DEFAULT_TAGS_MATCH_MODE = 'all_strict';
export const DEFAULT_BOOL = 'false';

/**
 * Convert a boolean-like value to the DB text representation ('true' / 'false').
 * Throws if the value is not boolean-like.
 */
export function toDbBool(value) {
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

/**
 * Validate and normalise a refresh_mode value.
 * Returns 'full' or 'delta'; throws for invalid non-null values.
 */
export function normaliseRefreshMode(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!VALID_REFRESH_MODES.has(value)) {
    throw new Error(`Invalid refresh_mode: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validate and normalise a tags_match_mode value.
 * Returns one of the valid modes; throws for invalid non-null values.
 */
export function normaliseTagsMatchMode(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!VALID_TAGS_MATCH_MODES.has(value)) {
    throw new Error(`Invalid tags_match_mode: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validate and clamp max_tokens to the allowed range.
 * Returns an integer or null; throws for non-finite, out-of-range, or non-integer values.
 */
export function normaliseMaxTokens(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`Invalid max_tokens: ${JSON.stringify(value)}`);
  const truncated = Math.trunc(n);
  if (truncated < MIN_MAX_TOKENS || truncated > MAX_MAX_TOKENS) {
    throw new Error(`max_tokens must be an integer between ${MIN_MAX_TOKENS} and ${MAX_MAX_TOKENS}`);
  }
  if (n !== truncated) {
    throw new Error(`max_tokens must be an integer`);
  }
  return truncated;
}

export function normaliseReturns(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!VALID_RETURNS.has(value)) {
    throw new Error(`Invalid returns: ${JSON.stringify(value)}`);
  }
  return value;
}

export function normaliseConcatenation(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!VALID_CONCATENATIONS.has(value)) {
    throw new Error(`Invalid concatenation: ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Returns true if the given dimension is one of the standard dimensions.
 */
export function isStandardDimension(value) {
  if (typeof value !== 'string' || value === '') return false;
  return STANDARD_DIMENSIONS.includes(value);
}

/**
 * Substitute entity placeholders into a template string.
 */
function substitutePlaceholders(template, entity) {
  if (!template) return template;
  return template
    .replaceAll(ENTITY_NAME_PLACEHOLDER, entity.name ?? '')
    .replaceAll(ENTITY_ID_PLACEHOLDER, entity.entity_id ?? '')
    .replaceAll(ENTITY_TYPE_PLACEHOLDER, entity.type_name ?? '');
}

/**
 * Returns true if any template field contains a supported placeholder.
 */
export function hasEntityPlaceholders(mmName, mmExtId, mmSourceQuery) {
  const haystack = `${mmName ?? ''}${mmExtId ?? ''}${mmSourceQuery ?? ''}`;
  return PLACEHOLDER_PATTERN.test(haystack);
}

/**
 * Returns true if the external id contains a supported entity placeholder.
 * Templates require this because ext_id becomes read-only after creation.
 */
export function hasEntityPlaceholderInExtId(mmExtId) {
  return PLACEHOLDER_PATTERN.test(mmExtId ?? '');
}

/**
 * Validate that a model is eligible to act as an entity template.
 * Returns { valid: boolean, error: string?, code: string? } instead of throwing.
 */
export function validateEntityTemplateEligibility({
  mm_is_template,
  mm_name,
  mm_ext_id,
  mm_source_query,
}) {
  if (mm_is_template !== 'true') {
    return { valid: true };
  }

  if (!hasEntityPlaceholders(mm_name, mm_ext_id, '')) {
    return {
      valid: false,
      error: `Template mode requires '${ENTITY_ID_PLACEHOLDER}' or '${ENTITY_NAME_PLACEHOLDER}' in Template Id (External ID) or Name`,
      code: 'VALIDATION_ERROR',
    };
  }

  return { valid: true };
}

/**
 * Derive virtual mental models from a template model.
 * The template must be pre-loaded with tags and entities.
 */
export function deriveMentalModels(template) {
  const entities = template?.entities;
  if (template?.is_template !== true || !Array.isArray(entities) || entities.length === 0) {
    return [];
  }

  const baseModel = {
    id: template.id,
    ext_id: template.ext_id,
    name: template.name,
    source_query: template.source_query,
    refresh_after_consolidation: template.refresh_after_consolidation,
    refresh_mode: normaliseRefreshMode(template.refresh_mode),
    exclude_all_mental_models: template.exclude_all_mental_models,
    exclude_mental_model_list: template.exclude_mental_model_list,
    max_tokens: normaliseMaxTokens(template.max_tokens),
    tags_match_mode: normaliseTagsMatchMode(template.tags_match_mode),
    dimension: template.dimension,
    returns: template.returns,
    concatenation: template.concatenation,
    is_template: template.is_template,
    tags: template.tags || [],
    entities: entities,
    created_at: template.created_at,
    updated_at: template.updated_at,
  };

  return entities.map((entity) => {
    const overrides = entity.overrides || {};
    return {
      ...baseModel,
      id: `${template.id}:${entity.id}`,
      ext_id: substitutePlaceholders(template.ext_id, entity),
      name: substitutePlaceholders(template.name, entity),
      source_query: substitutePlaceholders(template.source_query, entity),
      refresh_mode: overrides.refresh_mode ?? normaliseRefreshMode(template.refresh_mode),
      refresh_after_consolidation: overrides.refresh_after_consolidation ?? template.refresh_after_consolidation,
      exclude_all_mental_models: overrides.exclude_all_mental_models ?? template.exclude_all_mental_models,
      max_tokens: overrides.max_tokens ?? normaliseMaxTokens(template.max_tokens),
      tags_match_mode: normaliseTagsMatchMode(template.tags_match_mode),
      dimension: template.dimension,
      returns: template.returns,
      concatenation: template.concatenation,
      derived_entity: entity,
      is_derived: true,
    };
  });
}

const TAGS_SQL = `
  (SELECT json_group_array(json_object('id', t.tag_id, 'name', t.tag_name, 'generated_by', t.tag_generated_by))
   FROM mental_model_tags mmt
   JOIN tags t ON mmt.tag_id = t.tag_id
   WHERE mmt.mm_id = m.${PK})`;

/**
 * Return the tag list as a simple JSON array of tag names. Used by the
 * Hindsight diff path to avoid unnecessary object shape translation in SQL.
 */
const TAG_NAMES_SQL = `
  (SELECT json_group_array(t.tag_name)
   FROM mental_model_tags mmt
   JOIN tags t ON mmt.tag_id = t.tag_id
   WHERE mmt.mm_id = m.${PK})`;

const ENTITIES_SQL = `
  (SELECT json_group_array(json_object(
      'id', e.ent_id,
      'type_id', e.ent_type_id,
      'entity_id', e.ent_entity_id,
      'name', e.ent_name,
      'description', e.ent_description,
      'aliases', e.ent_aliases,
      'case_match', e.ent_case_match,
      'type_case_match', et.et_case_match,
      'type_name', et.et_type_name,
      'generated_by', e.ent_generated_by,
      'overrides', json_object(
        'refresh_mode', mme.mm_ent_refresh_mode,
        'refresh_after_consolidation', mme.mm_ent_refresh_after_consolidation,
        'exclude_all_mental_models', mme.mm_ent_exclude_all_mental_models,
        'max_tokens', mme.mm_ent_max_tokens
      )
   ))
   FROM mental_model_entities mme
   JOIN entities e ON mme.ent_id = e.ent_id
   JOIN entity_types et ON e.ent_type_id = et.et_id
   WHERE mme.mm_id = m.${PK})`;

/**
 * List all mental models with their associated tags and entities as JSON arrays.
 */
export const listMentalModels = (db, options = {}) => dbExec(() => {
  const { limit = 1000, offset = 0, dimension, dimensions, returns } = options;
  const conditions = [];
  const params = [];
  if (dimension !== undefined && dimension !== null) {
    conditions.push('m.mm_dimension = ?');
    params.push(dimension);
  }
  if (Array.isArray(dimensions) && dimensions.length > 0) {
    conditions.push(`m.mm_dimension IN (${dimensions.map(() => '?').join(',')})`);
    params.push(...dimensions);
  }
  if (returns !== undefined && returns !== null) {
    conditions.push('m.mm_returns = ?');
    params.push(returns);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT m.*,
      ${TAGS_SQL} AS mm_tags,
      ${ENTITIES_SQL} AS mm_entities
    FROM ${TABLE} m
    ${where}
    ORDER BY m.${PK} DESC
    LIMIT ? OFFSET ?
  `;
  params.push(requireInt('limit', limit), requireInt('offset', offset));
  const rows = stmt(db, sql).all(...params);
  return rows.map(r => fromJson(r, ['mm_tags', 'mm_entities']));
}, 'mentalModels.list');

/**
 * List distinct mental model dimensions. Returns an array of non-empty
 * dimension strings sorted alphabetically.
 */
export const listMentalModelDimensions = (db) => dbExec(() => {
  const sql = `
    SELECT DISTINCT mm_dimension AS dimension
    FROM ${TABLE}
    WHERE mm_dimension IS NOT NULL
      AND mm_dimension != ''
      AND mm_dimension != 'none'
    ORDER BY mm_dimension ASC
  `;
  return stmt(db, sql).all().map((r) => r.dimension);
}, 'mentalModels.listDimensions');

/**
 * Return the canonical list of standard mental model dimensions with display
 * labels. Kept in code today; can be moved to a DB lookup table later without
 * changing the API contract.
 */
const DISPLAY_LABELS = {
  none: 'None',
  interface: 'Interface',
  summary: 'Summary',
  'interface-found': 'Interface-Discovered',
  capability: 'Capability',
};

export const listStandardDimensions = () => {
  const dimensions = STANDARD_DIMENSIONS.map((value) => ({
    value,
    label: DISPLAY_LABELS[value] ?? value,
  }));
  return { success: true, data: dimensions };
};

/**
 * List mental models suitable for a Hindsight diff.
 * Returns both plain and template rows; templates include their entity list so
 * the route can expand them into derived rows. Tag names are returned as a
 * plain string array for easy set comparison.
 */
export const listMentalModelsForDiff = (db, options = {}) => dbExec(() => {
  const { limit = 1000, offset = 0 } = options;
  const sql = `
    SELECT m.*,
      ${TAG_NAMES_SQL} AS mm_tag_names,
      ${ENTITIES_SQL} AS mm_entities
    FROM ${TABLE} m
    ORDER BY m.${PK}
    LIMIT ? OFFSET ?
  `;
  const rows = stmt(db, sql).all(requireInt('limit', limit), requireInt('offset', offset));
  return rows.map(r => fromJson(r, ['mm_tag_names', 'mm_entities']));
}, 'mentalModels.listForDiff');

/**
 * Get a single mental model with tags and entities.
 */
export const getMentalModelWithRelations = (db, id) => dbExec(() => {
  const sql = `
    SELECT m.*,
      ${TAGS_SQL} AS mm_tags,
      ${ENTITIES_SQL} AS mm_entities
    FROM ${TABLE} m
    WHERE m.${PK} = ?
  `;
  const row = stmt(db, sql).get(requireInt(PK, id));
  return fromJson(row, ['mm_tags', 'mm_entities']);
}, 'mentalModels.getWithRelations');

/**
 * Create mental model.
 * Route layer should already validate and translate API field names to DB names.
 */
export const createMentalModel = (db, data) => dbExec(() => {
  requireString('mm_ext_id', data.mm_ext_id);

  const cols = ['mm_ext_id', 'mm_name', 'mm_source_query', 'mm_refresh_after_consolidation', 'mm_refresh_mode', 'mm_exclude_all_mental_models', 'mm_exclude_mental_model_list', 'mm_tags_match_mode', 'mm_is_template', 'mm_max_tokens', 'mm_dimension', 'mm_returns', 'mm_concatenation'];
  const presentCols = cols.filter(c => data[c] !== undefined && data[c] !== null);
  const placeholders = presentCols.map(() => '?').join(',');
  const values = presentCols.map(c => data[c]);

  const sql = `INSERT INTO ${TABLE} (${presentCols.join(',')}) VALUES (${placeholders})`;
  const result = stmt(db, sql).run(...values);
  return result.lastInsertRowid;
}, 'mentalModels.create');

/**
 * Update mental model. Only present fields are updated.
 */
export const updateMentalModel = (db, id, data) => dbExec(() => {
  const cols = ['mm_ext_id', 'mm_name', 'mm_source_query', 'mm_refresh_after_consolidation', 'mm_refresh_mode', 'mm_exclude_all_mental_models', 'mm_exclude_mental_model_list', 'mm_tags_match_mode', 'mm_is_template', 'mm_max_tokens', 'mm_dimension', 'mm_returns', 'mm_concatenation'];
  const updates = [];
  const values = [];

  for (const c of cols) {
    if (data[c] !== undefined && data[c] !== null) {
      updates.push(`${c} = ?`);
      values.push(data[c]);
    }
  }

  if (updates.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(requireInt(PK, id));
  const sql = `UPDATE ${TABLE} SET ${updates.join(', ')}, mm_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(...values);

  if (result.changes === 0) {
    return null;
  }
  return true;
}, 'mentalModels.update');

/**
 * Get all tags for a specific mental model.
 */
export const getMentalModelTags = (db, mmId) => dbExec(() => {
  const sql = `
    SELECT t.* FROM tags t
    JOIN mental_model_tags mmt ON t.tag_id = mmt.tag_id
    WHERE mmt.mm_id = ?
  `;
  return stmt(db, sql).all(requireInt('mm_id', mmId));
}, 'mentalModelTags.getByModel');

/**
 * Add a tag to a mental model.
 */
export const addMentalModelTag = (db, mmId, tagId) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const tId = requireInt('tag_id', tagId);
  const sql = `INSERT OR IGNORE INTO mental_model_tags (mm_id, tag_id) VALUES (?, ?)`;
  stmt(db, sql).run(mId, tId);
  return { mm_id: mId, tag_id: tId };
}, 'mentalModelTags.add');

/**
 * Remove a tag from a mental model.
 */
export const removeMentalModelTag = (db, mmId, tagId) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const tId = requireInt('tag_id', tagId);
  const sql = `DELETE FROM mental_model_tags WHERE mm_id = ? AND tag_id = ?`;
  const result = stmt(db, sql).run(mId, tId);
  return result.changes > 0;
}, 'mentalModelTags.remove');

/**
 * Get all entities for a specific mental model.
 */
export const getMentalModelEntities = (db, mmId) => dbExec(() => {
  const sql = `
    SELECT e.*, et.et_type_name, et.et_case_match AS type_case_match,
      mme.mm_ent_refresh_mode,
      mme.mm_ent_refresh_after_consolidation,
      mme.mm_ent_exclude_all_mental_models,
      mme.mm_ent_max_tokens
    FROM entities e
    JOIN mental_model_entities mme ON e.ent_id = mme.ent_id
    JOIN entity_types et ON e.ent_type_id = et.et_id
    WHERE mme.mm_id = ?
  `;
  const rows = stmt(db, sql).all(requireInt('mm_id', mmId));
  return rows.map(r => fromJson(r, ['ent_aliases']));
}, 'mentalModelEntities.getByModel');

/**
 * Add an entity to a mental model.
 */
export const addMentalModelEntity = (db, mmId, entId) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const eId = requireInt('ent_id', entId);
  const sql = `INSERT OR IGNORE INTO mental_model_entities (mm_id, ent_id) VALUES (?, ?)`;
  stmt(db, sql).run(mId, eId);
  return { mm_id: mId, ent_id: eId };
}, 'mentalModelEntities.add');

/**
 * Get per-entity config overrides for a single related entity.
 */
export const getMentalModelEntityOverrides = (db, mmId, entId) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const eId = requireInt('ent_id', entId);
  const sql = `
    SELECT mm_ent_refresh_mode AS refresh_mode,
           mm_ent_refresh_after_consolidation AS refresh_after_consolidation,
           mm_ent_exclude_all_mental_models AS exclude_all_mental_models,
           mm_ent_max_tokens AS max_tokens
    FROM mental_model_entities
    WHERE mm_id = ? AND ent_id = ?
  `;
  const row = stmt(db, sql).get(mId, eId);
  if (!row) return null;
  return {
    refresh_mode: row.refresh_mode,
    refresh_after_consolidation: row.refresh_after_consolidation === 'true',
    exclude_all_mental_models: row.exclude_all_mental_models === 'true',
    max_tokens: row.max_tokens,
  };
}, 'mentalModelEntities.getOverrides');

/**
 * Update per-entity config overrides. Only provided fields are changed.
 * Missing fields are left as-is (not cleared).
 */
export const updateMentalModelEntityOverrides = (db, mmId, entId, overrides) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const eId = requireInt('ent_id', entId);

  const updates = [];
  const values = [];

  if (overrides.refresh_mode !== undefined) {
    if (!VALID_REFRESH_MODES.has(overrides.refresh_mode)) {
      throw new Error(`Invalid refresh_mode: ${overrides.refresh_mode}`);
    }
    updates.push('mm_ent_refresh_mode = ?');
    values.push(overrides.refresh_mode);
  }
  if (overrides.refresh_after_consolidation !== undefined) {
    updates.push('mm_ent_refresh_after_consolidation = ?');
    values.push(toDbBool(overrides.refresh_after_consolidation));
  }
  if (overrides.exclude_all_mental_models !== undefined) {
    updates.push('mm_ent_exclude_all_mental_models = ?');
    values.push(toDbBool(overrides.exclude_all_mental_models));
  }
  if (overrides.max_tokens !== undefined) {
    updates.push('mm_ent_max_tokens = ?');
    values.push(normaliseMaxTokens(overrides.max_tokens));
  }

  if (updates.length === 0) {
    throw new Error('No override fields to update');
  }

  // Read current values so we can report whether anything actually changed.
  const current = stmt(db, `
    SELECT mm_ent_refresh_mode AS refresh_mode,
           mm_ent_refresh_after_consolidation AS refresh_after_consolidation,
           mm_ent_exclude_all_mental_models AS exclude_all_mental_models,
           mm_ent_max_tokens AS max_tokens
    FROM mental_model_entities
    WHERE mm_id = ? AND ent_id = ?
  `).get(mId, eId);

  if (!current) {
    throw new Error(`No mental_model_entities row for mm_id=${mId}, ent_id=${eId}`);
  }

  // Only include fields whose new value differs from the current DB value.
  const changedUpdates = [];
  const changedValues = [];

  if (overrides.refresh_mode !== undefined && overrides.refresh_mode !== current.refresh_mode) {
    changedUpdates.push('mm_ent_refresh_mode = ?');
    changedValues.push(overrides.refresh_mode);
  }
  if (overrides.refresh_after_consolidation !== undefined &&
      toDbBool(overrides.refresh_after_consolidation) !== current.refresh_after_consolidation) {
    changedUpdates.push('mm_ent_refresh_after_consolidation = ?');
    changedValues.push(toDbBool(overrides.refresh_after_consolidation));
  }
  if (overrides.exclude_all_mental_models !== undefined &&
      toDbBool(overrides.exclude_all_mental_models) !== current.exclude_all_mental_models) {
    changedUpdates.push('mm_ent_exclude_all_mental_models = ?');
    changedValues.push(toDbBool(overrides.exclude_all_mental_models));
  }
  if (overrides.max_tokens !== undefined &&
      normaliseMaxTokens(overrides.max_tokens) !== current.max_tokens) {
    changedUpdates.push('mm_ent_max_tokens = ?');
    changedValues.push(normaliseMaxTokens(overrides.max_tokens));
  }

  if (changedUpdates.length === 0) {
    return { changed: false, row: current };
  }

  changedValues.push(mId, eId);
  const sql = `UPDATE mental_model_entities SET ${changedUpdates.join(', ')}, mm_ent_updated_at = CURRENT_TIMESTAMP WHERE mm_id = ? AND ent_id = ?`;
  const result = stmt(db, sql).run(...changedValues);

  if (result.changes === 0) {
    throw new Error(`Update had no effect for mm_id=${mId}, ent_id=${eId}`);
  }

  return { changed: true, row: current };
}, 'mentalModelEntities.updateOverrides');

/**
 * Delete per-entity config overrides (reset all three to NULL).
 */
export const deleteMentalModelEntityOverrides = (db, mmId, entId) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const eId = requireInt('ent_id', entId);
  const sql = `UPDATE mental_model_entities SET mm_ent_refresh_mode = NULL, mm_ent_refresh_after_consolidation = NULL, mm_ent_exclude_all_mental_models = NULL, mm_ent_max_tokens = NULL, mm_ent_updated_at = CURRENT_TIMESTAMP WHERE mm_id = ? AND ent_id = ?`;
  const result = stmt(db, sql).run(mId, eId);
  return result.changes > 0;
}, 'mentalModelEntities.deleteOverrides');

/**
 * Clear per-entity config overrides for all entities associated with a mental model.
 */
export const clearMentalModelEntityOverrides = (db, mmId) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const sql = `UPDATE mental_model_entities SET mm_ent_refresh_mode = NULL, mm_ent_refresh_after_consolidation = NULL, mm_ent_exclude_all_mental_models = NULL, mm_ent_max_tokens = NULL, mm_ent_updated_at = CURRENT_TIMESTAMP WHERE mm_id = ?`;
  const result = stmt(db, sql).run(mId);
  return { cleared: result.changes };
}, 'mentalModelEntities.clearOverrides');

/**
 * Batch update per-entity config overrides for multiple related entities of a template.
 */
export const batchUpdateMentalModelEntityOverrides = (db, mmId, entityIds, overrides) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  if (!Array.isArray(entityIds) || entityIds.length === 0) {
    throw new Error('At least one entity_id is required');
  }

  const values = [];
  const refreshMode = overrides.refresh_mode !== undefined ? normaliseRefreshMode(overrides.refresh_mode) : null;
  const refreshAfterConsolidation = overrides.refresh_after_consolidation !== undefined ? toDbBool(overrides.refresh_after_consolidation) : null;
  const excludeAllMentalModels = overrides.exclude_all_mental_models !== undefined ? toDbBool(overrides.exclude_all_mental_models) : null;
  const maxTokens = overrides.max_tokens !== undefined ? normaliseMaxTokens(overrides.max_tokens) : null;

  values.push(refreshMode, refreshAfterConsolidation, excludeAllMentalModels, maxTokens);

  const placeholders = entityIds.map(() => '?').join(', ');
  const sql = `UPDATE mental_model_entities SET mm_ent_refresh_mode = ?, mm_ent_refresh_after_consolidation = ?, mm_ent_exclude_all_mental_models = ?, mm_ent_max_tokens = ?, mm_ent_updated_at = CURRENT_TIMESTAMP WHERE mm_id = ? AND ent_id IN (${placeholders})`;
  const result = stmt(db, sql).run(...values, mId, ...entityIds);
  return { updated: result.changes };
}, 'mentalModelEntities.batchUpdateOverrides');

/**
 * Remove an entity from a mental model.
 */
export const removeMentalModelEntity = (db, mmId, entId) => dbExec(() => {
  const mId = requireInt('mm_id', mmId);
  const eId = requireInt('ent_id', entId);
  const sql = `DELETE FROM mental_model_entities WHERE mm_id = ? AND ent_id = ?`;
  const result = stmt(db, sql).run(mId, eId);
  return result.changes > 0;
}, 'mentalModelEntities.remove');

/**
 * Batch update tags for multiple mental models (transactional).
 */
export const batchUpdateMentalModelTags = (db, mmIds, tagsToAdd, tagsToRemove) => dbExec(() => {
  const ids = mmIds.map((id) => requireInt('mm_id', id));
  let tagsAdded = 0;
  let tagsRemoved = 0;

  if (tagsToRemove && tagsToRemove.length > 0) {
    for (const rawTagId of tagsToRemove) {
      const tagId = requireInt('tag_id', rawTagId);
      const sql = `DELETE FROM mental_model_tags WHERE mm_id IN (${ids.map(() => '?').join(',')}) AND tag_id = ?`;
      const result = stmt(db, sql).run(...ids, tagId);
      tagsRemoved += result.changes;
    }
  }

  if (tagsToAdd && tagsToAdd.length > 0) {
    for (const rawTagId of tagsToAdd) {
      const tagId = requireInt('tag_id', rawTagId);
      for (const mmId of ids) {
        const sql = `INSERT OR IGNORE INTO mental_model_tags (mm_id, tag_id) VALUES (?, ?)`;
        try {
          const result = stmt(db, sql).run(mmId, tagId);
          if (result.changes > 0) tagsAdded++;
        } catch (err) {
          if (!err.message.includes('UNIQUE')) throw err;
        }
      }
    }
  }

  return { modelsUpdated: ids.length, tagsAdded, tagsRemoved };
}, 'mentalModelTags.batchUpdate');

/**
 * Batch update entities for multiple mental models (transactional).
 */
export const batchUpdateMentalModelEntities = (db, mmIds, entitiesToAdd, entitiesToRemove) => dbExec(() => {
  const ids = mmIds.map((id) => requireInt('mm_id', id));
  let entitiesAdded = 0;
  let entitiesRemoved = 0;

  if (entitiesToRemove && entitiesToRemove.length > 0) {
    for (const rawEntId of entitiesToRemove) {
      const entId = requireInt('ent_id', rawEntId);
      const sql = `DELETE FROM mental_model_entities WHERE mm_id IN (${ids.map(() => '?').join(',')}) AND ent_id = ?`;
      const result = stmt(db, sql).run(...ids, entId);
      entitiesRemoved += result.changes;
    }
  }

  if (entitiesToAdd && entitiesToAdd.length > 0) {
    for (const rawEntId of entitiesToAdd) {
      const entId = requireInt('ent_id', rawEntId);
      for (const mmId of ids) {
        const sql = `INSERT OR IGNORE INTO mental_model_entities (mm_id, ent_id) VALUES (?, ?)`;
        try {
          const result = stmt(db, sql).run(mmId, entId);
          if (result.changes > 0) entitiesAdded++;
        } catch (err) {
          if (!err.message.includes('UNIQUE')) throw err;
        }
      }
    }
  }

  return { modelsUpdated: ids.length, entitiesAdded, entitiesRemoved };
}, 'mentalModelEntities.batchUpdate');

/**
 * Batch update mental model configuration fields (refresh_mode, tags_match_mode, refresh_after_consolidation,
 * exclude_all_mental_models) across multiple mental models (transactional).
 */
export const batchUpdateMentalModelConfig = (db, mmIds, config) => dbExec(() => {
  const ids = mmIds.map((id) => requireInt('mm_id', id));

  const updates = [];
  const values = [];

  if (config.refresh_mode !== undefined && config.refresh_mode !== null) {
    updates.push('mm_refresh_mode = ?');
    values.push(normaliseRefreshMode(config.refresh_mode));
  }
  if (config.tags_match_mode !== undefined && config.tags_match_mode !== null) {
    updates.push('mm_tags_match_mode = ?');
    values.push(normaliseTagsMatchMode(config.tags_match_mode));
  }
  if (config.refresh_after_consolidation !== undefined && config.refresh_after_consolidation !== null) {
    updates.push('mm_refresh_after_consolidation = ?');
    values.push(toDbBool(config.refresh_after_consolidation));
  }
  if (config.exclude_all_mental_models !== undefined && config.exclude_all_mental_models !== null) {
    updates.push('mm_exclude_all_mental_models = ?');
    values.push(toDbBool(config.exclude_all_mental_models));
  }
  if (config.max_tokens !== undefined && config.max_tokens !== null) {
    updates.push('mm_max_tokens = ?');
    values.push(normaliseMaxTokens(config.max_tokens));
  }

  if (updates.length === 0 || ids.length === 0) {
    return { modelsUpdated: 0, entitiesUpdated: 0 };
  }

  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE ${TABLE} SET ${updates.join(', ')}, mm_updated_at = CURRENT_TIMESTAMP WHERE ${PK} IN (${placeholders})`;
  const result = stmt(db, sql).run(...values, ...ids);

  // For template mental models, also write the same per-entity config values as
  // explicit overrides on every linked entity. This keeps derived instances
  // aligned with the template, matching the behaviour of the modal form.
  let entitiesUpdated = 0;
  const entityColumns = [];
  const entityValues = [];
  if (config.refresh_mode !== undefined && config.refresh_mode !== null) {
    entityColumns.push('mm_ent_refresh_mode = ?');
    entityValues.push(normaliseRefreshMode(config.refresh_mode));
  }
  if (config.refresh_after_consolidation !== undefined && config.refresh_after_consolidation !== null) {
    entityColumns.push('mm_ent_refresh_after_consolidation = ?');
    entityValues.push(toDbBool(config.refresh_after_consolidation));
  }
  if (config.exclude_all_mental_models !== undefined && config.exclude_all_mental_models !== null) {
    entityColumns.push('mm_ent_exclude_all_mental_models = ?');
    entityValues.push(toDbBool(config.exclude_all_mental_models));
  }
  if (config.max_tokens !== undefined && config.max_tokens !== null) {
    entityColumns.push('mm_ent_max_tokens = ?');
    entityValues.push(normaliseMaxTokens(config.max_tokens));
  }

  if (entityColumns.length > 0) {
    const templateIds = stmt(db, `SELECT ${PK} FROM ${TABLE} WHERE ${PK} IN (${placeholders}) AND mm_is_template = 'true'`).all(...ids).map((r) => r[PK]);
    for (const templateId of templateIds) {
      const entRows = stmt(db, 'SELECT ent_id FROM mental_model_entities WHERE mm_id = ?').all(templateId);
      if (entRows.length === 0) continue;
      const entPlaceholders = entRows.map(() => '?').join(', ');
      const entitySql = `UPDATE mental_model_entities SET ${entityColumns.join(', ')}, mm_ent_updated_at = CURRENT_TIMESTAMP WHERE mm_id = ? AND ent_id IN (${entPlaceholders})`;
      const entityResult = stmt(db, entitySql).run(...entityValues, templateId, ...entRows.map((r) => r.ent_id));
      entitiesUpdated += entityResult.changes;
    }
  }

  return { modelsUpdated: result.changes, entitiesUpdated };
}, 'mentalModels.batchUpdateConfig');
