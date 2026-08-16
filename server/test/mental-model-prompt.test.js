import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { ensureSchema } from '../src/db/ensure-schema.js';
import { composeMentalModelPrompt, formatFocusVariable } from '../src/prompts/template-service.js';
import { validateEntityTemplateEligibility } from '../src/db/crud/mental-models.js';

const NON_CONTEXTUAL_MODES = [
  'generic',
];

describe('composeMentalModelPrompt', () => {
  it('includes the rendered topic in every non-contextual built-in template', async () => {
    const file = path.join(process.cwd(), `tmp/test-compose-prompt-${Date.now()}.db`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      ensureSchema(db);

      const topic = 'What are the architectural capabilities for ExampleSystem (COM-001)?';
      for (const mode of NON_CONTEXTUAL_MODES) {
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

describe('formatFocusVariable', () => {
  it('preserves entity labels but strips bracket tags in diagram focus', () => {
    const result = formatFocusVariable([
      {
        name: 'System [[Singleview (Company:COM-001)]] context',
        type: 'flowchart',
        content: 'Show [[Singleview (Company:COM-001)]] generating reports',
      },
    ]);
    assert.ok(!result.includes('[['), 'result should not contain entity bracket tags');
    assert.ok(!result.includes('(Company:COM-001)'), 'result should strip parenthetical IDs');
    assert.ok(!result.includes('(COM-001)'), 'result should strip any parenthetical ID');
    assert.ok(result.includes('System'), 'result should keep non-entity words');
    assert.ok(result.includes('Singleview'), 'result should preserve entity label');
    assert.ok(result.includes('context'), 'result should keep non-entity words');
    assert.ok(result.includes('generating reports'), 'result should keep directive content words');
  });

  it('strips entity tags and parenthetical IDs from table and narrative focus too', () => {
    const table = formatFocusVariable([{ name: '[[CRM (App:APP-001)]]', content: 'List [[CRM (App:APP-001)]] fields' }]);
    assert.ok(!table.includes('[['));
    assert.ok(!table.includes('(App:APP-001)'));
    assert.ok(table.includes('CRM'));

    const narrative = formatFocusVariable('Summarize [[CRM (App:APP-001)]] capabilities');
    assert.ok(!narrative.includes('[['));
    assert.ok(!narrative.includes('(App:APP-001)'));
    assert.ok(narrative.includes('CRM'));
    assert.ok(narrative.includes('capabilities'));
  });
});

describe('validateEntityTemplateEligibility', () => {
  it('accepts legacy entity placeholders', () => {
    const result = validateEntityTemplateEligibility({
      mm_is_template: 'true',
      mm_name: 'Summary for {entity-name}',
      mm_ext_id: 'summary-{entity-id}',
      mm_source_query: '',
    });
    assert.equal(result.valid, true);
  });

  it('accepts contextual-graph placeholders', () => {
    const result = validateEntityTemplateEligibility({
      mm_is_template: 'true',
      mm_name: 'Edge context: {source-name} ↔ {target-name}',
      mm_ext_id: 'edge-ctx-{source-id}|{target-id}',
      mm_source_query: '',
    });
    assert.equal(result.valid, true);
  });

  it('rejects templates with no supported placeholders', () => {
    const result = validateEntityTemplateEligibility({
      mm_is_template: 'true',
      mm_name: 'Static name',
      mm_ext_id: 'static-id',
      mm_source_query: '',
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'VALIDATION_ERROR');
  });

  it('does not validate non-templates', () => {
    const result = validateEntityTemplateEligibility({
      mm_is_template: 'false',
      mm_name: 'Static name',
      mm_ext_id: 'static-id',
      mm_source_query: '',
    });
    assert.equal(result.valid, true);
  });
});
