import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { edgeContextTableToGraph, deriveEdgeContextEdges } from '../src/services/contextual-graph/table-to-edges.js';

const EMPTY_PROPERTIES = {
  protocol: '',
  format: '',
  frequency: '',
  auth: '',
  encryption: '',
};

describe('edgeContextTableToGraph', () => {
  it('converts table rows to graph edges', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'],
      rows: [
        ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Detail one.', '-', ['e1']],
        ['a-com:COM-002', 'a-com:COM-001', 'sends', 'Postal address data', 'Detail two.', 'nightly', ['e2', 'e3']],
      ],
      evidence: [],
    };

    const { nodes, edges } = edgeContextTableToGraph(table);

    assert.equal(nodes.length, 2);
    assert.equal(edges.length, 2);

    assert.deepEqual(edges[0], {
      from: 'a-com:COM-001',
      to: 'a-com:COM-002',
      type: 'sends',
      label: 'Usage rating feed',
      detail: 'Detail one.',
      evidence: ['e1'],
      properties: { ...EMPTY_PROPERTIES, frequency: '' },
    });

    assert.deepEqual(edges[1], {
      from: 'a-com:COM-002',
      to: 'a-com:COM-001',
      type: 'sends',
      label: 'Postal address data',
      detail: 'Detail two.',
      evidence: ['e2', 'e3'],
      properties: { ...EMPTY_PROPERTIES, frequency: 'nightly' },
    });
  });

  it('converts "-" placeholders to empty strings in edge properties', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence', 'protocol', 'auth', 'encryption', 'format'],
      rows: [
        ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Detail one.', '-', ['e1'], '-', '-', '-', 'BLINCL feed'],
      ],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.equal(edges.length, 1);
    assert.deepEqual(edges[0].properties, {
      ...EMPTY_PROPERTIES,
      format: 'BLINCL feed',
    });
  });

  it('carries protocol, auth and encryption columns through to edge properties', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence', 'protocol', 'auth', 'encryption'],
      rows: [
        ['a-com:COM-001', 'a-com:COM-002', 'sends', 'Usage rating feed', 'Detail one.', '-', ['e1'], 'HTTPS', 'OAuth2', 'TLS1.3'],
      ],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.equal(edges.length, 1);
    assert.deepEqual(edges[0].properties, {
      ...EMPTY_PROPERTIES,
      protocol: 'HTTPS',
      auth: 'OAuth2',
      encryption: 'TLS1.3',
    });
  });

  it('carries protocol, auth and encryption from object rows', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'protocol', 'auth', 'encryption'],
      rows: [{
        from: 'a-com:COM-001',
        to: 'a-com:COM-002',
        type: 'sends',
        label: 'Usage rating feed',
        protocol: 'gRPC',
        auth: 'mTLS',
        encryption: 'TLS1.3',
      }],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.equal(edges.length, 1);
    assert.deepEqual(edges[0].properties, {
      ...EMPTY_PROPERTIES,
      protocol: 'gRPC',
      auth: 'mTLS',
      encryption: 'TLS1.3',
    });
  });

  it('handles column reordering', () => {
    const table = {
      name: 'edge-context',
      columns: ['evidence', 'type', 'from', 'to', 'detail', 'label', 'frequency'],
      rows: [['e1', 'sends', 'a-com:COM-001', 'a-com:COM-002', 'Detail.', 'Label', '-']],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].from, 'a-com:COM-001');
    assert.equal(edges[0].to, 'a-com:COM-002');
    assert.equal(edges[0].type, 'sends');
    assert.equal(edges[0].label, 'Label');
    assert.equal(edges[0].detail, 'Detail.');
    assert.deepEqual(edges[0].properties, { ...EMPTY_PROPERTIES, frequency: '' });
    assert.deepEqual(edges[0].evidence, ['e1']);
  });

  it('returns empty graph when required columns are missing', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'label'],
      rows: [['a-com:COM-001', 'foo']],
      evidence: [],
    };

    const result = edgeContextTableToGraph(table);
    assert.equal(result.nodes.length, 0);
    assert.equal(result.edges.length, 0);
  });

  it('skips rows with missing endpoints or type', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'],
      rows: [
        ['a-com:COM-001', 'a-com:COM-002', 'sends', 'OK', 'ok', '-', []],
        ['', 'a-com:COM-002', 'sends', 'Bad from', 'bad', '-', []],
        ['a-com:COM-001', '', 'sends', 'Bad to', 'bad', '-', []],
        ['a-com:COM-001', 'a-com:COM-002', '', 'Bad type', 'bad', '-', []],
      ],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].label, 'OK');
    assert.deepEqual(edges[0].properties, { ...EMPTY_PROPERTIES, frequency: '' });
  });

  it('treats string evidence as a single-item array', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'],
      rows: [['a-com:COM-001', 'a-com:COM-002', 'sends', 'L', 'D', '-', 'e1']],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.deepEqual(edges[0].evidence, ['e1']);
  });

  it('converts object rows keyed by column name', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'],
      rows: [{
        from: 'a-com:COM-001',
        to: 'a-com:COM-002',
        type: 'sends',
        label: 'L',
        detail: 'D',
        frequency: 'hourly',
        evidence: ['e1'],
      }],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.equal(edges.length, 1);
    assert.equal(edges[0].label, 'L');
    assert.equal(edges[0].detail, 'D');
    assert.deepEqual(edges[0].evidence, ['e1']);
    assert.deepEqual(edges[0].properties, { ...EMPTY_PROPERTIES, frequency: 'hourly' });
  });

  it('carries arbitrary extra columns through to edge properties', () => {
    const table = {
      name: 'edge-context',
      columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence', 'reliability', 'intermediaries'],
      rows: [[
        'a-com:COM-001', 'a-com:COM-002', 'sends', 'L', 'D', '-', ['e1'],
        'at-least-once', ['mq-bridge'],
      ]],
      evidence: [],
    };

    const { edges } = edgeContextTableToGraph(table);
    assert.deepEqual(edges[0].properties, {
      ...EMPTY_PROPERTIES,
      frequency: '',
      reliability: 'at-least-once',
      intermediaries: ['mq-bridge'],
    });
  });
});

