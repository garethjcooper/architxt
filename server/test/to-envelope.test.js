import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toEnvelope, toEnvelopeWithFallback } from '../src/services/contextual-graph/to-envelope.js';
import { config } from '../src/config.js';

describe('toEnvelope', () => {
  it('backfills empty narrative_name from the first sentence', () => {
    const envelope = toEnvelope({
      narratives: [{ narrative_name: '', narrative: 'The billing service handles customer invoices.' }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });

    assert.equal(envelope.narratives.length, 1);
    assert.equal(envelope.narratives[0].narrative_name, 'The billing service handles customer invoices');
    assert.equal(envelope.narratives[0].narrative, 'The billing service handles customer invoices.');
    assert.deepEqual(envelope.narratives[0].evidence, []);
  });

  it('keeps a provided narrative_name unchanged', () => {
    const envelope = toEnvelope({
      narratives: [{ narrative_name: 'Overview', narrative: 'Some text.' }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });

    assert.equal(envelope.narratives[0].narrative_name, 'Overview');
    assert.deepEqual(envelope.narratives[0].evidence, []);
  });

  it('backfills from a markdown heading when present', () => {
    const envelope = toEnvelope({
      narratives: [{ narrative_name: '', narrative: '## Architecture\n\nThe system has three layers.' }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });

    assert.equal(envelope.narratives[0].narrative_name, 'Architecture');
  });

  it('backfills from a standalone bold line', () => {
    const envelope = toEnvelope({
      narratives: [{ narrative_name: '', narrative: '**Core Role**\n\nThis component orchestrates events.' }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });

    assert.equal(envelope.narratives[0].narrative_name, 'Core Role');
  });

  it('uses "Narrative" as a last resort when the body has content but no inferable name', () => {
    const envelope = toEnvelope({
      narratives: [{ narrative_name: '', narrative: '   ' }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });

    assert.equal(envelope.narratives[0].narrative_name, 'Narrative');
  });

  it('normalizes legacy singular narrative field into narratives array', () => {
    const envelope = toEnvelope({
      narrative: '# Legacy summary\n\nSome text.',
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });

    assert.equal(envelope.narratives.length, 1);
    assert.equal(envelope.narratives[0].narrative_name, '');
    assert.equal(envelope.narratives[0].narrative, '# Legacy summary\n\nSome text.');
  });
});

describe('toEnvelopeWithFallback', () => {
  const originalFlag = config.mentalModel?.noStructuredOutputFallbackContent;

  it('prefers structured_output and does not mark fallback when present', () => {
    const structured = {
      narratives: [{ narrative_name: 'Overview', narrative: 'Direct output.', evidence: [] }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    };

    const { envelope, usedFallback } = toEnvelopeWithFallback({ structured_output: structured });

    assert.equal(usedFallback, false);
    assert.equal(envelope.narratives.length, 1);
    assert.equal(envelope.narratives[0].narrative, 'Direct output.');
  });

  it('returns empty envelope when fallback is disabled and structured_output is missing', () => {
    config.mentalModel = { ...config.mentalModel, noStructuredOutputFallbackContent: false };

    const { envelope, usedFallback } = toEnvelopeWithFallback({ content: '{"narratives": [{"narrative_name":"X","narrative":"Y","evidence":[]}],"graph":{"nodes":[],"edges":[]},"tables":[],"diagrams":[]}' });

    assert.equal(usedFallback, false);
    assert.equal(envelope.narratives.length, 0);
  });

  it('falls back to plain JSON content when enabled and structured_output is missing', () => {
    config.mentalModel = { ...config.mentalModel, noStructuredOutputFallbackContent: true };

    const content = JSON.stringify({
      narratives: [{ narrative_name: 'Fallback', narrative: 'From content.', evidence: [] }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });

    const { envelope, usedFallback } = toEnvelopeWithFallback({ content });

    assert.equal(usedFallback, true);
    assert.equal(envelope.narratives.length, 1);
    assert.equal(envelope.narratives[0].narrative, 'From content.');
  });

  it('falls back to fenced JSON content when enabled', () => {
    config.mentalModel = { ...config.mentalModel, noStructuredOutputFallbackContent: true };

    const content = 'Some prose before the envelope.\n\n```json\n{"narratives":[{"narrative_name":"Fenced","narrative":"Fenced content.","evidence":[]}],"graph":{"nodes":[],"edges":[]},"tables":[],"diagrams":[]}\n```\n\nMore prose.';

    const { envelope, usedFallback } = toEnvelopeWithFallback({ content });

    assert.equal(usedFallback, true);
    assert.equal(envelope.narratives.length, 1);
    assert.equal(envelope.narratives[0].narrative, 'Fenced content.');
  });

  it('rejects plain markdown/text as fallback even when enabled', () => {
    config.mentalModel = { ...config.mentalModel, noStructuredOutputFallbackContent: true };

    const { envelope, usedFallback } = toEnvelopeWithFallback({ content: '# Summary\n\nJust markdown prose, not an envelope.' });

    assert.equal(usedFallback, false);
    assert.equal(envelope.narratives.length, 0);
    assert.equal(envelope.graph.nodes.length, 0);
    assert.equal(envelope.graph.edges.length, 0);
  });

  it('rejects fallback content that parses to an empty envelope', () => {
    config.mentalModel = { ...config.mentalModel, noStructuredOutputFallbackContent: true };

    const content = JSON.stringify({ narratives: [], graph: { nodes: [], edges: [] }, tables: [], diagrams: [] });

    const { envelope, usedFallback } = toEnvelopeWithFallback({ content });

    assert.equal(usedFallback, false);
    assert.equal(envelope.narratives.length, 0);
  });

  it('ignores invalid structured_output and returns empty envelope when fallback is disabled', () => {
    config.mentalModel = { ...config.mentalModel, noStructuredOutputFallbackContent: false };

    const { envelope, usedFallback } = toEnvelopeWithFallback({ structured_output: 'not an object' });

    assert.equal(usedFallback, false);
    assert.equal(envelope.narratives.length, 0);
  });

  // Restore the original flag value after each test so later tests see the default.
  it('restores config flag', () => {
    config.mentalModel = { ...config.mentalModel, noStructuredOutputFallbackContent: originalFlag };
    assert.equal(config.mentalModel.noStructuredOutputFallbackContent, originalFlag);
  });
});
