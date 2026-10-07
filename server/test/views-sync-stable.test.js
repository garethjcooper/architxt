import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { upsertNode, upsertEdge } from '../src/db/crud/contextual-graph.js';
import { createView, updateView, syncViewsFromContextualGraph } from '../src/db/crud/views.js';

function getTestDb() {
  clearCache();
  const file = path.join(process.cwd(), `tmp/test-views-sync-stable-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_base_url, svr_name) VALUES (?, ?)').run('http://hindsight', 'test');
  const serverId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  return { db, file, serverId };
}

describe('syncViewsFromContextualGraph stability', () => {
  let db;
  let file;
  let serverId;

  beforeEach(() => {
    ({ db, file, serverId } = getTestDb());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(file); } catch {}
  });

  it('reports no changes on a second sync when the contextual graph is stable', () => {
    const bankId = 'bank';
    const nodeId = 'svc:SVC-TEST-001';
    const nodeViewId = `entity-${nodeId}`;

    const nodeResult = upsertNode(db, serverId, bankId, nodeId, ['canonical', 'active'], {
      display_name: 'Test Service',
      name: 'Test Service',
      entity_type: 'svc',
    });
    assert.equal(nodeResult.success, true);

    const edgeId = 'edge-1';
    const edgeResult = upsertEdge(db, serverId, bankId, edgeId, nodeId, nodeId, 'calls', {
      label: 'self-call',
    });
    assert.equal(edgeResult.success, true);

    const viewGraph = {
      nodes: [
        {
          id: nodeViewId,
          type: 'entity',
          ref_id: nodeId,
          label: 'Test Service',
          name: 'Test Service',
          entity_type: 'svc',
          properties: {
            display_name: 'Test Service',
            name: 'Test Service',
            entity_type: 'svc',
            last_seen_at: '2026-10-04T21:51:25.278Z',
            updated_at: '2026-10-04T21:51:44.487Z',
            provenance: {
              model_refs: [
                {
                  role: 'sys_entity_summary',
                  ext_id: `entity-summary-${nodeId}`,
                  scope: { node_id: nodeId },
                  attached_at: '2026-09-24T04:36:03.462Z',
                  fetched_at: '2026-10-04T21:51:44.487Z',
                  last_refresh_at: '2026-10-04T21:51:44.487Z',
                  last_refresh_status: 'ok',
                  content_hash: 'abc123',
                  last_refresh_empty_envelope: false,
                },
              ],
            },
          },
          style: {},
        },
      ],
      edges: [
        {
          id: edgeId,
          type: 'default',
          source: nodeViewId,
          target: nodeViewId,
          ref_id: edgeId,
          source_ref_id: nodeId,
          target_ref_id: nodeId,
          label: 'self-call',
          edge_type: 'calls',
          properties: {
            label: 'self-call',
            updated_at: '2026-10-04T21:51:44.487Z',
            provenance: {
              model_refs: [
                {
                  role: 'sys_edge_context',
                  ext_id: `edge-ctx-${nodeId}|${nodeId}`,
                  scope: { source_id: nodeId, target_id: nodeId },
                  attached_at: '2026-09-24T04:36:03.462Z',
                  fetched_at: '2026-10-04T21:51:44.487Z',
                  content_hash: 'def456',
                },
              ],
            },
          },
        },
      ],
    };
    const viewLayout = {
      positions: { [nodeViewId]: { x: 100, y: 100 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const createResult = createView(db, {
      server_id: serverId,
      bank_id: bankId,
      name: 'Stable View',
      graph: viewGraph,
      layout: viewLayout,
    });
    assert.equal(createResult.success, true);

    const firstResult = syncViewsFromContextualGraph(db, serverId, bankId);
    assert.equal(firstResult.success, true, firstResult.error);
    const first = firstResult.data;

    // Simulate the contextual-graph refresh rewriting model_ref timestamps.
    // The content_hash stays the same, so the view diff should remain stable.
    const refreshedViewGraph = {
      ...viewGraph,
      nodes: viewGraph.nodes.map((n) => ({
        ...n,
        properties: {
          ...n.properties,
          last_seen_at: '2026-10-04T21:55:37.775Z',
          updated_at: '2026-10-04T21:55:59.001Z',
          provenance: {
            ...n.properties.provenance,
            model_refs: n.properties.provenance.model_refs.map((ref) => ({
              ...ref,
              fetched_at: '2026-10-04T21:55:59.001Z',
              last_refresh_at: '2026-10-04T21:55:59.001Z',
            })),
          },
        },
      })),
      edges: viewGraph.edges.map((e) => ({
        ...e,
        properties: {
          ...e.properties,
          updated_at: '2026-10-04T21:55:59.001Z',
          provenance: {
            ...e.properties.provenance,
            model_refs: e.properties.provenance.model_refs.map((ref) => ({
              ...ref,
              fetched_at: '2026-10-04T21:55:59.001Z',
            })),
          },
        },
      })),
    };

    const viewId = createResult.data;
    const updateResult = updateView(db, viewId, { view_graph: refreshedViewGraph });
    assert.equal(updateResult.success, true, updateResult.error);

    const secondResult = syncViewsFromContextualGraph(db, serverId, bankId);
    assert.equal(secondResult.success, true, secondResult.error);
    const second = secondResult.data;
    assert.equal(
      second.changed,
      0,
      `expected no changes on second sync when only model_ref timestamps drift, got changed=${second.changed}, added=${second.total_added}, updated=${second.total_updated}, removed=${second.total_removed}`
    );
  });

  it('treats entity_type, edge orientation, and edge_type null/undefined as stable', () => {
    const bankId = 'bank-convention';
    const nodeA = 'a-com:COM-001';
    const nodeB = 'a-com:COM-002';
    const viewA = `entity-${nodeA}`;
    const viewB = `entity-${nodeB}`;
    const edgeId = 'edge-calls';

    // Contextual graph nodes have no explicit entity_type; the label is 'canonical'.
    const nodeAResult = upsertNode(db, serverId, bankId, nodeA, ['canonical'], {
      display_name: 'COM-001',
      name: 'COM-001',
    });
    assert.equal(nodeAResult.success, true);

    const nodeBResult = upsertNode(db, serverId, bankId, nodeB, ['canonical'], {
      display_name: 'COM-002',
      name: 'COM-002',
    });
    assert.equal(nodeBResult.success, true);

    // Contextual edge direction is A -> B, type is null.
    const edgeResult = upsertEdge(db, serverId, bankId, edgeId, nodeA, nodeB, null, {
      label: 'calls',
    });
    assert.equal(edgeResult.success, true);

    // View was created by the entities panel, which derives entity_type from
    // labels and canonicalizes edge endpoints. Here we deliberately store the
    // edge with source/target flipped and edge_type undefined to prove the
    // diff treats these as equivalent after canonicalization.
    const viewGraph = {
      nodes: [
        {
          id: viewA,
          type: 'entity',
          ref_id: nodeA,
          label: 'COM-001',
          name: 'COM-001',
          entity_type: 'a-com',
          properties: { display_name: 'COM-001', name: 'COM-001' },
          style: {},
        },
        {
          id: viewB,
          type: 'entity',
          ref_id: nodeB,
          label: 'COM-002',
          name: 'COM-002',
          entity_type: 'a-com',
          properties: { display_name: 'COM-002', name: 'COM-002' },
          style: {},
        },
      ],
      edges: [
        {
          id: edgeId,
          type: 'default',
          source: viewB,
          target: viewA,
          ref_id: edgeId,
          source_ref_id: nodeB,
          target_ref_id: nodeA,
          label: 'calls',
          edge_type: undefined,
          properties: { label: 'calls' },
        },
      ],
    };
    const viewLayout = {
      positions: { [viewA]: { x: 100, y: 100 }, [viewB]: { x: 300, y: 100 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const createResult = createView(db, {
      server_id: serverId,
      bank_id: bankId,
      name: 'Convention View',
      graph: viewGraph,
      layout: viewLayout,
    });
    assert.equal(createResult.success, true);

    const firstResult = syncViewsFromContextualGraph(db, serverId, bankId);
    assert.equal(firstResult.success, true, firstResult.error);
    const first = firstResult.data;
    assert.equal(
      first.changed,
      0,
      `expected no changes when entity_type, edge direction, and edge_type conventions differ, got changed=${first.changed}, added=${first.total_added}, updated=${first.total_updated}, removed=${first.total_removed}`
    );
  });

  it('does not churn after entities panel rewrites an edge to canonical orientation', () => {
    const bankId = 'bank-panel-orientation';
    const nodeA = 'a-com:COM-001';
    const nodeB = 'a-com:COM-002';
    const viewA = `entity-${nodeA}`;
    const viewB = `entity-${nodeB}`;

    // Node IDs chosen so that COM-002 is lexicographically larger than COM-001,
    // making the canonical orientation source=COM-001, target=COM-002.
    const nodeAResult = upsertNode(db, serverId, bankId, nodeA, ['canonical'], {
      display_name: 'COM-001',
      name: 'COM-001',
    });
    assert.equal(nodeAResult.success, true);

    const nodeBResult = upsertNode(db, serverId, bankId, nodeB, ['canonical'], {
      display_name: 'COM-002',
      name: 'COM-002',
    });
    assert.equal(nodeBResult.success, true);

    // Contextual edge is B -> A, so without canonicalization the view would store
    // source_ref_id=COM-002, target_ref_id=COM-001.
    const edgeId = 'edge-calls';
    const edgeResult = upsertEdge(db, serverId, bankId, edgeId, nodeB, nodeA, 'calls', {
      label: 'calls',
    });
    assert.equal(edgeResult.success, true);

    // Simulate the entities panel after the canonical orientation fix:
    // the view edge uses the sorted endpoint even though the contextual edge
    // points the other way.
    const viewGraph = {
      nodes: [
        {
          id: viewA,
          type: 'entity',
          ref_id: nodeA,
          label: 'COM-001',
          name: 'COM-001',
          entity_type: 'a-com',
          properties: { display_name: 'COM-001', name: 'COM-001' },
          style: {},
        },
        {
          id: viewB,
          type: 'entity',
          ref_id: nodeB,
          label: 'COM-002',
          name: 'COM-002',
          entity_type: 'a-com',
          properties: { display_name: 'COM-002', name: 'COM-002' },
          style: {},
        },
      ],
      edges: [
        {
          id: edgeId,
          type: 'default',
          source: viewA,
          target: viewB,
          ref_id: edgeId,
          source_ref_id: nodeA,
          target_ref_id: nodeB,
          label: 'calls',
          edge_type: 'calls',
          properties: { label: 'calls' },
        },
      ],
    };
    const viewLayout = {
      positions: { [viewA]: { x: 100, y: 100 }, [viewB]: { x: 300, y: 100 } },
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const createResult = createView(db, {
      server_id: serverId,
      bank_id: bankId,
      name: 'Panel Orientation View',
      graph: viewGraph,
      layout: viewLayout,
    });
    assert.equal(createResult.success, true);

    const firstResult = syncViewsFromContextualGraph(db, serverId, bankId);
    assert.equal(firstResult.success, true, firstResult.error);
    const first = firstResult.data;
    assert.equal(
      first.changed,
      0,
      `expected no changes when panel canonicalizes orientation, got changed=${first.changed}, added=${first.total_added}, updated=${first.total_updated}, removed=${first.total_removed}`
    );

    const secondResult = syncViewsFromContextualGraph(db, serverId, bankId);
    assert.equal(secondResult.success, true, secondResult.error);
    const second = secondResult.data;
    assert.equal(
      second.total_updated,
      0,
      `expected no churn after panel canonicalizes orientation, got changed=${second.changed}, added=${second.total_added}, updated=${second.total_updated}, removed=${second.total_removed}`
    );
    assert.equal(second.changed, 0, 'no view should be marked changed on second stable sync');
  });

  it('remains stable for a view with six mixed entity edges', () => {
    const bankId = 'bank-six-edges';
    const nodes = [
      { id: 'a-com:COM-001', label: 'COM-001' },
      { id: 'a-com:COM-002', label: 'COM-002' },
      { id: 'a-com:COM-003', label: 'COM-003' },
      { id: 'a-com:COM-004', label: 'COM-004' },
    ];

    for (const n of nodes) {
      const result = upsertNode(db, serverId, bankId, n.id, ['canonical'], {
        display_name: n.label,
        name: n.label,
      });
      assert.equal(result.success, true);
    }

    const edges = [
      { id: 'edge-1', source: 'a-com:COM-001', target: 'a-com:COM-002', type: 'calls', props: { label: 'calls' } },
      { id: 'edge-2', source: 'a-com:COM-002', target: 'a-com:COM-003', type: 'uses', props: { label: 'uses', directed: false } },
      { id: 'edge-3', source: 'a-com:COM-003', target: 'a-com:COM-004', type: null, props: { label: 'relates' } },
      { id: 'edge-4', source: 'a-com:COM-004', target: 'a-com:COM-001', type: 'notifies', props: { label: 'notifies' } },
      { id: 'edge-5', source: 'a-com:COM-001', target: 'a-com:COM-003', type: 'depends', props: { label: 'depends' } },
      { id: 'edge-6', source: 'a-com:COM-002', target: 'a-com:COM-004', type: 'emits', props: { label: 'emits' } },
    ];

    for (const e of edges) {
      const result = upsertEdge(db, serverId, bankId, e.id, e.source, e.target, e.type, e.props);
      assert.equal(result.success, true);
    }

    const viewNodes = nodes.map((n) => ({
      id: `entity-${n.id}`,
      type: 'entity',
      ref_id: n.id,
      label: n.label,
      name: n.label,
      entity_type: 'a-com',
      properties: { display_name: n.label, name: n.label },
      style: {},
    }));

    const viewEdges = edges.map((e) => {
      const sourceViewId = `entity-${e.source}`;
      const targetViewId = `entity-${e.target}`;
      return {
        id: e.id,
        type: 'default',
        source: sourceViewId,
        target: targetViewId,
        ref_id: e.id,
        source_ref_id: e.source,
        target_ref_id: e.target,
        label: e.props.label,
        edge_type: e.type || undefined,
        properties: e.props,
      };
    });

    const viewGraph = { nodes: viewNodes, edges: viewEdges };
    const viewLayout = {
      positions: Object.fromEntries(viewNodes.map((n, i) => [n.id, { x: 100 + i * 160, y: 100 + (i % 2) * 100 }])),
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const createResult = createView(db, {
      server_id: serverId,
      bank_id: bankId,
      name: 'Six Edges View',
      graph: viewGraph,
      layout: viewLayout,
    });
    assert.equal(createResult.success, true);

    const firstResult = syncViewsFromContextualGraph(db, serverId, bankId);
    assert.equal(firstResult.success, true, firstResult.error);

    const secondResult = syncViewsFromContextualGraph(db, serverId, bankId);
    assert.equal(secondResult.success, true, secondResult.error);
    assert.equal(
      secondResult.data.total_updated,
      0,
      `expected no churn on second sync for six-edge view, got changed=${secondResult.data.changed}, added=${secondResult.data.total_added}, updated=${secondResult.data.total_updated}, removed=${secondResult.data.total_removed}`
    );
    assert.equal(secondResult.data.changed, 0, 'no view should be marked changed on second stable sync');
  });
});