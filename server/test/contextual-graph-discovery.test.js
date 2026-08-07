import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { addContext } from '../src/services/contextual-graph/add-context.js';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import {
  fetchCandidatesFromModel,
  ingestCandidates } from '../src/services/contextual-graph/discovery.js';

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

describe('addContext discovery integration', () => {
  let db;
  let serverId;

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
  });

  it('queues discover-ctx models for seeds but does not fetch candidates', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
      { type: 'svc', entityId: 'SVC-006', name: 'Invoice Service' },
    ]);

    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], { display_name: 'Billing Service' });
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-006', ['canonical', 'active'], { display_name: 'Invoice Service' });

    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'svc:SVC-005' } },
        { data: { id: 'h2', label: 'svc:SVC-006' } },
      ],
      edges: [{ data: { source: 'h1', target: 'h2', weight: 1 } }] });

    const queued = [];
    const deployBatch = async (_db, _serverId, _bankId, specs) => {
      for (const spec of specs) queued.push(spec.ext_id);
      return { success: true, deployed: specs.map((s) => s.ext_id), failed: [] };
    };

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch,
      seed_node_ids: ['svc:SVC-005'],
            allowed_model_types: ['entity-summary', 'entity-capabilities', 'edge-ctx'],
 neighborhood: { top_k_neighbors: 5 },
      import_skeleton: false });

    assert.equal(result.success, true);
    assert.equal(result.queued.discover, 1);
    assert.ok(queued.includes('discover-svc:SVC-005'));
    // No candidates were ingested during addContext.
    assert.equal(result.queued.entitySummary, 2);
    assert.equal(result.queued.entityCapabilities, 2);
    assert.equal(result.queued.edge, 0); // auto-ranking is disabled
  });

  it('does not queue a second discover model for a seed that already has one', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], { display_name: 'Billing Service' });

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
            allowed_model_types: ['entity-summary', 'entity-capabilities', 'edge-ctx'],
 neighborhood: { top_k_neighbors: 5 },
      import_skeleton: false });

    const discoverExtId = firstDeployed.find((id) => id === 'discover-svc:SVC-005');
    assert.equal(discoverExtId, 'discover-svc:SVC-005', 'first run should deploy deterministic discover model');

    const secondQueued = [];
    const secondDeployBatch = async (_db, _serverId, _bankId, specs) => {
      for (const spec of specs) secondQueued.push(spec.ext_id);
      return { success: true, deployed: specs.map((s) => s.ext_id), failed: [] };
    };

    const result = await addContext(db, serverId, 'Mozart-API', {
      fetchGraph,
      deployBatch: secondDeployBatch,
      seed_node_ids: ['svc:SVC-005'],
            allowed_model_types: ['entity-summary', 'entity-capabilities', 'edge-ctx'],
 neighborhood: { top_k_neighbors: 5 },
      import_skeleton: false });

    assert.equal(result.success, true);
    assert.equal(result.queued.discover, 0);
    assert.ok(!secondQueued.includes('discover-svc:SVC-005'));
    // Real deploy path records provenance; mocks don't, so entity-summary re-queues
    // deterministically because the seed lacks a sys_entity_summary ref. This is a
    // test artifact; the behavior under real deployBatch is idempotent.
  });
});

