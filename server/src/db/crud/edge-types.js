import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { dbExec } from '../../utils/db-helpers.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('edge-types-crud');

const TABLE = 'edge_types';
const PK = 'edt_id';
const JSON_FIELDS = [];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'integer' });

export const getEdgeType = base.get;
export const listEdgeTypes = base.list;
export const deleteEdgeType = base.del;

/**
 * ArchiMate relationship types that can be assigned to an edge type.
 * Kept as an application-level enum; the database column remains TEXT so
 * the list can evolve without schema migrations.
 */
export const ARCHIMATE_RELATIONSHIPS = Object.freeze([
  'association',
  'serving',
  'used-by',
  'composition',
  'aggregation',
  'assignment',
  'realization',
  'specialization',
  'influence',
  'triggering',
  'flow',
  'access',
]);

const ARCHIMATE_SET = new Set(ARCHIMATE_RELATIONSHIPS);

/**
 * Standard edge types shipped with the system. Seeded idempotently by
 * ensureSchema and seed_data.sql.
 */
export const STANDARD_EDGE_TYPES = Object.freeze([
  {
    type_name: 'calls',
    description: 'A calls or invokes a service or interface on B.',
    c4_description: 'invokes or calls to',
    archimate_relationship: 'serving',
  },
  {
    type_name: 'sends',
    description: 'A sends data or an event to B.',
    c4_description: 'sends data or an event to',
    archimate_relationship: 'flow',
  },
  {
    type_name: 'reads',
    description: 'A reads data from B.',
    c4_description: 'reads data from',
    archimate_relationship: 'access',
  },
  {
    type_name: 'writes',
    description: 'A persists or writes data to B.',
    c4_description: 'persists or writes data to',
    archimate_relationship: 'access',
  },
  {
    type_name: 'depends-on',
    description: 'A depends on B. Use only when no more specific type applies.',
    c4_description: 'depends on',
    archimate_relationship: 'association',
  },
]);

/**
 * Validate edge type name: non-empty slug-ish string (lowercase letters, digits,
 * hyphens; no spaces or special characters). Keeps the same shape as edge values
 * stored in contextual_graph_edges.cge_type.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeEdgeTypeName(value) {
  if (value === undefined || value === null) {
    throw new Error('type_name is required');
  }
  const raw = String(value).trim();
  const lowered = raw.toLowerCase();
  if (!lowered) {
    throw new Error('type_name is required');
  }
  // Reject any input that required character-stripping or case change rather than
  // silently normalising. The UI can offer slugify, but the API is strict.
  if (raw !== lowered) {
    throw new Error('type_name must be lowercase');
  }
  if (!/^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$/.test(lowered)) {
    throw new Error('type_name must be lowercase letters, digits, and hyphens only');
  }
  if (lowered.includes('--')) {
    throw new Error('type_name must not contain consecutive hyphens');
  }
  return lowered;
}

/**
 * Validate a non-empty description.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeDescription(value) {
  if (value === undefined || value === null) {
    throw new Error('description is required');
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    throw new Error('description is required');
  }
  return trimmed;
}

/**
 * Validate an ArchiMate relationship value, if provided.
 * @param {unknown} value
 * @returns {string|null}
 */
export function normalizeArchimateRelationship(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  if (!ARCHIMATE_SET.has(trimmed)) {
    throw new Error(
      `archimate_relationship must be one of: ${ARCHIMATE_RELATIONSHIPS.join(', ')}`
    );
  }
  return trimmed;
}

/**
 * Create edge type.
 * @param {Object} db
 * @param {Object} data — { type_name, description, c4_description, archimate_relationship }
 */
export const createEdgeType = (db, data) => dbExec(() => {
  const { type_name, description, c4_description, archimate_relationship } = data;
  const normalizedName = normalizeEdgeTypeName(type_name);
  const normalizedDescription = normalizeDescription(description);

  const existing = stmt(db, `SELECT ${PK} FROM ${TABLE} WHERE edt_type_name = ?`).get(normalizedName);
  if (existing) {
    throw Object.assign(new Error('Edge type name already exists'), { code: 'DUPLICATE_KEY' });
  }

  const result = stmt(db, `INSERT INTO ${TABLE} (
    edt_type_name, edt_description, edt_c4_description, edt_archimate_relationship
  ) VALUES (?, ?, ?, ?)`).run(
    normalizedName,
    normalizedDescription,
    c4_description || null,
    normalizeArchimateRelationship(archimate_relationship)
  );
  return result.lastInsertRowid;
}, 'edge_types.create');

/**
 * Update edge type.
 * @param {Object} db
 * @param {number} id
 * @param {Object} data
 */
export const updateEdgeType = (db, id, data) => dbExec(() => {
  const { type_name, description, c4_description, archimate_relationship } = data;

  const updates = ['edt_updated_at = CURRENT_TIMESTAMP'];
  const params = [];

  if (type_name !== undefined) {
    const normalizedName = normalizeEdgeTypeName(type_name);
    updates.push('edt_type_name = ?');
    params.push(normalizedName);
  }
  if (description !== undefined) {
    const normalizedDescription = normalizeDescription(description);
    updates.push('edt_description = ?');
    params.push(normalizedDescription);
  }
  if (c4_description !== undefined) {
    updates.push('edt_c4_description = ?');
    params.push(c4_description || null);
  }
  if (archimate_relationship !== undefined) {
    updates.push('edt_archimate_relationship = ?');
    params.push(normalizeArchimateRelationship(archimate_relationship));
  }

  if (updates.length > 1) {
    params.push(id);
    stmt(db, `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE ${PK} = ?`).run(...params);
  }
  return true;
}, 'edge_types.update');

/**
 * Upsert the standard edge types. Used during schema ensure so new databases
 * (and upgraded ones that lack the standard set) always have the baseline.
 * Idempotent via INSERT OR IGNORE on type_name.
 * @param {Object} db
 */
export function ensureStandardEdgeTypes(db) {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'edge_types'").get();
  if (!tableExists) return 0;

  const upsert = db.prepare(`
    INSERT INTO ${TABLE} (
      edt_type_name, edt_description, edt_c4_description, edt_archimate_relationship
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(edt_type_name) DO UPDATE SET
      edt_description = excluded.edt_description,
      edt_c4_description = excluded.edt_c4_description,
      edt_archimate_relationship = excluded.edt_archimate_relationship,
      edt_updated_at = CURRENT_TIMESTAMP
  `);

  let seeded = 0;
  for (const t of STANDARD_EDGE_TYPES) {
    try {
      const result = upsert.run(
        t.type_name,
        t.description,
        t.c4_description,
        t.archimate_relationship
      );
      if (result.changes > 0) seeded++;
    } catch (err) {
      // Best-effort; don't let seeding break startup.
      logger?.error?.('Failed to ensure standard edge type', { type_name: t.type_name, error: err.message });
    }
  }
  return seeded;
}
