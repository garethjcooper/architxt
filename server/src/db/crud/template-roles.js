import { dbExec } from '../../utils/db-helpers.js';

const TABLE = 'template_roles';
const PK = 'tr_role_id';
const VALID_SCOPES = new Set(['node', 'edge', 'seed', 'graph']);

// Direct db.prepare is used below (instead of the shared stmt cache) because
// template role primary keys are strings and tests create many ephemeral SQLite
// databases in parallel. The global SQL-keyed statement cache can otherwise bind
// a prepared statement to the wrong database connection and return stale data.

/** Legacy model-type slug -> role_id. Kept for backward compatibility. */
export const MODEL_TYPE_TO_ROLE = {
  'entity-summary': 'sys_entity_summary',
  'entity-capabilities': 'sys_entity_capabilities',
  'edge-ctx': 'sys_edge_context',
  discover: 'sys_discovery_context',
};

/** Role_id -> legacy model-type slug. */
export const ROLE_TO_MODEL_TYPE = Object.fromEntries(
  Object.entries(MODEL_TYPE_TO_ROLE).map(([k, v]) => [v, k]),
);

export const getTemplateRole = (db, roleId) => dbExec(() => {
  const row = db.prepare(`
    SELECT
      tr_role_id AS role_id,
      tr_display_name AS display_name,
      tr_derivation_scope AS derivation_scope,
      tr_sort_order AS sort_order,
      tr_created_at AS created_at,
      tr_updated_at AS updated_at,
      (SELECT COUNT(*) FROM mental_models WHERE mm_template_role = tr.tr_role_id) AS usage_count
    FROM ${TABLE} tr
    WHERE ${PK} = ?
  `).get(roleId);
  if (!row) return null;
  return {
    role_id: row.role_id,
    display_name: row.display_name,
    derivation_scope: row.derivation_scope,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    usage_count: row.usage_count,
  };
}, 'templateRoles.get');

/**
 * List all template roles ordered by sort_order, then display_name.
 * Returns { success: true, data: [{ role_id, display_name, derivation_scope, sort_order }] }.
 */
export const listTemplateRoles = (db) => dbExec(() => {
  const rows = db.prepare(`
    SELECT
      tr_role_id AS role_id,
      tr_display_name AS display_name,
      tr_derivation_scope AS derivation_scope,
      tr_sort_order AS sort_order,
      tr_created_at AS created_at,
      tr_updated_at AS updated_at,
      (SELECT COUNT(*) FROM mental_models WHERE mm_template_role = tr.tr_role_id) AS usage_count
    FROM ${TABLE} tr
    ORDER BY COALESCE(tr_sort_order, 9999) ASC, tr_display_name ASC
  `).all();
  return rows;
}, 'templateRoles.list');

/**
 * Return a Set of all known role IDs.
 */
export function getTemplateRoleIds(db) {
  const result = listTemplateRoles(db);
  const rows = Array.isArray(result) ? result : (result.success ? result.data : []);
  return new Set(rows.map((r) => r.role_id));
}

/**
 * Map of role_id -> derivation_scope.
 */
export function getRoleScopeMap(db) {
  const result = listTemplateRoles(db);
  const rows = Array.isArray(result) ? result : (result.success ? result.data : []);
  return new Map(rows.map((r) => [r.role_id, r.derivation_scope]));
}

/**
 * Check if a role_id exists in template_roles.
 */
export function isKnownTemplateRole(db, roleId) {
  const row = db.prepare(`SELECT 1 FROM ${TABLE} WHERE ${PK} = ?`).get(roleId);
  return !!row;
}

/**
 * Validate role_id constraints.
 * No pattern is enforced, but role_id is capped at 64 chars and the
 * sys_ prefix is reserved for seeded system roles.
 */
export function validateRoleId(roleId) {
  if (!roleId || typeof roleId !== 'string') {
    return { valid: false, error: 'role_id is required', code: 'VALIDATION_ERROR' };
  }
  const trimmed = roleId.trim();
  if (trimmed === '') {
    return { valid: false, error: 'role_id is required', code: 'VALIDATION_ERROR' };
  }
  if (trimmed.length > 64) {
    return { valid: false, error: 'role_id must be 64 characters or fewer', code: 'VALIDATION_ERROR' };
  }
  if (trimmed.startsWith('sys_')) {
    return { valid: false, error: 'role_id cannot start with sys_ (reserved prefix)', code: 'VALIDATION_ERROR' };
  }
  return { valid: true, value: trimmed };
}

