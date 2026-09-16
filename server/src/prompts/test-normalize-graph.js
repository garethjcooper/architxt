import assert from 'node:assert';
import { describe, it } from 'node:test';
import { normalizeGraph, normalizeSlug, VALID_EDGE_TYPES } from './normalize-graph.js';

describe('normalizeGraph', () => {
  it('keeps valid nodes and edges', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }, { id: 'a-svc:SVC-005', name: 'Rating' }],
      edges: [{ from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'sends', label: 'usage data', detail: 'events' }],
    }, { activity: 'reflect' });
    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.edges.length, 1);
    assert.strictEqual(result.edges[0].provenance, 'known');
  });

  it('derives discovered provenance from discovered endpoint', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }, { id: 'payment-gateway', name: 'Payment Gateway', provenance: 'discovered' }],
      edges: [{ from: 'a-com:COM-001', to: 'payment-gateway', type: 'sends', label: 'charges' }],
    }, { activity: 'reflect' });
    assert.strictEqual(result.edges[0].provenance, 'discovered');
  });

  it('derives inferred provenance for synthesis', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }, { id: 'a-svc:SVC-005', name: 'Rating' }],
      edges: [{ from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'reads', label: 'data' }],
    }, { activity: 'synthesize' });
    assert.strictEqual(result.edges[0].provenance, 'inferred');
  });

  it('collapses duplicate edges by (from, to, type)', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }, { id: 'a-svc:SVC-005', name: 'Rating' }],
      edges: [
        { from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'sends', label: 'usage data', detail: 'A' },
        { from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'sends', label: 'events', detail: 'B' },
      ],
    });
    assert.strictEqual(result.edges.length, 1);
    assert.strictEqual(result.edges[0].label, 'usage data; events');
    assert.strictEqual(result.edges[0].detail, 'A; B');
  });

  it('normalizes bare slugs', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'Payment Gateway!', name: 'Payment Gateway' }],
      edges: [],
    });
    assert.strictEqual(result.nodes[0].id, 'payment-gateway');
  });

  it('skips nodes without id', () => {
    const result = normalizeGraph({
      nodes: [{ name: 'No id' }],
      edges: [],
    });
    assert.strictEqual(result.nodes.length, 0);
  });

  it('warns but keeps unknown known-format id', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'a-com:COM-999', name: 'Unknown' }],
      edges: [],
    }, { knownCatalog: new Map() });
    assert.strictEqual(result.nodes.length, 1);
  });

  it('completes missing known endpoint node from catalog', () => {
    const knownCatalog = new Map([
      ['a-com:COM-011', { id: 'a-com:COM-011', type: 'a-com', name: 'BAKB' }],
    ]);
    const result = normalizeGraph({
      nodes: [
        { id: 'billdb-fuse-rendered-invoice', name: 'Rendered Invoice Flow', provenance: 'discovered' },
      ],
      edges: [
        { from: 'a-com:COM-011', to: 'billdb-fuse-rendered-invoice', type: 'sends' },
      ],
    }, { activity: 'reflect', knownCatalog });
    assert.strictEqual(result.nodes.length, 2);
    const knownNode = result.nodes.find((n) => n.id === 'a-com:COM-011');
    assert.ok(knownNode);
    assert.strictEqual(knownNode.name, 'BAKB');
    assert.strictEqual(knownNode.provenance, 'known');
    assert.strictEqual(result.edges.length, 1);
    assert.strictEqual(result.edges[0].provenance, 'discovered');
  });

  it('preserves node label, type, provenance and source', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'alpha', name: 'Alpha', label: 'A', type: 'service', provenance: 'discovered', source: 'llm' }],
      edges: [],
    }, { });
    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].label, 'A');
    assert.strictEqual(result.nodes[0].type, 'service');
    assert.strictEqual(result.nodes[0].provenance, 'discovered');
    assert.strictEqual(result.nodes[0].source, 'llm');
  });

  it('allows discovered nodes in discovery mode', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'beta', name: 'Beta', provenance: 'discovered' }],
      edges: [],
    }, { });
    assert.strictEqual(result.nodes.length, 1);
    assert.strictEqual(result.nodes[0].id, 'beta');
  });

  it('preserves discovered nodes', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'gamma', name: 'Gamma', provenance: 'discovered' }],
      edges: [],
    }, { });
    assert.strictEqual(result.nodes.length, 1);
  });

  it('keeps both edges when endpoints exist', () => {
    const result = normalizeGraph({
      nodes: [
        { id: 'a-com:COM-001', name: 'Known' },
        { id: 'delta', name: 'Delta', provenance: 'discovered' },
      ],
      edges: [
        { from: 'a-com:COM-001', to: 'a-com:COM-001', type: 'depends-on' },
        { from: 'a-com:COM-001', to: 'delta', type: 'sends' },
      ],
    }, { });
    assert.strictEqual(result.edges.length, 2);
    assert.strictEqual(result.edges[0].to, 'a-com:COM-001');
    assert.strictEqual(result.edges[1].to, 'delta');
  });


  it('preserves mental-model edges when both endpoints are present in nodes', () => {
    const result = normalizeGraph({
      name: 'Intermediate to Fuse flows',
      nodes: [
        { id: 'a-com:COM-019', name: 'Intermediate' },
        { id: 'a-com:COM-049', name: 'Fuse' },
      ],
      edges: [
        {
          from: 'a-com:COM-019',
          to: 'a-com:COM-049',
          type: 'sends',
          label: 'usage events',
          detail: 'Intermediate distributes usage event data to Fuse.',
          properties: { dataObjects: ['usage events'] },
          evidence: ['a84faf98', 'entity-summary-a-com:COM-019'],
        },
      ],
    }, { activity: 'mental-model', knownCatalog: new Map() });
    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.edges.length, 1);
    assert.strictEqual(result.edges[0].from, 'a-com:COM-019');
    assert.strictEqual(result.edges[0].to, 'a-com:COM-049');
    assert.strictEqual(result.edges[0].provenance, 'known');
    assert.deepStrictEqual(result.edges[0].evidence, ['a84faf98', 'entity-summary-a-com:COM-019']);
  });

  it('preserves short evidence IDs without silently dropping them', () => {
    const result = normalizeGraph({
      nodes: [{ id: 'a-com:COM-019', name: 'Intermediate' }, { id: 'a-com:COM-049', name: 'Fuse' }],
      edges: [{ from: 'a-com:COM-019', to: 'a-com:COM-049', type: 'sends', evidence: ['a84faf98'] }],
    }, { activity: 'mental-model', knownCatalog: new Map() });
    assert.deepStrictEqual(result.edges[0].evidence, ['a84faf98']);
  });

  it('completes missing mental-model endpoint from known catalog', () => {
    const knownCatalog = new Map([
      ['a-com:COM-049', { id: 'a-com:COM-049', type: 'a-com', name: 'Fuse' }],
    ]);
    const result = normalizeGraph({
      name: 'Intermediate to Fuse flows',
      nodes: [{ id: 'a-com:COM-019', name: 'Intermediate' }],
      edges: [{ from: 'a-com:COM-019', to: 'a-com:COM-049', type: 'sends', label: 'usage events' }],
    }, { activity: 'mental-model', knownCatalog });
    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.edges.length, 1);
    const fuse = result.nodes.find((n) => n.id === 'a-com:COM-049');
    assert.ok(fuse);
    assert.strictEqual(fuse.name, 'Fuse');
    assert.strictEqual(fuse.provenance, 'known');
  });
});

describe('normalizeSlug', () => {
  it('lowercases and hyphenates', () => {
    assert.strictEqual(normalizeSlug('Payment Gateway!'), 'payment-gateway');
  });

  it('falls back to provided name', () => {
    assert.strictEqual(normalizeSlug('', 'Some Thing'), 'some-thing');
  });

  it('caps length', () => {
    const long = 'a'.repeat(100);
    assert.strictEqual(normalizeSlug(long).length, 64);
  });
});

describe('edge vocabulary', () => {
  it('contains the expected types', () => {
    assert(VALID_EDGE_TYPES.has('calls'));
    assert(VALID_EDGE_TYPES.has('sends'));
    assert(VALID_EDGE_TYPES.has('reads'));
    assert(VALID_EDGE_TYPES.has('writes'));
    assert(VALID_EDGE_TYPES.has('depends-on'));
  });
});
