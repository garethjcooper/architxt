import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { deleteGeneratedModels } from '../src/services/contextual-graph/delete-generated-models.js';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';

function makeDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

function seedServer(db) {
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return db.prepare('SELECT svr_id FROM servers').get().svr_id;
}

describe('deleteGeneratedModels', () => {
  let db;
  let serverId;

  beforeEach(() => {
    db = makeDb();
    serverId = seedServer(db);
  });

  it('requires server_id and bank_id', async () => {
    const result = await deleteGeneratedModels(db, null, null);
    assert.equal(result.success, false);
    assert.equal(result.code, 'MISSING_PARAMS');
  });

  it('parses working graph refs and deletes from Hindsight, clearing local refs', async () => {
    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-005', attached_at: '2026-08-01' }],
        updated_at: '2026-08-01' } });

    const deletedRemote = [];
    const deleteFromHindsight = async (_serverId, _bankId, extId) => {
      deletedRemote.push(extId);
      return { success: true };
    };

    const result = await deleteGeneratedModels(db, serverId, 'Mozart-API', { deleteFromHindsight });

    assert.equal(result.success, true);
    assert.deepEqual(result.deleted, ['entity-ctx-svc:SVC-005']);
    assert.deepEqual(deletedRemote, ['entity-ctx-svc:SVC-005']);
    assert.equal(result.cleared.nodes, 1);
    assert.equal(result.cleared.edges, 0);

    const { getNode } = await import('../src/db/crud/contextual-graph.js');
    const node = getNode(db, serverId, 'Mozart-API', 'svc:SVC-005').data;
    assert.equal(node.cgn_properties.provenance.model_refs, undefined);
    assert.equal(node.cgn_properties.provenance.source, 'contextual-graph');
  });

  it('supports dry-run without deleting', async () => {
    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      provenance: {
        model_refs: [{ role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-005' }] } });

    const deleteFromHindsight = async () => { throw new Error('should not be called'); };

    const result = await deleteGeneratedModels(db, serverId, 'Mozart-API', { dry_run: true, deleteFromHindsight });

    assert.equal(result.success, true);
    assert.equal(result.dry_run, true);
    assert.deepEqual(result.ext_ids, ['entity-ctx-svc:SVC-005']);
    assert.deepEqual(result.deleted, []);
  });

  it('can delete explicit ext_ids without parsing', async () => {
    const { upsertNode } = await import('../src/db/crud/contextual-graph.js');
    upsertNode(db, serverId, 'Mozart-API', 'svc:SVC-005', ['canonical', 'active'], {
      provenance: { model_refs: [{ role: 'entity-ctx', ext_id: 'entity-ctx-svc:SVC-005' }] } });

    const deletedRemote = [];
    const deleteFromHindsight = async (_serverId, _bankId, extId) => {
      deletedRemote.push(extId);
      return { success: true };
    };

    const result = await deleteGeneratedModels(db, serverId, 'Mozart-API', {
      ext_ids: ['entity-ctx-svc:SVC-005', 'entity-ctx-svc:SVC-006'],
      deleteFromHindsight });

    assert.deepEqual(result.deleted.sort(), ['entity-ctx-svc:SVC-005', 'entity-ctx-svc:SVC-006']);
    assert.equal(result.cleared.nodes, 1);
  });
});
