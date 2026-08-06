import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleSynthesize } from '../src/services/research/handlers/synthesize.js';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { ensureSeedData } from '../src/db/ensure-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = path.join(__dirname, '../../tmp/test-synthesize-handler.db');

function seedTestEntities(db) {
  db.prepare("INSERT OR IGNORE INTO entity_types (et_type_name, et_id_label, et_name_label) VALUES ('com', 'COM', 'Component')").run();
  db.prepare("INSERT OR IGNORE INTO entity_types (et_type_name, et_id_label, et_name_label) VALUES ('svc', 'SVC', 'Service')").run();
  const comType = db.prepare("SELECT et_id FROM entity_types WHERE et_type_name = 'com'").pluck().get();
  const svcType = db.prepare("SELECT et_id FROM entity_types WHERE et_type_name = 'svc'").pluck().get();
  db.prepare("INSERT OR IGNORE INTO entities (ent_entity_id, ent_name, ent_type_id, ent_description) VALUES (?, ?, ?, ?)").run('a-com:COM-001', 'Singleview', comType, 'Billing CRM');
  db.prepare("INSERT OR IGNORE INTO entities (ent_entity_id, ent_name, ent_type_id, ent_description) VALUES (?, ?, ?, ?)").run('a-svc:SVC-005', 'Rating Service', svcType, 'Usage rating engine');
}

function makeCompletion(content) {
  return async () => ({
    success: true,
    data: { content, model: 'test-model', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
  });
}

describe('synthesize handler', () => {
  let db;

  before(() => {
    const dir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);
    ensureSeedData(db);
    seedTestEntities(db);
  });

  after(() => {
    if (db) db.close();
    try {
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      const wal = `${TEST_DB_PATH}-wal`;
      const shm = `${TEST_DB_PATH}-shm`;
      if (fs.existsSync(wal)) fs.unlinkSync(wal);
      if (fs.existsSync(shm)) fs.unlinkSync(shm);
    } catch {
      // ignore cleanup errors
    }
  });

  it('returns empty result when no model is configured and no source material', async () => {
    const result = await handleSynthesize(1, 'bank', 'test query', { source_steps: [] }, db);
    assert.equal(result.success, true);
    assert.equal(result.narrative, 'No source material available for synthesis.');
    assert.deepEqual(result.graph, { nodes: [], edges: [] });
  });

  it('returns missing model response when source material exists but no model is configured', async () => {
    const result = await handleSynthesize(1, 'bank', 'test query', {
      source_steps: [{ synthesis: { narrative: 'Narrative' }, canvas: { graph: { nodes: [], edges: [] } } }],
      output_mode: 'narrative+graph',
    }, db);
    assert.equal(result.success, true);
    assert.equal(result.narrative, 'Synthesis is not configured: missing model.');
    assert.deepEqual(result.graph, { nodes: [], edges: [] });
  });

  it('returns error when db is missing', async () => {
    const result = await handleSynthesize(1, 'bank', 'test query', { source_steps: [] });
    assert.equal(result.success, false);
    assert.equal(result.code, 'MISSING_DB');
  });

  it('returns empty result when no source material is provided', async () => {
    const result = await handleSynthesize(1, 'bank', 'test query', { source_steps: [], model: 'test-model' }, db);
    assert.equal(result.success, true);
    assert.equal(result.narrative, 'No source material available for synthesis.');
    assert.deepEqual(result.graph, { nodes: [], edges: [] });
  });

  it('parses universal format, normalizes, and keeps corpus/catalog nodes in known-only mode', async () => {
    const response = `Synthesized summary.\n\n## ARCHITXT-GRAPH-DATA\n${JSON.stringify({ nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }, { id: 'a-svc:SVC-005', name: 'Rating' }, { id: 'payment-gateway', name: 'Payment Gateway' }], edges: [{ from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'sends', label: 'usage data', detail: 'Billable events' }, { from: 'a-com:COM-001', to: 'payment-gateway', type: 'calls', label: 'charges' }] })}`;

    const sourceSteps = [
      {
        intent_text: 'step one',
        synthesis: { narrative: 'Narrative one' },
        canvas: {
          graph: {
            nodes: [
              { id: 'a-com:COM-001', name: 'Singleview' },
              { id: 'a-svc:SVC-005', name: 'Rating Service' },
            ],
            edges: [{ from: 'a-com:COM-001', to: 'a-svc:SVC-005', type: 'sends', detail: 'usage data' }],
          },
        },
      },
    ];

    const result = await handleSynthesize(1, 'bank', 'test query', {
      source_steps: sourceSteps,
      model: 'test-model',
      output_mode: 'narrative+graph',
      generateCompletion: makeCompletion(response),
    }, db);

    assert.equal(result.success, true);
    assert.equal(result.narrative, 'Synthesized summary.');
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
    assert.equal(result.graph.nodes[0].id, 'a-com:COM-001');
    assert.equal(result.graph.nodes[0].name, 'Singleview');
    assert.equal(result.graph.edges[0].from, 'a-com:COM-001');
    assert.equal(result.graph.edges[0].to, 'a-svc:SVC-005');
    assert.equal(result.graph.edges[0].type, 'sends');
    assert.equal(result.graph.edges[0].provenance, 'inferred');
    assert.equal(result.graph.edges[0].label, 'usage data');
    assert.equal(result.graph.edges[0].detail, 'Billable events');

    // Corpus must appear in the recorded prompt so provenance is actually presented to the LLM.
    const recordedPrompt = result.calls?.[0]?.prompt_text || '';
    assert.ok(recordedPrompt.includes('Narrative one'), 'recorded prompt should include source narrative');
    assert.ok(recordedPrompt.includes('Singleview'), 'recorded prompt should include source entity name');
    assert.ok(recordedPrompt.includes('usage data'), 'recorded prompt should include source edge detail');
  });

  it('keeps discovered nodes in discovery mode', async () => {
    const response = `Synthesized summary.\n\n## ARCHITXT-GRAPH-DATA\n${JSON.stringify({ nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }, { id: 'payment-gateway', name: 'Payment Gateway' }], edges: [{ from: 'a-com:COM-001', to: 'payment-gateway', type: 'calls', label: 'charges' }] })}`;

    const sourceSteps = [
      {
        intent_text: 'step one',
        synthesis: { narrative: 'Narrative one' },
        canvas: {
          graph: {
            nodes: [{ id: 'a-com:COM-001', name: 'Singleview' }],
            edges: [],
          },
        },
      },
    ];

    const result = await handleSynthesize(1, 'bank', 'test query', {
      source_steps: sourceSteps,
      model: 'test-model',
      output_mode: 'narrative+graph',
      allow_discovery: true,
      generateCompletion: makeCompletion(response),
    }, db);

    assert.equal(result.success, true);
    assert.equal(result.graph.nodes.length, 2);
    assert.equal(result.graph.edges.length, 1);
    assert.ok(result.graph.nodes.some((n) => n.id === 'payment-gateway'));
  });
});
