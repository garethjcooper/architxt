import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { createTag, updateTag, deleteTag, getTagByName } from '../src/db/crud/tags.js';
import { clearCache } from '../src/cache.js';

function tempDb() {
  clearCache();
  const dir = path.join(process.cwd(), 'test-tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tags-crud-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(file);
  ensureSchema(db);
  return { db, file };
}

function closeAndDelete({ db, file }) {
  try { db.close(); } catch {}
  try { fs.unlinkSync(file); } catch {}
}

test('system tags cannot be updated (FORBIDDEN)', async () => {
  const ctx = tempDb();
  try {
    const tag = getTagByName(ctx.db, 'ARCHITXT-DOC');
    assert.ok(tag?.data, 'seeded system tag exists');
    const result = updateTag(ctx.db, tag.data.tag_id, { tag_name: 'RENAMED' });
    assert.equal(result.success, false);
    assert.equal(result.code, 'FORBIDDEN');
    // Name unchanged
    const after = getTagByName(ctx.db, 'ARCHITXT-DOC');
    assert.ok(after?.data, 'original name still present');
  } finally {
    closeAndDelete(ctx);
  }
});

test('system tags cannot be deleted (FORBIDDEN)', async () => {
  const ctx = tempDb();
  try {
    const tag = getTagByName(ctx.db, 'ARCHITXT-TRACE');
    assert.ok(tag?.data);
    const result = deleteTag(ctx.db, tag.data.tag_id);
    assert.equal(result.success, false);
    assert.equal(result.code, 'FORBIDDEN');
    assert.ok(getTagByName(ctx.db, 'ARCHITXT-TRACE')?.data, 'tag still exists');
  } finally {
    closeAndDelete(ctx);
  }
});

test('user tags remain updatable and deletable', async () => {
  const ctx = tempDb();
  try {
    const created = createTag(ctx.db, { tag_name: 'my-tag', tag_generated_by: 'user' });
    const id = created.data;
    const upd = updateTag(ctx.db, id, { tag_name: 'my-tag-2' });
    assert.equal(upd.success, true);
    assert.ok(getTagByName(ctx.db, 'my-tag-2')?.data);
    const del = deleteTag(ctx.db, id);
    assert.equal(del.success, true);
    assert.equal(del.data, true);
  } finally {
    closeAndDelete(ctx);
  }
});
