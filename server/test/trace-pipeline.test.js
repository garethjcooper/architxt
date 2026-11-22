import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import express from 'express';
import request from 'supertest';
import { DelimitedParser } from '../src/services/trace/parsers/delimited-parser.js';
import { PlaintextParser } from '../src/services/trace/parsers/plaintext-parser.js';
import { JsonLinesParser } from '../src/services/trace/parsers/json-lines-parser.js';
import { JsonNdParser } from '../src/services/trace/parsers/json-nd-parser.js';
import { XmlParser } from '../src/services/trace/parsers/xml-parser.js';
import { createParserForProfile, processTraceContent } from '../src/services/trace/index.js';
import { analyzeDelimitedSource } from '../src/services/trace/parsers/delimited-normaliser.js';
import traceProfilesRoute from '../src/routes/trace-profiles.js';

describe('trace pipeline', () => {
  describe('delimited engine', () => {
    const profileConfig = {
      version: '0.1',
      parser: {
        module: 'delimited',
        config: {
          input: { format: 'delimited', delimiter: '\t', hasHeader: false, encoding: 'utf-8' },
          records: {
            multilineColumn: 2,
          }
        }
      }
    };

    it('parses delimited rows into raw records', async () => {
      const parser = new DelimitedParser(profileConfig.parser.config);
      const content = Buffer.from([
        '00000000000000000000000000000001\tsession-1\t[2026-11-06T10:00:00Z] INFO OrderService-CustomerService POST /customers/{id}',
        '00000000000000000000000000000002\tsession-1\t[2026-11-06T10:00:01Z] ERROR OrderService-PaymentService POST /payments statusCode=500'
      ].join('\n'));

      const records = await parser.parseFile('test.log', content);
      assert.equal(records.length, 2);
      assert.ok(!records[0].unparsed);
      assert.ok(!records[1].unparsed);
      assert.ok(records[0].raw.includes('OrderService'));
      assert.ok(records[1].raw.includes('statusCode=500'));
    });

    it('selects the delimited engine from the registry', () => {
      const parser = createParserForProfile({ tfp_config: profileConfig });
      assert.equal(parser.constructor.name, 'DelimitedParser');
    });
  });

  describe('plaintext engine', () => {
    const profileConfig = {
      version: '0.1',
      parser: {
        module: 'plaintext',
        config: {
          input: { format: 'plaintext', encoding: 'utf-8' },
          records: {
            recordStartPattern: '^\\d{4}-\\d{2}-\\d{2}',
          }
        }
      }
    };

    it('parses line-oriented log records into raw records', async () => {
      const parser = new PlaintextParser(profileConfig.parser.config);
      const content = Buffer.from([
        '2026-11-06T10:00:00Z INFO OrderService->CustomerService POST /customers/{id}',
        '2026-11-06T10:00:01Z ERROR OrderService->PaymentService POST /payments'
      ].join('\n'));

      const records = await parser.parseFile('test.log', content);
      assert.equal(records.length, 2);
      assert.ok(!records[0].unparsed);
      assert.ok(!records[1].unparsed);
      assert.ok(records[0].raw.includes('OrderService'));
    });

    it('selects the plaintext engine from the registry', () => {
      const parser = createParserForProfile({ tfp_config: profileConfig });
      assert.equal(parser.constructor.name, 'PlaintextParser');
    });
  });

  describe('json-lines engine', () => {
    const profileConfig = {
      version: '0.1',
      parser: {
        module: 'json-lines',
        config: {
          input: { format: 'json-lines', encoding: 'utf-8' },
          records: {
            recordStartPattern: '^\\{',
          }
        }
      }
    };

    it('parses NDJSON objects into raw records', async () => {
      const parser = new JsonLinesParser(profileConfig.parser.config);
      const content = Buffer.from([
        '{"service":"OrderService","peer":"CustomerService","method":"POST","path":"/customers/{id}","direction":"REQUEST"}',
        '{"service":"OrderService","peer":"PaymentService","method":"POST","path":"/payments","direction":"REQUEST"}'
      ].join('\n'));

      const records = await parser.parseFile('test.log', content);
      assert.equal(records.length, 2);
      assert.ok(!records[0].unparsed);
      assert.ok(records[0].raw.includes('OrderService'));
    });

    it('selects the json-lines engine from the registry', () => {
      const parser = createParserForProfile({ tfp_config: profileConfig });
      assert.equal(parser.constructor.name, 'JsonLinesParser');
    });
  });

  describe('json-nd engine', () => {
    const profileConfig = {
      version: '0.1',
      parser: {
        module: 'json-nd',
        config: {
          input: { format: 'json-nd', encoding: 'utf-8' },
          records: {
            recordStartPattern: '^\\{',
          }
        }
      }
    };

    it('parses pretty-printed JSON objects into raw records', async () => {
      const parser = new JsonNdParser(profileConfig.parser.config);
      const content = Buffer.from(`{
  "email": "user@example.com",
  "streetAddress": "123 Main St",
  "city": "Auckland",
  "state": "NZ",
  "country": "New Zealand",
  "userCurrency": "USD",
  "creditCardNumber": "4111111111111111"
}`);

      const records = await parser.parseFile('test.json', content);
      assert.equal(records.length, 1);
      assert.ok(!records[0].unparsed);
      assert.ok(records[0].raw.includes('user@example.com'));
    });

    it('selects the json-nd engine from the registry', () => {
      const parser = createParserForProfile({ tfp_config: profileConfig });
      assert.equal(parser.constructor.name, 'JsonNdParser');
    });
  });

  describe('xml engine', () => {
    const profileConfig = {
      version: '0.1',
      parser: {
        module: 'xml',
        config: {
          input: { encoding: 'utf-8' },
          records: {},
        },
      },
    };

    it('splits a wrapper root element into one record per child element', async () => {
      const parser = new XmlParser(profileConfig.parser.config);
      const content = `<?xml version="1.0" encoding="UTF-8"?>
<log>
  <event id="1" ts="2026-11-18T10:00:00Z"><op>POST</op></event>
  <event id="2" ts="2026-11-18T10:01:00Z"><op>GET</op></event>
</log>`;
      const records = await parser.parseFile('test.xml', content);
      assert.equal(records.length, 2);
      assert.ok(records.every((r) => !r.unparsed));
      assert.ok(records[0].raw.includes('id="1"'));
      assert.ok(records[1].raw.includes('id="2"'));
      assert.ok(!records[0].raw.includes('<log>'));
    });

    it('treats a single root with text content as one record', async () => {
      const parser = new XmlParser(profileConfig.parser.config);
      const content = `<?xml version="1.0"?><config><server>localhost</server></config>`;
      const records = await parser.parseFile('test.xml', content);
      assert.equal(records.length, 1);
      assert.ok(records[0].raw.includes('<server>localhost</server>'));
    });

    it('splits concatenated top-level elements per element', async () => {
      const parser = new XmlParser(profileConfig.parser.config);
      const content = `<event id="1"/><event id="2"/><event id="3"/>`;
      const records = await parser.parseFile('test.xml', content);
      assert.equal(records.length, 3);
      assert.ok(records[2].raw.includes('id="3"'));
    });

    it('keeps the whole document as one record when splitElements is false', async () => {
      const parser = new XmlParser({ input: { encoding: 'utf-8' }, records: { splitElements: false } });
      const content = `<log><event id="1"/><event id="2"/></log>`;
      const records = await parser.parseFile('test.xml', content);
      assert.equal(records.length, 1);
      assert.ok(records[0].raw.includes('<log>'));
    });

    it('filters to recordStartTag when configured', async () => {
      const parser = new XmlParser({ input: { encoding: 'utf-8' }, records: { recordStartTag: 'event' } });
      const content = `<log><event id="1"/><note>skip me</note><event id="2"/></log>`;
      const records = await parser.parseFile('test.xml', content);
      assert.equal(records.length, 2);
      assert.ok(records.every((r) => r.raw.startsWith('<event')));
    });

    it('handles namespaced and attribute-quoted elements', async () => {
      const parser = new XmlParser(profileConfig.parser.config);
      const content = `<ns:log xmlns:ns="urn:x"><ns:event ns:id="a>b">text</ns:event><ns:event ns:id="2"/></ns:log>`;
      const records = await parser.parseFile('test.xml', content);
      assert.equal(records.length, 2);
      assert.ok(records[0].raw.includes('ns:id="a>b"'));
    });

    it('returns an unparsed record for non-XML content', async () => {
      const parser = new XmlParser(profileConfig.parser.config);
      const records = await parser.parseFile('test.xml', 'just some plain text, no tags');
      assert.equal(records.length, 1);
      assert.equal(records[0].unparsed, true);
    });

    it('selects the xml engine from the registry', () => {
      const parser = createParserForProfile({ tfp_config: profileConfig });
      assert.equal(parser.constructor.name, 'XmlParser');
    });
  });

  describe('processTraceContent end-to-end', () => {
    const profileConfig = {
      version: '0.1',
      parser: {
        module: 'delimited',
        config: {
          input: { format: 'delimited', delimiter: '\t', hasHeader: false, encoding: 'utf-8' },
          records: {
            multilineColumn: 2,
          }
        }
      }
    };

    it('returns raw records and metrics only', async () => {
      const content = Buffer.from([
        '00000000000000000000000000000001\tsession-1\t[2026-11-06T10:00:00Z] INFO OrderService-CustomerService POST /customers/{id}',
        '00000000000000000000000000000002\tsession-1\t[2026-11-06T10:00:01Z] INFO OrderService-CustomerService POST /customers/{id}'
      ].join('\n'));

      const result = await processTraceContent({ tfp_config: profileConfig }, content);
      assert.ok(Array.isArray(result.records));
      assert.equal(result.records.length, 2);
      assert.equal(result.metrics.rawRecords, 2);
      assert.equal(result.metrics.parsedRecords, 2);
      assert.equal(result.metrics.unparsedCount, 0);
      assert.equal(result.cleanedLog, undefined);
      // markdown is emitted for the extract-trace pipeline stage (document-md)
      assert.equal(typeof result.markdown, 'string');
      assert.ok(result.markdown.startsWith('# Cleaned Trace Log'));
    });

    it('keeps source order', async () => {
      const content = Buffer.from([
        '00000000000000000000000000000002\tsession-1\t[2026-11-06T10:00:01Z] INFO PaymentService-CustomerService POST /payments',
        '00000000000000000000000000000001\tsession-1\t[2026-11-06T10:00:00Z] INFO OrderService-CustomerService POST /customers/{id}'
      ].join('\n'));

      const result = await processTraceContent({ tfp_config: profileConfig }, content);
      assert.ok(result.records[0].raw.includes('PaymentService'));
      assert.ok(result.records[1].raw.includes('OrderService'));
    });
  });

  describe('trace-profiles route', () => {
    let routeApp;

    beforeEach(() => {
      routeApp = express();
      routeApp.use(express.json({ limit: '50mb' }));
      routeApp.use('/api/v1/trace-profiles', traceProfilesRoute);
    });

    it('GET /api/v1/trace-profiles/engines returns engine manifests', async () => {
      const res = await request(routeApp).get('/api/v1/trace-profiles/engines');
      assert.equal(res.status, 200);
      const modules = res.body.engines.map((e) => e.module).sort();
      assert.deepEqual(modules, ['delimited', 'json-lines', 'json-nd', 'plaintext', 'xml']);
    });

    it('POST /api/v1/trace-profiles/validate reports coverage for a delimited sample', async () => {
      const sample = [
        '00000000000000000000000000000001\tsession-1\t[2026-11-06T10:00:00Z] INFO OrderService-CustomerService POST /customers/{id}',
        '00000000000000000000000000000002\tsession-1\t[2026-11-06T10:00:01Z] INFO OrderService-PaymentService POST /payments',
        'garbage-row-no-match'
      ].join('\n');
      const config = {
        version: '0.1',
        parser: {
          module: 'delimited',
          config: {
            input: { format: 'delimited', delimiter: '\t', hasHeader: false, encoding: 'utf-8' },
            records: {
              recordStartRule: { minColumns: 3, keyColumn: 0, keyRegex: '^[a-f0-9]{32}$' },
              multilineColumn: 2,
            }
          }
        }
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/validate')
        .send({ config, sample });
      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.totalRecords, 2);
      assert.equal(res.body.matched, 2);
      assert.equal(res.body.unmatched, 0);
      assert.equal(res.body.coverage, 100);
      assert.equal(res.body.unparsedSamples.length, 0);
      assert.equal(res.body.cleanedLog, undefined);
    });

    it('POST /api/v1/trace-profiles/validate returns availableFields for delimited header columns', async () => {
      const sample = [
        'trace_id\tts\tactor',
        't1\t1\tauth',
        't1\t2\tdb',
      ].join('\n');
      const config = {
        parser: {
          module: 'delimited',
          config: {
            input: { delimiter: '\t', hasHeader: true, encoding: 'utf-8' },
          },
        },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/validate')
        .send({ config, sample });

      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.deepEqual(res.body.availableFields.sort(), ['actor', 'trace_id', 'ts']);
    });

    it('POST /api/v1/trace-profiles/validate returns multiple sample values per field', async () => {
      const sample = [
        'trace_id\tts\tactor',
        't1\t1\tauth',
        't2\t2\tdb',
        't3\t3\tauth',
      ].join('\n');
      const config = {
        parser: {
          module: 'delimited',
          config: {
            input: { delimiter: '\t', hasHeader: true, encoding: 'utf-8' },
          },
        },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/validate')
        .send({ config, sample });

      assert.equal(res.status, 200);
      const actorStat = res.body.fieldStats.find((s) => s.field === 'actor');
      assert.ok(Array.isArray(actorStat.samples));
      assert.deepEqual(actorStat.samples.sort(), ['auth', 'db']);
    });

    it('POST /api/v1/trace-profiles/validate truncates long sample values instead of dropping them', async () => {
      const longToken = 'x'.repeat(500);
      const sample = [
        'trace_id\tmsg',
        `t1\t${longToken}`,
        't2\tshort',
      ].join('\n');
      const config = {
        parser: {
          module: 'delimited',
          config: { input: { delimiter: '\t', hasHeader: true, encoding: 'utf-8' } },
        },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/validate')
        .send({ config, sample });

      assert.equal(res.status, 200);
      const msgStat = res.body.fieldStats.find((s) => s.field === 'msg');
      assert.ok(Array.isArray(msgStat.samples));
      assert.equal(msgStat.samples.length, 2);
      assert.ok(msgStat.samples[0].endsWith('...'));
      assert.ok(msgStat.samples[0].length <= 200);
      assert.ok(msgStat.samples.includes('short'));
    });

    it('POST /api/v1/trace-profiles/validate returns availableFields for json-lines payload paths', async () => {
      const sample = [
        '{"trace_id":"t1","ts":1,"actor":"auth"}',
        '{"trace_id":"t1","ts":2,"actor":"db"}',
      ].join('\n');
      const config = {
        parser: { module: 'json-lines', config: {} },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/validate')
        .send({ config, sample });

      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.deepEqual(res.body.availableFields.sort(), ['actor', 'trace_id', 'ts']);
    });

    it('POST /api/v1/trace-profiles/validate detects plaintext rows without cleanedLog', async () => {
      const sample = [
        '[5/9/17 10:57:40:218 NZST] 00000809 ABSLOG I ~REPLY~SVC~opB 0000015bea484b91000000011ee32cb8e2035aec727d4bf7355130a4755ef6bfed78abf6',
        '[5/9/17 10:57:40:215 NZST] 00000a82 ABSLOG I ~SCA_REQUEST~SVC~opA 0000015bea48529c000000011f1e0bf8165a7cdb8b31c2faa1f6eac281a28ba1679163d3',
        '[5/9/17 10:57:40:218 NZST] 00000a82 ABSLOG I ~RECEIVE~SVC~opC 0000015bea48529c000000011f1e0bf8165a7cdb8b31c2faa1f6eac281a28ba1679163d3',
      ].join('\n');

      const config = {
        parser: {
          module: 'plaintext',
          config: {
            input: { encoding: 'utf-8' },
            records: {
              recordStartPattern: '^\\[(?<timestamp>[^\\]]+)\\]\\s+(?<messageId>[0-9a-f]{8})\\s+ABSLOG\\s+I\\s+~(?<direction>[^~]+)~(?<service>[^~]+)~(?<operation>\\S+)\\s+(?<traceId>[0-9a-f]+)',
            },
          },
        },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/validate')
        .send({ config, sample });

      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.totalRecords, 3);
      assert.equal(res.body.matched, 3);
      assert.equal(res.body.cleanedLog, undefined);
      assert.ok(Array.isArray(res.body.records));
    });

    it('POST /api/v1/trace-profiles/preview-sequences mines eligible rows from plaintext via fieldExtraction rules', async () => {
      const sample = [
        'trace=t1 ts=2 actor=db',
        'trace=t1 ts=1 actor=auth',
        'trace=t2 ts=1 actor=auth',
      ].join('\n');

      const config = {
        parser: {
          module: 'plaintext',
          config: {
            input: { encoding: 'utf-8' },
            records: { recordStartPattern: '^trace=' },
            sequenceProfile: {
              orderColumns: ['ts'],
              correlationColumns: ['trace'],
              tokenColumns: ['actor'],
              entityColumn: 'actor',
              directionColumn: 'actor',
              separator: '|',
              sortOrder: 'frequency-desc',
            },
          },
        },
        fieldExtraction: {
          fields: [
            { name: 'trace', source: null, regex: 'trace=(?<value>[^\\s]+)', samples: ['t1'] },
            { name: 'ts', source: null, regex: 'ts=(?<value>[^\\s]+)', samples: ['1'] },
            { name: 'actor', source: null, regex: 'actor=(?<value>[^\\s]+)', samples: ['auth'] },
          ],
          payload: { format: null, fields: [] },
        },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/preview-sequences')
        .send({ config, sample });

      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.stats.inputRows, 3);
      assert.equal(res.body.stats.eligibleRows, 3);
      assert.equal(res.body.stats.ineligibleRows, 0);
      assert.ok(res.body.stats.sequenceCount >= 1);
      assert.ok(res.body.markdown.match(/## [^\n]+/));
    });

    it('POST /preview-sequences mines eligible rows from json-lines via JSON payload dot-paths', async () => {
      const sample = [
        '{"trace_id":"t1","ts":2,"actor":"db"}',
        '{"trace_id":"t1","ts":1,"actor":"auth"}',
        '{"trace_id":"t2","ts":1,"actor":"auth"}',
      ].join('\n');

      const config = {
        parser: {
          module: 'json-lines',
          config: {
            sequenceProfile: {
              orderColumns: ['ts'],
              correlationColumns: ['trace_id'],
              tokenColumns: ['actor'],
              entityColumn: 'actor',
              directionColumn: 'actor',
            },
          },
        },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/preview-sequences')
        .send({ config, sample });

      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.stats.eligibleRows, 3);
      assert.equal(res.body.stats.ineligibleRows, 0);
    });

    it('POST /preview-sequences applies top-level fieldExtraction for plaintext rows without it in config JSON', async () => {
      const sample = [
        '[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I ~REPLY~SVC~opA 0000015bea34350a000000011e5a4ab44bd9b2042e675cf97b26bafa6adc92cc63d65fd3',
        '[5/9/17 10:35:41:870 NZST] 0000082a ABSLOG I ~REPLY~SVC~opB 0000015bea34354a000000011ee025b8e2035aec727d4bf7355130a4755ef6bfed78abf6',
        '[5/9/17 10:35:43:380 NZST] 00000a4e ABSLOG I ~PROV~SVC~opC 0000015bea341371000000011e5a46dc4bd9b2042e675cf97b26bafa6adc92cc63d65fd3 trailing',
      ].join('\n');

      // Mirrors the UI: sequenceProfile lives under parser.config, but
      // fieldExtraction is top-level and only present when sent alongside.
      const config = {
        parser: {
          module: 'plaintext',
          config: {
            input: { encoding: 'utf-8' },
            records: { recordStartPattern: '^\\[\\d' },
            sequenceProfile: {
              orderColumns: ['timestamp'],
              correlationColumns: ['transactionId'],
              tokenColumns: ['direction'],
              entityColumn: 'direction',
              directionColumn: 'direction',
            },
          },
        },
        fieldExtraction: {
          fields: [
            { name: 'timestamp', source: null, regex: '^\\[(?<value>[^\\]]+)\\]' },
            { name: 'transactionId', source: null, regex: '\\]\\s+(?<value>[0-9a-f]{8})\\s+' },
            { name: 'direction', source: null, regex: 'ABSLOG\\s+I\\s+(?<value>[^\\s]+)' },
          ],
          payload: { format: null, fields: [] },
        },
      };

      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/preview-sequences')
        .send({ config, sample });

      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.equal(res.body.stats.eligibleRows, 3);
      assert.equal(res.body.stats.ineligibleRows, 0);
    });
  });

  describe('analyzeDelimitedSource multi-line column attribution', () => {
    const header = 'ts\tlevel\tevent_start_tms_part_key\tmsg\tpayload';
    const cont = '<event2> continuation';
    const rule = { keyColumn: 0, keyRegex: '^\\d{4}-' };
    const base = (records) => ({
      input: { delimiter: '\t', hasHeader: true },
      records: { recordStartRule: rule, ...records },
    });

    it('attributes continuation to the last column when no multiline column is configured', () => {
      const row = '2026-01-01\tINFO\tk1\thello\t<event><msg>a</msg></event>';
      const a = analyzeDelimitedSource([header, row, cont].join('\n'), base({}));
      assert.deepEqual(a.multiLineColumns, ['payload']);
    });

    it('attributes continuation to the configured multiline column when the row has it', () => {
      const row = '2026-01-01\tINFO\tk1\thello\t<event><msg>a</msg></event>';
      const a = analyzeDelimitedSource([header, row, cont].join('\n'), base({ multilineColumn: 'msg' }));
      assert.deepEqual(a.multiLineColumns, ['msg']);
    });

    it('falls back to the row\'s actual last column when the configured column is missing on a short row', () => {
      const short = '2026-01-01\tINFO';
      const a = analyzeDelimitedSource([header, short, cont].join('\n'), base({ multilineColumn: 'event_start_tms_part_key' }));
      assert.deepEqual(a.multiLineColumns, ['level']);
    });

    it('detects the XML/JSON payload column by content instead of the last column', () => {
      const wide = 'k\tthread\tpattern_match_data\tpart_key';
      const row = ['787b830189', 'x', '{"resultId":"x"}', 'last'].join('\t');
      const a = analyzeDelimitedSource([wide, row, '{"cont":1}'].join('\n'), {
        input: { delimiter: '\t', hasHeader: true },
        records: { recordStartRule: { keyColumn: 0, keyRegex: '^[0-9a-f]{8,}$' } },
      });
      assert.deepEqual(a.multiLineColumns, ['pattern_match_data']);
    });

    it('attributes to the last column under payload stitching even when a payload column exists', () => {
      const wide = 'k\tthread\tpattern_match_data\tpart_key';
      const row = ['787b830189', 'x', '{"resultId":"x"}', 'last'].join('\t');
      const a = analyzeDelimitedSource([wide, row, '{"cont":1}'].join('\n'), {
        input: { delimiter: '\t', hasHeader: true },
        records: {
          recordStartRule: { keyColumn: 0, keyRegex: '^[0-9a-f]{8,}$' },
          payloadStitching: 'json',
        },
      });
      assert.deepEqual(a.multiLineColumns, ['part_key']);
    });
  });

  describe('trace-profiles discovery-histogram route', () => {
    let routeApp;

    beforeEach(() => {
      routeApp = express();
      routeApp.use(express.json({ limit: '50mb' }));
      routeApp.use('/api/v1/trace-profiles', traceProfilesRoute);
    });

    it('POST /api/v1/trace-profiles/discovery-histogram returns 200 with valid:true and entries for a delimited sample', async () => {
      const sample = [
        'a b c',
        'x 1 foo',
        'y 2 foo',
        'z 3 bar',
      ].join('\n');
      const config = {
        parser: {
          module: 'delimited',
          config: { input: { delimiter: ' ', hasHeader: false }, records: {} },
        },
      };
      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/discovery-histogram')
        .send({ config, sample });
      assert.equal(res.status, 200);
      assert.equal(res.body.valid, true);
      assert.ok(Array.isArray(res.body.entries));
      assert.ok(res.body.entries.length > 0);
      assert.equal(res.body.totalRecords, 4);
    });

    it('POST /api/v1/trace-profiles/discovery-histogram returns 200 with valid:false and the error message when the engine is unknown', async () => {
      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/discovery-histogram')
        .send({ config: { parser: { module: 'nope', config: {} } }, sample: 'a b c' });
      assert.equal(res.status, 200);
      assert.equal(res.body.valid, false);
      assert.match(res.body.error, /Unknown trace parser engine/);
      assert.deepEqual(res.body.entries, []);
    });

    it('POST /api/v1/trace-profiles/discovery-histogram still rejects a missing sample with 400', async () => {
      const res = await request(routeApp)
        .post('/api/v1/trace-profiles/discovery-histogram')
        .send({ config: { parser: { module: 'plaintext', config: {} } } });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    });
  });
});
