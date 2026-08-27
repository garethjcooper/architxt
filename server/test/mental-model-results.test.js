import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelOutput } from '../src/services/contextual-graph/normalize-model-output.js';
import { extractGraph } from '../src/prompts/graph-parser.js';

describe('graph-parser.extractGraph (defensive helper)', () => {
  it('parses the contextual graph envelope', () => {
    const content = JSON.stringify({
      narrative: '',
      graph: {
        nodes: [{ id: 'a-com:COM-002', name: 'ICMS' }],
        edges: [{ from: 'a-com:COM-002', to: 'a-com:COM-269', type: 'sends', detail: 'ICMS sends billable events' }],
      },
    });
    const graph = extractGraph(content);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'a-com:COM-002');
    assert.equal(graph.nodes[0].name, 'ICMS');
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].type, 'sends');
    assert.equal(graph.edges[0].detail, 'ICMS sends billable events');
    assert.equal(graph.edges[0].from, 'a-com:COM-002');
    assert.equal(graph.edges[0].to, 'a-com:COM-269');
  });

  it('returns null for truncated JSON', () => {
    const content = '{\n  "graph": {\n    "nodes": [\n      { "id": "a-com:COM-002" }\n    ]';
    assert.equal(extractGraph(content), null);
  });
});

describe('normalizeModelOutput (contextual envelope)', () => {
  it('returns graph and no errors for valid mental-model content', () => {
    const content = JSON.stringify({
      narrative: 'ICMS is the invoice system.',
      graph: {
        nodes: [{ id: 'a-com:COM-002', name: 'ICMS' }],
        edges: [{ from: 'a-com:COM-002', to: 'a-com:COM-269', type: 'sends' }],
      },
      tables: [],
      diagrams: [],
    });
    const { graph, errors, narrative } = normalizeModelOutput(content);
    assert.equal(errors.length, 0);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'a-com:COM-002');
    assert.equal(narrative, 'ICMS is the invoice system.');
  });

  it('reports errors for invalid envelope', () => {
    const content = 'Not a JSON envelope.';
    const { graph, errors } = normalizeModelOutput(content);
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
    assert.ok(errors.length > 0, `expected errors, got: ${errors.join('; ')}`);
  });

  it('returns empty graph when graph shape is empty', () => {
    const content = JSON.stringify({ narrative: 'Nothing to graph.', graph: { unrelated: 'data' }, tables: [],
      diagrams: [] });
    const { graph, errors } = normalizeModelOutput(content);
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
  });

  it('returns empty graph when JSON parses to empty nodes/edges', () => {
    const content = JSON.stringify({ narrative: '', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] });
    const { graph, errors } = normalizeModelOutput(content);
    assert.ok(graph, 'expected graph to be returned');
    assert.deepEqual(graph, { name: '', nodes: [], edges: [] });
    assert.equal(errors.length, 0);
  });

  it('returns empty graph for missing content', () => {
    const { graph, errors } = normalizeModelOutput(null);
    assert.equal(errors.length, 0);
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
  });

  it('parses graph wrapped in a Markdown fence', () => {
    const content = `\`\`\`json\n${JSON.stringify({
      narrative: '',
      graph: {
        nodes: [{ id: 'a-svc:SVC-019', name: 'Create Notification v1' }],
        edges: [{ from: 'a-svc:SVC-019', to: 'a-svc:SVC-020', type: 'sends' }],
      },
      tables: [],
      diagrams: [],
    })}\n\`\`\``;
    const { graph, errors } = normalizeModelOutput(content);
    assert.equal(errors.length, 0);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'a-svc:SVC-019');
    assert.equal(graph.edges.length, 1);
  });
});
