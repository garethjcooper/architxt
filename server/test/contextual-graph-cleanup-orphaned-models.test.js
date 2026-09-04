import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import {
  upsertNode,
  upsertEdge,
  getNode,
  getEdge,
  listEdges,
} from '../src/db/crud/contextual-graph.js';
import { cleanupOrphanedModels } from '../src/services/contextual-graph/cleanup-orphaned-models.js';
import { clearCache } from '../src/cache.js';
import { createTemplateRole } from '../src/db/crud/template-roles.js';
import { createMentalModel } from '../src/db/crud/mental-models.js';
import { resetKnownRolesCache } from '../src/services/contextual-graph/graph-model-refs.js';

function seedCustomTemplate(db, { role, scope, extId, name, sourceQuery }) {
  createTemplateRole(db, { role_id: role, display_name: `${role} display`, derivation_scope: scope });
  createMentalModel(db, {
    mm_ext_id: extId,
    mm_name: name,
    mm_source_query: sourceQuery,
    mm_is_template: 'true',
    mm_template_role: role,
    mm_max_tokens: 4096,
  });
  resetKnownRolesCache();
}

function createDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return { db, serverId: db.prepare('SELECT svr_id FROM servers').get().svr_id };
}

function makeCleanup(db, serverId, bankId) {
  return cleanupOrphanedModels(db, serverId, bankId, {
    deleteFromHindsight: async () => ({ success: true }),
  });
}

