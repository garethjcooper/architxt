import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { handleReflect } from '../src/services/research/handlers/reflect.js';

function buildEnvelope({ narrative = '', nodes = [], edges = [] } = {}) {
  return { narrative, graph: { nodes, edges }, tables: [], diagrams: [] };
}

const REFLECT_STRUCT_WITH_GRAPH = buildEnvelope({
  narrative: 'Here is the analysis.',
  nodes: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ],
  edges: [
    { from: 'a', to: 'b', type: 'calls', label: 'links to' },
  ],
});

const REFLECT_STRUCT_NO_GRAPH = buildEnvelope({ narrative: 'Just a plain text response with no graph data.', nodes: [], edges: [] });

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-reflect-handler-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return { db, file };
}

function cleanupTestDb(db, file) {
  db.close();
  fs.unlinkSync(file);
}

describe('reflect handler', () => {
  let db;
  let file;

  before(() => {
    ({ db, file } = createTestDb());
  });

  after(() => {
    cleanupTestDb(db, file);
  });

  function makeReflectFn(structuredOutput) {
    return async () => ({
      success: true,
      data: { structured_output: structuredOutput },
    });
  }

  it('extracts graph from contextual envelope when present', async () => {
    const result = await handleReflect(1, 'bank', 'test query', {
      reflectFn: makeReflectFn(REFLECT_STRUCT_WITH_GRAPH),
    }, db);

    assert.equal(result.success, true);
    assert.ok(result.graph);
    assert.equal(Array.isArray(result.graph), false);
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
    assert.equal(result.graph.nodes[0].id, 'a');
    assert.equal(result.graph.nodes[0].name, 'Alpha');
  });

  it('returns empty graph when envelope graph is empty', async () => {
    const result = await handleReflect(1, 'bank', 'test query', {
      reflectFn: makeReflectFn(REFLECT_STRUCT_NO_GRAPH),
    }, db);

    assert.equal(result.success, true);
    assert.ok(result.graph);
    assert.equal(result.graph.nodes.length, 0);
    assert.equal(result.graph.edges.length, 0);
  });

  it('composes the generic template by default and requests a structured response schema', async () => {
    let capturedBody = null;
    const reflectFn = async (body) => {
      capturedBody = body;
      return { success: true, data: { text: 'ok', structured_output: { narrative: 'ok', graph: { nodes: [], edges: [] }, tables: [], diagrams: [] } } };
    };

    await handleReflect(1, 'bank', 'test query', { reflectFn }, db);

    assert.ok(capturedBody);
    assert.ok(capturedBody.query.includes('test query'));
    assert.ok(!capturedBody.query.includes('{{ARCHITXT_TOPIC}}'));
    assert.ok(capturedBody.query.includes('## Topic'));
    assert.deepEqual(capturedBody.response_schema, (await import('../src/services/contextual-graph/unified-response-schema.js')).UNIFIED_RESPONSE_SCHEMA);
  });

  it('injects section focus variables when provided', async () => {
    let capturedQuery = null;
    const reflectFn = async (body) => {
      capturedQuery = body.query;
      return { success: true, data: { structured_output: { narrative: '', graph: { nodes: [], edges: [] }, tables: [], diagrams: [] } } };
    };

    await handleReflect(1, 'bank', 'test query', {
      reflectFn,
      section_focus: { graph: 'CRM, ERP' },
    }, db);

    assert.ok(capturedQuery);
    assert.ok(capturedQuery.includes('- CRM, ERP'));
  });

  it('returns narrative and graph for generic template', async () => {
    let capturedQuery = null;
    const reflectFn = async (body) => {
      capturedQuery = body.query;
      return { success: true, data: { structured_output: REFLECT_STRUCT_WITH_GRAPH } };
    };

    const result = await handleReflect(1, 'bank', 'test query', { reflectFn }, db);

    assert.ok(capturedQuery);
    assert.ok(capturedQuery.includes('## Topic'));
    assert.equal(result.success, true);
    assert.ok(result.narrative.length > 0);
    assert.equal(result.graph.nodes.length, 2);
  });

  it('succeeds with empty narrative when diagrams are returned', async () => {
    const reflectFn = async (body) => ({
      success: true,
      data: {
        structured_output: {
          narrative: '',
          graph: { nodes: [], edges: [] },
          tables: [],
          diagrams: [{
            name: 'ICMS and Singleview Dataflow',
            type: 'erDiagram',
            content: 'erDiagram\n    SINGLEVIEW --o{ ICMS : \"sends usage data\"',
          }],
        },
      },
    });

    const result = await handleReflect(1, 'bank', 'test1 (erDiagram)', {
      reflectFn,
      section_focus: { diagram: [{ name: 'test1', type: 'erDiagram', content: 'show the relationship...' }] },
    }, db);

    assert.equal(result.success, true);
    assert.ok(result.narrative.includes('# Results - test1 (erDiagram)'));
    assert.equal(result.diagrams.length, 1);
    assert.equal(result.diagrams[0].type, 'erDiagram');
  });

  it('still requires narrative when narrative section was requested', async () => {
    const reflectFn = async (body) => ({
      success: true,
      data: {
        structured_output: {
          narrative: '',
          graph: { nodes: [], edges: [] },
          tables: [],
          diagrams: [],
        },
      },
    });

    const result = await handleReflect(1, 'bank', 'test query', {
      reflectFn,
      section_focus: { narrative: 'explain impact' },
    }, db);

    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_REFLECT_RESPONSE');
  });

  it('scrubs returned narrative when narrative was not requested', async () => {
    const reflectFn = async (body) => ({
      success: true,
      data: {
        structured_output: {
          narrative: 'The model should not have written this.',
          graph: { nodes: [], edges: [] },
          tables: [],
          diagrams: [{
            name: 'ICMS and Singleview Dataflow',
            type: 'erDiagram',
            content: 'erDiagram\n    SINGLEVIEW --o{ ICMS : \"sends usage data\"',
          }],
        },
      },
    });

    const result = await handleReflect(1, 'bank', 'test1 (erDiagram)', {
      reflectFn,
      section_focus: { diagram: [{ name: 'test1', type: 'erDiagram', content: 'show the relationship...' }] },
    }, db);

    assert.equal(result.success, true);
    assert.ok(!result.narrative.includes('The model should not have written this.'));
    assert.equal(result.diagrams.length, 1);
  });

  it('fails fast without db', async () => {
    const result = await handleReflect(1, 'bank', 'test query', {
      reflectFn: makeReflectFn(REFLECT_STRUCT_NO_GRAPH),
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'MISSING_DB');
  });
});
