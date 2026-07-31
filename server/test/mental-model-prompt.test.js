import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { composeMentalModelPrompt } from '../src/prompts/template-service.js';

const RETURNS_MODES = [
  'narrative',
  'graph-known',
  'graph-discovery',
  'narrative-graph-known',
  'narrative-graph-discovery',
];

describe('composeMentalModelPrompt', () => {
  it('includes the rendered topic in every built-in template', async () => {
    const file = path.join(process.cwd(), `tmp/test-compose-prompt-${Date.now()}.db`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      ensureSchema(db);

      const topic = 'What are the architectural capabilities for ExampleSystem (COM-001)?';
      for (const mode of RETURNS_MODES) {
        const prompt = await composeMentalModelPrompt(db, mode, topic);
        assert.ok(
          prompt.includes(topic),
          `composed prompt for ${mode} should include the topic`,
        );
        assert.ok(
          !prompt.includes('{{ARCHITXT_TOPIC}}'),
          `composed prompt for ${mode} should not contain unsubstituted ARCHITXT_TOPIC placeholder`,
        );
      }
    } finally {
      db.close();
      fs.unlinkSync(file);
    }
  });
});
