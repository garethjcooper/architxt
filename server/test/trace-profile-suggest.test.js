import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildTraceProfileSuggestionPrompt,
  detectDelimiterForSuggestion,
} from '../src/services/trace/trace-profile-suggest.js';

describe('trace profile suggestion prompt', () => {
  it('detects tab, comma, pipe, space, and semicolon delimiters', () => {
    assert.equal(detectDelimiterForSuggestion('a\tb\tc\nd\te\tf'), '\t');
    assert.equal(detectDelimiterForSuggestion('a,b,c\nd,e,f'), ',');
    assert.equal(detectDelimiterForSuggestion('a|b|c\nd|e|f'), '|');
    assert.equal(detectDelimiterForSuggestion('a;b;c\nd;e;f'), ';');
    // Space is trickier: tab/comma/pipe/semicolon are absent, and every row has multiple space-separated tokens.
    assert.equal(detectDelimiterForSuggestion('a b c\nd e f'), ' ');
  });

  it('ignores XML/JSON continuation lines when detecting delimiters', () => {
    const sample = [
      'hash_key\tactivity_source\toriginal_event',
      'aabbccdd00112233445566778899aabb\tAPPLOG\tstart',
      '<?xml version="1.0"?',
      '<soap:Envelope/>',
    ].join('\n');
    assert.equal(detectDelimiterForSuggestion(sample), '\t');
  });

  it('includes the detected delimiter in the generation prompt', () => {
    const sample = 'a\tb\tc\nd\te\tf';
    const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig: {} });
    assert.ok(prompt.includes('Detected field delimiter'), 'prompt should mention delimiter detection');
    assert.ok(prompt.includes('"\\t"'), 'prompt should include the tab delimiter');
  });

  it('truncates a large sample to a bounded number of records when a config is provided', () => {
    const sample = Array.from({ length: 120 }, (_, i) =>
      `[5/9/17 10:35:41:868 NZST] 000000b3 APPLOG I ~REPLY~GenericService_retrieveInfo_V1~retrieveInfo 0000015bea34350a${i}\n<payload/>`
    ).join('\n');

    const currentConfig = {
      parser: {
        module: 'plaintext',
        config: {
          records: {
            recordStartPattern: '^(\\[(?<timestamp>\\d{1,2}/\\d{1,2}/\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3} [A-Z]+)\\])',
          },
        },
      },
    };

    const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig, sampleBudget: 5000 });

    assert.ok(prompt.includes('budget: 5000 chars'), 'should report the configured budget');
    assert.ok(prompt.includes('sample has been truncated'), 'should include truncation note');
    const matches = prompt.match(/0000015bea34350a(\d+)/g) || [];
    assert.ok(matches.length <= 40, `expected at most 40 records with 5k budget, got ${matches.length}`);
  });

  it('uses a larger budget to include more records', () => {
    const sample = Array.from({ length: 120 }, (_, i) =>
      `[5/9/17 10:35:41:868 NZST] 000000b3 APPLOG I ~REPLY~GenericService_retrieveInfo_V1~retrieveInfo 0000015bea34350a${i}\n<payload/>`
    ).join('\n');

    const currentConfig = {
      parser: {
        module: 'plaintext',
        config: {
          records: {
            recordStartPattern: '^(\\[(?<timestamp>\\d{1,2}/\\d{1,2}/\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3} [A-Z]+)\\])',
          },
        },
      },
    };

    const smallPrompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig, sampleBudget: 5000 });
    const largePrompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig, sampleBudget: 50000 });

    const smallRecords = (smallPrompt.match(/0000015bea34350a(\d+)/g) || []).length;
    const largeRecords = (largePrompt.match(/0000015bea34350a(\d+)/g) || []).length;
    assert.ok(largeRecords > smallRecords, `expected larger budget to include more records: ${largeRecords} > ${smallRecords}`);
  });

  it('includes unmatched records from coverage result in the prompt', () => {
    const sample = Array.from({ length: 120 }, (_, i) =>
      `[5/9/17 10:35:41:868 NZST] 000000b3 APPLOG I ~REPLY~GenericService_retrieveInfo_V1~retrieveInfo 0000015bea34350a${i}\n<payload/>`
    ).join('\n');

    const currentConfig = {
      parser: {
        module: 'plaintext',
        config: {
          records: {
            recordStartPattern: '^(\\[(?<timestamp>\\d{1,2}/\\d{1,2}/\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3} [A-Z]+)\\])',
          },
        },
      },
    };

    const coverageResult = {
      totalRecords: 120,
      totalMatched: 119,
      overallCoverage: 99.2,
      valid: true,
      chunks: [
        {
          chunkId: 0,
          range: { startLine: 0, endLine: 119 },
          totalRecords: 120,
          matched: 119,
          unmatched: 1,
          coverage: 99.2,
          unparsedSamples: [
            '[5/9/17 10:35:41:868 NZST] 000000b3 APPLOG I ~REPLY~GenericService_retrieveInfo_V1~retrieveInfo UNMATCHED_RECORD_MARKER',
          ],
        },
      ],
    };

    const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig, coverageResult });

    assert.ok(prompt.includes('UNMATCHED_RECORD_MARKER'), 'should include the actual unmatched sample');
    assert.ok(prompt.includes('Fix those records first'), 'should instruct the model to fix unmatched samples first');
  });

  it('keeps a small sample intact', () => {
    const sample = '[5/9/17 10:35:41:868 NZST] 000000b3 APPLOG I ~REPLY~GenericService_retrieveInfo_V1~retrieveInfo 0000015bea34350a\n<payload/>';
    const currentConfig = {
      parser: {
        module: 'plaintext',
        config: {
          records: {
            recordStartPattern: '^(\\[(?<timestamp>\\d{1,2}/\\d{1,2}/\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3} [A-Z]+)\\])',
          },
        },
      },
    };

    const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig });

    assert.ok(!prompt.includes('sample has been truncated'), 'should not truncate small sample');
    assert.ok(prompt.includes('GenericService_retrieveInfo_V1'), 'should include the sample record');
  });

  it('falls back to line limit for blank initial generation', () => {
    const sample = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');

    const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig: {} });

    assert.ok(prompt.includes('Generate an Architxt trace profile parser config'), 'should be generation prompt');
    const lineCount = prompt.split('\n').filter((l) => l.startsWith('line ')).length;
    assert.ok(lineCount <= 160, `expected fallback line limit, got ${lineCount}`);
  });

  it('returns provenance metadata describing the LLM input', () => {
    const sample = Array.from({ length: 120 }, (_, i) =>
      `[5/9/17 10:35:41:868 NZST] 000000b3 APPLOG I ~REPLY~GenericService_retrieveInfo_V1~retrieveInfo 0000015bea34350a${i}\n<payload/>`
    ).join('\n');

    const currentConfig = {
      parser: {
        module: 'plaintext',
        config: {
          records: {
            recordStartPattern: '^(\\[(?<timestamp>\\d{1,2}/\\d{1,2}/\\d{2} \\d{2}:\\d{2}:\\d{2}:\\d{3} [A-Z]+)\\])',
          },
        },
      },
    };

    const coverageResult = {
      totalRecords: 120,
      totalMatched: 60,
      overallCoverage: 50,
      valid: true,
      chunks: [],
    };

    const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig, coverageResult, sampleBudget: 5000 });

    assert.ok(prompt.includes('budget: 5000 chars'));
    assert.ok(prompt.includes('sample has been truncated'));
    assert.ok(prompt.includes('COVERAGE RESULT START'));
    assert.ok(prompt.includes('CURRENT CONFIG START'));
  });

  it('prompt forbids field-level extraction rules', () => {
    const sample = 'a\tb\tc\nd\te\tf';
    const prompt = buildTraceProfileSuggestionPrompt(sample, { currentConfig: {} });
    assert.ok(prompt.includes('Do NOT emit fieldMap, fieldExtraction, kindMap, payloadExtraction'));
    assert.ok(prompt.includes('The parser emits raw detected rows'));
    assert.ok(!prompt.includes('kindMap') || !prompt.includes('kindMap:'), 'should not instruct LLM to emit kindMap');
  });
});
