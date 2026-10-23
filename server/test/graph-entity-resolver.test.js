import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { clearCache } from '../src/cache.js';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { createEntityType } from '../src/db/crud/entity-types.js';
import { createEntity } from '../src/db/crud/entities.js';
import {
  resolveGraphEntities,
  resolveTextEntitiesToGraphNodes,
  rewriteEdgeEndpoints,
} from '../src/services/graph-entity-resolver.js';

function getTestDb() {
  clearCache();
  const file = path.join(process.cwd(), `tmp/test-graph-entity-resolver-${Date.now()}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return { db, file };
}

describe('graph-entity-resolver', () => {
  let db;
  let file;

  beforeEach(() => {
    ({ db, file } = getTestDb());
  });

  afterEach(() => {
    db.close();
    try { fs.unlinkSync(file); } catch {}
  });

  describe('resolveGraphEntities', () => {
    it('resolves raw ids, names, and aliases to canonical ids', async () => {
      const typeResult = createEntityType(db, {
        type_name: 'a-com',
        description: 'component',
      });
      assert.equal(typeResult.success, true, typeResult.error);
      const typeId = typeResult.data;

      createEntity(db, {
        type_id: typeId,
        entity_id: 'COM-127',
        name: 'Order Management',
        aliases: ['OM'],
      });
      createEntity(db, {
        type_id: typeId,
        entity_id: 'COM-002',
        name: 'Resource Order',
        aliases: [],
      });

      const result = await resolveGraphEntities(db, [
        { id: 'OM' },
        { id: 'COM-002' },
      ]);

      assert.equal(result.success, true, result.error);
      assert.equal(result.nodes.length, 2);
      assert.deepEqual(
        result.nodes.map((n) => n.canonical_id).sort(),
        ['a-com:COM-002', 'a-com:COM-127']
      );

      assert.equal(result.aliases['om'], 'a-com:COM-127');
      assert.equal(result.aliases['order management'], 'a-com:COM-127');
      assert.equal(result.aliases['com-127'], 'a-com:COM-127');
      assert.equal(result.aliases['com-002'], 'a-com:COM-002');
    });
  });

  describe('rewriteEdgeEndpoints', () => {
    it('rewrites endpoints using normalized alias keys', () => {
      const edges = [
        { from: 'OM', to: 'COM-002', label: 'status' },
        { from: 'Order Management', to: 'a-com:COM-002', label: 'create' },
        { from: 'Unknown', to: 'COM-002', label: 'orphan' },
      ];

      const aliases = {
        om: 'a-com:COM-127',
        'order management': 'a-com:COM-127',
        'com-002': 'a-com:COM-002',
        'a-com:com-002': 'a-com:COM-002',
      };

      const rewritten = rewriteEdgeEndpoints(edges, aliases);

      assert.equal(rewritten[0].from, 'a-com:COM-127');
      assert.equal(rewritten[0].to, 'a-com:COM-002');
      assert.equal(rewritten[0].label, 'status');

      assert.equal(rewritten[1].from, 'a-com:COM-127');
      assert.equal(rewritten[1].to, 'a-com:COM-002');

      assert.equal(rewritten[2].from, 'Unknown');
      assert.equal(rewritten[2].to, 'a-com:COM-002');
    });

    it('is case-insensitive and ignores extra whitespace', () => {
      const edges = [{ from: '  OM  ', to: 'com-002' }];
      const aliases = { OM: 'a-com:COM-127', 'COM-002': 'a-com:COM-002' };

      const rewritten = rewriteEdgeEndpoints(edges, aliases);

      assert.equal(rewritten[0].from, 'a-com:COM-127');
      assert.equal(rewritten[0].to, 'a-com:COM-002');
    });
  });

  describe('resolveTextEntitiesToGraphNodes', () => {
    it('returns canonical graph-node shape for entities mentioned in text', async () => {
      const typeResult = createEntityType(db, {
        type_name: 'a-com',
        description: 'component',
      });
      assert.equal(typeResult.success, true, typeResult.error);
      const typeId = typeResult.data;

      createEntity(db, {
        type_id: typeId,
        entity_id: 'COM-127',
        name: 'Order Management',
        aliases: ['OM'],
      });
      createEntity(db, {
        type_id: typeId,
        entity_id: 'COM-002',
        name: 'Resource Order',
        aliases: [],
      });

      const result = await resolveTextEntitiesToGraphNodes(db, 'Order Management creates a Resource Order.');

      assert.equal(result.success, true, result.error);
      assert.equal(result.nodes.length, 2);
      const ids = result.nodes.map((n) => n.canonical_id).sort();
      assert.deepEqual(ids, ['a-com:COM-002', 'a-com:COM-127']);
      assert.ok(result.nodes.every((n) => n.db_id && n.entity_id && n.canonical_reference));
    });
  });
});
