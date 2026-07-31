import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGraphResponse } from '../src/prompts/parse-graph-response.js';
import { extractGraph } from '../src/prompts/graph-parser.js';

describe('graph-parser.extractGraph (defensive helper)', () => {
  it('parses the universal graph format', () => {
    const content = JSON.stringify({
      nodes: [{ id: 'a-com:COM-002', name: 'ICMS' }],
      edges: [{ from: 'a-com:COM-002', to: 'a-com:COM-269', type: 'sends', detail: 'ICMS sends billable events' }],
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
    const content = '{\n  "nodes": [\n    { "id": "a-com:COM-002" }\n  ]';
    assert.equal(extractGraph(content), null);
  });
});

describe('parseGraphResponse (unified gateway)', () => {
  it('returns graph and no error for valid mental-model content', () => {
    const content = JSON.stringify({
      nodes: [{ id: 'a-com:COM-002', name: 'ICMS' }],
      edges: [{ from: 'a-com:COM-002', to: 'a-com:COM-269', type: 'sends' }],
    });
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].id, 'a-com:COM-002');
    assert.equal(graph.nodes[0].source, 'mental_model');
  });

  it('reports truncation error for incomplete JSON', () => {
    const content = '{\n  "nodes": [\n    { "id": "a-com:COM-002" }\n  ]';
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
    assert.ok(error.includes('no usable nodes or edges'), `expected empty graph error, got: ${error}`);
  });

  it('reports no nodes/edges when JSON parses but graph shape is empty', () => {
    const content = JSON.stringify({ unrelated: 'data' });
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
    assert.ok(error.includes('no usable nodes or edges'), `expected empty graph error, got: ${error}`);
  });

  it('returns empty graph and no error when JSON parses to empty nodes/edges', () => {
    const content = JSON.stringify({ nodes: [], edges: [] });
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

  it('reports parse error for non-JSON string that looks like JSON', () => {
    const content = '{"nodes": [';
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
    assert.ok(error.includes('no usable nodes or edges'), `expected error, got: ${error}`);
  });

  it('extracts graph under ARCHITXT-GRAPH-DATA heading', () => {
    const content = `## ARCHITXT-GRAPH-DATA\n\n${JSON.stringify({
      nodes: [{ id: 'a-com:COM-024', name: 'Siebel CRM', provenance: 'known', source: 'known' }],
      edges: [{ from: 'found:data-stage', to: 'a-com:COM-024', type: 'sends', label: 'bulk load file' }],
    })}`;
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.edges.length, 1);
  });

  it('extracts graph when JSON is wrapped in ```json after the heading', () => {
    const graphObj = {
      nodes: [
        { id: 'found:mtas', name: 'MTAS', provenance: 'discovered' },
        { id: 'found:consumer', name: 'Consumer', provenance: 'discovered' },
        { id: 'a-com:COM-001', name: 'Singleview', provenance: 'known', source: 'known' },
      ],
      edges: [
        { from: 'found:mtas', to: 'a-com:COM-001', type: 'calls', label: 'Ro interface', detail: 'MTAS calls Singleview via the Diameter Ro interface to reserve and accumulate usage units.' },
        { from: 'a-com:COM-001', to: 'found:consumer', type: 'sends', label: 'api data', detail: 'Singleview sends processed billing and rating data to downstream Consumer applications.' },
      ],
    };
    const content = `## ARCHITXT-GRAPH-DATA\n\n\`\`\`json\n${JSON.stringify(graphObj)}\n\`\`\``;
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 3);
    assert.equal(graph.edges.length, 2);
  });

  it('extracts graph when the whole response is wrapped in ```markdown', () => {
    const graphObj = {
      nodes: [{ id: 'found:external-order-originator', name: 'External Order Originator', provenance: 'discovered' }, { id: 'a-svc:SVC-226', name: 'Submit Service Order v3', provenance: 'known', source: 'known' }],
      edges: [{ from: 'found:external-order-originator', to: 'a-svc:SVC-226', type: 'calls', label: 'submit order', detail: 'External systems (e.g., O2) invoke submitserviceorderv3 to process service orders via its REST API.' }],
    };
    const content = `\`\`\`markdown\n## ARCHITXT-GRAPH-DATA\n\n\`\`\`json\n${JSON.stringify(graphObj)}\n\`\`\`\n\`\`\``;
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 1);
  });

  it('extracts graph from ```json block without a heading', () => {
    const graphObj = {
      nodes: [{ id: 'a-svc:SVC-019', name: 'Create Notification v1' }],
      edges: [],
    };
    const content = `\`\`\`json\n${JSON.stringify(graphObj)}\n\`\`\``;
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.edges.length, 0);
  });

  it('extracts empty graph wrapped in ```json after the heading', () => {
    const content = `## ARCHITXT-GRAPH-DATA\n\n\`\`\`json\n${JSON.stringify({ nodes: [], edges: [] })}\n\`\`\``;
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.deepEqual(graph, { nodes: [], edges: [] });
  });

  it('extracts empty graph without a heading and wrapped in ```json', () => {
    const content = `\`\`\`json\n${JSON.stringify({ nodes: [], edges: [] })}\n\`\`\``;
    const { graph, error } = parseGraphResponse(content, { defaultSource: 'mental_model' });
    assert.equal(error, null);
    assert.deepEqual(graph, { nodes: [], edges: [] });
  });
});
