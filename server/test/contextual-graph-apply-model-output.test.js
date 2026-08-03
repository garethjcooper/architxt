import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { upsertNode, upsertEdge, getNode, getEdge, listEdges } from '../src/db/crud/contextual-graph.js';
import { normalizeModelOutput } from '../src/services/contextual-graph/normalize-model-output.js';
import { applyModelOutput } from '../src/services/contextual-graph/apply-model-output.js';
import { clearCache } from '../src/cache.js';

function createDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return db;
}

function model(extId, role) {
  return {
    mm_ext_id: extId,
    mm_template_role: role,
    mm_dimension: role,
    mm_name: 'Test model',
  };
}

describe('applyModelOutput', () => {
  let db;
  const serverId = 1;
  const bankId = 'bank-1';

  beforeEach(() => {
    db = createDb();
  });

  it('applies entity summary to a node', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], { display_name: 'Billing Service' });
    const output = normalizeModelOutput(JSON.stringify({
      narrative: 'Handles customer billing.',
      graph: { nodes: [], edges: [] },
      tables: [],
    }));

    const result = await applyModelOutput(db, serverId, bankId, model('entity-summary-svc-001', 'sys_entity_summary'), output);
    assert.equal(result.success, true);
    assert.equal(result.applied.nodeId, 'svc-001');

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    assert.equal(node.properties.summary, 'Handles customer billing.');
    assert.equal(node.properties.provenance.source, 'contextual-graph');
    assert.equal(node.properties.provenance.model_refs.length, 1);
    assert.equal(node.properties.provenance.model_refs[0].role, 'sys_entity_summary');
    assert.equal(node.properties.provenance.model_refs[0].ext_id, 'entity-summary-svc-001');
    assert.ok(node.properties.provenance.model_refs[0].content_hash);
  });

  it('applies entity capabilities to a node', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], { display_name: 'Billing Service' });
    const output = normalizeModelOutput(JSON.stringify({
      narrative: '',
      graph: { nodes: [], edges: [] },
      tables: [{
        name: 'capabilities',
        columns: ['name', 'evidence'],
        rows: [{ name: 'billing', evidence: ['mem-1'] }],
      }],
    }));

    const result = await applyModelOutput(db, serverId, bankId, model('entity-capabilities-svc-001', 'sys_entity_capabilities'), output);
    assert.equal(result.success, true);
    assert.equal(result.applied.nodeId, 'svc-001');

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    assert.equal(node.properties.capabilities.length, 1);
    assert.equal(node.properties.capabilities[0].name, 'billing');
    assert.deepEqual(node.properties.capabilities[0].evidence, ['mem-1']);
  });

  it('applies edge context to matching edges', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {});
    upsertNode(db, serverId, bankId, 'svc-002', ['active'], {});
    upsertEdge(db, serverId, bankId, 'edge-001', 'svc-001', 'svc-002', null, { directed: false });

    const output = normalizeModelOutput(JSON.stringify({
      narrative: '',
      graph: {
        nodes: [],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'sends', label: 'usage data', detail: 'A sends usage data to B', evidence: ['mem-2'] }],
      },
      tables: [],
    }));

    const result = await applyModelOutput(db, serverId, bankId, model('edge-ctx-svc-001|svc-002', 'sys_edge_context'), output);
    assert.equal(result.success, true);
    assert.equal(result.applied.edgeIds.length, 1);

    const edge = getEdge(db, serverId, bankId, 'edge-001').data;
    assert.equal(edge.cge_type, 'sends');
    assert.equal(edge.properties.label, 'usage data');
    assert.deepEqual(edge.properties.evidence, ['mem-2']);
    assert.equal(edge.properties.provenance.model_refs[0].role, 'sys_edge_context');
  });

  it('replaces a discovery subgraph scoped to a seed', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], { display_name: 'Billing Service' });

    const firstOutput = normalizeModelOutput(JSON.stringify({
      narrative: '',
      graph: {
        nodes: [{ id: 'found:a', name: 'A', type: 'service' }],
        edges: [{ from: 'svc-001', to: 'found:a', type: 'calls', label: 'calls', detail: 'detail', evidence: ['mem-3'] }],
      },
      tables: [],
    }));

    let result = await applyModelOutput(db, serverId, bankId, model('discover-svc-001', 'sys_discovery_context'), firstOutput);
    assert.equal(result.success, true);
    assert.equal(result.applied.nodeCount, 1);

    const discovered = getNode(db, serverId, bankId, 'found:a').data;
    assert.ok(discovered.labels.includes('candidate'));
    assert.equal(discovered.properties.provenance.discovery, 'discovered');

    // Re-apply with a different candidate; old candidate should be removed.
    const secondOutput = normalizeModelOutput(JSON.stringify({
      narrative: '',
      graph: {
        nodes: [{ id: 'found:b', name: 'B', type: 'service' }],
        edges: [{ from: 'svc-001', to: 'found:b', type: 'sends', label: 'sends', detail: 'detail', evidence: ['mem-4'] }],
      },
      tables: [],
    }));

    result = await applyModelOutput(db, serverId, bankId, model('discover-svc-001', 'sys_discovery_context'), secondOutput);
    assert.equal(result.success, true);

    const oldNode = getNode(db, serverId, bankId, 'found:a').data;
    assert.equal(oldNode, null);
    const newNode = getNode(db, serverId, bankId, 'found:b').data;
    assert.ok(newNode);

    // Count edges after second apply. The old edge should be gone and one new edge should exist.
    const edges = listEdges(db, serverId, bankId, { limit: 100 }).data;
    const discoveredEdges = edges.filter((e) => e.cge_source_id === 'svc-001' && e.cge_target_id === 'found:b');
    assert.equal(discoveredEdges.length, 1);
    assert.equal(discoveredEdges[0].cge_type, 'sends');
  });

  it('warns but ignores unexpected sections per role', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {});
    const output = normalizeModelOutput(JSON.stringify({
      narrative: 'unexpected narrative',
      graph: { nodes: [{ id: 'svc-002', name: 'X' }], edges: [] },
      tables: [{ name: 'other', columns: [], rows: [] }],
    }));

    const result = await applyModelOutput(db, serverId, bankId, model('entity-capabilities-svc-001', 'sys_entity_capabilities'), output);
    assert.equal(result.success, true);
    assert.ok(result.warnings.length > 0);
  });
});
