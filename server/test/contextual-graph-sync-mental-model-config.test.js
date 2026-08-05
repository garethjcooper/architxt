import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { upsertNode, upsertEdge } from '../src/db/crud/contextual-graph.js';
import { syncContextualMentalModelConfig } from '../src/services/contextual-graph/sync-mental-model-config.js';
import { deriveEntitySummaryModel } from '../src/services/contextual-graph/template-models.js';
import { composeMentalModelPrompt } from '../src/prompts/template-service.js';

function createDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return db;
}

const serverId = 1;
const bankId = 'bank-1';
const NODE_ID = 'svc-001';
const EXT_ID = 'entity-summary-svc-001';

function seedNodeWithRef(db, nodeId = NODE_ID, extId = EXT_ID, role = 'sys_entity_summary') {
  upsertNode(db, serverId, bankId, nodeId, ['active'], {
    display_name: 'Billing Service',
    provenance: {
      source: 'contextual-graph',
      model_refs: [{ ext_id: extId, role, attached_at: '2026-01-01T00:00:00Z' }],
    },
  });
}

function makeRemoteModel(overrides = {}) {
  return {
    id: EXT_ID,
    name: 'Entity summary: Billing Service',
    source_query: 'Summarize svc-001.',
    max_tokens: 4096,
    trigger: {
      mode: 'full',
      refresh_after_consolidation: false,
      exclude_mental_models: false,
      tags_match: 'all_strict',
    },
    tags: [],
    content: '',
    ...overrides,
  };
}

describe('syncContextualMentalModelConfig', () => {
  let db;
  let pushed;

  beforeEach(() => {
    db = createDb();
    pushed = [];
  });

  it('returns early when no model_refs exist', async () => {
    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      listAllMentalModels: async () => ({ success: true, mentalModels: [] }),
      pushMentalModel: async () => { throw new Error('should not push'); },
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.checked, 0);
  });

  it('skips when local config matches Hindsight', async () => {
    seedNodeWithRef(db);

    const spec = await deriveEntitySummaryModel(db, { id: NODE_ID, displayName: 'Billing Service' });
    const composed = await composeMentalModelPrompt(db, 'sys_entity_summary', spec.source_query);

    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [{
          id: spec.ext_id,
          name: spec.name,
          source_query: composed,
          max_tokens: spec.max_tokens,
          trigger: {
            mode: spec.refresh_mode,
            refresh_after_consolidation: spec.refresh_after_consolidation,
            exclude_mental_models: spec.exclude_all_mental_models,
            tags_match: spec.tags_match_mode,
          },
          tags: spec.tags,
          content: '',
        }],
      }),
      pushMentalModel: async () => { throw new Error('should not push'); },
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.checked, 1);
    assert.equal(result.stats.skippedNoChange, 1);
    assert.equal(result.stats.updated, 0);
  });

  it('returns updatedExtIds when config diverges', async () => {
    seedNodeWithRef(db);
    db.prepare("UPDATE mental_models SET mm_refresh_mode = 'delta' WHERE mm_template_role = 'sys_entity_summary'").run();

    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [makeRemoteModel()],
      }),
      pushMentalModel: async () => ({ success: true }),
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.updatedExtIds, [EXT_ID]);
  });

  it('pushes update when refresh_mode diverges', async () => {
    seedNodeWithRef(db);
    db.prepare("UPDATE mental_models SET mm_refresh_mode = 'delta' WHERE mm_template_role = 'sys_entity_summary'").run();

    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [makeRemoteModel()],
      }),
      pushMentalModel: async (_serverId, _bankId, spec) => {
        pushed.push(spec);
        return { success: true };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.checked, 1);
    assert.equal(result.stats.updated, 1);
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].refresh_mode, 'delta');
  });

  it('pushes update when tags_match_mode diverges', async () => {
    seedNodeWithRef(db);
    db.prepare("UPDATE mental_models SET mm_tags_match_mode = 'any' WHERE mm_template_role = 'sys_entity_summary'").run();

    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [makeRemoteModel()],
      }),
      pushMentalModel: async (_serverId, _bankId, spec) => {
        pushed.push(spec);
        return { success: true };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.updated, 1);
    assert.equal(pushed[0].tags_match_mode, 'any');
  });

  it('dry-run reports update without calling push', async () => {
    seedNodeWithRef(db);
    db.prepare("UPDATE mental_models SET mm_refresh_mode = 'delta' WHERE mm_template_role = 'sys_entity_summary'").run();

    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      dryRun: true,
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [makeRemoteModel()],
      }),
      pushMentalModel: async () => { throw new Error('should not push'); },
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.updated, 1);
    assert.equal(pushed.length, 0);
  });

  it('reports failure when listAllMentalModels fails', async () => {
    seedNodeWithRef(db);

    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      listAllMentalModels: async () => ({ success: false, error: 'unreachable' }),
      pushMentalModel: async () => { throw new Error('should not push'); },
    });

    assert.equal(result.success, false);
    assert.equal(result.error, 'unreachable');
  });

  it('pushes updates for edge-ctx refs', async () => {
    upsertNode(db, serverId, bankId, 'svc:SVC-001', ['active'], { display_name: 'A' });
    upsertNode(db, serverId, bankId, 'svc:SVC-002', ['active'], { display_name: 'B' });
    upsertEdge(db, serverId, bankId, 'e1', 'svc:SVC-001', 'svc:SVC-002', null, {
      directed: false,
      provenance: {
        source: 'contextual-graph',
        model_refs: [{ ext_id: 'edge-ctx-svc:SVC-001|svc:SVC-002', role: 'sys_edge_context', attached_at: '2026-01-01T00:00:00Z' }],
      },
    });
    db.prepare("UPDATE mental_models SET mm_refresh_mode = 'delta' WHERE mm_template_role = 'sys_edge_context'").run();

    const result = await syncContextualMentalModelConfig(db, serverId, bankId, {
      listAllMentalModels: async () => ({
        success: true,
        mentalModels: [{
          id: 'edge-ctx-svc:SVC-001|svc:SVC-002',
          name: 'Edge context: A ↔ B',
          source_query: 'Flows.',
          max_tokens: 4096,
          trigger: { mode: 'full', refresh_after_consolidation: false, exclude_mental_models: false, tags_match: 'all_strict' },
          tags: [],
          content: '',
        }],
      }),
      pushMentalModel: async (_serverId, _bankId, spec) => {
        pushed.push(spec);
        return { success: true };
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.stats.updated, 1);
    assert.equal(pushed[0].refresh_mode, 'delta');
  });
});
