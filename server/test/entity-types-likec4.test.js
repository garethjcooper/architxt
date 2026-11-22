import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ensureSchema } from '../src/db/ensure-schema.js';
import entitiesRoute from '../src/routes/entities.js';
import { createLogger } from '../src/utils/logger.js';
import { LIKEC4_SHAPES, normalizeLikeC4Shape } from '../src/db/crud/entity-types.js';

const logger = createLogger('entity-types-likec4-test');

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-entity-types-likec4-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  return { db, file };
}

function createApp(db) {
  const app = express();
  app.locals.config = { logger };
  app.use(express.json({ limit: '50mb' }));
  const entitiesRouter = express.Router();
  entitiesRouter.use((req, res, next) => {
    req.app.locals.db = db;
    res.locals.db = db;
    next();
  });
  entitiesRouter.use(entitiesRoute);
  app.use('/api/v1/entities', entitiesRouter);
  return app;
}

describe('normalizeLikeC4Shape', () => {
  it('returns null for null/undefined/empty', () => {
    assert.equal(normalizeLikeC4Shape(null), null);
    assert.equal(normalizeLikeC4Shape(undefined), null);
    assert.equal(normalizeLikeC4Shape('  '), null);
  });

  it('accepts every documented LikeC4 shape', () => {
    for (const shape of LIKEC4_SHAPES) {
      assert.equal(normalizeLikeC4Shape(shape), shape);
    }
  });

  it('rejects unknown shapes', () => {
    assert.throws(() => normalizeLikeC4Shape('hexagon'), /likec4_shape must be one of/);
  });
});

describe('Entity types likec4_shape API', () => {
  let db;
  let file;
  let app;

  before(() => {
    ({ db, file } = createTestDb());
    app = createApp(db);
  });

  after(() => {
    db.close();
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore
    }
  });

  it('creates an entity type with a likec4_shape', async () => {
    const res = await request(app)
      .post('/api/v1/entities/types')
      .send({ type_name: 'lk-db', description: 'database type', likec4_shape: 'storage' });
    assert.equal(res.status, 201);
    assert.ok(res.body.id);

    const list = await request(app).get('/api/v1/entities/types');
    assert.equal(list.status, 200);
    const found = list.body.find((t) => t.id === res.body.id);
    assert.ok(found);
    assert.equal(found.likec4_shape, 'storage');
  });

  it('creates an entity type with likec4_shape null (default rectangle)', async () => {
    const res = await request(app)
      .post('/api/v1/entities/types')
      .send({ type_name: 'lk-plain', description: 'plain type' });
    assert.equal(res.status, 201);

    const list = await request(app).get('/api/v1/entities/types');
    const found = list.body.find((t) => t.id === res.body.id);
    assert.equal(found.likec4_shape, null);
  });

  it('rejects an invalid likec4_shape on create', async () => {
    const res = await request(app)
      .post('/api/v1/entities/types')
      .send({ type_name: 'lk-bad', likec4_shape: 'hexagon' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.toLowerCase().includes('likec4_shape'));
  });

  it('updates likec4_shape and can clear it', async () => {
    const created = await request(app)
      .post('/api/v1/entities/types')
      .send({ type_name: 'lk-upd', likec4_shape: 'queue' });
    assert.equal(created.status, 201);
    const id = created.body.id;

    const upd = await request(app)
      .put(`/api/v1/entities/types/${id}`)
      .send({ likec4_shape: 'cylinder' });
    assert.equal(upd.status, 200);

    const getLikeC4 = async () => {
      const list = await request(app).get('/api/v1/entities/types');
      return list.body.find((t) => t.id === id).likec4_shape;
    };
    assert.equal(await getLikeC4(), 'cylinder');

    const cleared = await request(app)
      .put(`/api/v1/entities/types/${id}`)
      .send({ likec4_shape: null });
    assert.equal(cleared.status, 200);

    assert.equal(await getLikeC4(), null);
  });

  it('rejects an invalid likec4_shape on update', async () => {
    const created = await request(app)
      .post('/api/v1/entities/types')
      .send({ type_name: 'lk-bad2' });
    const id = created.body.id;

    const res = await request(app)
      .put(`/api/v1/entities/types/${id}`)
      .send({ likec4_shape: 'star' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.toLowerCase().includes('likec4_shape'));
  });
});
