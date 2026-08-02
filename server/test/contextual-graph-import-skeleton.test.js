import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { importHindsightSkeleton } from '../src/services/contextual-graph/import-hindsight-skeleton.js';
import {
  getNode,
  listNodes,
  getEdge,
  listEdges,
} from '../src/db/crud/contextual-graph.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-contextual-import-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_base_url, svr_name) VALUES (?, ?)').run('http://hindsight', 'test');
  const serverId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  return { db, file, serverId };
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
      db.prepare('INSERT INTO entity_types (et_type_name, et_id_label, et_name_label) VALUES (?, ?, ?)').run(
        e.type, 'ID', 'Name');
      typeId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    }
    db.prepare('INSERT INTO entities (ent_entity_id, ent_name, ent_type_id, ent_aliases, ent_generated_by) VALUES (?, ?, ?, ?, ?)').run(
      e.entityId, e.name, typeId, JSON.stringify(e.aliases || []), 'user');
  }
}

function makeFetchGraph(graph) {
  return async (serverId, bankId, options) => ({
    success: true,
    data: graph,
    request: { serverId, bankId, options },
  });
}

describe('importHindsightSkeleton', () => {
  let db;
  let file;
  let serverId;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file, serverId } = createTestDb());
    clearCache();
  });

  it('requires server_id and bank_id', async () => {
    const result = await importHindsightSkeleton(db, null, 'bank');
    assert.equal(result.success, false);
    assert.equal(result.code, 'MISSING_PARAMS');
  });

  it('imports canonical and uncanonical-grounded nodes', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
        { data: { id: 'h2', label: 'Payment Gateway' } },
      ],
      edges: [],
    });

    const result = await importHindsightSkeleton(db, serverId, 'Mozart-API', {}, fetchGraph);

    assert.equal(result.success, true);
    assert.equal(result.imported.nodes, 2);

    const canonical = getNode(db, serverId, 'Mozart-API', 'svc:SVC-005').data;
    assert.equal(canonical.cgn_id, 'svc:SVC-005');
    assert.deepEqual(canonical.cgn_labels, ['canonical', 'active', 'svc']);
    assert.equal(canonical.cgn_properties.provenance.source, 'hindsight');

    const uncanonical = getNode(db, serverId, 'Mozart-API', 'uncanonical:payment-gateway').data;
    assert.equal(uncanonical.cgn_id, 'uncanonical:payment-gateway');
    assert.deepEqual(uncanonical.cgn_labels, ['uncanonical', 'grounded', 'active']);
    assert.equal(uncanonical.cgn_properties.display_name, 'Payment Gateway');
  });

  it('imports undirected co-occurrence edges between resolved nodes', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
      { type: 'svc', entityId: 'SVC-006', name: 'Invoice Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
        { data: { id: 'h2', label: 'svc:SVC-006' } },
        { data: { id: 'h3', label: 'unknown:GHOST-001' } },
      ],
      edges: [
        { data: { source: 'h1', target: 'h2', weight: 3 } },
        { data: { source: 'h2', target: 'h1', weight: 3 } },
        { data: { source: 'h1', target: 'h3', weight: 1 } },
      ],
    });

    const result = await importHindsightSkeleton(db, serverId, 'Mozart-API', { min_weight: 1 }, fetchGraph);

    assert.equal(result.success, true);
    assert.equal(result.imported.nodes, 3);
    assert.equal(result.imported.edges, 2);

    const edge = getEdge(db, serverId, 'Mozart-API', 'hindsight:svc:SVC-005|svc:SVC-006').data;
    assert.equal(edge.cge_type, null);
    assert.equal(edge.cge_properties.directed, false);
    assert.equal(edge.cge_properties.weight, 3);
    assert.equal(edge.cge_properties.provenance.source, 'hindsight');

    const edges = listEdges(db, serverId, 'Mozart-API', { undirected: true }).data;
    assert.equal(edges.length, 2);

    const ghost = getNode(db, serverId, 'Mozart-API', 'unknown:ghost-001').data;
    assert.equal(ghost.cgn_labels.includes('grounded'), true);
    assert.equal(ghost.cgn_labels.includes('unknown'), true);
    assert.equal(ghost.cgn_properties.display_name, 'unknown:GHOST-001');
  });

  it('does not import edges below min_weight', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
      { type: 'svc', entityId: 'SVC-006', name: 'Invoice Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
        { data: { id: 'h2', label: 'svc:SVC-006' } },
      ],
      edges: [
        { data: { source: 'h1', target: 'h2', weight: 1 } },
      ],
    });

    const result = await importHindsightSkeleton(db, serverId, 'Mozart-API', { min_weight: 2 }, fetchGraph);
    assert.equal(result.imported.edges, 0);
  });

  it('preserves existing model-derived properties on re-import', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'entity-ctx',
        model_id: 'entity-ctx-svc:SVC-005',
        summary: 'Original summary',
      },
    });

    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
      ],
      edges: [],
    });

    const result = await importHindsightSkeleton(db, serverId, 'Mozart-API', {}, fetchGraph);
    assert.equal(result.imported.nodes, 1);

    const node = getNode(db, serverId, 'Mozart-API', 'svc:SVC-005').data;
    assert.equal(node.cgn_properties.provenance.source, 'hindsight');
    assert.equal(node.cgn_properties.provenance.model_id, 'entity-ctx-svc:SVC-005');
    assert.equal(node.cgn_properties.provenance.summary, 'Original summary');
  });

  it('does not delete existing nodes absent from the import', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'uncanonical:existing-node', ['uncanonical', 'discovered', 'active'], {
      display_name: 'Existing Node',
    });

    const fetchGraph = makeFetchGraph({
      nodes: [{ data: { id: 'h1', label: 'svc:SVC-005' } }],
      edges: [],
    });

    const result = await importHindsightSkeleton(db, serverId, 'Mozart-API', {}, fetchGraph);
    assert.equal(result.imported.nodes, 1);

    const existing = getNode(db, serverId, 'Mozart-API', 'uncanonical:existing-node').data;
    assert.notEqual(existing, null);
  });
});
