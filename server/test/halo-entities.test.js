import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { normalizeHindsightEntities } from '../src/services/research/halo-graph.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-halo-entities-${Date.now()}.db`);
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

function seedEntities(db, entities) {
  for (const e of entities) {
    const existingType = db.prepare('SELECT et_id FROM entity_types WHERE et_type_name = ?').get(e.type);
    let typeId;
    if (existingType) {
      typeId = existingType.et_id;
    } else {
      db.prepare(`
        INSERT INTO entity_types (et_type_name, et_id_label, et_name_label)
        VALUES (?, ?, ?)
      `).run(e.type, 'ID', 'Name');
      typeId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    }
    db.prepare(`
      INSERT INTO entities (ent_entity_id, ent_name, ent_type_id, ent_aliases, ent_generated_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(e.entityId, e.name, typeId, JSON.stringify(e.aliases || []), 'user');
  }
}

let lastCallOptions = null;

function makeFetchEntities(resultFn) {
  return async (serverId, bankId, options) => {
    lastCallOptions = { serverId, bankId, options };
    return resultFn(serverId, bankId, options);
  };
}

describe('normalizeHindsightEntities', () => {
  let db;
  let file;

  before(() => {
    ({ db, file } = createTestDb());
    lastCallOptions = null;
  });

  after(() => {
    cleanupTestDb(db, file);
  });

  it('paginates through Hindsight entities and resolves canonical architxt nodes', async () => {
    seedEntities(db, [
      { type: 'app-com', entityId: 'COM-001', name: 'Alpha' },
      { type: 'app-com', entityId: 'COM-002', name: 'Beta' },
      { type: 'app-per', entityId: 'PER-001', name: 'Alice' },
    ]);

    const fetchEntities = makeFetchEntities(() => ({
      success: true,
      data: {
        items: [
          { id: 'h1', canonical_name: 'app-com:COM-001', mention_count: 5 },
          { id: 'h2', canonical_name: 'app-com:COM-002', mention_count: 3 },
          { id: 'h3', canonical_name: 'app-per:PER-001', mention_count: 2 },
        ],
        total: 3,
      },
    }));

    const result = await normalizeHindsightEntities(1, 'Mozart-API', db, { limit: 1000 }, fetchEntities);

    assert.equal(lastCallOptions.options.limit, 1000);
    assert.equal(result.success, true);
    assert.equal(result.nodes.length, 3);
    assert.equal(result.edges.length, 0);

    const byId = Object.fromEntries(result.nodes.map((n) => [n.id, n]));
    assert.equal(byId['COM-001'].label, 'Alpha');
    assert.equal(byId['COM-001'].type, 'app-com');
    assert.equal(byId['COM-002'].label, 'Beta');
    assert.equal(byId['PER-001'].label, 'Alice');
  });

  it('drops Hindsight entities that do not map to architxt entities', async () => {
    seedEntities(db, [
      { type: 'app-com', entityId: 'COM-003', name: 'Gamma' },
    ]);

    const fetchEntities = makeFetchEntities(() => ({
      success: true,
      data: {
        items: [
          { id: 'h1', canonical_name: 'app-com:COM-003', mention_count: 5 },
          { id: 'hX', canonical_name: 'unknown-type:GHOST-001', mention_count: 99 },
        ],
        total: 2,
      },
    }));

    const result = await normalizeHindsightEntities(1, 'Mozart-API', db, {}, fetchEntities);

    assert.equal(result.success, true);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].id, 'COM-003');
  });

  it('deduplicates by canonical architxt entity id', async () => {
    seedEntities(db, [
      { type: 'app-com', entityId: 'COM-004', name: 'Delta' },
    ]);

    const fetchEntities = makeFetchEntities(() => ({
      success: true,
      data: {
        items: [
          { id: 'h1', canonical_name: 'app-com:COM-004', mention_count: 5 },
          { id: 'h2', canonical_name: 'Delta', mention_count: 3 },
        ],
        total: 2,
      },
    }));

    const result = await normalizeHindsightEntities(1, 'Mozart-API', db, {}, fetchEntities);

    assert.equal(result.success, true);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.nodes[0].id, 'COM-004');
  });

  it('returns error when fetch fails', async () => {
    const fetchEntities = makeFetchEntities(() => ({ success: false, error: 'timeout', code: 'TIMEOUT' }));

    const result = await normalizeHindsightEntities(1, 'Mozart-API', db, {}, fetchEntities);

    assert.equal(result.success, false);
    assert.equal(result.code, 'TIMEOUT');
  });
});