describe('deriveEdgeContextEdges', () => {
  it('prefers tables over graph edges', () => {
    const output = {
      tables: [{
        name: 'edge-context',
        columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'],
        rows: [['a-com:COM-001', 'a-com:COM-002', 'sends', 'L', 'D', '-', ['e1']]],
        evidence: [],
      }],
      graph: { nodes: [], edges: [{ from: 'x', to: 'y', type: 'calls', label: 'ignored' }] },
    };

    const result = deriveEdgeContextEdges(output);
    assert.equal(result.source, 'table');
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].from, 'a-com:COM-001');
  });

  it('falls back to graph edges when no tables exist', () => {
    const output = {
      tables: [],
      graph: {
        nodes: [],
        edges: [{ from: 'a-com:COM-001', to: 'a-com:COM-002', type: 'calls', label: 'L', detail: 'D', evidence: ['e1'], properties: {} }],
      },
    };

    const result = deriveEdgeContextEdges(output);
    assert.equal(result.source, 'graph');
    assert.equal(result.edges.length, 1);
  });

  it('does not fall back to graph when a table is present but has no rows', () => {
    const output = {
      tables: [{
        name: 'edge-context',
        columns: ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'],
        rows: [],
        evidence: [],
      }],
      graph: { nodes: [], edges: [{ from: 'x', to: 'y', type: 'calls', label: 'ignored' }] },
    };

    const result = deriveEdgeContextEdges(output);
    assert.equal(result.source, 'table');
    assert.equal(result.edges.length, 0);
  });
});
