import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from '../src/db/ensure-schema.js';
import {
  deriveEntitySummaryModel,
  deriveEntityCapabilitiesModel,
  deriveEdgeContextModel,
  deriveDiscoverContextModel,
} from '../src/services/contextual-graph/template-models.js';
import { clearCache } from '../src/cache.js';

function createDb() {
  clearCache();
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return db;
}

describe('contextual graph template models', () => {
  let db;

  beforeEach(() => {
    db = createDb();
  });

  it('seeds the four system templates on schema creation', () => {
    const rows = db.prepare(`
      SELECT mm_template_role, mm_ext_id, mm_name, mm_returns, mm_dimension
      FROM mental_models
      WHERE mm_is_template = 'true'
      ORDER BY mm_template_role
    `).all();

    assert.equal(rows.length, 4);
    const roles = rows.map((r) => r.mm_template_role);
    assert.ok(roles.includes('sys_entity_summary'));
    assert.ok(roles.includes('sys_entity_capabilities'));
    assert.ok(roles.includes('sys_edge_context'));
    assert.ok(roles.includes('sys_discovery_context'));

    const summary = rows.find((r) => r.mm_template_role === 'sys_entity_summary');
    assert.ok(summary.mm_ext_id.includes('{id}'));
    assert.ok(summary.mm_name.includes('{entity-name}'));
    assert.equal(summary.mm_returns, 'sys_patch');
    assert.equal(summary.mm_dimension, 'sys_entity_summary');

    const capabilities = rows.find((r) => r.mm_template_role === 'sys_entity_capabilities');
    assert.ok(capabilities.mm_ext_id.includes('{id}'));
    assert.equal(capabilities.mm_returns, 'sys_patch');
    assert.equal(capabilities.mm_dimension, 'sys_entity_capabilities');
  });

  it('derives an entity-summary model from a node', async () => {
    const spec = await deriveEntitySummaryModel(db, { id: 'svc-001', displayName: 'Billing Service' }, 'bank-1');

    assert.equal(spec.ext_id, 'entity-summary-svc-001');
    assert.equal(spec.name, 'Entity summary: Billing Service');
    assert.equal(spec.returns, 'sys_patch');
    assert.equal(spec.role, 'sys_entity_summary');
    assert.ok(spec.source_query.includes('svc-001'));
    assert.ok(spec.source_query.includes('Billing Service'));
    assert.deepEqual(spec.tags, ['ctx-bank-1', 'sys_entity_summary', 'node-svc-001']);
  });

  it('derives an entity-capabilities model from a node', async () => {
    const spec = await deriveEntityCapabilitiesModel(db, { id: 'svc-001', displayName: 'Billing Service' }, 'bank-1');

    assert.equal(spec.ext_id, 'entity-capabilities-svc-001');
    assert.equal(spec.name, 'Entity capabilities: Billing Service');
    assert.equal(spec.returns, 'sys_patch');
    assert.equal(spec.role, 'sys_entity_capabilities');
    assert.ok(spec.source_query.includes('svc-001'));
    assert.ok(spec.source_query.includes('Billing Service'));
    assert.deepEqual(spec.tags, ['ctx-bank-1', 'sys_entity_capabilities', 'node-svc-001']);
  });

  it('derives an edge context model from source and target nodes', async () => {
    const spec = await deriveEdgeContextModel(
      db,
      { id: 'svc-001', displayName: 'Billing Service' },
      { id: 'svc-002', displayName: 'Payment API' },
      'bank-1'
    );

    assert.equal(spec.ext_id, 'edge-ctx-svc-001|svc-002');
    assert.equal(spec.name, 'Edge context: Billing Service ↔ Payment API');
    assert.equal(spec.returns, 'sys_patch');
    assert.equal(spec.role, 'sys_edge_context');
    assert.ok(spec.source_query.includes('svc-001'));
    assert.ok(spec.source_query.includes('Payment API'));
    assert.deepEqual(spec.tags, ['ctx-bank-1', 'sys_edge_context', 'pair-svc-001|svc-002']);
  });

  it('derives a discover model from a seed node', async () => {
    const spec = await deriveDiscoverContextModel(db, { id: 'svc-001', displayName: 'Billing Service' }, [], 'bank-1');

    assert.equal(spec.ext_id, 'discover-svc-001');
    assert.equal(spec.name, 'Discover around Billing Service');
    assert.equal(spec.returns, 'sys_patch');
    assert.equal(spec.role, 'sys_discovery_context');
    assert.ok(spec.source_query.includes('svc-001'));
    assert.deepEqual(spec.tags, ['ctx-bank-1', 'sys_discovery_context', 'seed-svc-001']);
  });

  it('system templates have no tags', () => {
    const rows = db.prepare(`
      SELECT m.mm_id
      FROM mental_models m
      WHERE m.mm_is_template = 'true'
        AND m.mm_template_role LIKE 'sys_%'
    `).all();
    assert.ok(rows.length > 0);
    for (const { mm_id } of rows) {
      const tagCount = db.prepare('SELECT COUNT(*) AS c FROM mental_model_tags WHERE mm_id = ?').pluck().get(mm_id);
      assert.equal(tagCount, 0, `system template ${mm_id} should not have user tags`);
    }
  });
});
