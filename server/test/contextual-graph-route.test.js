import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContextualGraphRouter, BASE_PATH } from '../src/routes/contextual-graph.js';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { upsertNode, upsertEdge } from '../src/db/crud/contextual-graph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  return Number(db.prepare('SELECT svr_id FROM servers').get().svr_id);
}

function makeApp({ db, importHindsightSkeleton, addContext }) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/contextual-graph',
    createContextualGraphRouter({ db, importHindsightSkeleton, addContext }),
  );
  return app;
}

describe('contextual-graph route', () => {
  let db;
  let serverId;
  let bankId;

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
    bankId = 'Mozart-API';
  });

  describe('POST /import', () => {
    it('returns 400 when server_id or bank_id is missing', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/import')
        .send({ server_id: serverId });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_PARAMS');
    });

    it('returns imported counts on success', async () => {
      const importHindsightSkeleton = async () => ({
        success: true,
        imported: { nodes: 3, edges: 2 },
      });

      const app = makeApp({ db, importHindsightSkeleton });
      const res = await request(app)
        .post('/api/v1/contextual-graph/import')
        .send({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.imported.nodes, 3);
      assert.equal(res.body.imported.edges, 2);
    });

    it('returns 502 when Hindsight import fails', async () => {
      const importHindsightSkeleton = async () => ({
        success: false,
        error: 'Hindsight unreachable',
        code: 'HINDSIGHT_ENTITY_GRAPH_FAILED',
      });

      const app = makeApp({ db, importHindsightSkeleton });
      const res = await request(app)
        .post('/api/v1/contextual-graph/import')
        .send({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 502);
      assert.equal(res.body.code, 'HINDSIGHT_ENTITY_GRAPH_FAILED');
    });
  });

  describe('POST /add-context', () => {
    it('returns 400 when server_id or bank_id is missing', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/add-context')
        .send({ bank_id: bankId });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_PARAMS');
    });

    it('returns queued and deployed model ids on success', async () => {
      const addContext = async () => ({
        success: true,
        queued: { entity: 2, edge: 1, discover: 0 },
        deployed: ['entity-ctx-A', 'entity-ctx-B', 'edge-ctx-A|B'],
        failed: [],
      });

      const app = makeApp({ db, addContext });
      const res = await request(app)
        .post('/api/v1/contextual-graph/add-context')
        .send({
          server_id: serverId,
          bank_id: bankId,
          seed_node_ids: ['node-A'],
          neighborhood: { run_discovery: false },
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.queued.entity, 2);
      assert.equal(res.body.deployed.length, 3);
    });

    it('passes seed_node_ids and neighborhood to the service', async () => {
      let captured;
      const addContext = async (_db, _serverId, _bankId, options) => {
        captured = options;
        return { success: true, queued: { entity: 0, edge: 0, discover: 0 }, deployed: [], failed: [] };
      };

      const app = makeApp({ db, addContext });
      await request(app)
        .post('/api/v1/contextual-graph/add-context')
        .send({
          server_id: serverId,
          bank_id: bankId,
          seed_node_ids: ['node-A', 'node-B'],
          neighborhood: { top_k_neighbors: 3, run_discovery: false },
        });

      assert.deepEqual(captured.seed_node_ids, ['node-A', 'node-B']);
      assert.equal(captured.neighborhood.top_k_neighbors, 3);
    });
  });

  describe('GET /nodes', () => {
    it('returns 400 when scope is missing', async () => {
      const app = makeApp({ db });
      const res = await request(app).get('/api/v1/contextual-graph/nodes');
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_PARAMS');
    });

    it('returns nodes scoped to (server_id, bank_id)', async () => {
      upsertNode(db, serverId, bankId, 'svc:SVC-005', ['active'], { display_name: 'Billing' });
      upsertNode(db, serverId, 'Other-Bank', 'svc:SVC-006', ['active'], { display_name: 'Other' });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/nodes')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].id, 'svc:SVC-005');
    });
  });

  describe('GET /nodes/:id', () => {
    it('returns 404 for a missing node', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/nodes/svc:missing')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'NOT_FOUND');
    });

    it('returns a node by id', async () => {
      upsertNode(db, serverId, bankId, 'svc:SVC-005', ['active'], { display_name: 'Billing' });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/nodes/svc:SVC-005')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 200);
      assert.equal(res.body.id, 'svc:SVC-005');
      assert.equal(res.body.properties.display_name, 'Billing');
    });
  });

  describe('POST /nodes/:id', () => {
    it('upserts a node', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/nodes/svc:SVC-005')
        .send({
          server_id: serverId,
          bank_id: bankId,
          labels: ['active', 'canonical'],
          properties: { display_name: 'Billing Service' },
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.id, 'svc:SVC-005');
      assert.deepEqual(res.body.labels, ['active', 'canonical']);
    });
  });

  describe('DELETE /nodes/:id', () => {
    it('deletes a node and returns 204', async () => {
      upsertNode(db, serverId, bankId, 'svc:SVC-005', ['active'], { display_name: 'Billing' });

      const app = makeApp({ db });
      const res = await request(app)
        .delete('/api/v1/contextual-graph/nodes/svc:SVC-005')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 204);
    });
  });

  describe('GET /edges', () => {
    it('returns edges scoped to (server_id, bank_id)', async () => {
      upsertNode(db, serverId, bankId, 'A', ['active'], {});
      upsertNode(db, serverId, bankId, 'B', ['active'], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, { directed: false, weight: 1 });
      upsertEdge(db, serverId, 'Other-Bank', 'e2', 'A', 'B', null, { directed: false });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/edges')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 200);
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].id, 'e1');
    });
  });

  describe('GET /edges/:id', () => {
    it('returns 404 for a missing edge', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/edges/missing')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 404);
    });

    it('returns an edge by id', async () => {
      upsertNode(db, serverId, bankId, 'A', ['active'], {});
      upsertNode(db, serverId, bankId, 'B', ['active'], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, { directed: false, weight: 2 });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/edges/e1')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 200);
      assert.equal(res.body.id, 'e1');
      assert.equal(res.body.properties.weight, 2);
    });
  });

  describe('POST /edges/:id', () => {
    it('returns 400 when source_id or target_id is missing', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/edges/e1')
        .send({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    });

    it('upserts an edge', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/edges/e1')
        .send({
          server_id: serverId,
          bank_id: bankId,
          source_id: 'A',
          target_id: 'B',
          type: 'depends-on',
          properties: { weight: 3 },
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.id, 'e1');
      assert.equal(res.body.source_id, 'A');
      assert.equal(res.body.target_id, 'B');
      assert.equal(res.body.type, 'depends-on');
    });
  });

  describe('DELETE /edges/:id', () => {
    it('deletes an edge and returns 204', async () => {
      upsertNode(db, serverId, bankId, 'A', ['active'], {});
      upsertNode(db, serverId, bankId, 'B', ['active'], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, { directed: false });

      const app = makeApp({ db });
      const res = await request(app)
        .delete('/api/v1/contextual-graph/edges/e1')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 204);
    });
  });

  describe('POST /clear', () => {
    it('returns 400 when server_id or bank_id is missing', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/clear')
        .send({ server_id: serverId });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_PARAMS');
    });

    it('deletes all nodes and edges scoped to (server_id, bank_id)', async () => {
      upsertNode(db, serverId, bankId, 'A', ['active'], {});
      upsertNode(db, serverId, bankId, 'B', ['active'], {});
      upsertNode(db, serverId, 'Other-Bank', 'C', ['active'], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, { directed: false });
      upsertEdge(db, serverId, 'Other-Bank', 'e2', 'A', 'B', null, { directed: false });

      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/clear')
        .send({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.cleared.nodes, 2);
      assert.equal(res.body.cleared.edges, 1);

      const nodesRes = await request(app)
        .get('/api/v1/contextual-graph/nodes')
        .query({ server_id: serverId, bank_id: bankId });
      assert.equal(nodesRes.body.length, 0);

      const otherNodesRes = await request(app)
        .get('/api/v1/contextual-graph/nodes')
        .query({ server_id: serverId, bank_id: 'Other-Bank' });
      assert.equal(otherNodesRes.body.length, 1);
    });
  });
});
