import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import {
  upsertNode,
  upsertEdge,
  getNode,
  getEdge,
  listEdges,
} from '../src/db/crud/contextual-graph.js';
import { cleanupDisallowedModels } from '../src/services/contextual-graph/cleanup-disallowed-models.js';
import { clearCache } from '../src/cache.js';

function createTestDb() {
  clearCache();
  const file = path.join(process.cwd(), `tmp/test-cleanup-disallowed-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
  clearCache();
  db.close();
  fs.unlinkSync(file);
}

const deleteFromHindsight = async () => ({ success: true });
const listMentalModels = async (_serverId, _bankId) => ({ success: true, mentalModels: [] });

test('removes summary and capabilities from nodes when roles are disallowed', async () => {
  const { db, file, serverId } = createTestDb();
  const bankId = 'bank-a';
  const nodeId = 'node-1';

  upsertNode(db, serverId, bankId, nodeId, ['active'], {
    display_name: 'Node One',
    summary: 'A generated summary',
    capabilities: ['read', 'write'],
    provenance: {
      source: 'contextual-graph',
      model_refs: [
        { role: 'sys_entity_summary', ext_id: `entity-summary-${nodeId}`, scope: { node_id: nodeId }, attached_at: '2026-01-01T00:00:00Z' },
        { role: 'sys_entity_capabilities', ext_id: `entity-capabilities-${nodeId}`, scope: { node_id: nodeId }, attached_at: '2026-01-01T00:00:00Z' },
      ],
      updated_at: '2026-01-01T00:00:00Z',
    },
    updated_at: '2026-01-01T00:00:00Z',
  });

  // Both entity-summary and entity-capabilities are disallowed, so both refs
  // and both legacy fields should be removed. Only edge-ctx remains allowed.
  const result = await cleanupDisallowedModels(db, serverId, bankId, ['edge-ctx'], {
    deleteFromHindsight,
    listMentalModels,
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.deleted.sort(), [`entity-capabilities-${nodeId}`, `entity-summary-${nodeId}`].sort());
  assert.equal(result.cleared.nodes, 1);

  const nodeResult = getNode(db, serverId, bankId, nodeId);
  const nextProperties = nodeResult.data.properties;

  assert.equal(nextProperties.summary, undefined, 'summary should be removed during cleanup');
  assert.equal(nextProperties.capabilities, undefined, 'capabilities should be removed during cleanup');
  const remainingRefs = nextProperties.provenance?.model_refs || [];
  assert.equal(
    remainingRefs.some((ref) => ref.ext_id === `entity-summary-${nodeId}`),
    false,
    'entity-summary ref should be stripped',
  );
  assert.equal(
    remainingRefs.some((ref) => ref.ext_id === `entity-capabilities-${nodeId}`),
    false,
    'entity-capabilities ref should be stripped',
  );

  cleanupTestDb(db, file);
});

function makeCleanup(db, serverId, bankId, allowedModelTypes) {
  return cleanupDisallowedModels(db, serverId, bankId, allowedModelTypes, {
    deleteFromHindsight,
    listMentalModels,
  });
}

test('deletes directed edge-ctx edges when role is disallowed', async () => {
  const { db, file, serverId } = createTestDb();
  const bankId = 'bank-b';
  const sourceId = 'src';
  const targetId = 'dst';
  const edgeId = 'edge-ctx-src|dst-foo-edge-ctx';

  upsertNode(db, serverId, bankId, sourceId, ['active'], { display_name: 'Source' });
  upsertNode(db, serverId, bankId, targetId, ['active'], { display_name: 'Target' });
  upsertEdge(db, serverId, bankId, edgeId, sourceId, targetId, 'relates-to', {
    directed: true,
    label: 'foo',
    detail: 'bar',
    evidence: ['baz'],
    provenance: {
      source: 'contextual-graph',
      model_refs: [
        { role: 'sys_edge_context', ext_id: 'edge-ctx-src|dst', scope: { source_id: 'src', target_id: 'dst' }, attached_at: '2026-01-01T00:00:00Z' },
      ],
      updated_at: '2026-01-01T00:00:00Z',
    },
  });

  const result = await makeCleanup(db, serverId, bankId, ['entity-summary']);

  assert.equal(result.success, true);
  assert.equal(result.cleared.edges, 1);

  const edgesResult = listEdges(db, serverId, bankId, { limit: 100 });
  assert.equal(edgesResult.data.length, 0, 'edge-ctx generated edge should be deleted');

  cleanupTestDb(db, file);
});

test('removes model ref from mixed provenance without deleting the edge', async () => {
  const { db, file, serverId } = createTestDb();
  const bankId = 'bank-c';
  const sourceId = 'src';
  const targetId = 'dst';
  const edgeId = 'edge-mixed';

  upsertNode(db, serverId, bankId, sourceId, ['active'], { display_name: 'Source' });
  upsertNode(db, serverId, bankId, targetId, ['active'], { display_name: 'Target' });
  upsertEdge(db, serverId, bankId, edgeId, sourceId, targetId, 'relates-to', {
    directed: true,
    label: 'foo',
    provenance: {
      model_refs: [
        { role: 'sys_edge_context', ext_id: 'edge-ctx-src|dst', scope: { source_id: 'src', target_id: 'dst' }, attached_at: '2026-01-01T00:00:00Z' },
        { role: 'manual', ext_id: 'manual-ref', attached_at: '2026-01-01T00:00:00Z' },
      ],
    },
  });

  const result = await makeCleanup(db, serverId, bankId, ['entity-summary']);

  assert.equal(result.success, true);
  assert.equal(result.cleared.edges, 1);

  const edgeResult = getEdge(db, serverId, bankId, edgeId);
  assert.equal(edgeResult.success, true);
  const refs = edgeResult.data.cge_properties.provenance.model_refs;
  assert.equal(refs.length, 1);
  assert.equal(refs[0].ext_id, 'manual-ref');

  cleanupTestDb(db, file);
});

test('removes discovery-generated subgraph when discover is disallowed', async () => {
  const { db, file, serverId } = createTestDb();
  const bankId = 'bank-d';
  const seedId = 'seed';
  const discoveredNodeId = 'found:thing';
  const discoveredEdgeId = 'discovered-seed-found:thing-rel';

  upsertNode(db, serverId, bankId, seedId, ['active'], {
    display_name: 'Seed',
    provenance: {
      model_refs: [
        { role: 'sys_discovery_context', ext_id: `discover-${seedId}`, scope: { seed_id: seedId }, attached_at: '2026-01-01T00:00:00Z' },
      ],
    },
  });

  upsertNode(db, serverId, bankId, discoveredNodeId, ['candidate', 'active'], {
    display_name: 'Discovered Thing',
    provenance: {
      discovery: 'discovered',
      model_refs: [
        { role: 'sys_discovery_context', ext_id: `discover-${seedId}`, scope: { seed_id: seedId }, attached_at: '2026-01-01T00:00:00Z' },
      ],
    },
  });

  upsertEdge(db, serverId, bankId, discoveredEdgeId, seedId, discoveredNodeId, 'relates-to', {
    label: 'rel',
    provenance: {
      discovery: 'discovered',
      model_refs: [
        { role: 'sys_discovery_context', ext_id: `discover-${seedId}`, scope: { seed_id: seedId }, attached_at: '2026-01-01T00:00:00Z' },
      ],
    },
  });

  const result = await makeCleanup(db, serverId, bankId, ['entity-summary']);

  assert.equal(result.success, true);
  assert.equal(result.cleared.nodes, 2, 'seed updated + discovered node deleted');
  assert.equal(result.cleared.edges, 1, 'discovered edge deleted');

  const seedResult = getNode(db, serverId, bankId, seedId);
  assert.equal(seedResult.success, true);
  assert.equal(seedResult.data.properties.provenance, undefined, 'seed should keep node but have discovery ref stripped');

  const discoveredResult = getNode(db, serverId, bankId, discoveredNodeId);
  assert.equal(discoveredResult.success, true);
  assert.equal(discoveredResult.data, null, 'discovered node should be deleted');

  const edgesResult = listEdges(db, serverId, bankId, { limit: 100 });
  assert.equal(edgesResult.data.length, 0, 'discovered edge should be deleted');

  cleanupTestDb(db, file);
});

test('preserves seed node that is its own discovery seed', async () => {
  const { db, file, serverId } = createTestDb();
  const bankId = 'bank-e';
  const seedA = 'seed-a';
  const seedB = 'seed-b';

  upsertNode(db, serverId, bankId, seedA, ['active'], {
    display_name: 'Seed A',
    provenance: {
      model_refs: [
        { role: 'sys_discovery_context', ext_id: `discover-${seedB}`, scope: { seed_id: seedB }, attached_at: '2026-01-01T00:00:00Z' },
        { role: 'sys_discovery_context', ext_id: `discover-${seedA}`, scope: { seed_id: seedA }, attached_at: '2026-01-01T00:00:00Z' },
      ],
    },
  });

  upsertNode(db, serverId, bankId, seedB, ['active'], {
    display_name: 'Seed B',
    provenance: {
      model_refs: [
        { role: 'sys_discovery_context', ext_id: `discover-${seedB}`, scope: { seed_id: seedB }, attached_at: '2026-01-01T00:00:00Z' },
      ],
    },
  });

  const result = await makeCleanup(db, serverId, bankId, []);

  assert.equal(result.success, true);

  const seedAResult = getNode(db, serverId, bankId, seedA);
  assert.equal(seedAResult.success, true, 'seedA should be preserved because it is its own discovery seed');
  const seedBResult = getNode(db, serverId, bankId, seedB);
  assert.equal(seedBResult.success, true, 'seedB should be preserved because it is its own discovery seed');

  assert.equal(
    seedAResult.data.properties.provenance,
    undefined,
    'seedA should have all discovery refs stripped',
  );

  cleanupTestDb(db, file);
});

test('does nothing when all referenced roles are allowed', async () => {
  const { db, file, serverId } = createTestDb();
  const bankId = 'bank-f';
  const nodeId = 'node-keep';

  upsertNode(db, serverId, bankId, nodeId, ['active'], {
    display_name: 'Keep Node',
    provenance: {
      model_refs: [
        { role: 'sys_edge_context', ext_id: `edge-ctx-${nodeId}|other`, scope: { source_id: nodeId, target_id: 'other' }, attached_at: '2026-01-01T00:00:00Z' },
      ],
    },
  });

  const result = await makeCleanup(db, serverId, bankId, ['edge-ctx']);

  assert.equal(result.success, true);
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.cleared, { nodes: 0, edges: 0 });

  const nodeResult = getNode(db, serverId, bankId, nodeId);
  assert.equal(nodeResult.data.properties.display_name, 'Keep Node');

  cleanupTestDb(db, file);
});

test('deletes orphaned Hindsight models that no longer have local refs', async () => {
  const { db, file, serverId } = createTestDb();
  const bankId = 'bank-g';
  const sourceId = 'src';
  const targetId = 'dst';
  const orphanedExtId = 'edge-ctx-src|dst';

  upsertNode(db, serverId, bankId, sourceId, ['active'], { display_name: 'Source' });
  upsertNode(db, serverId, bankId, targetId, ['active'], { display_name: 'Target' });

  const deleted = [];
  const listWithOrphan = async (_serverId, _bankId) => ({
    success: true,
    mentalModels: [{ id: orphanedExtId }, { id: 'entity-summary-src' }],
  });
  const trackDelete = async (_serverId, _bankId, extId) => {
    deleted.push(extId);
    return { success: true };
  };

  // Only entity-summary is allowed, so edge-ctx should be deleted even though
  // it has no local ref in the working graph.
  const result = await cleanupDisallowedModels(db, serverId, bankId, ['entity-summary'], {
    deleteFromHindsight: trackDelete,
    listMentalModels: listWithOrphan,
  });

  assert.equal(result.success, true);
  assert.deepEqual(deleted, [orphanedExtId], 'should delete disallowed Hindsight models even when they have no local refs');
  assert.equal(result.cleared.nodes, 0);
  assert.equal(result.cleared.edges, 0);

  cleanupTestDb(db, file);
});
