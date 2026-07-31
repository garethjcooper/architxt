import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleModels } from '../src/services/research/handlers/models.js';

const TEST_CONTENT = `Some narrative text.

## ARCHITXT-GRAPH-DATA

\`\`\`json
{
  "nodes": [
    {"id": "a", "name": "Alpha"},
    {"id": "b", "name": "Beta"}
  ],
  "edges": [
    {"from": "a", "to": "b", "type": "calls", "label": "links to", "detail": "A links to B"}
  ]
}
\`\`\`

Footer text.
`;

const GRAPH_DATA_HEADING_RE = /^(#{1,6}\s*)?ARCHITXT-GRAPH-DATA\s*$/mi;
const CODE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/g;

function parseJsonString(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenceFree = trimmed.replace(CODE_FENCE_RE, '$1').trim();
  const candidates = [fenceFree, trimmed];
  const looseMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (looseMatch && !candidates.includes(looseMatch[1])) {
    candidates.push(looseMatch[1]);
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // continue
    }
  }
  return null;
}

function extractGraphDataSection(content) {
  if (!content || typeof content !== 'string') return null;
  const match = content.match(GRAPH_DATA_HEADING_RE);
  if (!match || match.index === undefined) return null;
  let section = content.slice(match.index);
  const nextHeadingMatch = section.slice(1).match(/\n#{1,6}\s/);
  if (nextHeadingMatch && nextHeadingMatch.index !== undefined) {
    section = section.slice(0, nextHeadingMatch.index + 1);
  }
  const parsed = parseJsonString(section);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

describe('models handler GRAPH-DATA extraction', () => {
  it('finds the section and parses nodes/edges', () => {
    const section = extractGraphDataSection(TEST_CONTENT);
    assert.ok(section);
    assert.equal(section.nodes.length, 2);
    assert.equal(section.edges.length, 1);
    assert.equal(section.nodes[0].id, 'a');
    assert.equal(section.edges[0].from, 'a');
  });

  it('finds the ARCHITXT-GRAPH-DATA heading', () => {
    const section = extractGraphDataSection(TEST_CONTENT);
    assert.ok(section);
    assert.equal(section.nodes.length, 2);
  });

  it('returns null when no ARCHITXT-GRAPH-DATA heading exists', () => {
    const section = extractGraphDataSection('Just some narrative without graph data.');
    assert.equal(section, null);
  });
});

describe('models handler integration', () => {
  function makeFetch(content) {
    return async (extId) => ({
      success: true,
      mentalModel: { content },
    });
  }

  it('returns a merged graph object for a single model', async () => {
    const result = await handleModels(1, 'bank', {}, {
      selections: [{ kind: 'model', ext_id: 'MODEL-A', name: 'Model A' }],
      fetchMentalModel: makeFetch(TEST_CONTENT),
    });

    assert.equal(result.success, true);
    assert.ok(result.graph);
    assert.equal(Array.isArray(result.graph), false);
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
    assert.equal(result.graph.nodes[0].id, 'a');
  });

  it('returns a merged graph object when concatenation is compile', async () => {
    const result = await handleModels(1, 'bank', {}, {
      selections: [
        { kind: 'model', ext_id: 'MODEL-A', name: 'Model A', concatenation: 'compile' },
        { kind: 'model', ext_id: 'MODEL-B', name: 'Model B', concatenation: 'compile' },
      ],
      fetchMentalModel: makeFetch(TEST_CONTENT),
    });

    assert.equal(result.success, true);
    assert.ok(result.graph);
    assert.equal(Array.isArray(result.graph), false);
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
  });
});
