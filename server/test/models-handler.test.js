import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleModels } from '../src/services/research/handlers/models.js';

const TEST_CONTENT = JSON.stringify({
  narratives: [{ narrative_name: 'Overview', narrative: 'Some narrative text.' }],
  graph: {
    nodes: [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ],
    edges: [
      { from: 'a', to: 'b', type: 'calls', label: 'links to', detail: 'A links to B' },
    ],
  },
});

function parseJsonString(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function extractGraphDataSection(content) {
  const parsed = parseJsonString(content);
  if (!parsed || !parsed.graph || typeof parsed.graph !== 'object') return null;
  return parsed.graph;
}

describe('models handler graph extraction', () => {
  it('finds the graph inside the contextual envelope', () => {
    const section = extractGraphDataSection(TEST_CONTENT);
    assert.ok(section);
    assert.equal(section.nodes.length, 2);
    assert.equal(section.edges.length, 1);
    assert.equal(section.nodes[0].id, 'a');
    assert.equal(section.edges[0].from, 'a');
  });

  it('returns null when the envelope has no graph', () => {
    const section = extractGraphDataSection(JSON.stringify({ narratives: [], narrative: 'Just narrative.' }));
    assert.equal(section, null);
  });
});

describe('models handler integration', () => {
  function makeFetch(content) {
    const structuredOutput = typeof content === 'string' ? parseJsonString(content) : content;
    return async (extId) => ({
      success: true,
      mentalModel: { reflect_response: { structured_output: structuredOutput } },
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

  it('uses the parsed narrative for the merged narrative', async () => {
    const result = await handleModels(1, 'bank', {}, {
      selections: [{ kind: 'model', ext_id: 'MODEL-A', name: 'Model A' }],
      fetchMentalModel: makeFetch(TEST_CONTENT),
    });

    assert.equal(result.success, true);
    assert.equal(result.narratives.length, 1);
    assert.equal(result.narratives[0].narrative_name, 'Overview');
    assert.ok(result.narratives[0].narrative.includes('Some narrative text.'));
  });

  it('returns a merged graph object when multiple models are selected', async () => {
    const result = await handleModels(1, 'bank', {}, {
      selections: [
        { kind: 'model', ext_id: 'MODEL-A', name: 'Model A' },
        { kind: 'model', ext_id: 'MODEL-B', name: 'Model B' },
      ],
      fetchMentalModel: makeFetch(TEST_CONTENT),
    });

    assert.equal(result.success, true);
    assert.ok(result.graph);
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
  });
});
