import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { clearCache } from '../src/cache.js';
import { upsertNode } from '../src/db/crud/contextual-graph.js';
import {
  buildArchitxtLookups,
  normalizeNodeId,
  buildNodeId,
  resolveHindsightNode,
  dedupeCandidates,
  buildEdgeId,
} from '../src/services/contextual-graph/identity.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-contextual-identity-${Date.now()}.db`);
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

function seedEntities(db, entities) {
  for (const e of entities) {
    const existingType = db.prepare('SELECT et_id FROM entity_types WHERE et_type_name = ?').get(e.type);
    let typeId;
    if (existingType) {
      typeId = existingType.et_id;
    } else {
      db.prepare('INSERT INTO entity_types (et_type_name, et_id_label, et_name_label) VALUES (?, ?, ?)').run(
        e.type, 'ID', 'Name');
      typeId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    }
    db.prepare('INSERT INTO entities (ent_entity_id, ent_name, ent_type_id, ent_aliases, ent_generated_by) VALUES (?, ?, ?, ?, ?)').run(
      e.entityId, e.name, typeId, JSON.stringify(e.aliases || []), 'user');
  }
}

describe('contextual graph identity', () => {
  let db;
  let file;
  let serverId;

  beforeEach(() => {
    if (db) cleanupTestDb(db, file);
    ({ db, file, serverId } = createTestDb());
    clearCache();
  });

  it('normalizes labels to stable node ids', () => {
    assert.equal(normalizeNodeId('Payment Gateway'), 'payment-gateway');
    assert.equal(normalizeNodeId('Invoice-Delivery!!!Service'), 'invoice-delivery-service');
    assert.equal(normalizeNodeId('a-com:COM-001'), 'a-com-com-001');
  });

  it('builds canonical node id when canonical entity is resolved', () => {
    assert.equal(buildNodeId({ label: 'a-com:COM-001', canonicalId: 'COM-001', typeLabel: 'a-com' }), 'a-com:COM-001');
    assert.equal(buildNodeId({ label: 'app-com:COM-001', canonicalId: 'COM-001', typeLabel: 'app-com' }), 'app-com:COM-001');
    assert.equal(buildNodeId({ label: 'Payment Gateway' }), 'uncanonical:payment-gateway');
  });

  it('resolves canonical entity by id or alias', async () => {
    seedEntities(db, [
      { type: 'app-com', entityId: 'COM-001', name: 'Alpha', aliases: ['alpha-component'] },
    ]);
    const lookups = await buildArchitxtLookups(db);

    const byId = await resolveHindsightNode(db, serverId, 'Mozart-API', lookups, { label: 'app-com:COM-001' });
    assert.equal(byId.taxonomy, 'canonical');
    assert.equal(byId.id, 'app-com:COM-001');

    const byAlias = await resolveHindsightNode(db, serverId, 'Mozart-API', lookups, { label: 'alpha-component' });
    assert.equal(byAlias.taxonomy, 'canonical');
    assert.equal(byAlias.id, 'app-com:COM-001');
  });

  it('resolves existing uncanonical-grounded node', async () => {
    seedEntities(db, []);
    upsertNode(db, serverId, 'Mozart-API', 'payment:payment-gateway', ['uncanonical', 'grounded', 'active'], {});
    const lookups = await buildArchitxtLookups(db);

    const result = await resolveHindsightNode(db, serverId, 'Mozart-API', lookups, { label: 'payment:Payment Gateway' });
    assert.equal(result.taxonomy, 'uncanonical-grounded');
    assert.equal(result.id, 'payment:payment-gateway');
    assert.equal(result.existingNode.labels.includes('grounded'), true);
  });

  it('deduplicates candidates against canonical, existing, and batch duplicates', async () => {
    seedEntities(db, [
      { type: 'svc', entityId: 'SVC-001', name: 'Billing Service', aliases: [] },
    ]);
    upsertNode(db, serverId, 'Mozart-API', 'uncanonical:rate-limiter', ['uncanonical', 'discovered', 'active'], {});
    const lookups = await buildArchitxtLookups(db);

    const candidates = [
      { id: 'billing', name: 'Billing Service', aliases: ['billing'] },
      { id: 'rate-limiter', name: 'Rate Limiter', aliases: ['rate-limiter'] },
      { id: 'rate-limiter-2', name: 'Rate Limiter', aliases: [] },
      { id: 'invoice-gateway', name: 'Invoice Gateway', aliases: [] },
    ];

    const { unique, mergedIntoExisting } = await dedupeCandidates(db, serverId, 'Mozart-API', lookups, candidates);

    assert.equal(unique.length, 1);
    assert.equal(unique[0].id, 'candidate:invoice-gateway');
    assert.equal(mergedIntoExisting.length, 3);
  });

  it('builds deterministic edge ids', () => {
    const id1 = buildEdgeId('a', 'b', 'calls', 'hindsight');
    const id2 = buildEdgeId('b', 'a', 'calls', 'hindsight');
    assert.equal(id1, id2);
    assert.ok(id1.startsWith('hindsight:'));

    const typed = buildEdgeId('a', 'b', 'sends', 'edge-ctx');
    assert.notEqual(id1, typed);
  });
});
