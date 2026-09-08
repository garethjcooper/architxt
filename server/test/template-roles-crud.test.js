import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import {
  createTemplateRole,
  updateTemplateRole,
  deleteTemplateRole,
  listTemplateRoles,
  getTemplateRole,
  validateRoleId,
} from '../src/db/crud/template-roles.js';
import { createMentalModel, updateMentalModel, listTemplateRoles as listMentalModelTemplateRoles } from '../src/db/crud/mental-models.js';

function getTestDb() {
  clearCache();
  const file = path.join(process.cwd(), `tmp/test-template-roles-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return { db, file };
}

function expectValidationError(result, messageIncludes) {
  assert.equal(result.success, false, 'expected operation to fail');
  assert.equal(result.code, 'VALIDATION_ERROR', `expected VALIDATION_ERROR, got ${result.code}`);
  if (messageIncludes) assert.ok(result.error.includes(messageIncludes), result.error);
}

function expectImmutableError(result, expectedCode = 'TEMPLATE_ROLE_IMMUTABLE') {
  assert.equal(result.success, false, 'expected operation to fail');
  assert.equal(result.code, expectedCode, `expected ${expectedCode}, got ${result.code}`);
}

function expectInUseError(result) {
  assert.equal(result.success, false, 'expected operation to fail');
  assert.equal(result.code, 'TEMPLATE_ROLE_IN_USE', `expected TEMPLATE_ROLE_IN_USE, got ${result.code}`);
}

describe('template roles CRUD', () => {
  let db, file;

  beforeEach(() => {
    ({ db, file } = getTestDb());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(file); } catch {}
  });

  it('lists seeded system roles ordered by sort_order then display_name', () => {
    const result = listTemplateRoles(db);
    assert.equal(result.success, true, result.error);
    const ids = result.data.map((r) => r.role_id);
    assert.deepEqual(ids, [
      'sys_entity_summary',
      'sys_entity_capabilities',
      'sys_edge_context',
      'sys_discovery_context',
      'user_entity_derived',
    ]);
  });

  it('creates a custom role with default sort_order=1', () => {
    const createResult = createTemplateRole(db, {
      role_id: 'my_role',
      display_name: 'My Role',
      derivation_scope: 'node',
    });
    assert.equal(createResult.success, true, createResult.error);

    const getResult = getTemplateRole(db, 'my_role');
    assert.equal(getResult.success, true, getResult.error);
    assert.equal(getResult.data.role_id, 'my_role');
    assert.equal(getResult.data.display_name, 'My Role');
    assert.equal(getResult.data.derivation_scope, 'node');
    assert.equal(getResult.data.sort_order, 1);
  });

  it('trims role_id and display_name on create', () => {
    const createResult = createTemplateRole(db, {
      role_id: '  spaced_role  ',
      display_name: '  Spaced Role  ',
      derivation_scope: 'edge',
    });
    assert.equal(createResult.success, true, createResult.error);

    const getResult = getTemplateRole(db, 'spaced_role');
    assert.equal(getResult.success, true, getResult.error);
    assert.equal(getResult.data.display_name, 'Spaced Role');
  });

  it('rejects missing role_id', () => {
    expectValidationError(
      createTemplateRole(db, { display_name: 'No ID', derivation_scope: 'node' }),
      'role_id is required'
    );
  });

  it('rejects role_id longer than 64 characters', () => {
    expectValidationError(
      createTemplateRole(db, { role_id: 'a'.repeat(65), display_name: 'Too Long', derivation_scope: 'node' }),
      '64 characters or fewer'
    );
  });

  it('rejects sys_ prefix for custom roles', () => {
    expectValidationError(
      createTemplateRole(db, { role_id: 'sys_fake', display_name: 'Fake System Role', derivation_scope: 'node' }),
      'sys_'
    );
  });

  it('does not enforce a character pattern on role_id', () => {
    const result = createTemplateRole(db, {
      role_id: 'Role With Spaces & Symbols!',
      display_name: 'Freeform Role',
      derivation_scope: 'edge',
    });
    assert.equal(result.success, true, result.error);
  });

  it('rejects missing display_name', () => {
    expectValidationError(
      createTemplateRole(db, { role_id: 'no_name', derivation_scope: 'node' }),
      'display_name is required'
    );
  });

  it('rejects invalid derivation_scope', () => {
    expectValidationError(
      createTemplateRole(db, { role_id: 'bad_scope', display_name: 'Bad Scope', derivation_scope: 'invalid' }),
      'derivation_scope'
    );
  });

  it('rejects non-integer sort_order', () => {
    expectValidationError(
      createTemplateRole(db, { role_id: 'bad_order', display_name: 'Bad Order', derivation_scope: 'node', sort_order: 1.5 }),
      'sort_order must be an integer'
    );
  });

  it('updates display_name and sort_order on system roles', () => {
    const result = updateTemplateRole(db, 'sys_entity_summary', {
      display_name: 'Updated Entity Summary',
      sort_order: 10,
    });
    assert.equal(result.success, true, result.error);

    const getResult = getTemplateRole(db, 'sys_entity_summary');
    assert.equal(getResult.data.display_name, 'Updated Entity Summary');
    assert.equal(getResult.data.sort_order, 10);
  });

  it('blocks changing derivation_scope on system roles', () => {
    expectImmutableError(
      updateTemplateRole(db, 'sys_entity_summary', { derivation_scope: 'edge' }),
      'BUILT_IN_TEMPLATE_ROLE_IMMUTABLE'
    );
  });

  it('updates derivation_scope on custom roles', () => {
    createTemplateRole(db, { role_id: 'editable_scope', display_name: 'Editable', derivation_scope: 'node' });
    const result = updateTemplateRole(db, 'editable_scope', { derivation_scope: 'edge' });
    assert.equal(result.success, true, result.error);
    assert.equal(getTemplateRole(db, 'editable_scope').data.derivation_scope, 'edge');
  });

  it('deletes a custom role when not in use', () => {
    createTemplateRole(db, { role_id: 'deletable', display_name: 'Deletable', derivation_scope: 'node' });
    const result = deleteTemplateRole(db, 'deletable');
    assert.equal(result.success, true, result.error);
    assert.equal(getTemplateRole(db, 'deletable').data, null);
  });

  it('blocks deleting a role referenced by a mental model', () => {
    createTemplateRole(db, { role_id: 'in_use_role', display_name: 'In Use', derivation_scope: 'node' });
    const mmResult = createMentalModel(db, {
      mm_ext_id: 'mm-with-role',
      mm_name: 'MM With Role',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'in_use_role',
    });
    assert.equal(mmResult.success, true, mmResult.error);

    expectInUseError(deleteTemplateRole(db, 'in_use_role'));
  });

  it('blocks deleting a system role referenced by its seeded mental model', () => {
    const result = deleteTemplateRole(db, 'sys_discovery_context');
    assert.equal(result.success, false, 'expected delete to fail');
    assert.equal(result.code, 'BUILT_IN_TEMPLATE_ROLE_IMMUTABLE', `expected BUILT_IN_TEMPLATE_ROLE_IMMUTABLE, got ${result.code}`);
  });

  it('exposes seeded roles through the legacy model-type API shape', () => {
    const result = listTemplateRoles(db);
    assert.equal(result.success, true, result.error);
    const roles = result.data
      .filter((r) => r.role_id)
      .map((r) => ({
        value: r.role_id,
        label: r.display_name || r.role_id,
        derivation_scope: r.derivation_scope || '',
      }));
    assert.deepEqual(roles.map((r) => r.value), [
      'sys_entity_summary',
      'sys_entity_capabilities',
      'sys_edge_context',
      'sys_discovery_context',
      'user_entity_derived',
    ]);
    assert.equal(roles.every((r) => r.label && r.value), true);
  });

  it('mental-models listTemplateRoles returns the legacy shape used by /roles/template', () => {
    const rows = listMentalModelTemplateRoles(db);
    assert.ok(Array.isArray(rows), 'expected an array');
    assert.equal(rows.length, 5, JSON.stringify(rows));
    const roles = rows.map((r) => r.role);
    assert.deepEqual(roles, [
      'sys_entity_summary',
      'sys_entity_capabilities',
      'sys_edge_context',
      'sys_discovery_context',
      'user_entity_derived',
    ]);
    assert.ok(rows.every((r) => r.role && r.label && r.derivation_scope !== undefined));
  });
});

describe('mental model role assignment rules', () => {
  let db, file;

  beforeEach(() => {
    ({ db, file } = getTestDb());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(file); } catch {}
  });

  it('allows assigning a custom template role to a manually created model', () => {
    createTemplateRole(db, { role_id: 'custom_role', display_name: 'Custom', derivation_scope: 'node' });
    const result = createMentalModel(db, {
      mm_ext_id: 'mm-custom-role',
      mm_name: 'Custom Role Model',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'custom_role',
    });
    assert.equal(result.success, true, result.error);
  });

  it('requires source_query when a contextual template role is assigned', () => {
    createTemplateRole(db, { role_id: 'ctx_role', display_name: 'Ctx', derivation_scope: 'node' });
    const result = createMentalModel(db, {
      mm_ext_id: 'mm-no-query',
      mm_name: 'No Query Model',
      mm_template_role: 'ctx_role',
    });
    assert.equal(result.success, false, 'expected create to fail');
    assert.equal(result.code, 'VALIDATION_ERROR', result.code);
    assert.ok(result.error.includes('source_query'), result.error);
  });

  it('blocks assigning a system template role to a new model', () => {
    const result = createMentalModel(db, {
      mm_ext_id: 'mm-sys-role',
      mm_name: 'System Role Model',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'sys_entity_summary',
    });
    expectImmutableError(result, 'SYSTEM_TEMPLATE_IMMUTABLE');
  });

  it('blocks changing mm_template_role on update', () => {
    createTemplateRole(db, { role_id: 'role_a', display_name: 'Role A', derivation_scope: 'node' });
    createTemplateRole(db, { role_id: 'role_b', display_name: 'Role B', derivation_scope: 'edge' });
    const createResult = createMentalModel(db, {
      mm_ext_id: 'mm-immutable-role',
      mm_name: 'Immutable Role Model',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'role_a',
    });
    assert.equal(createResult.success, true, createResult.error);
    const mmId = createResult.data;

    const updateResult = updateMentalModel(db, mmId, { mm_template_role: 'role_b' });
    expectImmutableError(updateResult, 'TEMPLATE_ROLE_IMMUTABLE');
  });

  it('blocks assigning the same custom role to two models', () => {
    createTemplateRole(db, { role_id: 'shared_role', display_name: 'Shared', derivation_scope: 'node' });
    const first = createMentalModel(db, {
      mm_ext_id: 'mm-first',
      mm_name: 'First',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'shared_role',
    });
    assert.equal(first.success, true, first.error);

    const second = createMentalModel(db, {
      mm_ext_id: 'mm-second',
      mm_name: 'Second',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'shared_role',
    });
    expectInUseError(second);
  });

  it('allows assigning user_entity_derived to multiple models', () => {
    const first = createMentalModel(db, {
      mm_ext_id: 'mm-user-derived-1',
      mm_name: 'User Derived 1',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'user_entity_derived',
    });
    assert.equal(first.success, true, first.error);

    const second = createMentalModel(db, {
      mm_ext_id: 'mm-user-derived-2',
      mm_name: 'User Derived 2',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'user_entity_derived',
    });
    assert.equal(second.success, true, second.error);
  });

  it('allows updating a model when mm_template_role is unchanged', () => {
    createTemplateRole(db, { role_id: 'role_a', display_name: 'Role A', derivation_scope: 'node' });
    const createResult = createMentalModel(db, {
      mm_ext_id: 'mm-unchanged-role',
      mm_name: 'Unchanged Role Model',
      mm_source_query: 'MATCH (n) RETURN n',
      mm_template_role: 'role_a',
    });
    assert.equal(createResult.success, true, createResult.error);
    const mmId = createResult.data;

    const updateResult = updateMentalModel(db, mmId, { mm_template_role: 'role_a', mm_name: 'Renamed' });
    assert.equal(updateResult.success, true, updateResult.error);
  });
});

describe('validateRoleId', () => {
  it('accepts freeform ids under 64 chars', () => {
    const result = validateRoleId('my custom role id');
    assert.equal(result.valid, true);
    assert.equal(result.value, 'my custom role id');
  });

  it('rejects sys_ prefix', () => {
    const result = validateRoleId('sys_mine');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('sys_'));
  });
});