/**
 * Create a custom template role. role_id is unique and cannot start with sys_.
 */
export const createTemplateRole = (db, { role_id, display_name, derivation_scope, sort_order = 1 }) => dbExec(() => {
  const idCheck = validateRoleId(role_id);
  if (!idCheck.valid) {
    throw Object.assign(new Error(idCheck.error), { code: idCheck.code });
  }
  const roleId = idCheck.value;
  const cleanDisplay = typeof display_name === 'string' ? display_name.trim() : '';
  if (cleanDisplay === '') {
    throw Object.assign(new Error('display_name is required'), { code: 'VALIDATION_ERROR' });
  }

  if (!VALID_SCOPES.has(derivation_scope)) {
    throw Object.assign(new Error('derivation_scope must be node, edge, seed or graph'), { code: 'VALIDATION_ERROR' });
  }

  const order = sort_order === undefined || sort_order === null ? 1 : Number(sort_order);
  if (!Number.isInteger(order)) {
    throw Object.assign(new Error('sort_order must be an integer'), { code: 'VALIDATION_ERROR' });
  }

  const sql = `INSERT INTO ${TABLE} (${PK}, tr_display_name, tr_derivation_scope, tr_sort_order) VALUES (?, ?, ?, ?)`;
  db.prepare(sql).run(roleId, cleanDisplay, derivation_scope, order);
  return roleId;
}, 'templateRoles.create');

/**
 * Update editable fields of a template role.
 * System roles can only edit display_name and sort_order.
 * Custom roles can also edit derivation_scope.
 */
export const updateTemplateRole = (db, roleId, { display_name, derivation_scope, sort_order }) => dbExec(() => {
  const isSystem = roleId.startsWith('sys_');
  const updates = [];
  const values = [];

  if (display_name !== undefined && display_name !== null) {
    const clean = typeof display_name === 'string' ? display_name.trim() : '';
    if (clean === '') {
      throw Object.assign(new Error('display_name cannot be empty'), { code: 'VALIDATION_ERROR' });
    }
    updates.push('tr_display_name = ?');
    values.push(clean);
  }

  if (derivation_scope !== undefined && derivation_scope !== null) {
    if (isSystem) {
      throw Object.assign(new Error('derivation_scope cannot be changed for system roles'), { code: 'SYSTEM_TEMPLATE_IMMUTABLE' });
    }
    if (!VALID_SCOPES.has(derivation_scope)) {
      throw Object.assign(new Error('derivation_scope must be node, edge, seed or graph'), { code: 'VALIDATION_ERROR' });
    }
    updates.push('tr_derivation_scope = ?');
    values.push(derivation_scope);
  }

  if (sort_order !== undefined && sort_order !== null) {
    const order = Number(sort_order);
    if (!Number.isInteger(order)) {
      throw Object.assign(new Error('sort_order must be an integer'), { code: 'VALIDATION_ERROR' });
    }
    updates.push('tr_sort_order = ?');
    values.push(order);
  }

  if (updates.length === 0) {
    throw Object.assign(new Error('No fields to update'), { code: 'VALIDATION_ERROR' });
  }

  values.push(roleId);
  const sql = `UPDATE ${TABLE} SET ${updates.join(', ')} WHERE ${PK} = ?`;
  const result = db.prepare(sql).run(...values);
  return result.changes > 0;
}, 'templateRoles.update');

/**
 * Delete a template role. Blocked when any mental model references it.
 * System roles are deletable only when not in use.
 */
export const deleteTemplateRole = (db, roleId) => dbExec(() => {
  const inUse = db.prepare(`SELECT 1 FROM mental_models WHERE mm_template_role = ? LIMIT 1`).get(roleId);
  if (inUse) {
    throw Object.assign(new Error('Template role is in use by one or more mental models'), { code: 'TEMPLATE_ROLE_IN_USE' });
  }

  const result = db.prepare(`DELETE FROM ${TABLE} WHERE ${PK} = ?`).run(roleId);
  return result.changes > 0;
}, 'templateRoles.delete');

/** Expose derivation scope validation. */
export function isValidDerivationScope(scope) {
  return VALID_SCOPES.has(scope);
}
