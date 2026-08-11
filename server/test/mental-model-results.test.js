import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGraphResponse } from '../src/prompts/parse-graph-response.js';
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

describe('parseGraphResponse (contextual envelope only)', () => {
  it('returns graph and no error for valid mental-model content', () => {
    const content = JSON.stringify({
      narrative: 'ICMS is the invoice system.',
      graph: {
        nodes: [{ id: 'a-com:COM-002', name: 'ICMS' }],
        edges: [{ from: 'a-com:COM-002', to: 'a-com:COM-269', type: 'sends' }],
      },
    });
    const { graph, error, narrative } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'a-com:COM-002');
    assert.equal(graph.nodes[0].source, 'mental_model');
    assert.equal(narrative, 'ICMS is the invoice system.');
  });

  it('reports error for invalid envelope', () => {
    const content = 'Not a JSON envelope.';
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
    assert.ok(error.includes('not a valid contextual JSON envelope'), `expected envelope error, got: ${error}`);
  });

  it('reports no nodes/edges when graph shape is empty', () => {
    const content = JSON.stringify({ narrative: 'Nothing to graph.', graph: { unrelated: 'data' } });
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
    assert.ok(error.includes('no usable nodes or edges'), `expected empty graph error, got: ${error}`);
  });

  it('returns empty graph and no error when JSON parses to empty nodes/edges', () => {
    const content = JSON.stringify({ narrative: '', graph: { nodes: [], edges: [] } });
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.ok(graph, 'expected graph to be returned');
    assert.deepEqual(graph, { nodes: [], edges: [] });
    assert.equal(error, null);
  });

  it('returns empty graph and no error for missing content', () => {
    const { graph, error } = parseGraphResponse(null, { defaultSource: 'mental_model' });
    assert.equal(error, undefined);
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
  });

  it('parses graph wrapped in a Markdown fence', () => {
    const content = `\`\`\`json\n${JSON.stringify({
      narrative: '',
      graph: {
        nodes: [{ id: 'a-svc:SVC-019', name: 'Create Notification v1' }],
        edges: [],
      },
    })}\n\`\`\``;
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'a-svc:SVC-019');
    assert.equal(graph.edges.length, 0);
  });
});
