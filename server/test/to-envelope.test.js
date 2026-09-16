import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toEnvelope } from '../src/services/contextual-graph/to-envelope.js';

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
});
