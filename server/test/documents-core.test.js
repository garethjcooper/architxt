import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { ensureSchema } from '../src/db/ensure-schema.js';
import documentsRoute from '../src/routes/documents.js';
import { config } from '../src/config.js';

function createTestDb() {
  const file = path.join(process.cwd(), `tmp/test-documents-core-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  ensureSchema(db);
  db.prepare('INSERT INTO servers (svr_name, svr_base_url) VALUES (?, ?)').run('Test', 'http://hindsight');
  return { db, file };
}

function createApp(db, storagePath) {
  const originalStoragePath = config.storage?.path;
  if (!config.storage) config.storage = {};
  config.storage.path = storagePath;

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.locals.db = db;
  app.use('/api/v1/documents', documentsRoute);

  app.locals._restoreStorage = () => {
    config.storage.path = originalStoragePath;
  };
  return app;
}

describe('documents core trace endpoints', () => {
  let db;
  let file;
  let app;
  let storagePath;

  before(() => {
    ({ db, file } = createTestDb());
    storagePath = path.join(process.cwd(), `tmp/test-trace-storage-${Date.now()}`);
    fs.mkdirSync(storagePath, { recursive: true });
    app = createApp(db, storagePath);
  });

  after(() => {
    db.close();
    app.locals._restoreStorage?.();
    try { fs.rmSync(file, { force: true }); } catch {}
    try { fs.rmSync(storagePath, { recursive: true, force: true }); } catch {}
  });

  describe('POST /api/v1/documents (trace mode)', () => {
    it('creates a trace document from a single source file', async () => {
      const extId = `order-logs-${Date.now()}`;
      const res = await request(app)
        .post('/api/v1/documents')
        .field('ext_id', extId)
        .field('source_type', 'trace')
        .field('trace_profile', 'interface-csv')
        .attach('file', Buffer.from('span1\t2024-01-01T00:00:00Z\tA\tGET /x\tB\n'), 'trace1.log');

      assert.equal(res.status, 201);
      assert.equal(res.body.source_type, 'trace');
      assert.equal(res.body.processing_options?.trace_profile, 'interface-csv');
      assert.equal(res.body.source_path, path.join(storagePath, String(res.body.id), 'source.log'));

      const doc = db.prepare('SELECT doc_filename, doc_processing_options FROM documents WHERE doc_ext_id = ?').get(extId);
      assert.equal(doc.doc_filename, 'trace1.log');
      const options = JSON.parse(doc.doc_processing_options);
      assert.equal(options.trace_profile, 'interface-csv');
      assert.equal(options.trace_files, undefined);
    });
  });

  describe('POST /api/v1/documents/batch/updateconfig', () => {
    function insertDoc(extId, sourceType) {
      const info = db.prepare(
        `INSERT INTO documents (doc_ext_id, doc_status, doc_source_path, doc_source_type, doc_processing_options, doc_timestamp)
         VALUES (?, 'uploaded', ?, ?, ?, '2024-01-01T00:00:00.000Z')`
      ).run(extId, `/tmp/${extId}`, sourceType, sourceType === 'trace' ? JSON.stringify({ stages: { extract: true }, trace_profile: 'old-profile' }) : JSON.stringify({ stages: { extract: true } }));
      return Number(info.lastInsertRowid);
    }

    it('updates trace_profile only on trace documents and skips plain documents', async () => {
      const traceId = insertDoc(`batch-trace-${Date.now()}`, 'trace');
      const docId = insertDoc(`batch-doc-${Date.now()}`, 'document');

      const res = await request(app)
        .post('/api/v1/documents/batch/updateconfig')
        .send({ document_ids: [traceId, docId], trace_profile: 'new-profile' });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.trace_docs_updated, 1);
      assert.equal(res.body.trace_docs_skipped, 1);

      const traceRow = db.prepare('SELECT doc_processing_options, doc_timestamp FROM documents WHERE doc_id = ?').get(traceId);
      assert.equal(JSON.parse(traceRow.doc_processing_options).trace_profile, 'new-profile');
      // stages preserved
      assert.equal(JSON.parse(traceRow.doc_processing_options).stages.extract, true);
      // timestamp untouched when only trace_profile sent
      assert.equal(traceRow.doc_timestamp, '2024-01-01T00:00:00.000Z');

      const docRow = db.prepare('SELECT doc_processing_options FROM documents WHERE doc_id = ?').get(docId);
      assert.equal(JSON.parse(docRow.doc_processing_options).trace_profile, undefined);
    });

    it('still updates timestamp for all docs and clears trace_profile with null', async () => {
      const traceId = insertDoc(`batch-trace2-${Date.now()}`, 'trace');
      const docId = insertDoc(`batch-doc2-${Date.now()}`, 'document');

      const res = await request(app)
        .post('/api/v1/documents/batch/updateconfig')
        .send({ document_ids: [traceId, docId], timestamp: '2025-06-01T12:00:00.000Z', trace_profile: null });

      assert.equal(res.status, 200);
      assert.equal(res.body.docs_updated, 2);
      assert.equal(res.body.trace_docs_updated, 1);
      assert.equal(res.body.trace_docs_skipped, 1);

      for (const id of [traceId, docId]) {
        const row = db.prepare('SELECT doc_timestamp FROM documents WHERE doc_id = ?').get(id);
        assert.equal(row.doc_timestamp, '2025-06-01T12:00:00.000Z');
      }
      const traceRow = db.prepare('SELECT doc_processing_options FROM documents WHERE doc_id = ?').get(traceId);
      assert.equal(JSON.parse(traceRow.doc_processing_options).trace_profile, null);
    });

    it('rejects a request with neither timestamp nor trace_profile', async () => {
      const res = await request(app)
        .post('/api/v1/documents/batch/updateconfig')
        .send({ document_ids: [1] });
      assert.equal(res.status, 400);
    });
  });
});
