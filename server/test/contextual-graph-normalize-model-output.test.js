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
      narrative: 'A system that bills customers.',
      graph: { nodes: [], edges: [] },
      tables: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.narrative, 'A system that bills customers.');
    assert.deepEqual(out.graph, { nodes: [], edges: [] });
    assert.deepEqual(out.tables, []);
    assert.equal(out.errors.length, 0);
  });

  it('extracts JSON wrapped in markdown fences', () => {
    const inner = JSON.stringify({ narrative: 'wrapped', graph: { nodes: [], edges: [] }, tables: [] });
    const raw = `Some prose before\n\n\`\`\`json\n${inner}\n\`\`\``;
    const out = normalizeModelOutput(raw);
    assert.equal(out.narrative, 'wrapped');
    assert.equal(out.errors.length, 0);
  });

  it('fills missing sections with defaults and records errors', () => {
    const out = normalizeModelOutput(JSON.stringify({ narrative: 'only narrative' }));
    assert.equal(out.narrative, 'only narrative');
    assert.deepEqual(out.graph, { nodes: [], edges: [] });
    assert.deepEqual(out.tables, []);
    assert.ok(out.errors.length >= 2);
  });

  it('drops isolated graph nodes', () => {
    const raw = JSON.stringify({
      narrative: '',
      graph: {
        nodes: [
          { id: 'svc-001', name: 'A' },
          { id: 'svc-002', name: 'B' },
        ],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'calls' }],
      },
      tables: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.graph.nodes.length, 2);
    assert.equal(out.graph.edges.length, 1);
  });

  it('drops nodes that have no connecting edges', () => {
    const raw = JSON.stringify({
      narrative: '',
      graph: {
        nodes: [
          { id: 'svc-001', name: 'A' },
          { id: 'svc-002', name: 'B' },
          { id: 'svc-003', name: 'Orphan' },
        ],
        edges: [{ from: 'svc-001', to: 'svc-002', type: 'calls' }],
      },
      tables: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.graph.nodes.length, 2);
    assert.ok(!out.graph.nodes.some((n) => n.id === 'svc-003'));
  });

  it('validates tables require name and columns/rows', () => {
    const raw = JSON.stringify({
      narrative: '',
      graph: { nodes: [], edges: [] },
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
    assert.equal(out.narrative, '');
  });

  it('extracts JSON buried after narrative prose and ignores smart-quoted asides inside string values', () => {
    const raw = JSON.stringify({
      narrative: 'Context.',
      graph: {
        nodes: [{ id: 'a-com:COM-002', name: 'ICMS', type: 'component' }, { id: 'a-com:COM-001', name: 'Singleview', type: 'component' }],
        edges: [{ from: 'a-com:COM-002', to: 'a-com:COM-001', type: 'reads', label: 'account data', detail: 'reads account data', evidence: ['entity-summary-a-com:COM-001'] }],
      },
      tables: [],
    });
    const out = normalizeModelOutput(raw);
    assert.equal(out.errors.length, 0);
    assert.equal(out.graph.nodes.length, 2);
    assert.equal(out.graph.edges.length, 1);
  });

  it('handles smart quotes inside JSON string values without breaking the envelope', () => {
    const content = '{\n  "narrative": "Uses \u201cFile: DBnnnn00\u201d interface.",\n  "graph": {"nodes": [], "edges": []},\n  "tables": []\n}';
    const out = normalizeModelOutput(content);
    assert.equal(out.errors.length, 0);
    assert.ok(out.narrative.includes('File: DBnnnn00'));
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
    const raw = '{"narrative":"Test","graph":{"nodes":[],"edges":[]},"tables":[{"name":"Data Flows","columns":["Capability"],"rows":[["OCS","handles calls,\nhandling charging"]]}]}';
    const out = normalizeModelOutput(raw);
    assert.equal(out.errors.length, 0);
    assert.equal(out.narrative, 'Test');
    assert.equal(out.tables.length, 1);
    assert.equal(out.tables[0].rows[0][0], 'OCS');
    assert.equal(out.tables[0].rows[0][1], 'handles calls,\nhandling charging');
  });
});
