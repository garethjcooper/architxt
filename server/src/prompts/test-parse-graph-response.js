import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseGraphResponse, parseGraphOnlyResponse } from './parse-graph-response.js';

describe('parseGraphResponse', () => {
  it('extracts narrative and graph from contextual envelope', () => {
    const raw = JSON.stringify({
      narrative: 'Singleview is the billing data platform.',
      graph: {
        nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }],
        edges: [{ from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'sends', label: 'usage data' }],
      },
    });
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.narrative, 'Singleview is the billing data platform.');
    assert.strictEqual(result.graph.nodes.length, 1);
    assert.strictEqual(result.graph.edges.length, 1);
    assert.strictEqual(result.graph.nodes[0].id, 'a-com:COM-001');
  });

  it('rejects legacy heading format', () => {
    const raw = `Singleview is the billing data platform.\n\n## ARCHITXT-GRAPH-DATA\n${JSON.stringify({
      nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }],
      edges: [{ from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'sends', label: 'usage data' }],
    })}`;
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.graph.nodes.length, 0);
    assert.strictEqual(result.graph.edges.length, 0);
    assert.ok(result.error);
  });

  it('returns empty graph when envelope graph is empty', () => {
    const result = parseGraphResponse(JSON.stringify({ narrative: 'Only narrative.', graph: { nodes: [], edges: [] } }), { expectGraph: false });
    assert.strictEqual(result.narrative, 'Only narrative.');
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });

  it('parses graph wrapped in a Markdown fence', () => {
    const raw = `\`\`\`json\n${JSON.stringify({
      narrative: '',
      graph: { nodes: [], edges: [] },
    })}\n\`\`\``;
    const result = parseGraphResponse(raw);
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });

  it('returns empty result for null input', () => {
    const result = parseGraphResponse(null);
    assert.strictEqual(result.narrative, '');
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });

  it('rejects non-string input', () => {
    const result = parseGraphResponse({ narrative: 'Hello', graph: { nodes: [], edges: [] } });
    assert.strictEqual(result.narrative, '');
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });

  it('extracts graph from last graph key in envelope', () => {
    const raw = JSON.stringify({
      narrative: '',
      graph: {
        nodes: [{ id: 'a-com:COM-002', name: 'Rating' }],
        edges: [],
      },
    });
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.graph.nodes.length, 1);
    assert.strictEqual(result.graph.nodes[0].id, 'a-com:COM-002');
  });

  it('reports error when graph section contains no usable nodes or edges', () => {
    const raw = JSON.stringify({ narrative: 'Summary.', graph: { unrelated: 'data' } });
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.graph.nodes.length, 0);
    assert.strictEqual(result.graph.edges.length, 0);
    assert.ok(result.error);
  });
});

describe('parseGraphOnlyResponse', () => {
  it('parses graph-only envelope', () => {
    const raw = JSON.stringify({
      graph: {
        nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }],
        edges: [],
      },
    });
    const result = parseGraphOnlyResponse(raw);
    assert.strictEqual(result.narrative, '');
    assert.strictEqual(result.graph.nodes[0].id, 'a-com:COM-001');
  });
});
