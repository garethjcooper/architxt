import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
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
    const etId = typeRow ? typeRow.et_id : db.prepare('INSERT INTO entity_types (et_type_name, et_case_match) VALUES (?, ?)').run(type, 'insensitive').lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO entities (ent_type_id, ent_entity_id, ent_name) VALUES (?, ?, ?)').run(etId, entityId, name);
  }
}

function makeFetchGraph({ nodes = [], edges = [] }) {
  return async () => ({ success: true, data: { nodes, edges } });
}

function makeDeployBatch(deployed = []) {
  return async () => ({ success: true, deployed, failed: [] });
}

describe('addContext', () => {
  let db;
  let serverId;

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
  });

  it('requires server_id and bank_id', async () => {
    const result = await addContext(db, null, null, {});
    assert.equal(result.success, false);
    assert.equal(result.code, 'MISSING_PARAMS');
  });

  it('imports skeleton and queues entity-ctx models for active nodes', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
      { type: 'svc', entityId: 'SVC-006', name: 'Invoice Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
        { data: { id: 'h2', label: 'svc:SVC-006' } },
      ],
      edges: [] });

    const deployed = [];
    const deployBatch = async (_db, _serverId, _bankId, specs) => {
      for (const spec of specs) deployed.push(spec.ext_id);
      return { success: true, deployed: specs.map((s) => s.ext_id), failed: [] };
    };

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      run_discovery: false,
 neighborhood: {} });

    assert.equal(result.success, true);
    assert.equal(result.queued.entity, 2);
    assert.equal(result.queued.edge, 0);
    assert.equal(result.queued.discover, 0);
    assert.ok(deployed.includes('entity-ctx-svc:SVC-005'));
    assert.ok(deployed.includes('entity-ctx-svc:SVC-006'));
  });

  it('queues edge-ctx models for undirected edges', async () => {
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
        { data: { source: 'h1', target: 'h2', weight: 3 } },
      ] });

    const deployed = [];
    const deployBatch = async (_db, _serverId, _bankId, specs) => {
      for (const spec of specs) deployed.push(spec.ext_id);
      return { success: true, deployed: specs.map((s) => s.ext_id), failed: [] };
    };

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      run_discovery: false,
 neighborhood: {} });

    assert.equal(result.success, true);
    assert.equal(result.queued.entity, 2);
    assert.equal(result.queued.edge, 1);
    assert.ok(deployed.includes('edge-ctx-svc:SVC-005|svc:SVC-006'));
  });

  it('does not queue entity-ctx for nodes that already have a model_ref', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      display_name: 'Billing Service',
      provenance: { source: 'entity-ctx', model_refs: [{ role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-005', attached_at: '2026-08-02T00:00:00.000Z' }] } });

    const fetchGraph = makeFetchGraph({
      nodes: [{ data: { id: 'h1', label: 'svc:SVC-005' } }],
      edges: [] });

    const deployBatch = async (_db, _serverId, _bankId, specs) => ({
      success: true,
      deployed: specs.map((s) => s.ext_id),
      failed: [] });

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      run_discovery: false,
 neighborhood: {} });

    assert.equal(result.success, true);
    assert.equal(result.queued.entity, 0);
  });

  it('includes manual seed_node_ids in discovery queue', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [{ data: { id: 'h1', label: 'svc:SVC-005' } }],
      edges: [] });

    const queued = [];
    const deployBatch = async (_db, _serverId, _bankId, specs) => {
      for (const spec of specs) queued.push(spec.ext_id);
      return { success: true, deployed: specs.map((s) => s.ext_id), failed: [] };
    };

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      seed_node_ids: ['svc:SVC-005'],
      run_discovery: false,
 neighborhood: { top_k_neighbors: 5 } });

    assert.equal(result.success, true);
    assert.equal(result.queued.discover, 1);
    assert.ok(queued.includes('discover-svc:SVC-005'));
  });

  it('records provenance on deployed models', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [{ data: { id: 'h1', label: 'svc:SVC-005' } }],
      edges: [] });

    const deployBatch = async (_db, _serverId, _bankId, specs) => ({
      success: true,
      deployed: specs.map((s) => s.ext_id),
      failed: [] });

    await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      run_discovery: false,
 neighborhood: {} });

    const { getNode } = await import('../src/db/crud/contextual-graph.js');
    const node = getNode(db, serverId, 'Mozart-API', 'svc:SVC-005').data;
    assert.equal(node.cgn_properties.provenance.model_refs.length, 1);
    assert.equal(node.cgn_properties.provenance.model_refs[0].role, 'entity-ctx');
    assert.equal(node.cgn_properties.provenance.model_refs[0].ext_id, 'entity-ctx-svc:SVC-005');
    assert.equal(node.cgn_properties.provenance.source, 'contextual-graph');
  });

  it('does not queue a second discover-ctx model for a seed that already has one', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const fetchGraph = makeFetchGraph({
      nodes: [{ data: { id: 'h1', label: 'svc:SVC-005' } }],
      edges: [] });

    const firstDeployed = [];
    const firstDeployBatch = async (_db, _serverId, _bankId, specs) => {
      for (const spec of specs) firstDeployed.push(spec.ext_id);
      return { success: true, deployed: specs.map((s) => s.ext_id), failed: [] };
    };

    await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch: firstDeployBatch,
      seed_node_ids: ['svc:SVC-005'],
      run_discovery: false,
 neighborhood: { top_k_neighbors: 5 } });

    const discoverExtId = firstDeployed.find((id) => id === 'discover-svc:SVC-005');
    assert.equal(discoverExtId, 'discover-svc:SVC-005', 'first run should deploy deterministic discover-ctx model');

    const secondQueued = [];
    const secondDeployBatch = async (_db, _serverId, _bankId, specs) => {
      for (const spec of specs) secondQueued.push(spec.ext_id);
      return { success: true, deployed: specs.map((s) => s.ext_id), failed: [] };
    };

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch: secondDeployBatch,
      seed_node_ids: ['svc:SVC-005'],
      run_discovery: false,
 neighborhood: { top_k_neighbors: 5 },
      import_skeleton: false });

    assert.equal(result.success, true);
    assert.equal(result.queued.discover, 0);
    assert.ok(!secondQueued.includes('discover-svc:SVC-005'));
    // Real deploy path records provenance; mocks don't, so entity-ctx re-queues
    // deterministically because the seed lacks an entity-ctx ref. This is a
    // test artifact; the behavior under real deployBatch is idempotent.
  });
});
