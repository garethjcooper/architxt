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
import { STANDARD_EDGE_TYPES } from '../src/db/crud/edge-types.js';

const logger = createLogger('edge-types-test');

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-edge-types-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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
    // Replace entities route's imported singleton db with request-scoped db
    res.locals.db = db;
    next();
  });
  entitiesRouter.use(entitiesRoute);
  app.use('/api/v1/entities', entitiesRouter);
  return app;
}

describe('Edge types API', () => {
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

  it('lists standard edge types immediately after schema ensure', async () => {
    const res = await request(app).get('/api/v1/entities/edge-types').expect(200);
    assert.equal(res.body.length, STANDARD_EDGE_TYPES.length);
    for (const standard of STANDARD_EDGE_TYPES) {
      assert.ok(res.body.some((t) => t.type_name === standard.type_name));
    }
  });

  it('creates a new edge type with required description', async () => {
    const res = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'owns', description: 'A owns B' })
      .expect(201);
    assert.equal(typeof res.body.id, 'number');
  });

  it('rejects create without description', async () => {
    const res = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'no-desc' })
      .expect(400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.toLowerCase().includes('description'));
  });

  it('rejects empty description', async () => {
    const res = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'empty-desc', description: '   ' })
      .expect(400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
  });

  it('normalizes type name to lowercase slug', async () => {
    const res = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'sends-data-to', description: 'Sends data to', c4_description: 'sends data to' })
      .expect(201);
    const getRes = await request(app).get(`/api/v1/entities/edge-types/${res.body.id}`).expect(200);
    assert.equal(getRes.body.type_name, 'sends-data-to');
    assert.equal(getRes.body.c4_description, 'sends data to');
  });

  it('lists created edge types including standards', async () => {
    const res = await request(app).get('/api/v1/entities/edge-types').expect(200);
    assert.equal(res.body.length, STANDARD_EDGE_TYPES.length + 2);
    assert.ok(res.body.every((t) => t.type_name && t.id));
  });

  it('rejects duplicate edge type names', async () => {
    const res = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'calls', description: 'duplicate' })
      .expect(409);
    assert.equal(res.body.code, 'DUPLICATE_KEY');
  });

  it('rejects invalid type names', async () => {
    await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'has space', description: 'x' })
      .expect(400);
    await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'UPPER', description: 'x' })
      .expect(400);
    await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: '-leading', description: 'x' })
      .expect(400);
    await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'trailing-', description: 'x' })
      .expect(400);
    await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'a--b', description: 'x' })
      .expect(400);
  });

  it('rejects invalid archimate relationship', async () => {
    const res = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'bad-archimate', description: 'x', archimate_relationship: 'not-real' })
      .expect(400);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.toLowerCase().includes('archimate'));
  });

  it('accepts valid archimate relationship', async () => {
    const res = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'valid-archimate', description: 'x', archimate_relationship: 'flow' })
      .expect(201);
    const getRes = await request(app).get(`/api/v1/entities/edge-types/${res.body.id}`).expect(200);
    assert.equal(getRes.body.archimate_relationship, 'flow');
  });

  it('updates an edge type', async () => {
    const createRes = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'update-me', description: 'before' })
      .expect(201);
    await request(app)
      .put(`/api/v1/entities/edge-types/${createRes.body.id}`)
      .send({ description: 'Ownership relationship', archimate_relationship: 'aggregation' })
      .expect(200);
    const getRes = await request(app).get(`/api/v1/entities/edge-types/${createRes.body.id}`).expect(200);
    assert.equal(getRes.body.description, 'Ownership relationship');
    assert.equal(getRes.body.archimate_relationship, 'aggregation');
  });

  it('rejects update with empty description', async () => {
    const createRes = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'desc-required-on-update', description: 'before' })
      .expect(201);
    await request(app)
      .put(`/api/v1/entities/edge-types/${createRes.body.id}`)
      .send({ description: '   ' })
      .expect(400);
  });

  it('rejects empty update body', async () => {
    const createRes = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'relates-to', description: 'x' })
      .expect(201);
    await request(app)
      .put(`/api/v1/entities/edge-types/${createRes.body.id}`)
      .send({})
      .expect(400);
  });

  it('returns 404 for missing edge type', async () => {
    const res = await request(app).get('/api/v1/entities/edge-types/999999').expect(404);
    assert.equal(res.body.error, 'Edge type not found');
  });

  it('deletes an edge type', async () => {
    const createRes = await request(app)
      .post('/api/v1/entities/edge-types')
      .send({ type_name: 'delete-me', description: 'to delete' })
      .expect(201);
    await request(app).delete(`/api/v1/entities/edge-types/${createRes.body.id}`).expect(204);
    await request(app).get(`/api/v1/entities/edge-types/${createRes.body.id}`).expect(404);
  });
});
