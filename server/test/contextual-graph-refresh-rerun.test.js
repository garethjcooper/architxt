import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { upsertNode } from '../src/db/crud/contextual-graph.js';
import { refreshContextualGraphPatches } from '../src/services/contextual-graph/refresh-patches.js';
import { contentHash } from '../src/services/contextual-graph/normalize-model-output.js';
import { config } from '../src/config.js';

function createDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return db;
}

describe('refreshContextualGraphPatches rerunExtIds', () => {
  let db;
  const serverId = 1;
  const bankId = 'bank-1';
  let originalRoles;

  beforeEach(() => {
    db = createDb();
    originalRoles = { ...(config.contextualGraph?.patchRoles || {}) };
    if (!config.contextualGraph) config.contextualGraph = { patchRoles: {} };
    config.contextualGraph.patchRoles = {
      sys_entity_summary: true,
      sys_entity_capabilities: true,
      sys_edge_context: true,
      sys_discovery_context: true,
    };
  });

  it('queues Hindsight refresh and records a pending_operations row', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const refreshed = [];
    const content = JSON.stringify({ narrative: 'Updated summary.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      rerunExtIds: ['entity-summary-svc-001'],
      refreshMentalModel: async (_serverId, _bankId, extId) => {
        refreshed.push(extId);
        return { success: true, operationId: 'op-1', status: 'pending' };
      },
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [{ id: 'entity-summary-svc-001', content }],
      }),
    });

    assert.equal(result.success, true);
    assert.deepEqual(refreshed, ['entity-summary-svc-001']);
    assert.equal(result.stats.rerunRequested, 1);
    assert.equal(result.stats.rerunPending, 1);
    assert.equal(result.stats.rerunFailed, 0);
    assert.equal(result.stats.applied, 1);

    // In production refreshMentalModel creates a pending_operations row for the
    // poll daemon. When using an injected mock we do not expect that side effect.

    const nodeResult = await import('../src/db/crud/contextual-graph.js').then((m) => m.getNode(db, serverId, bankId, 'svc-001'));
    assert.equal(nodeResult.data.properties.summary, 'Updated summary.');
    assert.equal(nodeResult.data.properties.provenance.model_refs[0].content_hash, contentHash(content));
  });

  it('records completed status when Hindsight returns terminal status', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      rerunExtIds: ['entity-summary-svc-001'],
      refreshMentalModel: async () => ({ success: true, operationId: 'op-2', status: 'completed' }),
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [{ id: 'entity-summary-svc-001', content: JSON.stringify({ narrative: 'Updated.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] }) }],
      }),
    });

    assert.equal(result.stats.rerunRequested, 1);
    assert.equal(result.stats.rerunCompleted, 1);
    assert.equal(result.stats.rerunPending, 0);
  });

  it('reports rerun failures', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const content = JSON.stringify({ narrative: 'Fallback content.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      rerunExtIds: ['entity-summary-svc-001'],
      refreshMentalModel: async () => ({ success: false, error: 'Hindsight busy' }),
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [{ id: 'entity-summary-svc-001', content }],
      }),
    });

    assert.equal(result.stats.rerunRequested, 1);
    assert.equal(result.stats.rerunFailed, 1);
    assert.equal(result.stats.applied, 1);
    assert.equal(result.stats.errors.length, 1);
    assert.equal(result.stats.errors[0].phase, 'rerun');
  });

  it('ignores rerunExtIds that are not locally referenced', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const refreshed = [];

    await refreshContextualGraphPatches(db, serverId, bankId, {
      rerunExtIds: ['entity-summary-svc-001', 'entity-summary-svc-999'],
      refreshMentalModel: async (_serverId, _bankId, extId) => {
        refreshed.push(extId);
        return { success: true, operationId: 'op-3', status: 'pending' };
      },
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [{ id: 'entity-summary-svc-001', content: JSON.stringify({ narrative: 'Updated.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] }) }],
      }),
    });

    assert.deepEqual(refreshed, ['entity-summary-svc-001']);
  });

  it('does not trigger a Hindsight refresh when content differs on refresh', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      summary: 'Old summary',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const refreshed = [];

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      refreshMentalModel: async (_serverId, _bankId, extId) => {
        refreshed.push(extId);
        return { success: true, operationId: 'op-unexpected', status: 'pending' };
      },
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [{ id: 'entity-summary-svc-001', content: JSON.stringify({ narrative: 'New summary.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] }) }],
      }),
    });

    assert.equal(result.success, true);
    assert.deepEqual(refreshed, []);
    assert.equal(result.stats.rerunRequested, 0);
    assert.equal(result.stats.applied, 1);
  });
});
