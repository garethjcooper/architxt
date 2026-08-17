import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { upsertNode, getNode } from '../src/db/crud/contextual-graph.js';
import { refreshContextualGraphPatches, extractModelRefsFromDb } from '../src/services/contextual-graph/refresh-patches.js';
import { contentHash } from '../src/services/contextual-graph/normalize-model-output.js';
import { clearCache } from '../src/cache.js';

function createDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return db;
}

describe('refreshContextualGraphPatches', () => {
  let db;
  const serverId = 1;
  const bankId = 'bank-1';

  beforeEach(() => {
    db = createDb();
  });

  function mentalModelWithContent(extId, content) {
    const structuredOutput = typeof content === 'string' ? JSON.parse(content) : content;
    return {
      id: extId,
      content,
      reflect_response: { structured_output: structuredOutput },
    };
  }

  it('returns early when no model_refs exist', async () => {
    const result = await refreshContextualGraphPatches(db, serverId, bankId);
    assert.equal(result.success, true);
    assert.equal(result.stats.matched, 0);
  });

  it('extracts model refs from nodes', () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      provenance: {
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash' }],
      },
    });

    const refs = extractModelRefsFromDb(db, serverId, bankId);
    assert.equal(refs.has('entity-summary-svc-001'), true);
    const scope = refs.get('entity-summary-svc-001');
    assert.equal(scope.type, 'node');
    assert.equal(scope.id, 'svc-001');
  });

  it('applies output when content hash changes', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const newContent = JSON.stringify({ narrative: 'Updated summary.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] });
    const injectedList = async () => ({
      success: true,
      mentalModels: [mentalModelWithContent('entity-summary-svc-001', newContent)],
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      listAllMentalModels: injectedList,
    });
    assert.equal(result.success, true);
    assert.equal(result.stats.applied, 1);

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    assert.equal(node.properties.summary, 'Updated summary.');
    assert.notEqual(node.properties.provenance.model_refs[0].content_hash, 'oldhash');
  });

  it('skips application when content hash is unchanged and applied content exists', async () => {
    const content = JSON.stringify({ narrative: 'Same summary.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] });
    const hash = contentHash(content);

    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      summary: 'Same summary.',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: hash, fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const injectedList = async () => ({
      success: true,
      mentalModels: [mentalModelWithContent('entity-summary-svc-001', content)],
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, { listAllMentalModels: injectedList });
    assert.equal(result.success, true);
    assert.equal(result.stats.skippedUnchanged, 1);
    assert.equal(result.stats.applied, 0);
  });

  it('supports dry-run without applying', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const injectedList = async () => ({
      success: true,
      mentalModels: [mentalModelWithContent('entity-summary-svc-001', JSON.stringify({ narrative: 'Updated.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] }))],
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, { dryRun: true, listAllMentalModels: injectedList });
    assert.equal(result.success, true);
    assert.equal(result.stats.applied, 0);

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    assert.equal(node.properties.summary, undefined);
  });



  it('re-applies when content hash is unchanged but applied content is missing', async () => {
    const content = JSON.stringify({ narrative: 'Same summary.', graph: { nodes: [], edges: [] }, tables: [],
      diagrams: [] });
    const hash = contentHash(content);

    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      // No summary applied yet, even though a content hash was recorded.
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: hash, fetched_at: '2026-01-01T00:00:00Z', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const injectedList = async () => ({
      success: true,
      mentalModels: [mentalModelWithContent('entity-summary-svc-001', content)],
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, { listAllMentalModels: injectedList });
    assert.equal(result.success, true);
    assert.equal(result.stats.skippedUnchanged, 0);
    assert.equal(result.stats.applied, 1);

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    assert.equal(node.properties.summary, 'Same summary.');
  });

  it('skips newly deployed models and marks them pending_build', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    // Return empty content: if the model were fetched normally this would throw.
    const injectedList = async () => ({
      success: true,
      mentalModels: [{ id: 'entity-summary-svc-001', content: '' }],
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      listAllMentalModels: injectedList,
      newlyDeployedExtIds: ['entity-summary-svc-001'],
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.skippedBuilding, 1);
    assert.equal(result.stats.applied, 0);
    assert.equal(result.stats.failed, 0);

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    const ref = node.properties.provenance.model_refs[0];
    assert.equal(ref.last_refresh_status, 'pending_build');
    assert.equal(ref.content_hash, undefined);
  });

  it('skips models with no reflect_response as pending_build instead of failing', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const injectedList = async () => ({
      success: true,
      mentalModels: [{ id: 'entity-summary-svc-001', name: 'Entity summary: Billing Service' }],
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      listAllMentalModels: injectedList,
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.skippedBuilding, 1);
    assert.equal(result.stats.applied, 0);
    assert.equal(result.stats.failed, 0);

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    const ref = node.properties.provenance.model_refs[0];
    assert.equal(ref.last_refresh_status, 'pending_build');
    assert.equal(ref.content_hash, undefined);
  });

  it('queues a refresh for models with reflect_response but no structured_output', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const injectedList = async () => ({
      success: true,
      mentalModels: [{ id: 'entity-summary-svc-001', name: 'Entity summary: Billing Service', reflect_response: { content: 'old markdown output' } }],
    });

    let queuedExtId = null;
    const injectedRefresh = async (srv, bank, extId) => {
      queuedExtId = extId;
      return { success: true, status: 'pending' };
    };

    const result = await refreshContextualGraphPatches(db, serverId, bankId, {
      listAllMentalModels: injectedList,
      refreshMentalModel: injectedRefresh,
    });

    assert.equal(result.success, true);
    assert.equal(queuedExtId, 'entity-summary-svc-001');
    assert.equal(result.stats.rerunRequested, 1);
    assert.equal(result.stats.rerunPending, 1);
    assert.equal(result.stats.skippedPendingRerun, 1);
    assert.equal(result.stats.applied, 0);
    assert.equal(result.stats.failed, 0);

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    const ref = node.properties.provenance.model_refs[0];
    assert.equal(ref.last_refresh_status, 'pending_refresh');
    assert.equal(ref.content_hash, undefined);
  });

  it('fails models with malformed structured_output', async () => {
    upsertNode(db, serverId, bankId, 'svc-001', ['active'], {
      display_name: 'Billing Service',
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'entity-summary-svc-001', role: 'sys_entity_summary', scope: { node_id: 'svc-001' }, content_hash: 'oldhash', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });

    const injectedList = async () => ({
      success: true,
      mentalModels: [{ id: 'entity-summary-svc-001', content: 'not valid json', reflect_response: { structured_output: 'not an object' } }],
    });

    const result = await refreshContextualGraphPatches(db, serverId, bankId, { listAllMentalModels: injectedList });
    assert.equal(result.success, true);
    assert.equal(result.stats.failed, 1);
    assert.equal(result.stats.applied, 0);

    const node = getNode(db, serverId, bankId, 'svc-001').data;
    assert.equal(node.properties.provenance.model_refs[0].content_hash, 'oldhash');
  });
});
