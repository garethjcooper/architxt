import assert from 'node:assert';
import { describe, it } from 'node:test';
import { PlaintextParser } from '../src/services/trace/parsers/plaintext-parser.js';
import { DelimitedParser } from '../src/services/trace/parsers/delimited-parser.js';
import { processTraceContent } from '../src/services/trace/index.js';

describe('per-record size cap (records.maxRecordBytes)', () => {
  it('marks oversized plaintext records as unparsed + oversized and skips them', async () => {
    const parser = new PlaintextParser({
      records: { recordStartPattern: '^\\[', maxRecordBytes: 20 },
    });
    const content = '[1] small\n[2] ' + 'x'.repeat(100) + '\n[3] tiny';
    const raw = await parser.parseFile('x', content);
    const { records, oversizedCount } = parser.applyRecordSizeCap(raw);

    assert.equal(records.length, 3);
    assert.equal(oversizedCount, 1);
    assert.equal(records[0].oversized, undefined);
    assert.ok(records[1].oversized);
    assert.ok(records[1].unparsed);
    assert.equal(records[2].oversized, undefined);
  });

  it('cap of 0 or unset means unlimited', async () => {
    const parser = new PlaintextParser({ records: { recordStartPattern: '^\\[' } });
    const content = '[1] ' + 'x'.repeat(10000);
    const { records, oversizedCount } = parser.applyRecordSizeCap(await parser.parseFile('x', content));
    assert.equal(oversizedCount, 0);
    assert.equal(records[0].oversized, undefined);
    assert.ok(!records[0].unparsed);
  });

  it('delimited engine applies the cap too', async () => {
    const parser = new DelimitedParser({
      input: { delimiter: '\t', hasHeader: false },
      records: { maxRecordBytes: 30 },
    });
    const content = ['short\trow', 'a\t' + 'y'.repeat(500)].join('\n');
    const { records, oversizedCount } = parser.applyRecordSizeCap(await parser.parseFile('x', content));
    assert.equal(oversizedCount, 1);
    assert.ok(records[1].oversized);
    assert.ok(!records[0].oversized);
  });

  it('throws on a non-integer cap', () => {
    assert.throws(() => new PlaintextParser({ records: { maxRecordBytes: 1.5 } }), /maxRecordBytes must be a non-negative integer/);
    assert.throws(() => new PlaintextParser({ records: { maxRecordBytes: 'big' } }), /maxRecordBytes must be a non-negative integer/);
  });

  it('processTraceContent reports oversizedCount in metrics and excludes oversized from sequence input', async () => {
    const profile = {
      tfp_config: {
        parser: {
          module: 'plaintext',
          config: {
            records: { recordStartPattern: '^\\[', maxRecordBytes: 60 },
            sequenceProfile: {
              orderColumns: ['step'],
              correlationColumns: ['traceId'],
              tokenColumns: ['actor'],
              entityColumn: 'actor',
              directionColumn: 'actor',
            },
          },
        },
        fieldExtraction: {
          fields: [
            { name: 'traceId', source: null, regex: 'trace=(?<value>\\S+)' },
            { name: 'step', source: null, regex: 'step=(?<value>\\d+)' },
            { name: 'actor', source: null, regex: 'actor=(?<value>\\S+)' },
          ],
        },
      },
    };
    const content = [
      '[1] trace=t1 step=1 actor=A',
      '[2] trace=t1 step=2 actor=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', // oversized
      '[3] trace=t2 step=1 actor=C',
    ].join('\n');

    const { metrics, sequenceDocument } = await processTraceContent(profile, Buffer.from(content), 'cap-test');
    assert.equal(metrics.oversizedCount, 1);
    assert.equal(metrics.parsedRecords, 2);
    assert.equal(metrics.unparsedCount, 1);
    // oversized record excluded from mining (unparsed filtered before extraction)
    assert.equal(sequenceDocument.stats.eligibleRows, 2);
  });
});
