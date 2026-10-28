import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { applyModelOutput } from '../src/services/contextual-graph/apply-model-output.js';
import { listEdges, getEdge, upsertNode } from '../src/db/crud/contextual-graph.js';
import { clearCache } from '../src/cache.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

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
  return db.prepare('SELECT svr_id FROM servers').get().svr_id;
}

function makeEdgeContextModel(sourceId, targetId) {
  return {
    mm_ext_id: `edge-ctx-${sourceId}|${targetId}`,
    mm_template_role: 'sys_edge_context',
    mm_dimension: 'sys_edge_context',
    mm_name: `Edge context ${sourceId} → ${targetId}`,
    scope: { source_id: sourceId, target_id: targetId },
  };
}

const BASE_KEYS = ['protocol', 'format', 'frequency', 'auth', 'encryption', 'directed', 'label', 'detail', 'evidence', 'updated_at', 'provenance'];

function makeTableEnvelope(rows, columns) {
  const envelope = {
    narratives: [],
    graph: { name: '', nodes: [], edges: [] },
    tables: [{
      name: 'edge-context',
      columns: columns || ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'],
      rows,
      evidence: [],
    }],
    diagrams: [],
  };
  return { ...envelope, raw: JSON.stringify(envelope) };
}

describe('applyModelOutput edge-context table input', () => {
  let db;
  let serverId;
  const bankId = 'bank-1';

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
  });

  it('creates directed edges from table rows', async () => {
    upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'active'], { display_name: 'Singleview' });
    upsertNode(db, serverId, bankId, 'a-com:COM-002', ['canonical', 'active'], { display_name: 'ICMS' });

    const rows = [
      ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Singleview sends postpaid usage to ICMS.', '-', ['e1']],
      ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Rental charges feed', 'Singleview sends the Rental Feed to ICMS.', '-', ['e2']],
      ['a-com:COM-002', 'a-com:COM-001', 'sends', 'Postal address data', 'ICMS provides postal address data to Singleview.', '-', ['e3']],
    ];

    const model = makeEdgeContextModel('a-com:COM-001', 'a-com:COM-002');
    const output = makeTableEnvelope(rows);

    const result = await applyModelOutput(db, serverId, bankId, model, output);
    assert.equal(result.success, true, result.error);

    const edgesResult = listEdges(db, serverId, bankId, { limit: 100 });
    assert.equal(edgesResult.data.length, 3);

    const byLabel = new Map(edgesResult.data.map((e) => [e.cge_properties.label, e]));
    assert.equal(byLabel.has('Usage rating feed'), true);
    assert.equal(byLabel.has('Rental charges feed'), true);
    assert.equal(byLabel.has('Postal address data'), true);

    const usageEdge = byLabel.get('Usage rating feed');
    assert.equal(usageEdge.cge_source_id, 'a-com:COM-001');
    assert.equal(usageEdge.cge_target_id, 'a-com:COM-002');
    assert.equal(usageEdge.cge_type, 'sends');
    assert.deepEqual(Object.keys(usageEdge.cge_properties).sort(), BASE_KEYS.sort());
    assert.equal(usageEdge.cge_properties.detail, 'Singleview sends postpaid usage to ICMS.');
    assert.deepEqual(usageEdge.cge_properties.evidence, ['e1']);
    assert.equal(usageEdge.cge_properties.frequency, '');
    assert.equal(usageEdge.cge_properties.protocol, '');
    assert.equal(usageEdge.cge_properties.format, '');
    assert.equal(usageEdge.cge_properties.auth, '');
    assert.equal(usageEdge.cge_properties.encryption, '');
  });

  it('re-applies deterministically: same table content replaces edges rather than duplicating', async () => {
    upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'active'], { display_name: 'Singleview' });
    upsertNode(db, serverId, bankId, 'a-com:COM-002', ['canonical', 'active'], { display_name: 'ICMS' });

    const rows = [
      ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Singleview sends postpaid usage to ICMS.', '-', ['e1']],
    ];

    const model = makeEdgeContextModel('a-com:COM-001', 'a-com:COM-002');
    let output = makeTableEnvelope(rows);

    await applyModelOutput(db, serverId, bankId, model, output);
    await applyModelOutput(db, serverId, bankId, model, output);

    const edgesResult = listEdges(db, serverId, bankId, { limit: 100 });
    assert.equal(edgesResult.data.length, 1);
  });

  it('updates an edge when the detail changes in a table row', async () => {
    upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'active'], { display_name: 'Singleview' });
    upsertNode(db, serverId, bankId, 'a-com:COM-002', ['canonical', 'active'], { display_name: 'ICMS' });

    const model = makeEdgeContextModel('a-com:COM-001', 'a-com:COM-002');

    await applyModelOutput(db, serverId, bankId, model, makeTableEnvelope([
      ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Original detail.', '-', ['e1']],
    ]));

    await applyModelOutput(db, serverId, bankId, model, makeTableEnvelope([
      ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Updated detail.', '-', ['e1', 'e2']],
    ]));

    const edgesResult = listEdges(db, serverId, bankId, { limit: 100 });
    assert.equal(edgesResult.data.length, 1);
    assert.equal(edgesResult.data[0].cge_properties.detail, 'Updated detail.');
    assert.deepEqual(edgesResult.data[0].cge_properties.evidence, ['e1', 'e2']);
  });

  it('re-applies with the same property shape as a fresh edge', async () => {
    upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'active'], { display_name: 'Singleview' });
    upsertNode(db, serverId, bankId, 'a-com:COM-002', ['canonical', 'active'], { display_name: 'ICMS' });

    const model = makeEdgeContextModel('a-com:COM-001', 'a-com:COM-002');

    // First apply: model emits protocol/auth/encryption.
    await applyModelOutput(db, serverId, bankId, model, makeTableEnvelope([
      ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Singleview sends postpaid usage to ICMS.', '-', ['e1'], 'HTTPS', 'OAuth2', 'TLS1.3'],
    ], ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence', 'protocol', 'auth', 'encryption']));

    const firstEdge = listEdges(db, serverId, bankId, { limit: 100 }).data[0];
    assert.deepEqual(Object.keys(firstEdge.cge_properties).sort(), BASE_KEYS.sort());
    assert.deepEqual(firstEdge.cge_properties.protocol, 'HTTPS');
    assert.deepEqual(firstEdge.cge_properties.auth, 'OAuth2');
    assert.deepEqual(firstEdge.cge_properties.encryption, 'TLS1.3');

    // Re-apply: same edge, but protocol/auth/encryption are now unknown ('-').
    await applyModelOutput(db, serverId, bankId, model, makeTableEnvelope([
      ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Singleview sends postpaid usage to ICMS.', '-', ['e1'], '-', '-', '-'],
    ], ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence', 'protocol', 'auth', 'encryption']));

    const secondEdge = listEdges(db, serverId, bankId, { limit: 100 }).data[0];
    assert.equal(secondEdge.cge_id, firstEdge.cge_id);
    assert.deepEqual(Object.keys(secondEdge.cge_properties).sort(), BASE_KEYS.sort());
    assert.equal(secondEdge.cge_properties.protocol, '');
    assert.equal(secondEdge.cge_properties.auth, '');
    assert.equal(secondEdge.cge_properties.encryption, '');
  });

  it('ignores rows missing required columns', async () => {
    upsertNode(db, serverId, bankId, 'a-com:COM-001', ['canonical', 'active'], { display_name: 'Singleview' });
    upsertNode(db, serverId, bankId, 'a-com:COM-002', ['canonical', 'active'], { display_name: 'ICMS' });

    const envelope = {
      narratives: [],
      graph: { name: '', nodes: [], edges: [] },
      tables: [{
        name: 'edge-context',
        columns: ['x', 'y', 'z'],
        rows: [['a-com:COM-001', 'a-com:COM-002', 'sends']],
        evidence: [],
      }],
      diagrams: [],
    };
    envelope.raw = JSON.stringify(envelope);

    const model = makeEdgeContextModel('a-com:COM-001', 'a-com:COM-002');
    const result = await applyModelOutput(db, serverId, bankId, model, envelope);
    assert.equal(result.success, false);
    assert.equal(result.code, 'NO_EDGES');
  });

  it('falls back to graph.edges when no tables are present', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['canonical', 'active'], { display_name: 'A' });
    upsertNode(db, serverId, bankId, 'svc-002', ['canonical', 'active'], { display_name: 'B' });

    const envelope = {
      narratives: [],
      graph: {
        name: '',
        nodes: [],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'sends', label: 'legacy', detail: 'legacy edge', evidence: ['e1'] }],
      },
      tables: [],
      diagrams: [],
    };
    envelope.raw = JSON.stringify(envelope);

    const model = makeEdgeContextModel('svc-001', 'svc-002');
    const result = await applyModelOutput(db, serverId, bankId, model, envelope);
    assert.equal(result.success, true);

    const edges = listEdges(db, serverId, bankId, { limit: 100 }).data;
    assert.equal(edges.length, 1);
    assert.equal(edges[0].cge_properties.label, 'legacy');
  });
});
