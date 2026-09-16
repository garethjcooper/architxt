import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { normalizeModelOutput, contentHash } from '../src/services/contextual-graph/normalize-model-output.js';
import { clearCache } from '../src/cache.js';

function createDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

describe('normalizeModelOutput', () => {
  it('parses a valid envelope', () => {
    const raw = JSON.stringify({
      narratives: [{ narrative_name: 'Overview', narrative: 'A system that bills customers.' }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });
    const out = normalizeModelOutput(raw);
    assert.deepEqual(out.narratives, [{ narrative_name: 'Overview', narrative: 'A system that bills customers.', evidence: [] }]);
    assert.deepEqual(out.graph, { name: '', nodes: [], edges: [] });
    assert.deepEqual(out.tables, []);
    assert.equal(out.errors.length, 0);
  });

  it('strips inline bracketed and parenthesized evidence IDs from narrative prose and adds them to the evidence array', () => {
    const raw = JSON.stringify({
      narratives: [{
        narrative_name: 'Overview',
        narrative: 'The gateway is central.【 3941f37e-ac67-4c4e-8817-4fd9c9693b15】【3d6a4e7d-c0fd-47bb-9be8-07fa65775a09】 It routes traffic (b4f96446-aa10-41f6-952c-2a895cfc818c, c33bccc3-3e0b-45c0-9566-5615c3f25955) and handles faults (1083358c-5aa2-437c-8a2a-8497099d5a03).',
        evidence: ['existing-id-00000000-0000-0000-0000-000000000000'],
      }],
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.narratives.length, 1);
    assert.equal(out.narratives[0].narrative, 'The gateway is central. It routes traffic and handles faults.');
    assert.deepEqual(out.narratives[0].evidence.sort(), [
      '3941f37e-ac67-4c4e-8817-4fd9c9693b15',
      '3d6a4e7d-c0fd-47bb-9be8-07fa65775a09',
      'b4f96446-aa10-41f6-952c-2a895cfc818c',
      'c33bccc3-3e0b-45c0-9566-5615c3f25955',
      '1083358c-5aa2-437c-8a2a-8497099d5a03',
      'existing-id-00000000-0000-0000-0000-000000000000',
    ].sort());
    assert.equal(out.errors.length, 0);
  });

  it('extracts JSON wrapped in markdown fences', () => {
    const inner = JSON.stringify({ narratives: [{ narrative: 'wrapped' }], graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] });
    const raw = `Some prose before\n\n\`\`\`json\n${inner}\n\`\`\``;
    const out = normalizeModelOutput(raw);
    assert.deepEqual(out.narratives, [{ narrative_name: 'wrapped', narrative: 'wrapped', evidence: [] }]);
    assert.equal(out.errors.length, 0);
  });

  it('fills missing sections with defaults and records errors', () => {
    const out = normalizeModelOutput(JSON.stringify({ narratives: [{ narrative: 'only narrative' }] }));
    assert.deepEqual(out.narratives, [{ narrative_name: 'only narrative', narrative: 'only narrative', evidence: [] }]);
    assert.deepEqual(out.graph, { name: '', nodes: [], edges: [] });
    assert.deepEqual(out.tables, []);
    assert.ok(out.errors.length >= 2);
  });

  it('drops isolated graph nodes', () => {
    const raw = JSON.stringify({
      narratives: [],
      graph: {
        nodes: [
          { id: 'svc-001', name: 'A' },
          { id: 'svc-002', name: 'B' },
        ],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'calls' }],
      },
      tables: [],
      diagrams: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.graph.nodes.length, 2);
    assert.equal(out.graph.edges.length, 1);
  });

  it('drops nodes that have no connecting edges', () => {
    const raw = JSON.stringify({
      narratives: [],
      graph: {
        nodes: [
          { id: 'svc-001', name: 'A' },
          { id: 'svc-002', name: 'B' },
          { id: 'svc-003', name: 'Orphan' },
        ],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'calls' }],
      },
      tables: [],
      diagrams: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.graph.nodes.length, 2);
    assert.ok(!out.graph.nodes.some((n) => n.id === 'svc-003'));
  });

  it('validates tables require name and columns/rows', () => {
    const raw = JSON.stringify({
      narratives: [],
      graph: { name: '', nodes: [], edges: [] },
      tables: [
        { name: 'capabilities', columns: ['name'], rows: [{ name: 'billing' }] },
        { columns: ['name'], rows: [] },
      ],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].name, 'capabilities');
    assert.ok(out.errors.length > 0);
  });

  it('returns errors for malformed JSON', () => {
    const out = normalizeModelOutput('not json');
    assert.equal(out.errors.length, 1);
    assert.deepEqual(out.narratives, []);
  });

  it('extracts JSON buried after narrative prose and ignores smart-quoted asides inside string values', () => {
    const raw = JSON.stringify({
      narratives: [{ narrative: 'Context.' }],
      graph: {
        nodes: [{ id: 'a-com:COM-002', name: 'ICMS', type: 'component' }, { id: 'a-com:COM-001', name: 'Singleview', type: 'component' }],
        edges: [{ from: 'a-com:COM-002', to: 'a-com:COM-001', type: 'reads', label: 'account data', detail: 'reads account data', evidence: ['entity-summary-a-com:COM-001'] }],
      },
      tables: [],
      diagrams: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.errors.length, 0);
    assert.equal(out.graph.nodes.length, 2);
    assert.equal(out.graph.edges.length, 1);
  });

  it('handles smart quotes inside JSON string values without breaking the envelope', () => {
    const content = '{\n  "narratives": [{"narrative_name":"","narrative":"Uses \u201cFile: DBnnnn00\u201d interface."}],\n  "graph": {"nodes": [], "edges": []},\n  "tables": [],\n  "diagrams": []\n}';
    const out = normalizeModelOutput(content);
    assert.equal(out.errors.length, 0);
    assert.ok(out.narratives[0].narrative.includes('File: DBnnnn00'));
  });

  it('parses and validates diagrams', () => {
    const raw = JSON.stringify({
      narratives: [],
      graph: { name: '', nodes: [], edges: [] },
      tables: [],
      diagrams: [
        { name: 'Order sequence', type: 'sequenceDiagram', content: 'Alice->>Bob: Hello', evidence: [] },
        { name: 'Missing type', content: 'A' },
        { name: 'Bad type', type: 'invalidDiagram', content: 'A' },
      ],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.diagrams.length, 1);
    assert.equal(out.diagrams[0].name, 'Order sequence');
    assert.equal(out.diagrams[0].type, 'sequenceDiagram');
    assert.deepEqual(out.diagrams[0].evidence, []);
    assert.ok(out.errors.length > 0);
  });

  it('contentHash returns a 16-char hex string', () => {
    const h1 = contentHash('hello');
    const h2 = contentHash('hello');
    const h3 = contentHash('world');
    assert.equal(h1.length, 16);
    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
  });

  it('fixes literal unescaped newlines inside JSON string values', () => {
    const raw = '{"narratives":[{"narrative_name":"","narrative":"Test"}],"graph":{"nodes":[],"edges":[]},"tables":[{"name":"Data Flows","columns":["Capability"],"rows":[["OCS","handles calls,\nhandling charging"]]}],"diagrams":[]}';
    const out = normalizeModelOutput(raw);
    assert.equal(out.errors.length, 0);
    assert.equal(out.narratives[0].narrative, 'Test');
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].rows[0][0], 'OCS');
    assert.equal(out.tables[0].rows[0][1], 'handles calls,\nhandling charging');
  });
  it('repairs literal \\n in diagram content into real newlines', () => {
    // Models emit the two-character sequence backslash-n inside JSON strings.
    // The raw JSON below contains \\n in the source, which JSON.parse turns into \n.
    const raw = '{"narratives":[],"graph":{"name":"","nodes":[],"edges":[]},"tables":[],"diagrams":[{"name":"Integration A","type":"flowchart","content":"flowchart LR\\n    payProv[\\"Payment Provider\\"] --> eig[\\"Gateway\\"]","evidence":[]}]}';
    const result = normalizeModelOutput(raw);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.diagrams.length, 1);
    assert.strictEqual(result.diagrams[0].content, 'flowchart LR\n    payProv["Payment Provider"] --> eig["Gateway"]');
  });

});
