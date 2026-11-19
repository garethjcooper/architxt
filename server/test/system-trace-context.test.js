import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  SYSTEM_TRACE_CONTEXT_NAME,
  SYSTEM_TRACE_CONTEXT_TEXT,
  applySystemTraceContext,
} from '../src/services/trace/system-context.js';

describe('system trace context', () => {
  it('exports a non-empty canonical text with a stable name', () => {
    assert.strictEqual(SYSTEM_TRACE_CONTEXT_NAME, 'system-trace');
    assert.ok(typeof SYSTEM_TRACE_CONTEXT_TEXT === 'string');
    assert.ok(SYSTEM_TRACE_CONTEXT_TEXT.includes('system-trace'));
    assert.ok(SYSTEM_TRACE_CONTEXT_TEXT.includes('Trace Sequence Analysis'));
    assert.ok(SYSTEM_TRACE_CONTEXT_TEXT.includes('Entity and Direction'));
    assert.ok(!SYSTEM_TRACE_CONTEXT_TEXT.includes('Cleaned Trace Log'));
  });

  it('prepends the system text to a user context for trace documents', () => {
    const result = applySystemTraceContext('my project context', 'trace');
    assert.ok(result.startsWith(SYSTEM_TRACE_CONTEXT_TEXT));
    assert.ok(result.includes('my project context'));
    // system text first, then separator, then user text
    assert.ok(result.indexOf(SYSTEM_TRACE_CONTEXT_TEXT) < result.indexOf('my project context'));
  });

  it('returns only the system text for trace documents with no user context', () => {
    assert.strictEqual(applySystemTraceContext(null, 'trace'), SYSTEM_TRACE_CONTEXT_TEXT);
    assert.strictEqual(applySystemTraceContext(undefined, 'trace'), SYSTEM_TRACE_CONTEXT_TEXT);
    assert.strictEqual(applySystemTraceContext('   ', 'trace'), SYSTEM_TRACE_CONTEXT_TEXT);
  });

  it('passes non-trace documents through unchanged', () => {
    assert.strictEqual(applySystemTraceContext('my context', 'document'), 'my context');
    assert.strictEqual(applySystemTraceContext('my context', null), 'my context');
    assert.strictEqual(applySystemTraceContext('my context', undefined), 'my context');
    assert.strictEqual(applySystemTraceContext(null, 'document'), null);
  });
});

describe('system trace context at the CRUD layer', () => {
  it('prepends system text in getDocument/listDocuments for trace docs only', async () => {
    const { default: Database } = await import('better-sqlite3');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { ensureSchema } = await import('../src/db/ensure-schema.js');
    const { clearCache } = await import('../src/cache.js');
    const { createDocument, getDocument, listDocuments } = await import('../src/db/crud/documents.js');
    const { createContext } = await import('../src/db/crud/contexts.js');

    const file = path.join(process.cwd(), `tmp/test-system-trace-ctx-${Date.now()}.db`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureSchema(db);

    try {
      clearCache();
      const ctxId = createContext(db, { ctxt_desc: 'user project context', ctxt_generated_by: 'user' });
      assert.ok(ctxId.success, `context created: ${ctxId.error}`);

      const traceId = createDocument(db, {
        doc_source_path: '/tmp/trace.log', doc_source_type: 'trace', ctxt_id: ctxId.data, doc_status: 'processed',
      });
      assert.ok(traceId.success, `trace doc created: ${traceId.error}`);

      const plainId = createDocument(db, {
        doc_source_path: '/tmp/doc.pdf', doc_source_type: 'document', ctxt_id: ctxId.data, doc_status: 'processed',
      });
      assert.ok(plainId.success, `plain doc created: ${plainId.error}`);

      const traceDoc = getDocument(db, traceId.data);
      assert.ok(traceDoc.success);
      assert.ok(traceDoc.data.doc_context.description.startsWith(SYSTEM_TRACE_CONTEXT_TEXT));
      assert.ok(traceDoc.data.doc_context.description.includes('user project context'));
      assert.strictEqual(traceDoc.data.doc_context.id, ctxId.data);

      const plainDoc = getDocument(db, plainId.data);
      assert.ok(plainDoc.success);
      assert.strictEqual(plainDoc.data.doc_context.description, 'user project context');

      const list = listDocuments(db, {});
      assert.ok(list.success);
      const traceRow = list.data.find(r => r.doc_id === traceId.data);
      const plainRow = list.data.find(r => r.doc_id === plainId.data);
      assert.ok(traceRow.doc_context.description.startsWith(SYSTEM_TRACE_CONTEXT_TEXT));
      assert.strictEqual(plainRow.doc_context.description, 'user project context');
    } finally {
      db.close();
      fs.unlinkSync(file);
      fs.rmSync(path.join(process.cwd(), `tmp/test-system-trace-ctx-${path.basename(file, '.db')}.db-wal`), { force: true });
      fs.rmSync(path.join(process.cwd(), `tmp/test-system-trace-ctx-${path.basename(file, '.db')}.db-shm`), { force: true });
    }
  });
});
