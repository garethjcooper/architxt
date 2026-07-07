import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { dbExec } from '../../utils/db-helpers.js';

const TABLE = 'entity_types';
const PK = 'et_id';
const JSON_FIELDS = [];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

export const getEntityType = base.get;
export const listEntityTypes = base.list;
export const deleteEntityType = base.del;

export const DEFAULT_MIN_ID_DIGITS = 3;
export const MIN_ID_DIGITS_LIMIT = 1;
export const MAX_ID_DIGITS_LIMIT = 10;
export const VALID_ID_SEPARATORS = ['none', '-'];

/**
 * Normalize a boolean-ish API value to 0 or 1 for storage.
 * @param {unknown} value
 * @returns {0 | 1 | null} null if the field should not be updated
 */
function normalizeUsesPattern(value) {
  if (value === undefined || value === null) return null;
  return value ? 1 : 0;
}

/**
 * Normalize the id format prefix: trim whitespace, reject non-alphanumeric characters.
 * @param {unknown} value
 * @returns {string | null | undefined} undefined if input was undefined; null if empty/invalid
 */
function normalizeIdFormatPrefix(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9]+$/.test(trimmed)) {
    throw new Error('Id Format Prefix must contain only alphanumeric characters');
  }
  return trimmed;
}

/**
 * Normalize min id digits to an integer within the allowed range.
 * @param {unknown} value
 * @returns {number | null | undefined} undefined if input was undefined; null if explicitly null
 */
function normalizeMinIdDigits(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw new Error('Minimum Number Of Id Digits must be an integer');
  }
  if (num < MIN_ID_DIGITS_LIMIT || num > MAX_ID_DIGITS_LIMIT) {
    throw new Error(`Minimum Number Of Id Digits must be between ${MIN_ID_DIGITS_LIMIT} and ${MAX_ID_DIGITS_LIMIT}`);
  }
  return num;
}

/**
 * Normalize id separator value. No enforced enum; UI controls valid values.
 * @param {unknown} value
 * @returns {string | null | undefined} undefined if input was undefined; null if explicitly null or empty
 */
function normalizeIdSeparator(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/**
 * Create entity type
 * @param {Object} db
 * @param {Object} data — { type_name, description, id_label, name_label, case_match, word_boundary_match, uses_entity_id_pattern, id_format_prefix, min_id_digits, id_separator }
 */
export const createEntityType = (db, data) => dbExec(() => {
  const { type_name, description, id_label, name_label, case_match, word_boundary_match, uses_entity_id_pattern, id_format_prefix, min_id_digits, id_separator } = data;
  if (!type_name) throw new Error('Internal: type_name is required');

  const usesPattern = normalizeUsesPattern(uses_entity_id_pattern ?? false);
  const prefix = usesPattern ? normalizeIdFormatPrefix(id_format_prefix) : null;
  const digits = usesPattern
    ? normalizeMinIdDigits(min_id_digits ?? DEFAULT_MIN_ID_DIGITS)
    : normalizeMinIdDigits(min_id_digits) ?? DEFAULT_MIN_ID_DIGITS;
  const separator = usesPattern
    ? normalizeIdSeparator(id_separator ?? 'none')
    : null;

  const sql = `INSERT INTO ${TABLE} (
    et_type_name, et_description, et_id_label, et_name_label,
    et_case_match, et_word_boundary_match,
    et_uses_entity_id_pattern, et_id_format_prefix, et_min_id_digits, et_id_separator
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const result = stmt(db, sql).run(
    type_name,
    description || null,
    id_label || null,
    name_label || null,
    case_match || 'insensitive',
    word_boundary_match || 'boundaries',
    usesPattern,
    prefix,
    digits,
    separator
  );
  return result.lastInsertRowid;
}, 'entity_types.create');

/**
 * Update entity type
 * @param {Object} db
 * @param {number} id
 * @param {Object} data
 */
export const updateEntityType = (db, id, data) => dbExec(() => {
  const {
    type_name, description, id_label, name_label,
    case_match, word_boundary_match,
    uses_entity_id_pattern, id_format_prefix, min_id_digits, id_separator
  } = data;

  const updates = ['et_updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (type_name !== undefined) { updates.push('et_type_name = ?'); params.push(type_name); }
  if (description !== undefined) { updates.push('et_description = ?'); params.push(description); }
  if (id_label !== undefined) { updates.push('et_id_label = ?'); params.push(id_label); }
  if (name_label !== undefined) { updates.push('et_name_label = ?'); params.push(name_label); }
  if (case_match !== undefined) { updates.push('et_case_match = ?'); params.push(case_match); }
  if (word_boundary_match !== undefined) { updates.push('et_word_boundary_match = ?'); params.push(word_boundary_match); }

  if (uses_entity_id_pattern !== undefined) {
    const usesPattern = normalizeUsesPattern(uses_entity_id_pattern);
    updates.push('et_uses_entity_id_pattern = ?');
    params.push(usesPattern);

    // When turning the pattern off, clear pattern-specific fields so they don't linger.
    if (usesPattern === 0) {
      if (!updates.some((u) => u.includes('et_id_format_prefix'))) {
        updates.push('et_id_format_prefix = ?');
        params.push(null);
      }
      if (!updates.some((u) => u.includes('et_id_separator'))) {
        updates.push('et_id_separator = ?');
        params.push(null);
      }
    }
  }

  if (id_format_prefix !== undefined) {
    const usesPattern = normalizeUsesPattern(uses_entity_id_pattern);
    const prefix = usesPattern === 1 ? normalizeIdFormatPrefix(id_format_prefix) : null;
    updates.push('et_id_format_prefix = ?');
    params.push(prefix);
  }

  if (min_id_digits !== undefined) {
    const digits = normalizeMinIdDigits(min_id_digits);
    updates.push('et_min_id_digits = ?');
    params.push(digits);
  }

  if (id_separator !== undefined) {
    const usesPattern = normalizeUsesPattern(uses_entity_id_pattern);
    const separator = usesPattern === 1 ? normalizeIdSeparator(id_separator) : null;
    updates.push('et_id_separator = ?');
    params.push(separator);
  }

  if (updates.length > 1) {
    params.push(id);
    stmt(db, `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE ${PK} = ?`).run(...params);
  }
  return true;
}, 'entity_types.update');

/**
 * Exported normalizers for routes/service wrappers that need to validate
 * these fields independently of a full create/update call.
 */
export const entityTypePattern = {
  normalizeUsesPattern,
  normalizeIdFormatPrefix,
  normalizeMinIdDigits,
  normalizeIdSeparator,
  DEFAULT_MIN_ID_DIGITS,
  MIN_ID_DIGITS_LIMIT,
  MAX_ID_DIGITS_LIMIT,
  VALID_ID_SEPARATORS,
};
