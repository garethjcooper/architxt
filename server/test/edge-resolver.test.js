import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { resolveGraphEdges } from '../src/services/edge-resolver.js';
import { upsertEdge } from '../src/db/crud/contextual-graph.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-edge-resolver-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_base_url, svr_name) VALUES (?, ?)').run('http://test', 'test');
  const serverId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  return { db, file, serverId };
}

function cleanupTestDb(db, file) {
  db.close();
  fs.unlinkSync(file);
}

function seedContextualEdge(db, serverId, bankId, sourceId, targetId, type, label, evidence = []) {
  const edgeId = type
    ? `edge-${sourceId}-${targetId}-${type}`
    : `hindsight-${sourceId}-${targetId}`;
  upsertEdge(db, serverId, bankId, edgeId, sourceId, targetId, type, {
    label,
    evidence,
    directed: type !== null,
  });
  return edgeId;
}

describe('edge-resolver', () => {
  let db;
  let file;
  let serverId;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file, serverId } = createTestDb());
    clearCache();
  });

  it('requires a graph.edges array', async () => {
    const result = await resolveGraphEdges(db, serverId, 'bank', {});
    assert.equal(result.success, false);
    assert.equal(result.code, 'VALIDATION_ERROR');
  });

  it('resolves by exact edge id', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'dials');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'x', to: 'y', id: 'edge-a-b-calls' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].match_class, 'id');
    assert.equal(result.edges[0].from, 'x');
    assert.equal(result.edges[0].to, 'y');
  });

  it('resolves a full match by endpoints, type and label', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'dials');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b', type: 'calls', label: 'dials' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, 'full');
  });

  it('resolves a typeless input edge by label across typed contextual edges', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'authenticates');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b', label: 'authenticates' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, 'label');
    assert.equal(result.edges[0].type, 'calls');
  });

  it('falls back to no_type when a typeless input has a label that does not match', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'authenticates');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b', label: 'missing-label' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, null);
    assert.equal(result.edges[0].stage, 'no_type');
  });

  it('reports ambiguous_label when multiple typed edges share the same label', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'sync');
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'uses', 'sync');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b', label: 'sync' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, null);
    assert.equal(result.edges[0].stage, 'ambiguous_label');
    assert.equal(result.edges[0].candidates.length, 2);
  });

  it('uses evidence tie-break for ambiguous label matches', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'sync', ['mem-1']);
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'uses', 'sync', ['mem-2']);
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b', label: 'sync', evidence: ['mem-2'] }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, 'evidence');
    assert.equal(result.edges[0].type, 'uses');
  });

  it('still requires endpoints to match for label-only resolution', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'authenticates');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'c', label: 'authenticates' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, null);
    assert.equal(result.edges[0].stage, 'no_endpoints');
  });

  it('ignores existing co-occurrence edges when resolving', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', null, null);
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, null);
    assert.equal(result.edges[0].stage, 'no_endpoints');
  });

  it('resolves a typeless input edge by label in the reverse orientation', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'sends', 'trustee list file');
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'sends', 'synccustomer data');
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'sends', 'billable usage file');
    seedContextualEdge(db, serverId, 'bank', 'b', 'a', 'sends', 'synccustomer data');
    seedContextualEdge(db, serverId, 'bank', 'b', 'a', 'sends', 'account merge data');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b', label: 'account merge data' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].match_class, 'label');
    assert.equal(result.edges[0].reversed, true);
    assert.equal(result.edges[0].type, 'sends');
    assert.equal(result.edges[0].id, 'edge-b-a-sends');
    assert.equal(result.edges[0].from, 'a');
    assert.equal(result.edges[0].to, 'b');
  });

  it('reports ambiguous_label when the same label exists in both orientations', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'sends', 'shared label');
    seedContextualEdge(db, serverId, 'bank', 'b', 'a', 'sends', 'shared label');
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [{ from: 'a', to: 'b', label: 'shared label' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges[0].match_class, null);
    assert.equal(result.edges[0].stage, 'ambiguous_label');
    assert.equal(result.edges[0].candidates.length, 2);
  });

  it('reports label and partial match classes for typed edge variants', async () => {
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'calls', 'dials');
    seedContextualEdge(db, serverId, 'bank', 'a', 'b', 'uses', null);
    const result = await resolveGraphEdges(db, serverId, 'bank', {
      edges: [
        { from: 'a', to: 'b', type: 'calls', label: 'dials' },
        { from: 'a', to: 'b', type: 'uses' },
      ],
    });
    assert.equal(result.success, true);
    assert.equal(result.edges.length, 2);
    assert.equal(result.edges[0].match_class, 'full');
    assert.equal(result.edges[1].match_class, 'partial');
  });
});
