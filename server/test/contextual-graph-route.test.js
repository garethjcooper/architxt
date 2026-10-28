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

function makeApp({ db, importHindsightSkeleton, addContext, refreshPatches }) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/v1/contextual-graph',
    createContextualGraphRouter({ db, importHindsightSkeleton, addContext, refreshPatches }),
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

  describe('GET /export', () => {
    it('returns 400 when server_id or bank_id is missing', async () => {
      const app = makeApp({ db });
      const res = await request(app).get('/api/v1/contextual-graph/export');
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_PARAMS');
    });

    it('returns a JSON graph export with nodes, edges, and meta', async () => {
      upsertNode(db, serverId, bankId, 'A', ['canonical'], { display_name: 'Service A' });
      upsertNode(db, serverId, bankId, 'B', ['candidate'], { display_name: 'Service B' });
      upsertNode(db, serverId, 'Other-Bank', 'C', ['canonical'], { display_name: 'Other' });
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', 'depends-on', { directed: true });
      upsertEdge(db, serverId, bankId, 'e2', 'B', 'A', null, {});
      upsertEdge(db, serverId, 'Other-Bank', 'e3', 'A', 'C', 'calls', {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 200);
      assert.equal(res.body.nodes.length, 2);
      assert.equal(res.body.edges.length, 2);
      assert.equal(res.body.meta.format, 'json');
      assert.equal(res.body.meta.server_id, serverId);
      assert.equal(res.body.meta.bank_id, bankId);
      assert.equal(res.body.meta.node_count, 2);
      assert.equal(res.body.meta.edge_count, 2);
      assert.equal(res.headers['content-disposition'], undefined);

      const nodeA = res.body.nodes.find((n) => n.id === 'A');
      assert.deepEqual(nodeA.labels, ['canonical']);
      assert.equal(nodeA.properties.display_name, 'Service A');

      const edge = res.body.edges.find((e) => e.id === 'e1');
      assert.equal(edge.source_id, 'A');
      assert.equal(edge.target_id, 'B');
      assert.equal(edge.type, 'depends-on');
    });

    it('supports exact node ids via ids', async () => {
      upsertNode(db, serverId, bankId, 'A', ['canonical'], {});
      upsertNode(db, serverId, bankId, 'B', ['canonical'], {});
      upsertNode(db, serverId, bankId, 'C', ['candidate'], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, {});
      upsertEdge(db, serverId, bankId, 'e2', 'B', 'C', null, {});
      upsertEdge(db, serverId, bankId, 'e3', 'C', 'A', null, {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, ids: 'A,B' });

      assert.equal(res.status, 200);
      assert.equal(res.body.nodes.length, 2);
      assert.deepEqual(res.body.nodes.map((n) => n.id).sort(), ['A', 'B']);
      assert.equal(res.body.edges.length, 1);
      assert.equal(res.body.edges[0].id, 'e1');
    });

    it('rejects unsupported formats', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'pdf' });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'UNSUPPORTED_FORMAT');
    });

    it('exports GraphML with directed default', async () => {
      upsertNode(db, serverId, bankId, 'A', ['Entity'], { name: 'Alpha' });
      upsertNode(db, serverId, bankId, 'B', ['Entity'], { name: 'Bravo' });
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', 'sends', { weight: 2 });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'graphml' })
        .set('Accept', 'application/graphml+xml');

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/graphml+xml; charset=utf-8');
      const xml = res.text;
      assert.ok(xml.includes('edgedefault="directed"'));
      assert.ok(xml.includes('<node id="A">'));
      assert.ok(xml.includes('<node id="B">'));
      assert.ok(xml.includes('<edge id="e1" source="A" target="B">'));
      assert.ok(xml.includes('<data key="architxt-labels">Entity</data>'));
      assert.ok(xml.includes('<data key="architxt-node-label">Alpha</data>'));
      assert.ok(xml.includes('<data key="architxt-type">sends</data>'));
      assert.ok(xml.includes('<data key="weight">2</data>'));
      assert.ok(xml.includes('http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd'));
    });

    it('exports GEXF with directed default', async () => {
      upsertNode(db, serverId, bankId, 'A', ['Entity'], { name: 'Alpha' });
      upsertNode(db, serverId, bankId, 'B', ['Entity'], { name: 'Bravo' });
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', 'sends', { weight: 2 });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'gexf' })
        .set('Accept', 'application/gexf+xml');

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/gexf+xml; charset=utf-8');
      const xml = res.text;
      assert.ok(xml.includes('defaultedgetype="directed"'));
      assert.ok(xml.includes('<node id="A" label="Alpha">'));
      assert.ok(xml.includes('<node id="B" label="Bravo">'));
      assert.ok(xml.includes('<edge id="e1" source="A" target="B" type="directed" label="sends"'));
      assert.ok(xml.includes('<attvalue for="architxt-labels" value="Entity"/>'));
      assert.ok(xml.includes('<attvalue for="architxt-node-label" value="Alpha"/>'));
      assert.ok(xml.includes('<attvalue for="architxt-type" value="sends"/>'));
      assert.ok(xml.includes('<attvalue for="weight" value="2"/>'));
      assert.ok(xml.includes('http://www.gexf.net/1.3/gexf.xsd'));
    });

    it('exports GEXF undirected when requested', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});
      upsertNode(db, serverId, bankId, 'B', [], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'gexf', undirected: 'true' });

      assert.equal(res.status, 200);
      assert.ok(res.text.includes('defaultedgetype="undirected"'));
    });

    it('uses .gexf extension for gexf filename', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'gexf', filename: 'my-graph' });

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-disposition'].includes('my-graph.gexf'));
    });

    it('exports Cypher with directed default', async () => {
      upsertNode(db, serverId, bankId, 'A', ['Entity'], { name: 'Alpha' });
      upsertNode(db, serverId, bankId, 'B', ['Entity'], { name: 'Bravo' });
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', 'sends', { weight: 2 });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'cypher' })
        .set('Accept', 'text/plain');

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
      const text = res.text;
      assert.ok(text.includes('CREATE (A:`Entity` {'));
      assert.ok(text.includes('CREATE (B:`Entity` {'));
      assert.ok(text.includes('MATCH (A { id: \'A\' }), (B { id: \'B\' })'));
      assert.ok(text.includes('CREATE (A)-[e1:`SENDS` {'));
      assert.ok(text.includes('weight: 2'));
      assert.ok(text.includes('type: \'sends\''));
      assert.ok(text.includes(']->(B);'));
    });

    it('exports Cypher undirected when requested', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});
      upsertNode(db, serverId, bankId, 'B', [], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', 'links', { directed: false });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'cypher', undirected: 'true' });

      assert.equal(res.status, 200);
      assert.ok(res.text.includes(']-(B);'));
      assert.ok(!res.text.includes(']->(B);'));
    });

    it('uses .cypher extension for cypher filename', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'cypher', filename: 'my-graph' });

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-disposition'].includes('my-graph.cypher'));
    });

    it('exports CSV as a JSON envelope with nodes and edges strings', async () => {
      upsertNode(db, serverId, bankId, 'A', ['Entity'], { name: 'Alpha' });
      upsertNode(db, serverId, bankId, 'B', ['Entity'], { name: 'Beta' });
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', 'sends', { weight: 2 });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'csv' });

      assert.equal(res.status, 200);
      assert.equal(res.type, 'application/json');
      assert.equal(res.body.meta.format, 'csv');
      assert.ok(res.body.nodes.includes('id,labels,name'));
      assert.ok(res.body.nodes.includes('A,Entity,Alpha'));
      assert.ok(res.body.edges.includes('id,source_id,target_id,type,directed,weight'));
      assert.ok(res.body.edges.includes('e1,A,B,sends,true,2'));
    });

    it('exports CSV undirected when requested', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});
      upsertNode(db, serverId, bankId, 'B', [], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', 'links', { directed: false });

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'csv', undirected: 'true' });

      assert.equal(res.status, 200);
      assert.equal(res.type, 'application/json');
      assert.ok(res.body.edges.split('\n').some((line) => line.includes('false')));
      assert.ok(!res.body.edges.split('\n').some((line) => line.includes('true')));
    });

    it('uses .json extension for csv filename', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'csv', filename: 'my-graph' });

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-disposition'].includes('my-graph.json'));
    });

    it('exports GraphML undirected when requested', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});
      upsertNode(db, serverId, bankId, 'B', [], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'graphml', undirected: 'true' });

      assert.equal(res.status, 200);
      assert.ok(res.text.includes('edgedefault="undirected"'));
    });

    it('uses .graphml extension for graphml filename', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'graphml', filename: 'my-graph' });

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-disposition'].includes('my-graph.graphml'));
    });

    it('exports C4 Structurizr DSL using entity/edge type mappings', async () => {
      upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'a-com'], { name: 'Customer Service' });
      upsertNode(db, serverId, bankId, 'b-act:ACT-001', ['canonical', 'b-act'], { name: 'User' });
      upsertNode(db, serverId, bankId, 'a-svc:SVC-001', ['canonical', 'a-svc'], { name: 'API' });
      upsertEdge(db, serverId, bankId, 'e1', 'a-com:COM-001', 'a-svc:SVC-001', 'calls', {});
      upsertEdge(db, serverId, bankId, 'e2', 'b-act:ACT-001', 'a-com:COM-001', 'sends', {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'c4' });

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
      const text = res.text;
      assert.ok(text.includes('workspace {'));
      assert.ok(text.includes('Customer Service'));
      assert.ok(text.includes('a_com_com_001 = container'));
      assert.ok(text.includes('b_act_act_001 = person'));
      assert.ok(text.includes('mozart_api_system.a_com_com_001 -> mozart_api_system.a_svc_svc_001'));
      assert.ok(text.includes('b_act_act_001 -> mozart_api_system.a_com_com_001'));
      assert.ok(text.includes('}'));
    });

    it('exports C4 Mermaid using entity/edge type mappings', async () => {
      upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'a-com'], { name: 'Customer Service' });
      upsertNode(db, serverId, bankId, 'b-act:ACT-001', ['canonical', 'b-act'], { name: 'User' });
      upsertNode(db, serverId, bankId, 'a-svc:SVC-001', ['canonical', 'a-svc'], { name: 'API' });
      upsertEdge(db, serverId, bankId, 'e1', 'a-com:COM-001', 'a-svc:SVC-001', 'calls', {});
      upsertEdge(db, serverId, bankId, 'e2', 'b-act:ACT-001', 'a-com:COM-001', 'sends', {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'c4-mermaid' });

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
      const text = res.text;
      assert.ok(text.includes('C4Container'));
      assert.ok(text.includes('Customer Service'));
      assert.ok(text.includes('Container(a_com_com_001'));
      assert.ok(text.includes('Person(b_act_act_001'));
      assert.ok(text.includes('Rel(a_com_com_001, a_svc_svc_001'));
      assert.ok(text.includes('Rel(b_act_act_001, a_com_com_001'));
    });

    it('exports ArchiMate XML using entity/edge type mappings', async () => {
      upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'a-com'], { name: 'Customer Service' });
      upsertNode(db, serverId, bankId, 'a-svc:SVC-001', ['canonical', 'a-svc'], { name: 'API' });
      upsertEdge(db, serverId, bankId, 'e1', 'a-com:COM-001', 'a-svc:SVC-001', 'calls', {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, format: 'archimate' });

      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/xml; charset=utf-8');
      const xml = res.text;
      assert.ok(xml.includes('<model xmlns="http://www.opengroup.org/xsd/archimate/3.0/"'));
      assert.ok(xml.includes('<name xml:lang="en">Mozart-API</name>'));
      assert.ok(xml.includes('<elements>'));
      assert.ok(xml.includes('</elements>'));
      assert.ok(xml.includes('<relationships>'));
      assert.ok(xml.includes('</relationships>'));
      assert.ok(xml.includes('<organizations>'));
      assert.ok(xml.includes('</organizations>'));
      assert.ok(xml.includes('<views>'));
      assert.ok(xml.includes('xsi:type="ApplicationComponent"'));
      assert.ok(xml.includes('xsi:type="ApplicationService"'));
      assert.ok(xml.includes('xsi:type="Serving"'));
      assert.ok(xml.includes('<view identifier='));
      assert.ok(xml.includes('xsi:type="Diagram"'));
    });

    it('honours node label filters', async () => {
      upsertNode(db, serverId, bankId, 'A', ['canonical'], {});
      upsertNode(db, serverId, bankId, 'B', ['candidate'], {});
      upsertEdge(db, serverId, bankId, 'e1', 'A', 'B', null, {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, labels: 'canonical' });

      assert.equal(res.status, 200);
      assert.equal(res.body.nodes.length, 1);
      assert.equal(res.body.nodes[0].id, 'A');
      assert.equal(res.body.edges.length, 0);
    });

    it('uses custom filename when provided', async () => {
      upsertNode(db, serverId, bankId, 'A', [], {});

      const app = makeApp({ db });
      const res = await request(app)
        .get('/api/v1/contextual-graph/export')
        .query({ server_id: serverId, bank_id: bankId, filename: 'my-graph' });

      assert.equal(res.status, 200);
      assert.ok(res.headers['content-disposition'].includes('my-graph.json'));
    });
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
        imported: { nodes: 3, edges: 2 } });

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
        code: 'HINDSIGHT_ENTITY_GRAPH_FAILED' });

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

    it('returns queued and composed model ids on success', async () => {
      const addContext = async () => ({
        success: true,
        queued: { entity: 2, edge: 1, discover: 0 },
        composed: ['entity-ctx-A', 'entity-ctx-B', 'edge-ctx-A|B'],
        pushed: ['entity-ctx-A', 'entity-ctx-B', 'edge-ctx-A|B'],
        unchanged: [],
        failed: [] });

      const app = makeApp({ db, addContext });
      const res = await request(app)
        .post('/api/v1/contextual-graph/add-context')
        .send({
          server_id: serverId,
          bank_id: bankId,
          seed_node_ids: ['node-A'],
          neighborhood: {} });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.queued.entity, 2);
      assert.equal(res.body.composed.length, 3);
    });

    it('passes seed_node_ids and neighborhood to the service', async () => {
      let captured;
      const addContext = async (_db, _serverId, _bankId, options) => {
        captured = options;
        return { success: true, queued: { entity: 0, edge: 0, discover: 0 }, composed: [], pushed: [], unchanged: [], failed: [] };
      };

      const app = makeApp({ db, addContext });
      await request(app)
        .post('/api/v1/contextual-graph/add-context')
        .send({
          server_id: serverId,
          bank_id: bankId,
          seed_node_ids: ['node-A', 'node-B'],
          neighborhood: { top_k_neighbors: 3 } });

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
          properties: { display_name: 'Billing Service' } });

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
          properties: { weight: 3 } });

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

  describe('POST /refresh', () => {
    it('returns 400 when server_id or bank_id is missing', async () => {
      const app = makeApp({ db });
      const res = await request(app)
        .post('/api/v1/contextual-graph/refresh')
        .send({ server_id: serverId });

      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'MISSING_PARAMS');
    });

    it('returns refresh stats and dry_run flag on success', async () => {
      let receivedOptions;
      const refreshPatches = async (_db, _serverId, _bankId, options) => {
        receivedOptions = options;
        return {
          success: true,
          stats: {
            fetched: 1,
            matched: 1,
            applied: 1,
            skippedDisabled: 0,
            skippedUnchanged: 0,
            failed: 0,
            errors: [],
          },
        };
      };

      const app = makeApp({ db, refreshPatches });
      const res = await request(app)
        .post('/api/v1/contextual-graph/refresh')
        .send({ server_id: serverId, bank_id: bankId, dry_run: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.dry_run, true);
      assert.equal(res.body.stats.applied, 1);
      assert.equal(receivedOptions.dryRun, true);
    });

    it('returns 500 when refresh fails', async () => {
      const refreshPatches = async () => ({
        success: false,
        error: 'Hindsight unreachable',
        stats: { fetched: 0, matched: 0, applied: 0 },
      });

      const app = makeApp({ db, refreshPatches });
      const res = await request(app)
        .post('/api/v1/contextual-graph/refresh')
        .send({ server_id: serverId, bank_id: bankId });

      assert.equal(res.status, 500);
      assert.equal(res.body.success, false);
      assert.equal(res.body.error, 'Hindsight unreachable');
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
