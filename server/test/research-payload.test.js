import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicQuery } from '../src/services/research/intent.js';
import {
  makeResearchCall,
  executeCall,
  parseResearchResponse,
  parseSynthesisResponse,
  parseReflectFindingsResponse,
} from '../src/services/research/tool-plan.js';

function makeLongQuery(entityCount) {
  const entities = Array.from({ length: entityCount }, (_, i) => `[[System ${i} (SYS-${String(i).padStart(3, '0')})]]`);
  return `${entities.join(' and ')} plus some extra narrative text to make the overall query longer. We want to understand how the query behaves when it contains many entity tokens and a lot of freeform text before the topic boundary.`;
}

function makeSelections(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `SYS-${String(i).padStart(3, '0')}`,
    kind: 'entity',
    label: `System ${i}`,
  }));
}

function makeExtraSelections(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `EXTRA-${String(i).padStart(3, '0')}`,
    kind: 'entity',
    label: `Extra ${i}`,
  }));
}

function makeLegacyExtraSelections(count) {
  return Array.from({ length: count }, (_, i) => ({
    source: 'query_builder',
    kind: 'entity',
    ids: [`EXTRA-${String(i).padStart(3, '0')}`],
    action: 'expand',
    context: `Extra ${i}`,
  }));
}

function makeTopic(query, selections) {
  return { text: query, selections };
}

describe('intent.buildTopicQuery size', () => {
  it('grows linearly with extra entity selections not already in the query', () => {
    const query = makeLongQuery(50);
    const topic = makeTopic(query, makeExtraSelections(50));

    const q = buildTopicQuery(topic, {});
    assert.ok(q.length > query.length, 'scoped query should be longer than raw query when selections add new context');
    assert.ok(q.includes('Selected entities:'), 'should include extra selections');
    assert.ok(!q.includes('Relevant entities:'), 'should not duplicate parsed entities already in topic.text');
  });
  it('buildTopicQuery still works with legacy verbose selection objects', () => {
    const query = makeLongQuery(5);
    const topic = makeTopic(query, makeLegacyExtraSelections(5));

    const q = buildTopicQuery(topic, {});
    assert.ok(q.includes('Selected entities:'), 'should include legacy selections not in query text');
  });
  it('deduplicates selections already present in the query text', () => {
    const query = makeLongQuery(5);
    const topic = makeTopic(query, makeSelections(5));

    const q = buildTopicQuery(topic, {});
    assert.ok(!q.includes('Selected entities:'), 'should not repeat entities already in topic.text');
    assert.equal(q, query, 'query with only redundant selections stays unchanged');
  });
});

describe('tool-plan research call', () => {
  it('makeResearchCall builds a single reflect call with response_schema', () => {
    const call = makeResearchCall('What is [[BillDB (COM-011)]]?', makeSelections(2), { budget: 'low' });

    assert.equal(call.name, 'research_reflect');
    assert.equal(call.args.mode, 'reflect');
    assert.equal(call.args.budget, 'low');
    assert.ok(call.args.response_schema, 'response_schema should be present');
    assert.equal(call.args.response_schema.required.length, 3);
    assert.ok(call.args.query.includes('Research question'));
    assert.ok(call.args.query.includes('Selected entities:'));
    assert.ok(call.metrics.prompt_chars > 0);
    assert.ok(call.metrics.prompt_tokens > 0);
  });

  it('makeResearchCall omits selections when empty', () => {
    const call = makeResearchCall('What is BillDB?', [], {});
    assert.ok(!call.args.query.includes('Selected entities:'));
  });

  it('makeResearchCall includes type and tag filters', () => {
    const call = makeResearchCall('What is BillDB?', [], { types: ['service'], tags: ['billing'], tags_match: 'all' });
    assert.ok(call.args.query.includes('Limit to types:'));
    assert.ok(call.args.query.includes('Filter by tags:'));
    assert.equal(call.args.types.join(','), 'service');
    assert.equal(call.args.tags_match, 'all');
  });
});

describe('tool-plan response parsing', () => {
  it('parseResearchResponse reads findings, seams, and narrative from structured_output', () => {
    const result = parseResearchResponse({
      success: true,
      data: {
        structured_output: {
          findings: [{ id: 'f-1', statement: 'MongoDB is the primary DB.', confidence: 0.9, source_fact_ids: ['m1'] }],
          seams: [{ id: 's-1', type: 'gap', description: 'Migration timeline unclear.', source_fact_ids: [] }],
          narrative: '# BillDB\n\nUses MongoDB.',
        },
        text: 'Uses MongoDB as its primary database.',
        usage: { total_tokens: 123 },
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, 'f-1');
    assert.deepEqual(result.findings[0].source_fact_ids, ['m1']);
    assert.equal(result.seams.length, 1);
    assert.equal(result.seams[0].type, 'gap');
    assert.equal(result.narrative, '# BillDB\n\nUses MongoDB.');
  });

  it('parseResearchResponse fails fast when structured_output is missing', () => {
    const result = parseResearchResponse({
      success: true,
      data: { text: 'Plain narrative answer.' },
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'AGENT_INVALID_RESPONSE');
  });

  it('parseResearchResponse drops malformed findings and seams', () => {
    const result = parseResearchResponse({
      success: true,
      data: {
        structured_output: {
          findings: [
            { id: 'f-1', statement: 'Valid finding.', confidence: 0.9 },
            { id: 'f-2', confidence: 0.5 },
            'not an object',
          ],
          seams: [
            { id: 's-1', type: 'gap', description: 'Valid seam.' },
            { id: 's-2', type: 'contradiction' },
          ],
          narrative: 'Narrative.',
        },
      },
    });
    assert.equal(result.findings.length, 1);
    assert.equal(result.seams.length, 1);
  });

  it('parseReflectFindingsResponse aliases parseResearchResponse', () => {
    const result = parseReflectFindingsResponse({
      success: true,
      data: {
        structured_output: {
          findings: [{ id: 'f-1', statement: 'Aliased.', confidence: 0.9 }],
          seams: [],
          narrative: 'Aliased narrative.',
        },
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.findings[0].statement, 'Aliased.');
    assert.equal(result.narrative, 'Aliased narrative.');
  });

  it('parseSynthesisResponse extracts Markdown from Reflect text', () => {
    const markdown = '# BillDB\n\nIt is a billing database.';
    const result = parseSynthesisResponse(
      { success: true, data: { text: markdown, usage: { total_tokens: 50 } } },
      'reflect',
    );
    assert.equal(result.success, true);
    assert.equal(result.narrative, markdown);
  });

  it('parseSynthesisResponse accepts Markdown string from local LLM', () => {
    const result = parseSynthesisResponse({ success: true, data: '# Summary\n\nIt works.' }, 'local_llm');
    assert.equal(result.success, true);
    assert.equal(result.narrative, '# Summary\n\nIt works.');
  });
});
