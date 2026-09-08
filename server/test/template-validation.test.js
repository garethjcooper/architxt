import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { createTemplateRole } from '../src/db/crud/template-roles.js';
import {
  validateRoleBasedTemplate,
  extractRoleTemplatePrefix,
  buildRoleTemplateValue,
  getRoleTemplateInstructions,
} from '../src/services/contextual-graph/template-validation.js';

function getTestDb() {
  clearCache();
  const file = path.join(process.cwd(), `tmp/test-template-validation-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return { db, file };
}

describe('template-validation', () => {
  let db, file;

  beforeEach(() => {
    ({ db, file } = getTestDb());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(file); } catch {}
  });

  it('rejects unknown template roles', () => {
    const result = validateRoleBasedTemplate(db, {
      roleId: 'missing_role',
      extId: 'x-{entity-id}',
      name: 'x {entity-name}',
      sourceQuery: '{entity-name} {entity-id}',
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes('missing_role'));
  });

  it('validates node role format and query placeholders', () => {
    createTemplateRole(db, { role_id: 'node_role', display_name: 'Node Role', derivation_scope: 'node' });
    const ok = validateRoleBasedTemplate(db, {
      roleId: 'node_role',
      extId: 'node-role-{entity-id}',
      name: 'Node Role {entity-name}',
      sourceQuery: '{entity-name} and {entity-id}',
    });
    assert.equal(ok.valid, true);
    assert.deepEqual(ok.errors, []);

    const bad = validateRoleBasedTemplate(db, {
      roleId: 'node_role',
      extId: 'node-role-bad',
      name: 'Bad',
      sourceQuery: 'no placeholders',
    });
    assert.equal(bad.valid, false);
    assert.equal(bad.errors.length, 4);
  });

  it('validates edge role format and query placeholders', () => {
    createTemplateRole(db, { role_id: 'edge_role', display_name: 'Edge Role', derivation_scope: 'edge' });
    const ok = validateRoleBasedTemplate(db, {
      roleId: 'edge_role',
      extId: 'edge-role-{source-id}|{target-id}',
      name: 'Edge Role {source-name} <-> {target-name}',
      sourceQuery: '{source-name} {source-id} {target-name} {target-id}',
    });
    assert.equal(ok.valid, true);

    const missing = validateRoleBasedTemplate(db, {
      roleId: 'edge_role',
      extId: 'edge-role-{source-id}|{target-id}',
      name: 'Edge Role {source-name} <-> {target-name}',
      sourceQuery: '{source-name} {source-id} {target-name}',
    });
    assert.equal(missing.valid, false);
    assert.ok(missing.errors.some((e) => e.includes('{target-id}')));
  });

  it('validates seed role format and query placeholders', () => {
    createTemplateRole(db, { role_id: 'seed_role', display_name: 'Seed Role', derivation_scope: 'seed' });
    const ok = validateRoleBasedTemplate(db, {
      roleId: 'seed_role',
      extId: 'seed-role-{seed-id}',
      name: 'Seed Role {seed-name}',
      sourceQuery: '{seed-id} {seed-name}',
    });
    assert.equal(ok.valid, true);

    const badName = validateRoleBasedTemplate(db, {
      roleId: 'seed_role',
      extId: 'seed-role-{seed-id}',
      name: 'Seed Role',
      sourceQuery: '{seed-id} {seed-name}',
    });
    assert.equal(badName.valid, false);
    assert.ok(badName.errors.some((e) => e.includes('Name must be')));
  });

  it('extracts and rebuilds prefixes', () => {
    assert.equal(extractRoleTemplatePrefix('node', 'extId', 'prefix-{entity-id}'), 'prefix');
    assert.equal(extractRoleTemplatePrefix('node', 'name', 'Prefix {entity-name}'), 'Prefix');
    assert.equal(buildRoleTemplateValue('edge', 'extId', 'abc'), 'abc-{source-id}|{target-id}');
    assert.equal(buildRoleTemplateValue('seed', 'name', 'Seed'), 'Seed {seed-name}');
    assert.ok(getRoleTemplateInstructions('node').includes('{entity-name}'));
  });
});
