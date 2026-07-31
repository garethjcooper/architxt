import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { normalizeHindsightGraph } from '../src/services/research/halo-graph.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-halo-graph-${Date.now()}.db`);
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

function makeFetchGraph(resultFn) {
  return async (serverId, bankId, options) => {
    lastCallOptions = { serverId, bankId, options };
    return resultFn(serverId, bankId, options);
  };
}

describe('normalizeHindsightGraph', () => {
  let db;
  let file;

  before(() => {
    ({ db, file } = createTestDb());
    lastCallOptions = null;
  });

  after(() => {
    cleanupTestDb(db, file);
  });

  it('does not pass a limit to Hindsight because the endpoint ignores it', async () => {
    const fetchGraph = makeFetchGraph(() => ({
      success: true,
      data: { nodes: [], edges: [] },
    }));

    await normalizeHindsightGraph(1, 'Mozart-API', db, { limit: 1000, min_count: 2 }, fetchGraph);

    assert.equal(lastCallOptions.options.limit, undefined);
    assert.equal(lastCallOptions.options.min_count, 2);
  });

  it('returns only architxt-mapped nodes that participate in edges', async () => {
    seedEntities(db, [
      { type: 'app-com', entityId: 'COM-001', name: 'Alpha' },
      { type: 'app-com', entityId: 'COM-002', name: 'Beta' },
    ]);

    const fetchGraph = makeFetchGraph(() => ({
      success: true,
      data: {
        nodes: [
          { data: { id: 'h1', label: 'app-com:COM-001' } },
          { data: { id: 'h2', label: 'app-com:COM-002' } },
          // Hindsight-only node that does not resolve to an architxt entity.
          { data: { id: 'h3', label: 'unknown-type:GHOST-001' } },
        ],
        edges: [
          { data: { source: 'h1', target: 'h2', linkType: 'cooccurrence', weight: 3 } },
        ],
      },
    }));

    const result = await normalizeHindsightGraph(1, 'Mozart-API', db, {}, fetchGraph);

    assert.equal(result.success, true);
    assert.equal(result.nodes.length, 2);
    assert.equal(result.edges.length, 1);
    assert.ok(result.nodes.some((n) => n.id === 'COM-001' && n.label === 'Alpha' && n.type === 'app-com'));
    assert.ok(result.nodes.some((n) => n.id === 'COM-002' && n.label === 'Beta' && n.type === 'app-com'));
    assert.ok(!result.nodes.some((n) => n.id.includes('GHOST')));
    assert.equal(result.edges[0].from, 'COM-001');
    assert.equal(result.edges[0].to, 'COM-002');
    assert.equal(result.edges[0].type, 'cooccurrence');
  });

  it('drops unmapped nodes even if they are the only nodes returned', async () => {
    seedEntities(db, [
      { type: 'svc-com', entityId: 'SVC-001', name: 'Service Alpha' },
    ]);

    const fetchGraph = makeFetchGraph(() => ({
      success: true,
      data: {
        nodes: [
          { data: { id: 'h1', label: 'svc-com:SVC-001' } },
          { data: { id: 'h2', label: 'unknown:GHOST-002' } },
        ],
        edges: [],
      },
    }));

    const result = await normalizeHindsightGraph(1, 'Mozart-API', db, {}, fetchGraph);

    assert.equal(result.success, true);
    // SVC-001 has no edges, so it is dropped too.
    assert.equal(result.nodes.length, 0);
    assert.equal(result.edges.length, 0);
  });
});
