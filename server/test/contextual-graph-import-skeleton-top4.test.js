import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { importHindsightSkeleton } from '../src/services/contextual-graph/import-hindsight-skeleton.js';
import { listNodes } from '../src/db/crud/contextual-graph.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-contextual-import-top4-${Date.now()}.db`);
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

function makeFetchGraph(graph) {
  return async (serverId, bankId, options) => ({
    success: true,
    data: graph,
    request: { serverId, bankId, options },
  });
}

describe('importHindsightSkeleton top_k_nodes ranking', () => {
  let db;
  let file;
  let serverId;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file, serverId } = createTestDb());
    clearCache();
  });

  it('imports the top 4 nodes by mentionCount, including the highest-mention node', async () => {
    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'a-com:COM-001', label: 'a-com:COM-001', mentionCount: 3864 } },
        { data: { id: 'a-com:COM-002', label: 'a-com:COM-002', mentionCount: 3406 } },
        { data: { id: 'a-com:COM-003', label: 'a-com:COM-003', mentionCount: 1 } },
        { data: { id: 'a-com:COM-004', label: 'a-com:COM-004', mentionCount: 1 } },
        { data: { id: 'a-com:COM-005', label: 'a-com:COM-005', mentionCount: 1 } },
        { data: { id: 'a-com:COM-024', label: 'a-com:COM-024', mentionCount: 1056 } },
      ],
      edges: [
        // Edge degree alone would rank COM-024 first; mentionCount must win.
        { data: { source: 'a-com:COM-001', target: 'a-com:COM-002', weight: 1 } },
        { data: { source: 'a-com:COM-001', target: 'a-com:COM-024', weight: 1 } },
        { data: { source: 'a-com:COM-001', target: 'a-com:COM-005', weight: 1 } },
        { data: { source: 'a-com:COM-024', target: 'a-com:COM-002', weight: 1 } },
        { data: { source: 'a-com:COM-024', target: 'a-com:COM-003', weight: 1 } },
        { data: { source: 'a-com:COM-024', target: 'a-com:COM-004', weight: 1 } },
      ],
    });

    const result = await importHindsightSkeleton(db, serverId, 'Mozart-API', {
      top_k_nodes: 4,
    }, fetchGraph);

    assert.equal(result.success, true);
    assert.equal(result.imported.nodes, 4);

    const nodes = listNodes(db, serverId, 'Mozart-API', { limit: 100 }).data;
    const importedIds = new Set(nodes.map((n) => n.cgn_id));

    assert.ok(importedIds.has('a-com:com-001'), 'expected highest-mention node COM-001 to be imported');
    assert.ok(importedIds.has('a-com:com-002'), 'expected COM-002 to be imported');
    assert.ok(importedIds.has('a-com:com-024'), 'expected COM-024 to be imported');
  });

  it('falls back to edge degree when mentionCount is absent', async () => {
    const fetchGraph = makeFetchGraph({
      nodes: [
        { data: { id: 'h1', label: 'a-com:COM-001' } },
        { data: { id: 'h2', label: 'a-com:COM-002' } },
        { data: { id: 'h3', label: 'a-com:COM-003' } },
        { data: { id: 'h4', label: 'a-com:COM-004' } },
        { data: { id: 'h5', label: 'a-com:COM-005' } },
        { data: { id: 'h6', label: 'a-com:COM-024' } },
      ],
      edges: [
        { data: { source: 'h1', target: 'h2', weight: 1 } },
        { data: { source: 'h1', target: 'h6', weight: 1 } },
        { data: { source: 'h1', target: 'h5', weight: 1 } },
        { data: { source: 'h6', target: 'h2', weight: 1 } },
        { data: { source: 'h3', target: 'h4', weight: 1 } },
      ],
    });

    const result = await importHindsightSkeleton(db, serverId, 'Mozart-API', {
      top_k_nodes: 4,
    }, fetchGraph);

    assert.equal(result.success, true);
    assert.equal(result.imported.nodes, 4);

    const nodes = listNodes(db, serverId, 'Mozart-API', { limit: 100 }).data;
    const importedIds = new Set(nodes.map((n) => n.cgn_id));

    assert.ok(importedIds.has('a-com:com-001'), 'expected highest-degree node COM-001 to be imported when no mentionCount');
  });
});
