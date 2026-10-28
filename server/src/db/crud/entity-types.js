import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { dbExec } from '../../utils/db-helpers.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('entity-types-crud');

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
 * Valid C4 element types that can be assigned to an entity type.
 * Kept as an application-level enum; the database column remains TEXT so
 * the list can evolve without schema migrations.
 */
export const C4_ELEMENTS = Object.freeze([
  'Person',
  'SoftwareSystem',
  'Container',
  'Component',
]);

const C4_ELEMENT_SET = new Set(C4_ELEMENTS);

/**
 * Valid ArchiMate element types that can be assigned to an entity type.
 * Initial scope: Application layer plus BusinessActor for people/users.
 */
export const ARCHIMATE_ELEMENTS = Object.freeze([
  'BusinessActor',
  'ApplicationComponent',
  'ApplicationService',
  'ApplicationInterface',
  'DataObject',
]);

const ARCHIMATE_ELEMENT_SET = new Set(ARCHIMATE_ELEMENTS);

/**
 * Validate a C4 element value, if provided.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeC4Element(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!C4_ELEMENT_SET.has(trimmed)) {
    throw new Error(`c4_element must be one of: ${C4_ELEMENTS.join(', ')}`);
  }
  return trimmed;
}

/**
 * Validate an ArchiMate element value, if provided.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeArchiMateElement(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (!ARCHIMATE_ELEMENT_SET.has(trimmed)) {
    throw new Error(`archimate_element must be one of: ${ARCHIMATE_ELEMENTS.join(', ')}`);
  }
  return trimmed;
}

export const entityTypeArchitecture = {
  C4_ELEMENTS,
  ARCHIMATE_ELEMENTS,
  normalizeC4Element,
  normalizeArchiMateElement,
};

/**
 * Create entity type
 * @param {Object} db
 * @param {Object} data — { type_name, description, id_label, name_label, case_match, word_boundary_match, uses_entity_id_pattern, id_format_prefix, min_id_digits, id_separator, c4_element, archimate_element }
 */
export const createEntityType = (db, data) => dbExec(() => {
  const { type_name, description, id_label, name_label, case_match, word_boundary_match, uses_entity_id_pattern, id_format_prefix, min_id_digits, id_separator, c4_element, archimate_element } = data;
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
    et_uses_entity_id_pattern, et_id_format_prefix, et_min_id_digits, et_id_separator,
    et_c4_element, et_archimate_element
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
    separator,
    normalizeC4Element(c4_element),
    normalizeArchiMateElement(archimate_element)
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
    uses_entity_id_pattern, id_format_prefix, min_id_digits, id_separator,
    c4_element, archimate_element
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

  if (c4_element !== undefined) {
    updates.push('et_c4_element = ?');
    params.push(normalizeC4Element(c4_element));
  }

  if (archimate_element !== undefined) {
    updates.push('et_archimate_element = ?');
    params.push(normalizeArchiMateElement(archimate_element));
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

/**
 * Standard entity types shipped with the system. Seeded idempotently by
 * ensureSchema. Existing rows are left untouched (INSERT OR IGNORE).
 */
export const STANDARD_ENTITY_TYPES = Object.freeze([
  {
    type_name: 'b-act',
    description: 'Business role or organisational actor that participates in processes or services.',
    uses_entity_id_pattern: 1,
    id_format_prefix: 'ACT',
    min_id_digits: 3,
    id_separator: '-',
    case_match: 'insensitive',
    word_boundary_match: 'boundaries',
    c4_element: 'Person',
    archimate_element: 'BusinessActor',
  },
  {
    type_name: 'a-com',
    description: 'Deployable application component, module or bounded context in the architecture.',
    uses_entity_id_pattern: 1,
    id_format_prefix: 'COM',
    min_id_digits: 3,
    id_separator: '-',
    case_match: 'insensitive',
    word_boundary_match: 'boundaries',
    c4_element: 'Container',
    archimate_element: 'ApplicationComponent',
  },
  {
    type_name: 'a-svc',
    description: 'Exposed application service or API that other components consume.',
    uses_entity_id_pattern: 1,
    id_format_prefix: 'SVC',
    min_id_digits: 3,
    id_separator: '-',
    case_match: 'insensitive',
    word_boundary_match: 'boundaries',
    c4_element: 'Container',
    archimate_element: 'ApplicationService',
  },
  {
    type_name: 'a-int',
    description: 'Interface, contract or integration point exposed by an application service or component.',
    uses_entity_id_pattern: 1,
    id_format_prefix: 'INT',
    min_id_digits: 3,
    id_separator: '-',
    case_match: 'insensitive',
    word_boundary_match: 'boundaries',
    c4_element: 'Component',
    archimate_element: 'ApplicationInterface',
  },
]);

/**
 * Upsert the standard entity types. Used during schema ensure so new databases
 * (and upgraded ones that lack the baseline set) always have the default types.
 * Idempotent via INSERT OR IGNORE on type_name; existing rows are not updated.
 * @param {Object} db
 * @returns {number} count of newly inserted rows
 */
export function ensureStandardEntityTypes(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'entity_types'").get();
  if (!tableExists) return 0;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO ${TABLE} (
      et_type_name, et_description,
      et_uses_entity_id_pattern, et_id_format_prefix, et_min_id_digits, et_id_separator,
      et_case_match, et_word_boundary_match,
      et_c4_element, et_archimate_element
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let seeded = 0;
  for (const t of STANDARD_ENTITY_TYPES) {
    try {
      const result = insert.run(
        t.type_name,
        t.description,
        t.uses_entity_id_pattern,
        t.id_format_prefix,
        t.min_id_digits,
        t.id_separator,
        t.case_match,
        t.word_boundary_match,
        t.c4_element || null,
        t.archimate_element || null
      );
      if (result.changes > 0) seeded++;
    } catch (err) {
      logger.warn({ err, type_name: t.type_name }, 'Failed to seed standard entity type');
    }
  }

  if (seeded > 0) {
    logger.info(`Seeded ${seeded} standard entity type(s)`);
  }
  return seeded;
}