describe('cleanupOrphanedModels', () => {
  let db;
  let serverId;

  beforeEach(() => {
    ({ db, serverId } = createDb());
  });

  it('requires server_id and bank_id', async () => {
    const result = await cleanupOrphanedModels(db, null, null);
    assert.equal(result.success, false);
    assert.equal(result.code, 'MISSING_PARAMS');
  });

  it('deletes an edge-role model whose backing edge is missing', async () => {
    const bankId = 'bank-edge-orphan';
    const sourceId = 'svc:SRC';
    const targetId = 'svc:DST';
    const edgeId = 'edge-ctx-src|dst-foo';
    const extId = 'edge-ctx-src|dst';

    upsertNode(db, serverId, bankId, sourceId, ['grounded', 'active'], { display_name: 'Source' });
    upsertNode(db, serverId, bankId, targetId, ['grounded', 'active'], { display_name: 'Target' });

    // Create a directed generated edge carrying the edge-ctx ref, but no grounded
    // undirected edge exists between the endpoints.
    upsertEdge(db, serverId, bankId, edgeId, sourceId, targetId, 'relates-to', {
      directed: true,
      label: 'foo',
      detail: 'bar',
      provenance: {
        source: 'contextual-graph',
        model_refs: [
          { role: 'sys_edge_context', ext_id: extId, scope: { source_id: sourceId, target_id: targetId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    const result = await makeCleanup(db, serverId, bankId);

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, [extId]);
    assert.equal(result.cleared.edges, 1, 'generated edge should be removed');
    assert.equal(result.cleared.nodes, 0);

    const edgeResult = getEdge(db, serverId, bankId, edgeId);
    assert.equal(edgeResult.success, true);
    assert.equal(edgeResult.data, null, 'edge should be deleted');
  });

  it('keeps an edge-role model that still has a grounded edge', async () => {
    const bankId = 'bank-edge-attached';
    const sourceId = 'svc:SRC';
    const targetId = 'svc:DST';
    const edgeId = 'grounded-src-dst';
    const extId = 'edge-ctx-src|dst';

    upsertNode(db, serverId, bankId, sourceId, ['grounded', 'active'], { display_name: 'Source' });
    upsertNode(db, serverId, bankId, targetId, ['grounded', 'active'], { display_name: 'Target' });
    upsertEdge(db, serverId, bankId, edgeId, sourceId, targetId, 'relates-to', {
      labels: ['grounded'],
      directed: false,
    });
    upsertEdge(db, serverId, bankId, 'edge-ctx-src|dst-foo', sourceId, targetId, 'relates-to', {
      directed: true,
      label: 'foo',
      provenance: {
        model_refs: [
          { role: 'sys_edge_context', ext_id: extId, scope: { source_id: sourceId, target_id: targetId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    const result = await makeCleanup(db, serverId, bankId);

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, []);
    assert.equal(result.cleared.nodes, 0);
    assert.equal(result.cleared.edges, 0);
    assert.equal(result.skipped, 1);
  });

  it('deletes an entity-summary model whose node is now a candidate', async () => {
    const bankId = 'bank-node-candidate';
    const nodeId = 'svc:NODE';
    const extId = 'entity-summary-svc:NODE';

    upsertNode(db, serverId, bankId, nodeId, ['candidate', 'active'], {
      display_name: 'Candidate Node',
      summary: 'Generated summary',
      provenance: {
        model_refs: [
          { role: 'sys_entity_summary', ext_id: extId, scope: { node_id: nodeId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    const result = await makeCleanup(db, serverId, bankId);

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, [extId]);
    assert.equal(result.cleared.nodes, 1);

    const nodeResult = getNode(db, serverId, bankId, nodeId);
    assert.equal(nodeResult.data.properties.summary, undefined);
    assert.equal(nodeResult.data.properties.provenance, undefined);
  });

  it('deletes a discovery model whose seed node is missing', async () => {
    const bankId = 'bank-seed-missing';
    const seedId = 'svc:SEED';
    const discoveredNodeId = 'discovered:thing';
    const discoveredEdgeId = 'discovered-seed-thing';
    const extId = `discover-${seedId}`;

    // Seed node with a discovery ref, but then discovered subgraph still exists.
    upsertNode(db, serverId, bankId, seedId, ['grounded', 'active'], {
      display_name: 'Seed',
      provenance: {
        model_refs: [
          { role: 'sys_discovery_context', ext_id: extId, scope: { seed_id: seedId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    upsertNode(db, serverId, bankId, discoveredNodeId, ['candidate', 'active'], {
      display_name: 'Discovered Thing',
      provenance: {
        discovery: 'discovered',
        model_refs: [
          { role: 'sys_discovery_context', ext_id: extId, scope: { seed_id: seedId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    upsertEdge(db, serverId, bankId, discoveredEdgeId, seedId, discoveredNodeId, 'relates-to', {
      provenance: {
        discovery: 'discovered',
        model_refs: [
          { role: 'sys_discovery_context', ext_id: extId, scope: { seed_id: seedId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    // Delete the seed so the discovery model becomes an orphan.
    const { deleteNode } = await import('../src/db/crud/contextual-graph.js');
    deleteNode(db, serverId, bankId, seedId);

    const result = await makeCleanup(db, serverId, bankId);

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, [extId]);
    assert.equal(result.cleared.nodes, 1, 'discovered node deleted (seed is already gone)');
    assert.equal(result.cleared.edges, 0, 'discovered edge was already deleted with seed node');

    const discoveredResult = getNode(db, serverId, bankId, discoveredNodeId);
    assert.equal(discoveredResult.data, null);

    const edgesResult = listEdges(db, serverId, bankId, { limit: 100 });
    assert.equal(edgesResult.data.length, 0);
  });

  it('reports remote delete failures but still clears local data', async () => {
    const bankId = 'bank-remote-fail';
    const nodeId = 'svc:NODE';
    const extId = 'entity-summary-svc:NODE';

    upsertNode(db, serverId, bankId, nodeId, ['candidate', 'active'], {
      display_name: 'Candidate Node',
      summary: 'Generated summary',
      provenance: {
        model_refs: [
          { role: 'sys_entity_summary', ext_id: extId, scope: { node_id: nodeId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    const result = await cleanupOrphanedModels(db, serverId, bankId, {
      deleteFromHindsight: async () => ({ success: false, error: 'network error' }),
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, []);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].ext_id, extId);
    assert.equal(result.cleared.nodes, 1);
  });

  it('keeps a custom node-scoped role model when the node still qualifies', async () => {
    const bankId = 'bank-custom-node';
    const nodeId = 'svc:CUSTOM';
    const role = 'custom_node_role';
    const extId = `${role}-${nodeId}`;

    seedCustomTemplate(db, {
      role,
      scope: 'node',
      extId: 'custom-node-{id}',
      name: 'Custom node: {entity-name}',
      sourceQuery: 'MATCH (n {id: "{id}"}) RETURN n',
    });

    upsertNode(db, serverId, bankId, nodeId, ['grounded', 'active'], {
      display_name: 'Custom Node',
      provenance: {
        model_refs: [
          { role, ext_id: extId, scope: { node_id: nodeId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    const result = await makeCleanup(db, serverId, bankId);

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, []);
    assert.equal(result.cleared.nodes, 0);
    assert.equal(result.cleared.edges, 0);
    assert.equal(result.skipped, 1);

    const nodeResult = getNode(db, serverId, bankId, nodeId);
    assert.equal(nodeResult.data.properties.provenance.model_refs[0].ext_id, extId);
  });

  it('keeps a custom edge-scoped role model when a grounded edge still exists', async () => {
    const bankId = 'bank-custom-edge';
    const sourceId = 'svc:CUSTOM-SRC';
    const targetId = 'svc:CUSTOM-DST';
    const role = 'custom_edge_role';
    const extId = `${role}-${sourceId}|${targetId}`;

    seedCustomTemplate(db, {
      role,
      scope: 'edge',
      extId: 'custom-edge-{source-id}|{target-id}',
      name: 'Custom edge: {source-name} → {target-name}',
      sourceQuery: 'MATCH (a {id: "{source-id}"})-[r]-(b {id: "{target-id}"}) RETURN r',
    });

    upsertNode(db, serverId, bankId, sourceId, ['grounded', 'active'], { display_name: 'Source' });
    upsertNode(db, serverId, bankId, targetId, ['grounded', 'active'], { display_name: 'Target' });
    upsertEdge(db, serverId, bankId, 'grounded-custom', sourceId, targetId, 'relates-to', {
      labels: ['grounded'],
      directed: false,
    });
    upsertEdge(db, serverId, bankId, 'generated-custom', sourceId, targetId, 'relates-to', {
      directed: true,
      label: 'custom',
      provenance: {
        model_refs: [
          { role, ext_id: extId, scope: { source_id: sourceId, target_id: targetId }, attached_at: '2026-01-01T00:00:00Z' },
        ],
      },
    });

    const result = await makeCleanup(db, serverId, bankId);

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, []);
    assert.equal(result.cleared.nodes, 0);
    assert.equal(result.cleared.edges, 0);
    assert.equal(result.skipped, 1);

    const edgeResult = getEdge(db, serverId, bankId, 'generated-custom');
    assert.equal(edgeResult.data.cge_properties.provenance.model_refs[0].ext_id, extId);
  });
});
