import assert from 'node:assert';
import { describe, it } from 'node:test';
import { parseGraphResponse, parseGraphOnlyResponse } from './parse-graph-response.js';

describe('parseGraphResponse', () => {
  it('extracts narrative and graph from universal format', () => {
    const raw = `Singleview is the billing data platform.

## ARCHITXT-GRAPH-DATA
{"nodes":[{"id":"a-com:COM-001","name":"Singleview"}],"edges":[{"from":"a-com:COM-001","to":"a-svc:SVC-005","type":"sends","label":"usage data"}]}`;
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.narrative, 'Singleview is the billing data platform.');
    assert.strictEqual(result.graph.nodes.length, 1);
    assert.strictEqual(result.graph.edges.length, 1);
    assert.strictEqual(result.graph.nodes[0].id, 'a-com:COM-001');
  });

  it('parses heading with non-ASCII dashes (U+2011 non-breaking hyphen)', () => {
    const raw = `Summary.

## ARCHITXT\u2011GRAPH\u2011DATA
\`\`\`json
{"nodes":[{"id":"found:payment-gateway","name":"Payment Gateway"}],"edges":[{"from":"a-com:COM-002","to":"found:payment-gateway","type":"sends"}]}
\`\`\``;
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.narrative, 'Summary.');
    assert.strictEqual(result.graph.nodes.length, 1);
    assert.strictEqual(result.graph.nodes[0].id, 'found:payment-gateway');
    assert.strictEqual(result.graph.edges.length, 1);
  });

  it('parses heading with mixed ASCII and Unicode dashes', () => {
    const raw = `## ARCHITXT\u2011GRAPH-DATA
{"nodes":[{"id":"a-com:COM-001","name":"Singleview"}],"edges":[]}`;
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.graph.nodes.length, 1);
    assert.strictEqual(result.graph.nodes[0].id, 'a-com:COM-001');
  });

  it('returns empty graph when heading is missing and expectGraph is false', () => {
    const result = parseGraphResponse('Only narrative.', { expectGraph: false });
    assert.strictEqual(result.narrative, 'Only narrative.');
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });

  it('parses graph wrapped in a Markdown fence', () => {
    const raw = `## ARCHITXT-GRAPH-DATA
\`\`\`json
{"nodes":[],"edges":[]}
\`\`\``;
    const result = parseGraphResponse(raw);
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });

  it('returns empty result for null input', () => {
    const result = parseGraphResponse(null);
    assert.strictEqual(result.narrative, '');
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });

  it('uses last occurrence of heading', () => {
    const raw = `first
## ARCHITXT-GRAPH-DATA
{"nodes":[],"edges":[]}
second
## ARCHITXT-GRAPH-DATA
{"nodes":[{"id":"a-com:COM-002","name":"Rating"}],"edges":[]}`;
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.graph.nodes.length, 1);
    assert.strictEqual(result.graph.nodes[0].id, 'a-com:COM-002');
  });

  it('extracts graph even with trailing narrative after the JSON block', () => {
    const raw = `Summary.

## ARCHITXT-GRAPH-DATA
{"nodes":[{"id":"found:invoice-delivery-interface","name":"Invoice Delivery Interface"}],"edges":[{"from":"a-com:COM-011","to":"found:invoice-delivery-interface","type":"sends"}]}

More text after the graph.`;
    const result = parseGraphResponse(raw);
    assert.strictEqual(result.graph.nodes.length, 1);
    assert.strictEqual(result.graph.nodes[0].id, 'found:invoice-delivery-interface');
    assert.strictEqual(result.graph.edges.length, 1);
  });

  it('rejects non-string input', () => {
    const result = parseGraphResponse({ narrative: 'Hello\n\n## ARCHITXT-GRAPH-DATA\n{"nodes":[],"edges":[]}' });
    assert.strictEqual(result.narrative, '');
    assert.deepStrictEqual(result.graph, { nodes: [], edges: [] });
  });
});

describe('parseGraphOnlyResponse', () => {
  it('parses graph-only response', () => {
    const raw = `## ARCHITXT-GRAPH-DATA
{"nodes":[{"id":"a-com:COM-001","name":"Singleview"}],"edges":[]}`;
    const result = parseGraphOnlyResponse(raw);
    assert.strictEqual(result.narrative, '');
    assert.strictEqual(result.graph.nodes[0].id, 'a-com:COM-001');
  });
});
