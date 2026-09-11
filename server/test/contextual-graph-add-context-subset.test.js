import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { addContext } from '../src/services/contextual-graph/add-context.js';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function makeDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

function seedServer(db) {
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return db.prepare('SELECT svr_id FROM servers').get().svr_id;
}

function seedEntities(db, rows) {
  for (const { type, entityId, name } of rows) {
    const typeRow = db.prepare('SELECT et_id FROM entity_types WHERE et_type_name = ?').get(type);
    const etId = typeRow ? typeRow.et_id : db.prepare('INSERT INTO entity_types (et_type_name, et_case_match, et_id_format_prefix) VALUES (?, ?, ?)').run(type, 'insensitive', type).lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO entities (ent_type_id, ent_entity_id, ent_name) VALUES (?, ?, ?)').run(etId, entityId, name);
  }
}

function makeFetchGraph({ nodes = [], edges = [] }) {
  return async () => ({ success: true, data: { nodes, edges } });
}

function collectDeployBatch() {
  const composed = [];
  const deployBatch = async (_db, _serverId, _bankId, specs) => {
    for (const spec of specs) composed.push(spec.ext_id);
    return { success: true, composed: specs.map((s) => s.ext_id), pushed: specs.map((s) => s.ext_id), unchanged: [], failed: [] };
  };
  return { composed, deployBatch };
}

describe('addContext subset options', () => {
  let db;
  let serverId;

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
  });

  it('only contextualizes the specified node subset', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
      { type: 'svc', entityId: 'SVC-006', name: 'Invoice Service' },
      { type: 'svc', entityId: 'SVC-007', name: 'Payment Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
        { data: { id: 'h2', label: 'svc:SVC-006' } },
        { data: { id: 'h3', label: 'svc:SVC-007' } },
      ],
      edges: [
        { data: { source: 'h1', target: 'h2', weight: 3 } },
        { data: { source: 'h2', target: 'h3', weight: 3 } },
      ] });

    const { composed, deployBatch } = collectDeployBatch();

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      node_ids: ['svc:SVC-005', 'svc:SVC-006'],
            allowed_model_types: ['entity-summary', 'entity-capabilities', 'edge-ctx'],
      import_skeleton: true });

    assert.equal(result.success, true);
    assert.equal(result.queued.entitySummary, 2, 'only 2 entity-summary specs');
    assert.equal(result.queued.entityCapabilities, 2, 'only 2 entity-capabilities specs');
    assert.equal(result.queued.edge, 1, 'only 1 edge-ctx spec for the pair inside subset');
    assert.equal(result.queued.discover, 0, 'discovery disabled');
    assert.ok(composed.includes('entity-summary-svc:SVC-005'));
    assert.ok(composed.includes('entity-capabilities-svc:SVC-005'));
    assert.ok(composed.includes('entity-summary-svc:SVC-006'));
    assert.ok(composed.includes('entity-capabilities-svc:SVC-006'));
    assert.ok(!composed.includes('entity-summary-svc:SVC-007'));
  });

  it('skips skeleton import and contextualizes the current working graph', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
      { type: 'svc', entityId: 'SVC-006', name: 'Invoice Service' },
    ]);

    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      display_name: 'Billing Service',
      provenance: { source: 'hindsight' } });
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-006', ['canonical', 'active'], {
      display_name: 'Invoice Service',
      provenance: { source: 'hindsight' } });

    const fetchGraph = makeFetchGraph({ nodes: [], edges: [] });
    const { composed, deployBatch } = collectDeployBatch();

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      import_skeleton: false,
      allowed_model_types: ['entity-summary', 'entity-capabilities'],
    });

    assert.equal(result.success, true);
    assert.equal(result.queued.entitySummary, 2);
    assert.equal(result.queued.entityCapabilities, 2);
    assert.ok(composed.includes('entity-summary-svc:SVC-005'));
    assert.ok(composed.includes('entity-summary-svc:SVC-006'));
  });
});
