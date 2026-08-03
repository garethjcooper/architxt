import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import {
  upsertNode,
  getNode,
  listNodes,
  deleteNode,
  upsertEdge,
  getEdge,
  listEdges,
  deleteEdge } from '../src/db/crud/contextual-graph.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-contextual-graph-${Date.now()}.db`);
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

describe('contextual graph CRUD', () => {
  let db;
  let file;
  let serverId;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file, serverId } = createTestDb());
    clearCache();
  });

  it('upserts and retrieves a node with parsed labels/properties', () => {
    const result = upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      provenance: { source: 'hindsight' } });
    assert.equal(result.success, true);

    const row = getNode(db, serverId, 'Mozart-API', 'svc:SVC-005').data;
    assert.equal(row.cgn_id, 'svc:SVC-005');
    assert.deepEqual(row.cgn_labels, ['canonical', 'active']);
    assert.equal(row.cgn_properties.provenance.source, 'hindsight');
  });

  it('filters nodes by labels and id prefix', () => {
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical'], {});
    upsertNode(db, serverId, 'Mozart-API', 'uncanonical:rate-limiter', ['uncanonical', 'grounded'], {});

    const canonical = listNodes(db, serverId, 'Mozart-API', { labels: ['canonical'] }).data;
    assert.equal(canonical.length, 1);

    const prefix = listNodes(db, serverId, 'Mozart-API', { idPrefix: 'uncanonical:' }).data;
    assert.equal(prefix.length, 1);
    assert.equal(prefix[0].cgn_id, 'uncanonical:rate-limiter');
  });

  it('upserts and retrieves an edge with parsed properties', () => {
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical'], {});
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-006', ['canonical'], {});

    const result = upsertEdge(db, serverId, 'Mozart-API', 'edge-1', 'svc:SVC-005', 'svc:SVC-006', 'calls', {
      directed: true,
      provenance: { source: 'edge-ctx' } });
    assert.equal(result.success, true);

    const row = getEdge(db, serverId, 'Mozart-API', 'edge-1').data;
    assert.equal(row.cge_source_id, 'svc:SVC-005');
    assert.equal(row.cge_type, 'calls');
    assert.equal(row.cge_properties.directed, true);
  });

  it('filters edges by source, target, type, and directed flag', () => {
    upsertNode(db, serverId, 'Mozart-API', 'a', [], {});
    upsertNode(db, serverId, 'Mozart-API', 'b', [], {});
    upsertNode(db, serverId, 'Mozart-API', 'c', [], {});

    upsertEdge(db, serverId, 'Mozart-API', 'e1', 'a', 'b', 'calls', { directed: true });
    upsertEdge(db, serverId, 'Mozart-API', 'e2', 'b', 'c', null, { directed: false });

    const fromA = listEdges(db, serverId, 'Mozart-API', { sourceId: 'a' }).data;
    assert.equal(fromA.length, 1);

    const toC = listEdges(db, serverId, 'Mozart-API', { targetId: 'c' }).data;
    assert.equal(toC.length, 1);

    const undirected = listEdges(db, serverId, 'Mozart-API', { undirected: true }).data;
    assert.equal(undirected.length, 1);

    const nullType = listEdges(db, serverId, 'Mozart-API', { type: null }).data;
    assert.equal(nullType.length, 1);
  });

  it('deletes a node and all attached edges', () => {
    upsertNode(db, serverId, 'Mozart-API', 'a', [], {});
    upsertNode(db, serverId, 'Mozart-API', 'b', [], {});
    upsertEdge(db, serverId, 'Mozart-API', 'e1', 'a', 'b', 'calls', {});
    upsertEdge(db, serverId, 'Mozart-API', 'e2', 'b', 'a', 'calls', {});

    const result = deleteNode(db, serverId, 'Mozart-API', 'a');
    assert.equal(result.data.deleted, true);

    assert.equal(getNode(db, serverId, 'Mozart-API', 'a').data, null);
    assert.equal(getEdge(db, serverId, 'Mozart-API', 'e1').data, null);
    assert.equal(getEdge(db, serverId, 'Mozart-API', 'e2').data, null);
    assert.notEqual(getNode(db, serverId, 'Mozart-API', 'b').data, null);
  });

  it('deletes a single edge without touching nodes', () => {
    upsertNode(db, serverId, 'Mozart-API', 'a', [], {});
    upsertNode(db, serverId, 'Mozart-API', 'b', [], {});
    upsertEdge(db, serverId, 'Mozart-API', 'e1', 'a', 'b', 'calls', {});

    const result = deleteEdge(db, serverId, 'Mozart-API', 'e1');
    assert.equal(result.data.deleted, true);
    assert.equal(getEdge(db, serverId, 'Mozart-API', 'e1').data, null);
    assert.notEqual(getNode(db, serverId, 'Mozart-API', 'a').data, null);
  });
});
