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

  it('creates missing nodes and edges from edge-context model output', async () => {
    const output = normalizeModelOutput(JSON.stringify({
      narrative: '',
      graph: {
        nodes: [
          { id: 'svc-001', name: 'Billing Service', type: 'service' },
          { id: 'svc-002', name: 'Payment API', type: 'service' },
        ],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'sends', label: 'usage data', detail: 'A sends usage data to B', evidence: ['mem-2'] }],
      },
      tables: [],
    }));

    const result = await applyModelOutput(db, serverId, bankId, model('edge-ctx-svc-001|svc-002', 'sys_edge_context'), output);
    assert.equal(result.success, true);
    assert.equal(result.applied.createdNodes, 2);
    assert.equal(result.applied.edgeIds.length, 1);

    const sourceNode = getNode(db, serverId, bankId, 'svc-001').data;
    assert.equal(sourceNode.properties.display_name, 'Billing Service');
    assert.equal(sourceNode.properties.provenance.inferred, 'edge-context');

    const edge = getEdge(db, serverId, bankId, result.applied.edgeIds[0]).data;
    assert.equal(edge.cge_source_id, 'svc-001');
    assert.equal(edge.cge_target_id, 'svc-002');
    assert.equal(edge.cge_type, 'sends');
    assert.equal(edge.properties.label, 'usage data');
    assert.equal(edge.properties.directed, true);
    assert.deepEqual(edge.properties.evidence, ['mem-2']);
  });

  it('creates a missing edge when endpoint nodes already exist', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], { display_name: 'Billing Service' });
    upsertNode(db, serverId, bankId, 'svc-002', ['active'], { display_name: 'Payment API' });

    const output = normalizeModelOutput(JSON.stringify({
      narrative: '',
      graph: {
        nodes: [{ id: 'svc-001', name: 'Billing Service', type: 'service' }, { id: 'svc-002', name: 'Payment API', type: 'service' }],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'reads', label: 'account data', detail: 'Reads account data', evidence: ['mem-5'] }],
      },
      tables: [],
    }));

    const result = await applyModelOutput(db, serverId, bankId, model('edge-ctx-svc-001|svc-002', 'sys_edge_context'), output);
    assert.equal(result.success, true);
    assert.equal(result.applied.createdNodes, 0);
    assert.equal(result.applied.edgeIds.length, 1);

    const edge = getEdge(db, serverId, bankId, result.applied.edgeIds[0]).data;
    assert.equal(edge.cge_source_id, 'svc-001');
    assert.equal(edge.cge_target_id, 'svc-002');
    assert.equal(edge.cge_type, 'reads');
  });

  it('fails when edge-context model returns no edges', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {});
    upsertNode(db, serverId, bankId, 'svc-002', ['active'], {});

    const output = normalizeModelOutput(JSON.stringify({
      narrative: '',
      graph: { nodes: [], edges: [] },
      tables: [],
    }));

    const result = await applyModelOutput(db, serverId, bankId, model('edge-ctx-svc-001|svc-002', 'sys_edge_context'), output);
    assert.equal(result.success, false);
    assert.equal(result.code, 'NO_EDGES');
  });

  it('parses JSON containing non-breaking hyphens and no-break spaces', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], { display_name: 'Billing Service' });
    const output = normalizeModelOutput('Some prose before the envelope.\n\n{\n  "narrative": "payment‑method and account‑merge routing",\n  "graph": { "nodes": [], "edges": [] },\n  "tables": []\n}\n\nTrailing prose.');
    assert.equal(output.errors.length, 0);
    assert.equal(output.narrative, 'payment-method and account-merge routing');
  });

  it('parses real Hindsight content envelope for edge-context model', () => {
    const realContent = '## Overview\n\n{ \\"narrative\\": \\"Singleview (a-com:COM-001) is the emerging canonical source for customer agreement, payment‑method and usage information. ICMS (a-com:COM-002) reads account and payment data from Singleview, depends on Singleview for account‑merge and transaction routing, and receives usage data forwarded by Singleview for rating and billing.\\", \\"graph\\": { \\"nodes\\": [ { \\"id\\": \\"a-com:COM-002\\", \\"name\\": \\"ICMS\\", \\"type\\": \\"component\\" }, { \\"id\\": \\"a-com:COM-001\\", \\"name\\": \\"Singleview\\", \\"type\\": \\"component\\" } ], \\"edges\\": [ { \\"from\\": \\"a-com:COM-002\\", \\"to\\": \\"a-com:COM-001\\", \\"type\\": \\"reads\\", \\"label\\": \\"account data\\", \\"detail\\": \\"ICMS reads account and payment‑method information from Singleview to populate credit‑account identifiers.\\", \\"evidence\\": [\\"entity-summary-a-com:COM-001\\", \\"architxt-capabilities-txt-COM-002\\"] }, { \\"from\\": \\"a-com:COM-002\\", \\"to\\": \\"a-com:COM-001\\", \\"type\\": \\"depends-on\\", \\"label\\": \\"account merge\\", \\"detail\\": \\"ICMS depends on Singleview for account‑merge and transaction routing in the future AR‑master role.\\", \\"evidence\\": [\\"entity-summary-a-com:COM-001\\", \\"architxt-summary-txt-COM-001\\"] }, { \\"from\\": \\"a-com:COM-001\\", \\"to\\": \\"a-com:COM-002\\", \\"type\\": \\"sends\\", \\"label\\": \\"usage data\\", \\"detail\\": \\"Singleview forwards product‑usage records to ICMS for rating and billing processing.\\", \\"evidence\\": [\\"architxt-summary-txt-COM-001\\"] } ] }, \\"tables\\": [] }';
    const output = normalizeModelOutput(realContent);
    assert.equal(output.errors.length, 0);
    assert.equal(output.graph.edges.length, 3);
    assert.equal(output.graph.nodes.length, 2);
    const reads = output.graph.edges.find((e) => e.type === 'reads');
    assert.equal(reads.label, 'account data');
    assert.ok(reads.detail.includes('payment-method'));
  });

  it('normalizes JSON containing smart quotes inside string values', () => {
    const content = '{\n  "narrative": "Uses \u201cFile: DBnnnn00\u201d interface.",\n  "graph": {"nodes": [], "edges": []},\n  "tables": []\n}';
    const output = normalizeModelOutput(content);
    assert.equal(output.errors.length, 0);
    assert.ok(output.narrative.includes('File: DBnnnn00'));
  });

  it('synthesizes envelope from Markdown capability table', () => {
    const content = '## Overview\n\nSingleview is the billing hub.\n\n```markdown\n| Capability | Responsibility | Purpose | Business Capability Mapping |\n|---|---|---|---|\n| Adjustments | Corrects charges. | Enables corrections. | Billing Adjustments |\n```';
    const output = normalizeModelOutput(content);
    assert.equal(output.errors.length, 0);
    assert.equal(output.tables.length, 1);
    assert.equal(output.tables[0].name, 'capabilities');
    assert.deepStrictEqual(output.tables[0].columns, ['name', 'responsibility', 'purpose', 'business_capability_mapping']);
    assert.equal(output.tables[0].rows.length, 1);
    assert.equal(output.tables[0].rows[0].name, 'Adjustments');
  });
});
