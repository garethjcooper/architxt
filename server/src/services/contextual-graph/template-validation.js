import { getRoleScopeMap } from '../../db/crud/template-roles.js';

const SCOPE_RULES = {
  node: {
    extIdTail: '-{id}',
    nameTail: ' {entity-name}',
    extIdRegex: /^(.+)-\{id\}$/,
    nameRegex: /^(.+) \{entity-name\}$/,
    requiredQueryPlaceholders: ['{entity-name}', '{id}'],
  },
  edge: {
    extIdTail: '-{source-id}|{target-id}',
    nameTail: ' {source-name} <-> {target-name}',
    extIdRegex: /^(.+)-\{source-id\}\|\{target-id\}$/,
    nameRegex: /^(.+) \{source-name\} <-> \{target-name\}$/,
    requiredQueryPlaceholders: ['{source-name}', '{source-id}', '{target-name}', '{target-id}'],
  },
  seed: {
    extIdTail: '-{seed-id}',
    nameTail: ' {seed-name}',
    extIdRegex: /^(.+)-\{seed-id\}$/,
    nameRegex: /^(.+) \{seed-name\}$/,
    requiredQueryPlaceholders: ['{seed-id}', '{seed-name}'],
  },
};

/**
 * Get the derivation scope for a template role from the DB.
 *
 * @param {object} db
 * @param {string} roleId
 * @returns {string|null} 'node'|'edge'|'seed'|'graph'|null
 */
export function getRoleDerivationScope(db, roleId) {
  if (!roleId) return null;
  const scopeMap = getRoleScopeMap(db);
  return scopeMap.get(roleId) || null;
}

/**
 * Validate the format of a role-based contextual template.
 *
 * Returns an object describing whether the template ext_id, name, and source_query
 * conform to the required patterns for the role's derivation_scope. Generic
 * templates (no role) are not validated by this function.
 *
 * @param {object} db
 * @param {object} params
 * @param {string} params.roleId
 * @param {string} params.extId
 * @param {string} params.name
 * @param {string} params.sourceQuery
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRoleBasedTemplate(db, { roleId, extId, name, sourceQuery }) {
  const scope = getRoleDerivationScope(db, roleId);
  if (!scope) {
    return { valid: false, errors: [`Unknown template role: ${roleId}`] };
  }

  const rules = SCOPE_RULES[scope];
  if (!rules) {
    return { valid: false, errors: [`Unhandled derivation scope: ${scope}`] };
  }

  const errors = [];

  if (!rules.extIdRegex.test(extId ?? '')) {
    errors.push(`External ID must be "<prefix>${rules.extIdTail}".`);
  }

  if (!rules.nameRegex.test(name ?? '')) {
    errors.push(`Name must be "<prefix>${rules.nameTail}".`);
  }

  const query = sourceQuery ?? '';
  for (const placeholder of rules.requiredQueryPlaceholders) {
    if (!query.includes(placeholder)) {
      errors.push(`Source query must contain ${placeholder}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extract the user-editable prefix from a role-based template ext_id or name.
 * Returns null if the value does not match the expected role format.
 *
 * @param {string} scope
 * @param {'extId'|'name'} field
 * @param {string} value
 * @returns {string|null}
 */
export function extractRoleTemplatePrefix(scope, field, value) {
  const rules = SCOPE_RULES[scope];
  if (!rules) return null;
  const regex = field === 'name' ? rules.nameRegex : rules.extIdRegex;
  const match = regex.exec(value ?? '');
  return match ? match[1] : null;
}

/**
 * Build the full ext_id/name for a role-based template from a user prefix.
 *
 * @param {string} scope
 * @param {'extId'|'name'} field
 * @param {string} prefix
 * @returns {string|null}
 */
export function buildRoleTemplateValue(scope, field, prefix) {
  const rules = SCOPE_RULES[scope];
  if (!rules) return null;
  const tail = field === 'name' ? rules.nameTail : rules.extIdTail;
  return `${prefix}${tail}`;
}

/**
 * Human-readable instruction describing the required format for a role scope.
 *
 * @param {string} scope
 * @returns {string|null}
 */
export function getRoleTemplateInstructions(scope) {
  const rules = SCOPE_RULES[scope];
  if (!rules) return null;
  return `External ID must end with "${rules.extIdTail}" and Name must end with "${rules.nameTail}". Source query must include: ${rules.requiredQueryPlaceholders.join(', ')}.`;
}
