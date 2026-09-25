import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { createEntityType } from '../src/db/crud/entity-types.js';
import { createEntity } from '../src/db/crud/entities.js';
import { resolveEntitiesFromText, groupResolvedEntities } from '../src/services/agent/entity-resolver.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-entity-resolver-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return { db, file };
}

function cleanupTestDb(db, file) {
  db.close();
  fs.unlinkSync(file);
}

function createEntityRow(db, typeId, entityId, name, aliases = [], caseMatch = null, wordBoundaryMatch = null) {
  return createEntity(db, {
    type_id: typeId,
    entity_id: entityId,
    name,
    description: null,
    aliases,
    case_match: caseMatch,
    word_boundary_match: wordBoundaryMatch,
    generated_by: 'user',
  });
}

function createEntityTypeRow(db, typeName, overrides = {}) {
  return createEntityType(db, {
    type_name: typeName,
    description: null,
    id_label: `${typeName} ID`,
    name_label: `${typeName} Name`,
    case_match: 'insensitive',
    word_boundary_match: 'boundaries',
    ...overrides,
  });
}

describe('resolveEntitiesFromText', () => {
  let db;
  let file;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file } = createTestDb());
    clearCache();
  });

  it('returns an empty array when the catalog is empty', async () => {
    const result = await resolveEntitiesFromText(db, 'What about App-1 and the user service?');
    assert.equal(result.success, true);
    assert.deepEqual(result.data, []);
  });

  it('resolves explicit [[Name (type:entity_id)]] tags', async () => {
    const type = createEntityTypeRow(db, 'svc');
    const typeId = type.data;
    createEntityRow(db, typeId, 'SVC-001', 'User Service');

    const result = await resolveEntitiesFromText(db, 'We should update [[User Service (svc:SVC-001)]] first.');
    assert.equal(result.success, true);
    assert.equal(result.data.length, 1);

    const resolved = result.data[0];
    assert.equal(resolved.entity_id, 'SVC-001');
    assert.equal(resolved.name, 'User Service');
    assert.equal(resolved.type_name, 'svc');
    assert.equal(resolved.fromTag, true);
    assert.equal(resolved.matchedText, 'User Service');

    const grouped = groupResolvedEntities(result.data);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].canonical_reference, '[[User Service (svc:SVC-001)]]');
    assert.equal(grouped[0].from_tag, true);
  });

  it('scans clean text for entity names and aliases', async () => {
    const type = createEntityTypeRow(db, 'app');
    const typeId = type.data;
    createEntityRow(db, typeId, 'APP-005', 'Payment App', ['checkout', 'payments']);

    const result = await resolveEntitiesFromText(db, 'The checkout is down because payments is unavailable.');
    assert.equal(result.success, true);
    assert.equal(result.data.length, 2);

    const grouped = groupResolvedEntities(result.data);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].entity_id, 'APP-005');
    assert.equal(grouped[0].name, 'Payment App');
    assert.equal(grouped[0].type_name, 'app');
    assert.equal(grouped[0].from_tag, false);
  });

  it('merges tag and scan matches for the same entity', async () => {
    const type = createEntityTypeRow(db, 'svc');
    const typeId = type.data;
    createEntityRow(db, typeId, 'SVC-007', 'Order Service');

    const result = await resolveEntitiesFromText(db, 'The [[Order Service (svc:SVC-007)]] and order service both need work.');
    assert.equal(result.success, true);

    const grouped = groupResolvedEntities(result.data);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].from_tag, true);
    assert.equal(grouped[0].ranges.length, 2);
  });

  it('respects per-entity word boundary override', async () => {
    const type = createEntityTypeRow(db, 'svc');
    const typeId = type.data;
    createEntityRow(db, typeId, 'SVC-009', 'Auth', [], 'insensitive', 'no-boundaries');

    const result = await resolveEntitiesFromText(db, 'authentication and authorization flow');
    assert.equal(result.success, true);
    assert.equal(result.data.length, 2);

    const grouped = groupResolvedEntities(result.data);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].entity_id, 'SVC-009');
  });

  it('ignores unknown tags and does not invent entities', async () => {
    const type = createEntityTypeRow(db, 'svc');
    const typeId = type.data;
    createEntityRow(db, typeId, 'SVC-011', 'Known Service');

    const result = await resolveEntitiesFromText(db, '[[Unknown Service (svc:SVC-999)]] and Known Service are both listed.');
    assert.equal(result.success, true);
    assert.equal(result.data.length, 1);

    const grouped = groupResolvedEntities(result.data);
    assert.equal(grouped.length, 1);
    assert.equal(grouped[0].entity_id, 'SVC-011');
  });

  it('returns validation error for empty text', async () => {
    const result = await resolveEntitiesFromText(db, '');
    assert.equal(result.success, false);
    assert.equal(result.code, 'VALIDATION_ERROR');
  });

  it('resolves exact entity_id tokens in free text', async () => {
    const type = createEntityTypeRow(db, 'com');
    const typeId = type.data;
    createEntityRow(db, typeId, 'COM-001', 'Billing Component');

    const result = await resolveEntitiesFromText(db, 'Tell me about COM-001 and also SVC-AUD-001.');
    assert.equal(result.success, true);
    assert.equal(result.data.length, 1);

    const resolved = result.data[0];
    assert.equal(resolved.entity_id, 'COM-001');
    assert.equal(resolved.name, 'Billing Component');
    assert.equal(resolved.type_name, 'com');
    assert.equal(resolved.matchedText, 'COM-001');
    assert.equal(resolved.fromTag, false);
  });
});