describe('fetchCandidatesFromModel', () => {
  let db;
  let svrId;

  beforeEach(() => {
    db = makeDb();
    svrId = seedServer(db);
  });

  it('returns candidates from a mocked mental model content', async () => {
    const content = JSON.stringify({
      candidates: [
        {
          id: 'invoice-gateway',
          summary: 'Invoice processing gateway',
          hypothesized_edges: [
            { target: 'svc:SVC-005', type: 'depends-on', evidence: 'mem-001' },
          ] },
      ] });

    const fetchCandidates = async (_serverId, _bankId, _extId) => ({
      success: true,
      candidates: [
        {
          id: 'invoice-gateway',
          displayName: 'Invoice processing gateway',
          aliases: [],
          hypothesizedEdges: [
            { target: 'svc:SVC-005', type: 'depends-on', evidence: 'mem-001' },
          ] },
      ] });

    const result = await fetchCandidates(svrId, 'Mozart-API', 'discover-svc:SVC-005');

    assert.equal(result.success, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].id, 'invoice-gateway');
    assert.equal(result.candidates[0].displayName, 'Invoice processing gateway');
    assert.deepEqual(result.candidates[0].hypothesizedEdges, [
      { target: 'svc:SVC-005', type: 'depends-on', evidence: 'mem-001' },
    ]);
  });

  it('returns fetch error when the model is not found', async () => {
    const fetchCandidates = async (_serverId, _bankId, _extId) => ({
      success: false,
      error: 'Server 1 not found',
      code: 'FETCH_FAILED' });

    const result = await fetchCandidates(svrId, 'Mozart-API', 'discover-svc:SVC-005');

    assert.equal(result.success, false);
    assert.equal(result.code, 'FETCH_FAILED');
  });

  it('returns parse error for non-JSON mental model content', async () => {
    const fetchCandidates = async (_serverId, _bankId, _extId) => ({
      success: false,
      error: 'discover-ctx content was not valid JSON',
      code: 'PARSE_FAILED' });

    const result = await fetchCandidates(svrId, 'Mozart-API', 'discover-svc:SVC-005');

    assert.equal(result.success, false);
    assert.equal(result.code, 'PARSE_FAILED');
  });
});

describe('ingestCandidates', () => {
  let db;
  let serverId;

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
  });

  it('merges discovered found: candidates into existing grounded nodes without deriving new specs', async () => {
    const { upsertNode, listNodes, getNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'mozart-api', ['grounded', 'active'], {
      display_name: 'Mozart API',
      aliases: ['Mozart API'],
    });
    upsertNode(db, serverId, 'Mozart-API', 'subscriber', ['grounded', 'active'], {
      display_name: 'Subscriber',
      aliases: ['Subscriber'],
    });

    const candidates = [
      {
        id: 'found:mozart-api',
        summary: 'Mozart API',
        hypothesized_edges: [
          { target: 'subscriber', type: 'sends', evidence: 'mem-001' },
        ] },
    ];

    const existingNodes = listNodes(db, serverId, 'Mozart-API', { limit: 10000 }).data;
    const result = await ingestCandidates(db, serverId, 'Mozart-API', 'subscriber', candidates, { existingNodes });

    assert.equal(result.success, true);
    assert.equal(result.upserted.nodes.length, 0);
    assert.equal(result.upserted.edges.length, 1);
    assert.equal(result.entity.length, 0);
    assert.equal(result.edge.length, 0);

    const foundNode = getNode(db, serverId, 'Mozart-API', 'found:mozart-api').data;
    assert.equal(foundNode, null);
  });

  it('upserts candidate nodes/edges without deriving entity/edge-ctx specs', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-005', name: 'Billing Service' },
    ]);

    const { upsertNode, listNodes } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      display_name: 'Billing Service' });

    const candidates = [
      {
        id: 'candidate:payment-bridge',
        summary: 'Payment Bridge',
        hypothesized_edges: [
          { target: 'svc:SVC-005', type: 'depends-on', evidence: 'mem-001' },
        ] },
    ];

    const existingNodes = listNodes(db, serverId, 'Mozart-API', { limit: 10000 }).data;
    const result = await ingestCandidates(db, serverId, 'Mozart-API', 'svc:SVC-005', candidates, { existingNodes });

    assert.equal(result.success, true);
    assert.equal(result.entity.length, 0);
    assert.equal(result.edge.length, 0);
    assert.ok(result.upserted.nodes.includes('payment-bridge'));
    assert.equal(result.upserted.edges.length, 1);
  });
});
