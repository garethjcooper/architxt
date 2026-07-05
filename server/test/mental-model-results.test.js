import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGraph,
  tryExtractGraph,
} from '../src/services/research/mental-model-results.js';

describe('mental-model-results.extractGraph', () => {
  it('parses a valid nodes/edges JSON string', () => {
    const content = JSON.stringify({
      nodes: [{ entity: 'a-com:COM-002', entity_name: 'ICMS' }],
      edges: [{ source: 'a-com:COM-002', target: 'a-com:COM-269', edge_type: 'sends' }],
    });
    const graph = extractGraph(content);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'a-com:COM-002');
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].relationship_type, 'sends');
  });

  it('returns null for truncated JSON', () => {
    const content = '{\n  "nodes": [\n    { "entity": "a-com:COM-002" }\n  ]';
    assert.equal(extractGraph(content), null);
  });
});

describe('mental-model-results.tryExtractGraph', () => {
  it('returns graph and no error for valid content', () => {
    const content = JSON.stringify({
      nodes: [{ entity: 'a-com:COM-002', entity_name: 'ICMS' }],
      edges: [{ source: 'a-com:COM-002', target: 'a-com:COM-269', edge_type: 'sends' }],
    });
    const { graph, error } = tryExtractGraph(content);
    assert.ok(graph);
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 1);
  });

  it('reports truncation error for incomplete JSON', () => {
    const content = '{\n  "nodes": [\n    { "entity": "a-com:COM-002" }\n  ]';
    const { graph, error } = tryExtractGraph(content);
    assert.equal(graph, null);
    assert.ok(error.includes('truncated'), `expected truncation error, got: ${error}`);
  });

  it('reports no nodes/edges when JSON parses but graph shape is empty', () => {
    const content = JSON.stringify({ unrelated: 'data' });
    const { graph, error } = tryExtractGraph(content);
    assert.equal(graph, null);
    assert.ok(error.includes('no usable nodes or edges'), `expected empty graph error, got: ${error}`);
  });

  it('returns null error for missing content', () => {
    const { graph, error } = tryExtractGraph(null);
    assert.equal(graph, null);
    assert.equal(error, null);
  });

  it('reports parse error for non-JSON string that looks like JSON', () => {
    const content = '{"nodes": [';
    const { graph, error } = tryExtractGraph(content);
    assert.equal(graph, null);
    assert.ok(error.includes('truncated'), `expected error, got: ${error}`);
  });
});
