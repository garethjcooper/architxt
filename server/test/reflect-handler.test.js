import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { handleReflect } from '../src/services/research/handlers/reflect.js';

function buildEnvelope({ narrative = '', nodes = [], edges = [] } = {}) {
  return JSON.stringify({ narrative, graph: { nodes, edges } });
}

const REFLECT_TEXT_WITH_GRAPH = buildEnvelope({
  narrative: 'Here is the analysis.',
  nodes: [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
  ],
  edges: [
    { from: 'a', to: 'b', type: 'calls', label: 'links to' },
  ],
});

const REFLECT_TEXT_NO_GRAPH = JSON.stringify({ narrative: 'Just a plain text response with no graph data.', graph: { nodes: [], edges: [] } });

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

  function makeReflectFn(text) {
    return async () => ({
      success: true,
      data: { text },
    });
  }

  it('extracts graph from contextual envelope when present', async () => {
    const result = await handleReflect(1, 'bank', 'test query', {
      reflectFn: makeReflectFn(REFLECT_TEXT_WITH_GRAPH),
      output_mode: 'narrative+graph',
    }, db);

    assert.equal(result.success, true);
    assert.ok(result.graph);
    assert.equal(Array.isArray(result.graph), false);
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
    assert.equal(result.graph.nodes[0].id, 'a');
    assert.equal(result.graph.nodes[0].source, 'mental_model');
  });

  it('returns empty graph when envelope graph is empty', async () => {
    const result = await handleReflect(1, 'bank', 'test query', {
      reflectFn: makeReflectFn(REFLECT_TEXT_NO_GRAPH),
      output_mode: 'narrative+graph',
    }, db);

    assert.equal(result.success, true);
    assert.ok(result.graph);
    assert.equal(result.graph.nodes.length, 0);
    assert.equal(result.graph.edges.length, 0);
  });

  it('composes the narrative template by default', async () => {
    let capturedQuery = null;
    const reflectFn = async (body) => {
      capturedQuery = body.query;
      return { success: true, data: { text: 'ok' } };
    };

    await handleReflect(1, 'bank', 'test query', { reflectFn, output_mode: 'narrative' }, db);

    assert.ok(capturedQuery);
    assert.ok(capturedQuery.includes('test query'));
    assert.ok(!capturedQuery.includes('{{ARCHITXT_TOPIC}}'));
    assert.ok(!capturedQuery.includes('ARCHITXT-GRAPH-DATA'));
    assert.ok(capturedQuery.includes('contextual JSON envelope'));
  });

  it('composes the narrative-graph-known template when output_mode is narrative+graph', async () => {
    let capturedQuery = null;
    const reflectFn = async (body) => {
      capturedQuery = body.query;
      return { success: true, data: { text: 'ok' } };
    };

    await handleReflect(1, 'bank', 'test query', { reflectFn, output_mode: 'narrative+graph' }, db);

    assert.ok(capturedQuery);
    assert.ok(capturedQuery.includes('contextual JSON envelope'));
    assert.ok(!capturedQuery.includes('ARCHITXT-GRAPH-DATA'));
  });

  it('composes the narrative-graph-discovery template when output_mode is narrative+graph and allow_discovery is true', async () => {
    let capturedQuery = null;
    const reflectFn = async (body) => {
      capturedQuery = body.query;
      return { success: true, data: { text: 'ok' } };
    };

    await handleReflect(1, 'bank', 'test query', { reflectFn, output_mode: 'narrative+graph', allow_discovery: true }, db);

    assert.ok(capturedQuery);
    assert.ok(capturedQuery.includes('contextual JSON envelope'));
    assert.ok(capturedQuery.includes('bare-slug'));
  });

  it('composes the graph-known template when output_mode is graph-only', async () => {
    let capturedQuery = null;
    const reflectFn = async (body) => {
      capturedQuery = body.query;
      return { success: true, data: { text: REFLECT_TEXT_WITH_GRAPH } };
    };

    const result = await handleReflect(1, 'bank', 'test query', { reflectFn, output_mode: 'graph-only' }, db);

    assert.ok(capturedQuery);
    assert.ok(capturedQuery.includes('contextual JSON envelope'));
    assert.equal(result.success, true);
    assert.equal(result.narrative, '');
    assert.equal(result.graph.nodes.length, 2);
  });

  it('fails fast without db', async () => {
    const result = await handleReflect(1, 'bank', 'test query', {
      reflectFn: makeReflectFn(REFLECT_TEXT_NO_GRAPH),
      output_mode: 'narrative+graph',
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'MISSING_DB');
  });
});
