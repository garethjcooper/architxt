import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import {
  deleteMentalModel,
  updateMentalModel,
  addMentalModelTag,
  addMentalModelEntity,
  removeMentalModelEntity,
  removeMentalModelTag,
  syncMentalModelTags,
  batchUpdateMentalModelConfig,
  batchUpdateMentalModelTags,
  batchUpdateMentalModelEntities,
  deriveMentalModels,
  getMentalModelWithRelations,
  isSystemTemplateRole,
  SYSTEM_TEMPLATE_ROLES,
} from '../src/db/crud/mental-models.js';

function getTestDb() {
  clearCache();
  const file = path.join(process.cwd(), `tmp/test-system-template-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return { db, file };
}

function getSystemTemplate(db, role) {
  const row = db.prepare("SELECT mm_id, mm_ext_id, mm_template_role, mm_is_template FROM mental_models WHERE mm_template_role = ?").get(role);
  if (!row) throw new Error(`Missing system template role ${role}`);
  return row;
}

function makeTag(db) {
  const result = db.prepare("INSERT INTO tags (tag_name, tag_generated_by) VALUES (?, 'user')").run(`tag-${Date.now()}`);
  return result.lastInsertRowid;
}

function makeEntity(db) {
  const typeId = db.prepare("INSERT INTO entity_types (et_type_name, et_id_format_prefix) VALUES (?, ?)").run('test-type', 'test-type').lastInsertRowid;
  const entId = db.prepare(
    "INSERT INTO entities (ent_type_id, ent_entity_id, ent_name, ent_generated_by) VALUES (?, ?, ?, 'user')"
  ).run(typeId, 'ent-1', 'Test Entity').lastInsertRowid;
  return { typeId, entId };
}

function expectBlocked(result) {
  assert.equal(result.success, false, 'expected operation to fail');
  assert.equal(result.code, 'SYSTEM_TEMPLATE_IMMUTABLE', `expected SYSTEM_TEMPLATE_IMMUTABLE, got ${result.code}`);
  assert.ok(result.error.includes('System template'), result.error);
}

describe('system template hygiene', () => {
  let db, file;

  beforeEach(() => {
    ({ db, file } = getTestDb());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(file); } catch {}
  });

  it('has the four reserved system template roles', () => {
    for (const role of SYSTEM_TEMPLATE_ROLES) {
      const row = getSystemTemplate(db, role);
      assert.equal(row.mm_is_template, 'true');
      assert.ok(isSystemTemplateRole(row.mm_template_role));
    }
  });

  it('exposes no tags and no entities on system templates', () => {
    for (const role of SYSTEM_TEMPLATE_ROLES) {
      const { mm_id } = getSystemTemplate(db, role);
      const relations = getMentalModelWithRelations(db, mm_id);
      assert.ok(relations.success);
      assert.deepEqual(relations.data.mm_tags, []);
      assert.deepEqual(relations.data.mm_entities, []);
    }
  });

  it('cannot delete a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = deleteMentalModel(db, mm_id);
    expectBlocked(result);
  });

  it('cannot convert a system template to a non-template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = updateMentalModel(db, mm_id, { mm_is_template: 'false' });
    expectBlocked(result);
  });

  it('cannot change a system template role', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = updateMentalModel(db, mm_id, { mm_template_role: 'user_entity_derived' });
    expectBlocked(result);
  });

  it('cannot change a system template external id to a different value', () => {
    const { mm_id, mm_ext_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = updateMentalModel(db, mm_id, { mm_ext_id: `${mm_ext_id}-hacked` });
    expectBlocked(result);
  });

  it('allows a system template external id to be set to its current value', () => {
    const { mm_id, mm_ext_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = updateMentalModel(db, mm_id, { mm_ext_id: mm_ext_id });
    assert.equal(result.success, true, result.error);
  });

  it('cannot change a system template name', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = updateMentalModel(db, mm_id, { mm_name: 'Hacked name' });
    expectBlocked(result);
  });

  it('can still edit benign config fields on a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = updateMentalModel(db, mm_id, { mm_max_tokens: 4096 });
    assert.equal(result.success, true, result.error);
  });

  it('cannot add a tag to a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const tagId = makeTag(db);
    const result = addMentalModelTag(db, mm_id, tagId);
    expectBlocked(result);
  });

  it('cannot remove a tag from a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const tagId = makeTag(db);
    const result = removeMentalModelTag(db, mm_id, tagId);
    expectBlocked(result);
  });

  it('cannot sync tags on a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = syncMentalModelTags(db, mm_id, ['some-tag']);
    expectBlocked(result);
  });

  it('cannot add an entity to a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const { entId } = makeEntity(db);
    const result = addMentalModelEntity(db, mm_id, entId);
    expectBlocked(result);
  });

  it('cannot remove an entity from a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const { entId } = makeEntity(db);
    const result = removeMentalModelEntity(db, mm_id, entId);
    expectBlocked(result);
  });

  it('cannot batch update tags on a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const tagId = makeTag(db);
    const result = batchUpdateMentalModelTags(db, [mm_id], [tagId], []);
    expectBlocked(result);
  });

  it('cannot batch update entities on a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const { entId } = makeEntity(db);
    const result = batchUpdateMentalModelEntities(db, [mm_id], [entId], []);
    expectBlocked(result);
  });

  it('cannot batch update config on a system template', () => {
    const { mm_id } = getSystemTemplate(db, 'sys_entity_summary');
    const result = batchUpdateMentalModelConfig(db, [mm_id], { max_tokens: 1024 });
    expectBlocked(result);
  });

  it('does not derive per-entity models from a system template', () => {
    const derived = deriveMentalModels({
      id: 1,
      is_template: true,
      template_role: 'sys_entity_summary',
      ext_id: 'sys_entity_summary',
      name: 'Entity summary',
      source_query: '',
      refresh_after_consolidation: false,
      refresh_mode: 'full',
      exclude_all_mental_models: false,
      exclude_mental_model_list: null,
      max_tokens: 2048,
      tags_match_mode: 'all_strict',
      dimension: 'contextual-graph',
      returns: 'sys_patch',
      concatenation: 'compile',
      tags: [],
      entities: [{ id: 99, name: 'some-entity', entity_id: 'ent-99' }],
    });
    assert.deepEqual(derived, []);
  });

  it('substitutes {id} alias for {entity-id} in derived user templates', () => {
    const db = getTestDb().db;
    const derived = deriveMentalModels(
      {
        id: 1,
        is_template: true,
        template_role: 'user_entity_derived',
        ext_id: 'derived-{id}',
        name: 'Derived {entity-name}',
        source_query: 'Tell me about {id}',
        refresh_after_consolidation: false,
        refresh_mode: 'full',
        exclude_all_mental_models: false,
        exclude_mental_model_list: null,
        max_tokens: 2048,
        tags_match_mode: 'all_strict',
        tags: [],
        entities: [{ id: 99, name: 'some-entity', entity_id: 'ent-99' }],
      },
      { db }
    );
    assert.equal(derived.length, 1);
    assert.equal(derived[0].ext_id, 'derived-ent-99');
    assert.equal(derived[0].name, 'Derived some-entity');
    assert.equal(derived[0].source_query, 'Tell me about ent-99');
  });

  it('allows a normal user template to be deleted and updated', () => {
    const createResult = db.prepare(
      "INSERT INTO mental_models (mm_ext_id, mm_name, mm_is_template, mm_template_role) VALUES (?, ?, ?, ?)"
    ).run('user-template-1', 'User Template', 'true', 'user_entity_derived');
    const mmId = createResult.lastInsertRowid;

    const updateResult = updateMentalModel(db, mmId, { mm_is_template: 'false' });
    assert.equal(updateResult.success, true, updateResult.error);

    const deleteResult = deleteMentalModel(db, mmId);
    assert.equal(deleteResult.success, true, deleteResult.error);
  });
});
