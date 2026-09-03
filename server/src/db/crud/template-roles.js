import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { dbExec } from '../../utils/db-helpers.js';

const TABLE = 'template_roles';
const PK = 'tr_role_id';
const JSON_FIELDS = [];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'string' });

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

export const getTemplateRole = base.get;

/**
 * List all template roles ordered by sort_order, then role_id.
 * Returns { success: true, data: [{ role_id, display_name, derivation_scope, sort_order }] }.
 */
export const listTemplateRoles = (db) => dbExec(() => {
  const rows = stmt(db, `
    SELECT tr_role_id AS role_id,
           tr_display_name AS display_name,
           tr_derivation_scope AS derivation_scope,
           tr_sort_order AS sort_order
    FROM ${TABLE}
    ORDER BY COALESCE(tr_sort_order, 9999) ASC, tr_role_id ASC
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
  const row = stmt(db, `SELECT 1 FROM ${TABLE} WHERE ${PK} = ?`).get(roleId);
  return !!row;
}
