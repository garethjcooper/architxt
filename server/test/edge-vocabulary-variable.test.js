import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { buildEdgeVocabularyFragment } from '../src/prompts/edge-vocabulary.js';
import { loadAndCompose, composeMentalModelPrompt } from '../src/prompts/template-service.js';

function openDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

test('edge vocabulary variable is injected into sys_edge_context template', async () => {
  const db = openDb();
  ensureSchema(db);

  const { prompt } = loadAndCompose(db, 'sys_edge_context', {
    ARCHITXT_TOPIC: 'How does A relate to B?',
    ARCHITXT_CORPUS: 'Source text.',
    ARCHITXT_NARRATIVE_FOCUS: '',
    ARCHITXT_GRAPH_FOCUS: '',
    ARCHITXT_TABLE_FOCUS: '',
  });

  assert.ok(prompt.includes('### Edge/Relationship vocabulary'));
  assert.ok(prompt.includes('`calls`'));
  assert.ok(prompt.includes('`sends`'));
  assert.ok(prompt.includes('`reads`'));
  assert.ok(prompt.includes('`writes`'));
  assert.ok(prompt.includes('`depends-on`'));
  assert.ok(!prompt.includes('{{ARCHITXT_EDGE_VOCABULARY}}'));
  assert.ok(!prompt.includes('edge-vocabulary.md'));
});

test('edge vocabulary variable is injected into sys_discovery_context template', async () => {
  const db = openDb();
  ensureSchema(db);

  const { prompt } = loadAndCompose(db, 'sys_discovery_context', {
    ARCHITXT_TOPIC: 'Discover around A.',
    ARCHITXT_CORPUS: 'Source text.',
    ARCHITXT_NARRATIVE_FOCUS: '',
    ARCHITXT_GRAPH_FOCUS: '',
    ARCHITXT_TABLE_FOCUS: '',
  });

  assert.ok(prompt.includes('### Edge/Relationship vocabulary'));
  assert.ok(prompt.includes('`calls`'));
  assert.ok(!prompt.includes('{{ARCHITXT_EDGE_VOCABULARY}}'));
});

test('edge vocabulary reflects a custom edge type added to the registry', async () => {
  const db = openDb();
  ensureSchema(db);
  db.prepare(`
    INSERT INTO edge_types (edt_type_name, edt_description, edt_c4_description, edt_archimate_relationship)
    VALUES (?, ?, ?, ?)
  `).run('notifies', 'A notifies B of a state change.', 'notifies', 'flow');

  const vocab = buildEdgeVocabularyFragment(db);
  assert.ok(vocab.includes('`notifies`'));
  assert.ok(vocab.includes('A notifies B of a state change.'));
});

test('mental model prompt composition includes edge vocabulary', async () => {
  const db = openDb();
  ensureSchema(db);

  const prompt = await composeMentalModelPrompt(db, 'sys_edge_context', 'Explain A -> B', {
    ARCHITXT_CORPUS: 'Some source.',
  });

  assert.ok(prompt.includes('### Edge/Relationship vocabulary'));
  assert.ok(prompt.includes('`calls`'));
  assert.ok(!prompt.includes('{{ARCHITXT_EDGE_VOCABULARY}}'));
});
