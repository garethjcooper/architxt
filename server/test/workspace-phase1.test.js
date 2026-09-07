import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import {
  createSession,
  getSession,
  updateSession,
  listSessionsByServerBank,
  createSessionPage,
  updateCuratedPage,
  getStep,
  listStepsForSession,
} from '../src/db/crud/research.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-workspace-phase1-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_base_url, svr_name) VALUES (?, ?)').run('http://hindsight', 'test');
  const serverId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  return { db, file, serverId };
}

function cleanupTestDb(db, file) {
  db.close();
  fs.unlinkSync(file);
}

describe('workspace phase 1: schema and CRUD', () => {
  let db;
  let file;
  let serverId;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file, serverId } = createTestDb());
    clearCache();
  });

  it('persists rs_scope_entity_ids when creating a session', () => {
    const result = createSession(db, {
      rs_title: 'Test session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_scope_entity_ids: ['svc:001', 'svc:002'],
      rs_server_id: serverId,
    });
    assert.equal(result.success, true);
    const sessionId = result.data;

    const fetched = getSession(db, sessionId).data;
    assert.deepEqual(fetched.rs_scope_entity_ids, ['svc:001', 'svc:002']);
  });

  it('defaults rs_scope_entity_ids to null when omitted', () => {
    const result = createSession(db, {
      rs_title: 'Test session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_server_id: serverId,
    });
    assert.equal(result.success, true);
    const sessionId = result.data;

    const fetched = getSession(db, sessionId).data;
    assert.equal(fetched.rs_scope_entity_ids, null);
  });

  it('updates rs_scope_entity_ids on a session', () => {
    const createResult = createSession(db, {
      rs_title: 'Test session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_server_id: serverId,
    });
    const sessionId = createResult.data;

    const updateResult = updateSession(db, sessionId, {
      rs_scope_entity_ids: ['app:APP-003'],
    });
    assert.equal(updateResult.success, true);

    const fetched = getSession(db, sessionId).data;
    assert.deepEqual(fetched.rs_scope_entity_ids, ['app:APP-003']);
  });

  it('returns scope_entity_ids in listSessionsByServerBank', () => {
    createSession(db, {
      rs_title: 'Scoped session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_scope_entity_ids: ['svc:004'],
      rs_server_id: serverId,
    });

    const listResult = listSessionsByServerBank(db, serverId, 'bank');
    assert.equal(listResult.success, true);
    const session = listResult.data.find((s) => s.rs_title === 'Scoped session');
    assert.ok(session);
    assert.deepEqual(session.rs_scope_entity_ids, ['svc:004']);
  });

  it('creates a curated_page step with a blank envelope', () => {
    const sessionResult = createSession(db, {
      rs_title: 'Session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_server_id: serverId,
    });
    const sessionId = sessionResult.data;

    const pageResult = createSessionPage(db, sessionId, 'My curated page');
    assert.equal(pageResult.success, true);
    const stepId = pageResult.data;

    const step = getStep(db, stepId).data;
    assert.equal(step.rstep_action_type, 'curated_page');
    assert.equal(step.rstep_intent_text, 'My curated page');
    assert.equal(step.rstep_status, 'completed');
    assert.deepEqual(step.rstep_envelope, { narratives: [], graph: { nodes: [], edges: [] }, tables: [], diagrams: [] });
    assert.equal(step.rstep_canvas_state, null);
    assert.equal(step.rstep_synthesis, null);
  });

  it('updates a curated_page envelope and title', () => {
    const sessionId = createSession(db, {
      rs_title: 'Session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_server_id: serverId,
    }).data;
    const stepId = createSessionPage(db, sessionId, 'Original').data;

    const updateResult = updateCuratedPage(db, stepId, {
      rstep_intent_text: 'Renamed page',
      rstep_envelope: {
        narratives: [{ narrative_name: '', narrative: '# Summary\nHello' }],
        graph: { name: '', nodes: [{ id: 'n1' }], edges: [] },
        tables: [{ name: 'T1', columns: [], rows: [] }],
        diagrams: [{ name: 'D1', type: 'mermaid', content: 'graph LR\nA-->B' }],
      },
    });
    assert.equal(updateResult.success, true);

    const step = getStep(db, stepId).data;
    assert.equal(step.rstep_intent_text, 'Renamed page');
    assert.deepEqual(step.rstep_envelope.graph.nodes, [{ id: 'n1' }]);
    assert.deepEqual(step.rstep_envelope.narratives, [{ narrative_name: '', narrative: '# Summary\nHello' }]);
  });

  it('refuses to update a non-curated_page step via updateCuratedPage', () => {
    const sessionId = createSession(db, {
      rs_title: 'Session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_server_id: serverId,
    }).data;

    const stepId = createSessionPage(db, sessionId, 'Page').data;
    // Flip the step to reflect so it is no longer a curated_page.
    db.prepare("UPDATE research_steps SET rstep_action_type = 'reflect' WHERE rstep_id = ?").run(stepId);

    const updateResult = updateCuratedPage(db, stepId, {
      rstep_intent_text: 'Should fail',
    });
    assert.equal(updateResult.success, false);
    assert.ok(updateResult.error.includes('not a curated_page'));
  });

  it('lists curated_page steps alongside other steps', () => {
    const sessionId = createSession(db, {
      rs_title: 'Session',
      rs_bank_id: 'bank',
      rs_viewpoint_ids: [1],
      rs_server_id: serverId,
    }).data;

    const pageId = createSessionPage(db, sessionId, 'Page one').data;

    const steps = listStepsForSession(db, sessionId).data;
    assert.equal(steps.length, 1);
    assert.equal(steps[0].rstep_id, pageId);
    assert.equal(steps[0].rstep_action_type, 'curated_page');
  });
});
