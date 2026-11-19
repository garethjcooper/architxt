import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  splitHeaderAndPayload,
  extractPayloadFields,
  applyFieldRules,
  applyFieldExtractionToRecords,
  extractRecordFields,
  mergeFieldRules,
  mergePayloadFields,
  discoverDelimitedColumnRules,
  discoverFieldExtractionRules,
  stripFieldExtractionSamples,
  buildPositionalCandidates,
  buildValueHistogram,
  buildHistogramPrompt,
  applyNameMapToFields,
  isPlausibleFieldRule,
  tokenShape,
} from '../src/services/trace/trace-field-extract.js';
import { config } from '../src/config.js';

describe('trace field extraction', () => {
  describe('splitHeaderAndPayload', () => {
    it('separates a plaintext header from an XML payload', () => {
      const raw = '[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I ~REPLY~MF_Customer_retrievePlanInfo_V1~retrievePlanInfo 0000015bea34350a\n<?xml version="1.0"?><payload/>';
      const { header, payload } = splitHeaderAndPayload(raw);
      assert.ok(header.includes('ABSLOG'));
      assert.equal(payload.format, 'xml');
      assert.ok(payload.content.startsWith('<?xml'));
    });

    it('returns no payload for a header-only row', () => {
      const { header, payload } = splitHeaderAndPayload('plain log line with no payload');
      assert.equal(payload, null);
      assert.equal(header, 'plain log line with no payload');
    });
  });

  describe('extractPayloadFields', () => {
    it('extracts leaf text fields from XML with literal namespaces', () => {
      const xml = '<?xml version="1.0"?><msg:root xmlns:msg="http://example.com"><msg:header><msg:app>App1</msg:app></msg:header><msg:body><msg:customer><msg:id>123</msg:id></msg:customer></msg:body></msg:root>';
      const result = extractPayloadFields({ format: 'xml', content: xml });
      assert.equal(result.format, 'xml');
      const paths = result.fields.map((f) => f.path);
      // Re-rooted at the document element: no 'msg:root.' prefix, matching the
      // JSON engines' per-record field shape.
      assert.ok(paths.includes('msg:header.msg:app'));
      assert.ok(paths.includes('msg:body.msg:customer.msg:id'));
    });

    it('exposes xml attributes rootless (with @ prefix) like json leaf paths', () => {
      const xml = '<event traceId="t1" op="POST"><msg>hello</msg></event>';
      const result = extractPayloadFields({ format: 'xml', content: xml });
      const byPath = Object.fromEntries(result.fields.map((f) => [f.path, f.samples[0]]));
      assert.equal(byPath['@traceId'], 't1');
      assert.equal(byPath['@op'], 'POST');
      assert.equal(byPath['msg'], 'hello');
      assert.ok(!('event.@traceId' in byPath));
    });

    it('extracts leaf scalar fields from JSON', () => {
      const json = JSON.stringify({ header: { app: 'App1', id: 42 }, body: { active: true } });
      const result = extractPayloadFields({ format: 'json', content: json });
      assert.equal(result.format, 'json');
      const paths = result.fields.map((f) => f.path);
      assert.ok(paths.includes('header.app'));
      assert.ok(paths.includes('header.id'));
      assert.ok(paths.includes('body.active'));
    });

    it('skips arrays by recording only the first element', () => {
      const json = JSON.stringify({ items: [{ name: 'a', value: 1 }, { name: 'b', value: 2 }] });
      const result = extractPayloadFields({ format: 'json', content: json });
      const paths = result.fields.map((f) => f.path);
      assert.ok(paths.includes('items.name'));
      assert.ok(paths.includes('items.value'));
      assert.equal(paths.length, 2);
    });
  });

  describe('applyFieldRules', () => {
    it('collects samples from rows using unified field rules', () => {
      const rows = [
        { raw: '[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I ~REPLY~S1~op1 abc\n<payload/>' },
        { raw: '[5/9/17 10:35:41:870 NZST] 000000c1 ABSLOG I ~REQUEST~S2~op2 def\n<payload/>' },
      ];
      const fields = [
        { name: 'found001', source: null, regex: '^\\[(?<value>[^\\]]+)\\]' },
        { name: 'found002', source: null, regex: '\\]\\s+(?<value>[0-9a-f]+)\\s+ABSLOG' },
      ];
      const matched = applyFieldRules(rows, fields);
      assert.ok(matched.found001.includes('5/9/17 10:35:41:868 NZST'));
      assert.ok(matched.found002.includes('000000b3'));
    });
  });

  describe('stripFieldExtractionSamples', () => {
    it('removes samples from fields but keeps name/source/regex and payload', () => {
      const fe = {
        fields: [
          { name: 'ts', source: null, regex: '\\d+', samples: ['1', '2'] },
          { name: 'level', source: 'msg', regex: 'INFO', samples: ['INFO'] },
        ],
        payload: { format: null, fields: [] },
      };
      const stripped = stripFieldExtractionSamples(fe);
      assert.deepStrictEqual(stripped.fields, [
        { name: 'ts', source: null, regex: '\\d+' },
        { name: 'level', source: 'msg', regex: 'INFO' },
      ]);
      assert.deepStrictEqual(stripped.payload, { format: null, fields: [] });
      // original untouched
      assert.equal(fe.fields[0].samples.length, 2);
    });

    it('passes through null/undefined and non-array fields unchanged', () => {
      assert.equal(stripFieldExtractionSamples(null), null);
      assert.equal(stripFieldExtractionSamples(undefined), undefined);
      const fe = { payload: { format: null, fields: [] } };
      assert.deepStrictEqual(stripFieldExtractionSamples(fe), fe);
    });
  });

  describe('mergeFieldRules', () => {
    it('adds only new field names and new regexes', () => {
      const existing = [{ name: 'found001', source: null, regex: 'regex1', samples: [] }];
      const discovered = [
        { name: 'found001', source: null, regex: 'regex2', samples: [] },
        { name: 'found002', source: null, regex: 'regex2', samples: [] },
      ];
      const merged = mergeFieldRules(existing, discovered);
      assert.equal(merged.length, 2);
      assert.ok(merged.some((r) => r.name === 'found002'));
    });
  });

  describe('mergePayloadFields', () => {
    it('adds only new paths', () => {
      const existing = { format: 'xml', fields: [{ path: 'a.b', samples: ['1'] }] };
      const discovered = { format: 'xml', fields: [{ path: 'a.b', samples: ['2'] }, { path: 'a.c', samples: ['3'] }] };
      const merged = mergePayloadFields(existing, discovered);
      assert.equal(merged.fields.length, 2);
      assert.ok(merged.fields.some((f) => f.path === 'a.c'));
    });
  });

  describe('discoverDelimitedColumnRules', () => {
    it('splits tab-delimited rows using the configured delimiter under input', () => {
      const rows = [{ raw: '1\t2\t3' }];
      const sample = 'colA\tcolB\tcolC\n1\t2\t3';
      const parserConfig = {
        module: 'delimited',
        config: {
          input: { delimiter: '\t', hasHeader: true },
        },
      };
      const result = discoverDelimitedColumnRules({ rows, sample, parserConfig });
      assert.equal(result.payload.format, 'delimited');
      const names = result.fields.map((f) => f.name);
      assert.deepStrictEqual(names, ['colA', 'colB', 'colC']);
      assert.deepStrictEqual(result.fields.map((f) => f.ordinal), [0, 1, 2]);
      const fieldB = result.fields.find((f) => f.name === 'colB');
      assert.equal(fieldB.source, null);
      assert.equal(fieldB.regex, null);
      assert.ok(fieldB?.samples.includes('2'));
    });

    it('falls back to column_N when only rows are provided', () => {
      const rows = [{ raw: 'a\tb\tc' }, { raw: '1\t2\t3' }];
      const result = discoverDelimitedColumnRules({ rows, parserConfig: {
        module: 'delimited',
        config: { input: { delimiter: '\t', hasHeader: true } },
      }});
      const names = result.fields.map((f) => f.name);
      assert.deepStrictEqual(names, ['column_0', 'column_1', 'column_2']);
    });

    it('uses column_N when there is no header row', () => {
      const rows = [{ raw: 'a\tb\tc' }, { raw: '1\t2\t3' }];
      const result = discoverDelimitedColumnRules({ rows, parserConfig: {
        module: 'delimited',
        config: { input: { delimiter: '\t', hasHeader: false } },
      }});
      const names = result.fields.map((f) => f.name);
      assert.deepStrictEqual(names, ['column_0', 'column_1', 'column_2']);
    });
  });

  describe('extractRecordFields', () => {
    it('applies a source:null field rule to the whole record', () => {
      const fieldExtraction = {
        fields: [{ name: 'found001', source: null, regex: '^(?<value>[0-9a-f]{32})\\s' }],
      };
      const fields = extractRecordFields('787b830189c7cfeef42b71c973c78997 2018-11-30 rest', fieldExtraction);
      assert.equal(fields.found001, '787b830189c7cfeef42b71c973c78997');
    });

    it('applies regex WITHIN a parser-provided source field (one source, two outputs)', () => {
      const fieldExtraction = {
        fields: [
          { name: 'level', source: 'message', regex: '(?<value>INFO|WARN|ERROR)' },
          { name: 'msg_id', source: 'message', regex: 'id=(?<value>[0-9a-f]+)' },
        ],
      };
      const parserFields = { message: 'ERROR id=abc123 something failed' };
      const fields = extractRecordFields('raw line', fieldExtraction, parserFields);
      assert.equal(fields.level, 'ERROR');
      assert.equal(fields.msg_id, 'abc123');
      // source itself is preserved
      assert.equal(fields.message, 'ERROR id=abc123 something failed');
    });

    it('resolves chained within-field sources (field derived from another field)', () => {
      const fieldExtraction = {
        fields: [
          { name: 'kv', source: null, regex: 'data=(?<value>\\S+)' },
          { name: 'user', source: 'kv', regex: 'user=(?<value>\\w+)' },
        ],
      };
      const fields = extractRecordFields('x data=user=bob,role=admin y', fieldExtraction);
      assert.equal(fields.kv, 'user=bob,role=admin');
      assert.equal(fields.user, 'bob');
    });

    it('resolves JSON payload dot-paths into flat fields for whole-record JSON', () => {
      const fieldExtraction = { fields: [], payload: { format: 'json', fields: [] } };
      const raw = '{"resultId":"abc","groupKey":"220233588","nested":{"flag":true}}';
      const fields = extractRecordFields(raw, fieldExtraction);
      assert.equal(fields.resultId, 'abc');
      assert.equal(fields.groupKey, '220233588');
      assert.equal(fields['nested.flag'], 'true');
    });

    it('skips stitched JSON payload expansion when a header precedes the payload', () => {
      const fieldExtraction = { fields: [], payload: { format: 'json', fields: [] } };
      const raw = '2018-06-19 11:57:27.428 CHL115 {"resultId":"abc","groupKey":"220233588"}';
      const fields = extractRecordFields(raw, fieldExtraction);
      assert.deepStrictEqual(fields, {});
    });

    it('returns empty fields for non-string raw or missing rules', () => {
      assert.deepStrictEqual(extractRecordFields(undefined, { fields: [] }), {});
      assert.deepStrictEqual(extractRecordFields('some line', null), {});
    });

    it('keeps the parser-provided column value for a source:null regex:null field (delimited)', () => {
      // A detected delimited column has source:null/regex:null; its real value
      // is the column the parser already provided, not the whole raw row.
      const fieldExtraction = {
        fields: [{ name: 'resultId', source: null, regex: null }],
      };
      const parserFields = { resultId: '220233588', ts: '2018-11-30 15:34:36.040' };
      const raw = '787b830189c7cfeef42b71c973c78997\t\t\t2018-11-30 15:34:36.040\t220233588';
      const fields = extractRecordFields(raw, fieldExtraction, parserFields);
      assert.equal(fields.resultId, '220233588');
      assert.equal(fields.ts, '2018-11-30 15:34:36.040');
    });

    it('regex on a source:null field still wins over a same-named parser column', () => {
      const fieldExtraction = {
        fields: [{ name: 'resultId', source: null, regex: '\\t(?<value>[0-9]+)$' }],
      };
      const parserFields = { resultId: '220233588' };
      const raw = 'abc\t2018-11-30\t220233588';
      const fields = extractRecordFields(raw, fieldExtraction, parserFields);
      assert.equal(fields.resultId, '220233588');
    });

    it('falls back to the whole record for source:null regex:null when the parser gave nothing', () => {
      const fieldExtraction = {
        fields: [{ name: 'whole', source: null, regex: null }],
      };
      const fields = extractRecordFields('2024-01-01 req abc123 done', fieldExtraction);
      assert.equal(fields.whole, '2024-01-01 req abc123 done');
    });

    it('does NOT fall back to the whole record when the parser column exists but is blank', () => {
      // Blank delimited columns must stay blank, not become the whole row.
      const fieldExtraction = {
        fields: [{ name: 'account_number', source: null, regex: null }],
      };
      const parserFields = { account_number: '' };
      const raw = 'abc\t2018-11-30\t220233588';
      const fields = extractRecordFields(raw, fieldExtraction, parserFields);
      assert.ok('account_number' in fields);
      assert.equal(fields.account_number, '');
    });
  });

  describe('applyFieldExtractionToRecords', () => {
    it('enriches raw-only records and explicit field rules win on name collision', () => {
      const records = [
        { raw: 'trace=t1 ts=1 actor=auth' },
        { raw: 'trace=t1 ts=2 actor=db', fields: { actor: 'parser-actor' } },
        { unparsed: true, raw: 'garbage' },
      ];
      const fieldExtraction = {
        fields: [
          { name: 'trace', source: null, regex: 'trace=(?<value>[^\\s]+)', samples: [] },
          { name: 'ts', source: null, regex: 'ts=(?<value>[^\\s]+)', samples: [] },
          { name: 'actor', source: null, regex: 'actor=(?<value>[^\\s]+)', samples: [] },
        ],
        payload: { format: null, fields: [] },
      };
      const enriched = applyFieldExtractionToRecords(records, fieldExtraction);
      assert.equal(enriched[0].fields.trace, 't1');
      assert.equal(enriched[0].fields.ts, '1');
      assert.equal(enriched[0].fields.actor, 'auth');
      // Explicit fields[] rules win over parser-provided values of the same name.
      assert.equal(enriched[1].fields.actor, 'db');
      assert.equal(enriched[1].fields.trace, 't1');
      // Unparsed records are still enriched (they are filtered out before mining).
      assert.equal(enriched[2].unparsed, true);
      assert.deepStrictEqual(enriched[2].fields, {});
    });

    it('unified field rules win over parser-provided columns of the same name', () => {
      const records = [{ raw: 'x', fields: { message: 'ERROR id=abc123 fail' } }];
      const fieldExtraction = {
        fields: [{ name: 'message', source: 'message', regex: '(?<value>INFO|WARN|ERROR)' }],
      };
      const out = applyFieldExtractionToRecords(records, fieldExtraction);
      // deliberate within-column refinement overrides the raw parser value
      assert.equal(out[0].fields.message, 'ERROR');
    });

    it('derives JSON payload fields even when no rules are given (json-lines support)', () => {
      const records = [{ raw: '{"trace_id":"t1","ts":2,"actor":"db"}' }];
      const out = applyFieldExtractionToRecords(records, null);
      assert.equal(out[0].fields.trace_id, 't1');
      assert.equal(out[0].fields.actor, 'db');
    });

    it('adds an empty fields map when no rules are given', () => {
      const records = [{ raw: 'a b c' }];
      const out = applyFieldExtractionToRecords(records, null);
      assert.deepStrictEqual(out[0].fields, {});
    });
  });

  describe('discoverFieldExtractionRules payload handling', () => {
    // A catch-all whole-record field means no unmatched rows, so no LLM call happens.
    const catchAllField = [{ name: 'line', source: null, regex: '^(?<value>.+)$', samples: [] }];

    it('does not expand stitched JSON payloads on plaintext rows', async () => {
      const rows = [
        { raw: '2018-06-19 CHL115 {"resultId":"abc","seq1":[{"token":"x"}],"nested":{"deep":"v"}}' },
        { raw: '2018-06-19 CHL115 {"resultId":"def","seq1":[{"token":"y"}]}' },
      ];
      const { fieldExtraction } = await discoverFieldExtractionRules(rows, { fields: catchAllField }, {});
      assert.deepStrictEqual(fieldExtraction.payload.fields, []);
    });

    it('still expands payload fields for whole-record JSON rows', async () => {
      const rows = [
        { raw: '{"trace_id":"t1","ts":1}' },
        { raw: '{"trace_id":"t2","ts":2}' },
      ];
      const { fieldExtraction } = await discoverFieldExtractionRules(rows, { fields: catchAllField }, {});
      const paths = fieldExtraction.payload.fields.map((f) => f.path);
      assert.ok(paths.includes('trace_id'));
      assert.ok(paths.includes('ts'));
    });

    it('emits deterministic source:null column fields for delimited rows', async () => {
      const rows = [{ raw: '1\t2\t3' }];
      const sample = 'colA\tcolB\tcolC\n1\t2\t3';
      const { fieldExtraction } = await discoverFieldExtractionRules(rows, null, {
        parserConfig: { module: 'delimited', config: { input: { delimiter: '\t', hasHeader: true } } },
        sample,
      });
      assert.deepStrictEqual(
        fieldExtraction.fields.map((f) => f.name),
        ['colA', 'colB', 'colC']
      );
      assert.deepStrictEqual(fieldExtraction.fields.map((f) => f.ordinal), [0, 1, 2]);
      assert.ok(fieldExtraction.fields.every((f) => f.source === null && f.regex === null));
    });
  });

  describe('buildPositionalCandidates (pre-scan)', () => {
    it('finds variable positions with example values and drops constant columns', () => {
      const rows = [
        { raw: '[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I ~REPLY~MF_Customer_retrievePlanInfo_V1~retrievePlanInfo 0000015bea34350a' },
        { raw: '[5/9/17 10:36:02:111 NZST] 000000c4 ABSLOG I ~REPLY~MF_Customer_retrievePlanInfo_V1~retrievePlanInfo 0000015bea34999f' },
        { raw: '[5/9/17 10:37:19:004 NZST] 000000d5 ABSLOG I ~REPLY~MF_Customer_retrievePlanInfo_V1~retrievePlanInfo 0000015bea34777b' },
      ];
      const candidates = buildPositionalCandidates(rows);
      const positions = candidates.map((c) => c.position);
      // Whitespace tokens: [date / time / NZST] / hex-id / ABSLOG / I / ~tilde~ / trace-id
      // positions 1 (time), 3 (hex id), 7 (trace id) vary; date/NZST]/ABSLOG/I/tilde are constant.
      assert.ok(positions.includes(1));
      assert.ok(positions.includes(3));
      assert.ok(positions.includes(7));
      assert.ok(!positions.includes(0), '[date is constant');
      assert.ok(!positions.includes(2), 'NZST] is constant');
      assert.ok(!positions.includes(4), 'ABSLOG is constant');
      const hexCand = candidates.find((c) => c.position === 3);
      assert.ok(hexCand, 'hex id column detected');
      assert.equal(hexCand.shape, 'hex');
      assert.equal(hexCand.rowCount, 3);
      assert.ok(hexCand.examples.includes('000000b3'));
      const tildeCand = candidates.find((c) => c.shape === 'tilde');
      assert.ok(!tildeCand, 'constant tilde token not a candidate');
    });

    it('is deterministic and covers all rows, not a sample', () => {
      // A rare token appearing only in the LAST row must still produce a candidate
      // (sampling 15 of 100 rows would miss it).
      const rows = Array.from({ length: 100 }, (_, i) => ({
        raw: `2026-01-01 LOG tok${i}`,
      }));
      rows[99] = { raw: '2026-01-01 LOG RARE_TOKEN_XYZ' };
      const candidates = buildPositionalCandidates(rows);
      const last = candidates.find((c) => c.position === 2);
      assert.ok(last, 'last-position variable token found');
      assert.ok(last.examples.includes('RARE_TOKEN_XYZ'), 'rare token value present in examples');
      assert.equal(last.rowCount, 100, 'rowCount reflects ALL rows');
      // Determinism: same input -> same output.
      assert.deepStrictEqual(buildPositionalCandidates(rows), candidates);
    });

    it('returns no candidates when every column is constant', () => {
      const rows = [
        { raw: 'CONSTANT HEADER ONLY' },
        { raw: 'CONSTANT HEADER ONLY' },
      ];
      assert.deepStrictEqual(buildPositionalCandidates(rows), []);
    });

    it('ignores payload content — only the header is scanned', () => {
      const rows = [
        { raw: '2026-01-01 LOG a {"k":"v1"}' },
        { raw: '2026-01-01 LOG b {"k":"v2"}' },
      ];
      const candidates = buildPositionalCandidates(rows);
      assert.deepStrictEqual(candidates.map((c) => c.position), [2]);
    });

    it('covers a rare token in the last of 100 rows (full coverage, no sampling)', () => {
      const rows = Array.from({ length: 100 }, (_, i) => ({ raw: `2026-01-01 LOG tok${i}` }));
      rows[99] = { raw: '2026-01-01 LOG RARE_TOKEN_XYZ' };
      const candidates = buildPositionalCandidates(rows);
      const last = candidates.find((c) => c.position === 2);
      assert.ok(last.examples.includes('RARE_TOKEN_XYZ'));
      assert.equal(last.rowCount, 100);
    });
  });

  describe('buildValueHistogram (pre-stage)', () => {
    const mkRows = () => [
      { raw: '[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I ~REPLY~opA 0000015bea34350a' },
      { raw: '[5/9/17 10:35:41:870 NZST] 0000082a ABSLOG I ~REPLY~opA 0000015bea34999f' },
      { raw: '[5/30/17 09:01:11:001 NZST] 00000a4e ABSLOG I ~PROV~opB 0000015bea34777b' },
      { raw: '[5/30/17 09:02:12:002 NZST] 00000fea ABSLOG I ~REPLY~opA 0000015bea34111c' },
    ];

    it('lists repeating variable values with support counts and excludes constants', () => {
      const { entries, totalRows } = buildValueHistogram(mkRows());
      assert.equal(totalRows, 4);
      const byValue = new Map(entries.map((e) => [e.value, e]));
      // Repeating variable values are present with their counts.
      assert.ok(byValue.has('REPLY'), 'repeating ~REPLY~ token found');
      assert.equal(byValue.get('REPLY').count, 3);
      assert.ok(byValue.get('opA'), 'repeating operation found');
      // Constants (in >=90% of rows) are excluded.
      assert.ok(!byValue.has('ABSLOG'));
      assert.ok(!byValue.has('NZST'));
      assert.ok(!byValue.has('I'));
      // Every entry carries shape, counts, and context rows.
      for (const e of entries) {
        assert.ok(typeof e.shape === 'string');
        assert.equal(e.rowCount, 4);
        assert.ok(e.count >= 2);
        assert.ok(Array.isArray(e.contexts) && e.contexts.length >= 1);
      }
      // Sorted by support desc.
      const counts = entries.map((e) => e.count);
      assert.deepStrictEqual(counts, [...counts].sort((a, b) => b - a));
    });

    it('respects the knobs: minSupport, constantRatio, maxEntries', () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({
        raw: `2026-01-01 LOG tok${i % 10} CONST`,
      }));
      // constantRatio=1.0 keeps nothing as constant-excluded; minSupport high drops all.
      const all = buildValueHistogram(rows, { minSupport: 2, constantRatio: 1.0, maxEntries: 100 });
      assert.ok(all.entries.some((e) => e.value === 'CONST'), 'CONST kept when constantRatio=1');
      const none = buildValueHistogram(rows, { minSupport: 999 });
      assert.deepStrictEqual(none.entries, []);
      const capped = buildValueHistogram(rows, { minSupport: 2, constantRatio: 1.0, maxEntries: 3 });
      assert.ok(capped.entries.length <= 3);
    });

    it('is deterministic and position-agnostic (same value at different positions)', () => {
      const rows = [
        { raw: '2026-01-01 LOG alpha TOKEN_XY' },
        { raw: '2026-01-01 LOG beta TOKEN_XY' },
        { raw: '2026-01-01 LOG gamma TOKEN_XY extra words here' }, // longer 3rd row
      ];
      const { entries } = buildValueHistogram(rows, { minSupport: 2, constantRatio: 1.0 });
      const tok = entries.find((e) => e.value === 'TOKEN_XY');
      assert.ok(tok, 'value found regardless of position/row length');
      assert.equal(tok.count, 3);
      assert.deepStrictEqual(buildValueHistogram(rows, { minSupport: 2, constantRatio: 1.0 }).entries, entries);
    });

    it('honors minSupport=1 even at scale — the fractional floor is off by default', () => {
      // 200 rows; RARE appears in exactly 1, COMMON in 5.
      const rows = [
        { raw: '2026-01-01 LOG COMMON RARE' },
        ...Array.from({ length: 4 }, (_, i) => ({ raw: `2026-01-01 LOG COMMON tok${i}` })),
        ...Array.from({ length: 195 }, (_, i) => ({ raw: `2026-01-01 LOG other${i} x` })),
      ];
      const { entries } = buildValueHistogram(rows, { minSupport: 1, constantRatio: 1.0 });
      const rare = entries.find((e) => e.value === 'RARE');
      assert.ok(rare, 'value in a single row of 200 is kept when minSupport=1 and no pct floor');
      assert.equal(rare.count, 1);
      // Opting back into the old behaviour: a 2% floor excludes it again.
      const withPct = buildValueHistogram(rows, { minSupport: 1, minSupportPct: 0.02, constantRatio: 1.0 });
      assert.ok(!withPct.entries.some((e) => e.value === 'RARE'), 'minSupportPct=0.02 re-imposes the floor');
    });

    it('exposes totalCandidates/truncated and honors maxEntries=-1 as unlimited', () => {
      const rows = Array.from({ length: 10 }, (_, i) => ({ raw: `2026-01-01 LOG v${i}` }));
      const h = buildValueHistogram(rows, { minSupport: 1, constantRatio: 1.0, maxEntries: 3 });
      assert.equal(h.totalCandidates, 12); // 2026-01-01 + LOG + v0..v9
      assert.ok(h.truncated);
      assert.equal(h.entries.length, 3);
      const all = buildValueHistogram(rows, { minSupport: 1, constantRatio: 1.0, maxEntries: -1 });
      assert.equal(all.entries.length, all.totalCandidates);
      assert.equal(all.truncated, false);
    });

    it('filters stopwords, shapes, and short tokens via knobs (format-generic)', () => {
      const rows = [
        { raw: '2026-01-01 LOG ALPHA the x1' },
        { raw: '2026-01-01 LOG ALPHA from x2' },
        { raw: '2026-01-01 LOG BETA to deadbeef' },
      ];
      const all = buildValueHistogram(rows, { minSupport: 1, constantRatio: 1.0, stopwords: [] });
      assert.ok(all.entries.some((e) => e.value === 'the'), 'stopwords disabled keeps prose');
      const filtered = buildValueHistogram(rows, { minSupport: 1, constantRatio: 1.0 });
      assert.ok(!filtered.entries.some((e) => ['the', 'from', 'to'].includes(e.value)), 'default stopwords drop prose');
      assert.ok(filtered.entries.some((e) => e.value === 'ALPHA'));
      const wordsOnly = buildValueHistogram(rows, { minSupport: 1, constantRatio: 1.0, includeShapes: ['word'] });
      assert.ok(wordsOnly.entries.every((e) => e.shape === 'word'), 'includeShapes filters hex/other');
      assert.ok(!wordsOnly.entries.some((e) => e.value === 'deadbeef'));
      const longOnly = buildValueHistogram(rows, { minSupport: 1, constantRatio: 1.0, minTokenLength: 3, stopwords: [] });
      assert.ok(!longOnly.entries.some((e) => e.value === 'x1'), 'minTokenLength drops short tokens');
    });

    it('buildHistogramPrompt passes only observed values/shape/count/context — no format hints', () => {
      const entries = [
        { value: 'REPLY', shape: 'word', count: 179, rowCount: 1000, contexts: ['[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I ~REPLY~MF_Customer_retrievePlanInfo_V1~retrievePlanInfo 0000015bea34…'] },
        { value: '5/9/17', shape: 'date', count: 597, rowCount: 1000, contexts: ['[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I ~REPLY~…'] },
      ];
      const { system, user } = buildHistogramPrompt(entries, 'anchor row here');
      assert.ok(user.includes('REPLY') && user.includes('179/1000') && user.includes('597/1000'));
      assert.ok(user.includes('anchor row here'));
      // genericity guard: instructions must not reference specific delimiters/formats
      // (brackets/tildes are unavoidable inside the required JSON output example,
      // so check word-level format hints, case-insensitive)
      const lower = system.toLowerCase();
      for (const banned of ['tilde', 'bracket', 'xml', 'delimited']) {
        assert.ok(!lower.includes(banned), `system prompt must not mention "${banned}"`);
      }
      assert.ok(system.includes('(?<value>'));
    });

    it('buildHistogramPrompt includes NAMED GROUPS section when nameMap given and uses exact names', () => {
      const entries = [{ value: 'REPLY', shape: 'word', count: 179, rowCount: 1000, contexts: ['row ctx'] }];
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST'] }];
      const { system, user } = buildHistogramPrompt(entries, 'anchor', nameMap);
      assert.ok(user.includes('NAMED GROUPS'));
      assert.ok(user.includes('name "direction"'));
      assert.ok(user.includes('"SCA_REQUEST"'));
      assert.ok(system.includes('Cover EVERY named group'), 'prompt must not license skipping named groups');
      assert.ok(!system.includes('Do NOT use semantic names'), 'contradictory semantic-name ban removed');
      assert.ok(!system.includes('ignore one-off values'), 'old permission to ignore low-support values removed');
      const plain = buildHistogramPrompt(entries, 'anchor');
      assert.ok(!plain.user.includes('NAMED GROUPS'), 'no section without nameMap');
    });

    it('prompt tags injected named entries with [NAMED GROUP]', () => {
      const entries = [{ value: '5/30/17 12:15:45:979', shape: 'datetime', count: 1, rowCount: 1000, contexts: ['ctx'], named: 'timestamp' }];
      const { user } = buildHistogramPrompt(entries, 'anchor', [{ name: 'timestamp', values: ['5/30/17 12:15:45:979'] }]);
      assert.ok(user.includes('[NAMED GROUP: "timestamp"]'));
    });

    it('histogram prompt includes EXAMPLE ROWS block and position-anchoring instruction', () => {
      const entries = [{ value: 'REPLY', shape: 'word', count: 9, rowCount: 10, contexts: ['ctx'] }];
      const rows = ['[5/9/17 10:35:41 NZST] x ~REPLY~opA ICMS tail', '[5/9/17 10:36:02 NZST] y ~RECEIVE~opB OM-AS tail'];
      const { system, user } = buildHistogramPrompt(entries, rows[0], [], rows);
      assert.ok(user.includes('EXAMPLE ROWS'), 'example rows block present');
      assert.ok(user.includes('ROW 1: [5/9/17 10:35:41 NZST]'), 'row content included');
      assert.ok(user.includes('ROW 2:'), 'second row included');
      assert.ok(system.includes('align fields') && system.includes('position'), 'position-anchoring instruction present');
      assert.ok(system.includes('consecutive segments share the same delimiter shape'), 'ambiguous-segment disambiguation instruction present');
      assert.ok(system.includes('test each regex against the full rows and the value list'), 'explicit verification-against-rows instruction present');
      // no rows -> no block
      const { user: noRows } = buildHistogramPrompt(entries, 'anchor', [], []);
      assert.ok(!noRows.includes('EXAMPLE ROWS'));
    });

    it('prompt always restricts the task to exactly one rule per named group, no extras', () => {
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST', 'SCA_RESPONSE', 'PROV_REQUEST'] }];
      const { system } = buildHistogramPrompt(
        [{ value: 'REPLY', shape: 'word', count: 9, rowCount: 10, contexts: ['c'] }], 'anchor', nameMap, ['row1']);
      assert.ok(system.includes('ONLY task'), 'named-mode framing present');
      assert.ok(system.includes('exactly one rule per named group, no more, no less'));
      assert.ok(system.includes('do not add extra fields'));
      assert.ok(!system.includes('found001'), 'no open-mode/foundNNN framing remains');
      assert.ok(!system.includes('GROUP the listed values'), 'open-discovery framing removed');
    });

    it('applyNameMapToFields renames by matched-value overlap, deterministic', () => {
      const headers = [
        '[5/9/17 10:35:41 NZST] x ~REPLY~opA id1',
        '[5/9/17 10:35:42 NZST] x ~RECEIVE~opB id2',
        '[5/9/17 10:35:43 NZST] x ~SCA_REQUEST~opC id3',
      ];
      const fields = [{ name: 'found001', regex: '~(?<value>[A-Z_]+)~' }];
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST'] }];
      const [renamed] = applyNameMapToFields(fields, headers, nameMap);
      assert.equal(renamed.name, 'direction');
      // no overlap -> untouched
      const [untouched] = applyNameMapToFields(fields, headers, []);
      assert.equal(untouched.name, 'found001');
    });

    it('applyNameMapToFields refuses an untruthful label: regex mostly captures non-group values', () => {
      // Regex matches every whitespace-delimited word; only 1 of the 5 captured
      // values belongs to the direction group -> must NOT be named "direction".
      const headers = [
        '[5/9/17 10:35:41 NZST] x ~REPLY~opA id1 tail',
        '[5/9/17 10:35:42 NZST] x ~RECEIVE~opB id2 tail',
        '[5/9/17 10:35:43 NZST] x ~SCA_REQUEST~opC id3 tail',
      ];
      const loose = [{ name: 'found001', regex: '\\b(?<value>[A-Za-z0-9_\\[\\].:-]+)\\b' }];
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST', 'SCA_RESPONSE', 'PROV_REQUEST'] }];
      const [out] = applyNameMapToFields(loose, headers, nameMap);
      assert.equal(out.name, 'found001', 'loose grab-bag regex must not earn the group name');
    });

    it('applyNameMapToFields uses all matches per row, not just the leftmost', () => {
      // Leftmost match is the date; the tilde token appears later in each row.
      const headers = [
        '[5/9/17 10:35:41 NZST] ~REPLY~a',
        '[5/9/17 10:35:42 NZST] ~RECEIVE~b',
        '[5/9/17 10:35:43 NZST] ~SCA_REQUEST~c',
      ];
      const f = [{ name: 'found001', regex: '~(?<value>[A-Z_]+)~' }];
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST'] }];
      const [out] = applyNameMapToFields(f, headers, nameMap);
      assert.equal(out.name, 'direction');
    });

    it('applyNameMapToFields purity bar: all-caps grab-bag must not earn "system"', () => {
      // \b[A-Z0-9_]+\b matches NZST, ABSLOG, REPLY plus the system values —
      // captures are mostly NON-system, so purity < 0.8 -> no rename.
      const headers = [
        '[5/9/17 10:35:41 NZST] 000000b3 ABSLOG I ~REPLY~opA ICMS tail',
        '[5/9/17 10:36:02 NZST] 0000082a ABSLOG I ~RECEIVE~opB OM-AS tail',
        '[5/30/17 09:01:11 NZST] 00000a4e ABSLOG I ~REPLY~opC WS_TOM tail',
      ];
      const grabBag = [{ name: 'found001', regex: '\\b(?<value>[A-Z0-9_]+)\\b' }];
      const nameMap = [{ name: 'system', values: ['ICMS', 'OM-AS', 'WS_TOM', 'WS_SIEBEL', 'SE9832', 'SV'] }];
      const [out] = applyNameMapToFields(grabBag, headers, nameMap);
      assert.equal(out.name, 'found001', 'grab-bag regex fails the 0.8 purity bar');
      // sanity: a tight regex limited to the system token DOES earn the name
      const tight = [{ name: 'found001', regex: '~[A-Za-z]+\\s+(?<value>(?:ICMS|OM-AS|WS_TOM|WS_SIEBEL|SE9832|SV))\\s' }];
      const [named] = applyNameMapToFields(tight, headers, nameMap);
      assert.equal(named.name, 'system');
    });

    it('prompt forbids literal alternations and field-named capture groups', () => {
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE'] }];
      const { system, user } = buildHistogramPrompt([], 'anchor', nameMap);
      assert.ok(user.includes('do NOT emit a literal alternation'));
      assert.ok(system.includes('named exactly "value"'));
    });

    it('classifies date and number shapes distinctly from hex/other', () => {
      assert.equal(tokenShape('5/9/17'), 'date');
      assert.equal(tokenShape('12-31-2017'), 'date');
      assert.equal(tokenShape('2026-01-01'), 'timestamp');
      assert.equal(tokenShape('42'), 'number');
      assert.equal(tokenShape('0'), 'number');
      assert.equal(tokenShape('00010134'), 'hex', 'leading-zero digit strings are ids (hex), not numbers');
      assert.equal(tokenShape('0000015bea34'), 'hex', 'pure hex string stays hex, not number');
      assert.equal(tokenShape('10:35:41:868'), 'time');
    });

    it('classifies compound date+time as datetime, checked before date/time', () => {
      assert.equal(tokenShape('5/9/17 10:35:41:868'), 'datetime');
      assert.equal(tokenShape('12-31-2017 09:01:11'), 'datetime');
      assert.equal(tokenShape('5/9/17 10:35'), 'datetime');
      // ISO date+space+time is the longer compound form already: timestamp
      assert.equal(tokenShape('2026-01-01 10:35:41'), 'timestamp');
      // date or time alone must NOT be datetime
      assert.equal(tokenShape('5/9/17'), 'date');
      assert.equal(tokenShape('10:35:41:868'), 'time');
    });

    it('histogram tokenizes "date time" as one datetime entry, not separate date/time', () => {
      const rows = [
        { raw: '[5/9/17 10:35:41:868 NZST] x REPLY a' },
        { raw: '[5/9/17 10:36:02:111 NZST] x REPLY b' },
        { raw: '[5/9/17 10:37:19:004 NZST] x REPLY c' },
      ];
      const { entries } = buildValueHistogram(rows, { stopwords: [] });
      const dt = entries.find((e) => e.value.includes('5/9/17 10:3'));
      // each row has a distinct datetime -> each appears once, below minSupport 2,
      // so instead verify via tokenize indirectly: dates DO repeat so check shape of a repeated pair
      assert.ok(dt === undefined || dt.shape === 'datetime');
      // repeated date alone is still date-shaped; the compound token must be datetime-shaped
      const rows2 = [
        { raw: '[5/9/17 10:35:41:868 NZST] x REPLY a extra' },
        { raw: '[5/9/17 10:35:41:868 NZST] x REPLY b extra' },
        { raw: '[5/9/17 10:35:41:868 NZST] x REPLY c extra' },
      ];
      const entries2 = buildValueHistogram(rows2, { stopwords: [], constantRatio: 1 }).entries;
      const compound = entries2.find((e) => e.value === '5/9/17 10:35:41:868');
      assert.ok(compound, 'compound datetime token present');
      assert.equal(compound.shape, 'datetime');
      assert.ok(!entries2.some((e) => e.value === '5/9/17' && e.shape === 'date' && e.count === 3 && entries2.some((x) => x.value === '10:35:41:868' && x.count === 3)), 'no split date+time both at full support');
    });

    it('ignores payload content — only headers are histogrammed', () => {
      const rows = [
        { raw: '2026-01-01 LOG a {"k":"repeated_v1"}' },
        { raw: '2026-01-01 LOG b {"k":"repeated_v2"}' },
        { raw: '2026-01-01 LOG c {"k":"repeated_v1"}' },
      ];
      const { entries } = buildValueHistogram(rows);
      // Payload values must not appear; header tokens that repeat across rows may.
      assert.ok(!entries.some((e) => e.value.includes('repeated_v')), 'payload values excluded');
      // a/b/c each appear in 1 of 3 rows -> below minSupport (2), so nothing leaks.
      assert.deepStrictEqual(entries, []);
    });
  });

  describe('isPlausibleFieldRule (quality gate)', () => {
    const headers = [
      '[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I',
      '[5/9/17 10:35:41:870 NZST] 0000082a ABSLOG I',
      '[5/30/17 09:01:11:001 NZST] 00000a4e ABSLOG I',
    ];
    const manyHeaders = [
      '[5/9/17 10:35:41:868 NZST] 000000b3 ABSLOG I',
      '[5/9/17 10:35:41:870 NZST] 0000082a ABSLOG I',
      '[5/9/17 10:35:41:900 NZST] 0000091c ABSLOG I',
      '[5/30/17 09:01:11:001 NZST] 00000a4e ABSLOG I',
      '[5/30/17 09:02:22:002 NZST] 00000b5f ABSLOG I',
      '[5/30/17 09:03:33:003 NZST] 00000c60 ABSLOG I',
    ];

    it('keeps a rule that varies with a dominant shape', () => {
      assert.ok(isPlausibleFieldRule({ regex: 'NZST\\]\\s+(?<value>[0-9a-f]+)' }, manyHeaders));
    });

    it('rejects a rule matching a constant (single distinct value)', () => {
      assert.ok(!isPlausibleFieldRule({ regex: '(?<value>ABSLOG)' }, headers));
    });

    it('rejects a rule with fewer than minDistinctValues distinct values (default 5)', () => {
      // 3 distinct hex ids across 3 rows — below the default floor of 5
      assert.ok(!isPlausibleFieldRule({ regex: 'NZST\\]\\s+(?<value>[0-9a-f]+)' }, headers));
      // but fine when the floor is lowered
      assert.ok(isPlausibleFieldRule({ regex: 'NZST\\]\\s+(?<value>[0-9a-f]+)' }, headers, { minDistinctValues: 3 }));
      // 6 distinct ids passes the default
      assert.ok(isPlausibleFieldRule({ regex: 'NZST\\]\\s+(?<value>[0-9a-f]+)' }, manyHeaders));
    });

    it('minDistinctValues is configurable via options', () => {
      assert.ok(isPlausibleFieldRule({ regex: 'NZST\\]\\s+(?<value>[0-9a-f]+)' }, headers, { minDistinctValues: 2 }));
      assert.ok(!isPlausibleFieldRule({ regex: 'NZST\\]\\s+(?<value>[0-9a-f]+)' }, headers, { minDistinctValues: 10 }));
    });

    it('rejects a rule matching fewer than minRows rows', () => {
      // matches only the 3 rows containing 5/30/17 — distinct values are the full
      // row tails (>= minDistinctValues), so only the row-count check can reject it
      assert.ok(!isPlausibleFieldRule({ regex: '5/30/17(?<value>.*)' }, manyHeaders, { minDistinctValues: 1, minRows: 4 }));
    });

    it('rejects invalid regex and non-regex fields pass through', () => {
      assert.ok(!isPlausibleFieldRule({ regex: '(?<value>[unclosed' }, headers));
      assert.ok(isPlausibleFieldRule({ regex: null }, headers));
    });
  });

  describe('discoverFieldExtractionRules force re-discovery', () => {
    const rows = [
      { raw: '[5/9/17 10:35:41 NZST] 000000b3 ABSLOG I ~REPLY~opA ~MF_X_opA_V1~' },
      { raw: '[5/9/17 10:36:02 NZST] 0000082a ABSLOG I ~RECEIVE~opB ~MF_X_opB_V2~' },
      { raw: '[5/30/17 09:01:11 NZST] 00000a4e ABSLOG I ~REPLY~opC ~MF_X_opC_V1~' },
    ];
    // A whole-record rule that matches every header — without force, discovery
    // is skipped entirely (the 6ms no-op).
    const catchAll = [{ name: 'line', source: null, regex: '^(?<value>.+)$' }];
    const fakeDiscovery = async () => ([{ name: 'found001', source: null, regex: '~(?<value>[A-Z_]+)~', samples: ['REPLY'] }]);

    it('skips LLM when existing rules cover all rows and force is not set', async () => {
      const { fieldExtraction } = await discoverFieldExtractionRules(
        rows, { fields: catchAll }, { discoverImpl: async () => { throw new Error('LLM must not be called'); } });
      assert.deepStrictEqual(fieldExtraction.fields.map((f) => f.name), ['line']);
    });

    it('re-runs discovery when force:true even if all rows are covered', async () => {
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE'] }];
      const { fieldExtraction } = await discoverFieldExtractionRules(
        rows, { fields: catchAll, nameMap }, { force: true, minNameMapValues: 1, minDistinctValues: 2, discoverImpl: fakeDiscovery });
      const names = fieldExtraction.fields.map((f) => f.name);
      assert.ok(names.includes('line'));
      assert.ok(names.includes('direction'), 'new named field merged in despite catch-all');
    });

    it('skips discovery entirely when no nameMap is present (open mode removed)', async () => {
      const { fieldExtraction } = await discoverFieldExtractionRules(
        rows, { fields: [] }, { force: true, discoverImpl: async () => { throw new Error('LLM must not be called without a nameMap'); } });
      assert.deepStrictEqual(fieldExtraction.fields, []);
    });

    it('applies nameMap naming to the merged set (retroactive rename)', async () => {
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE'] }];
      const { fieldExtraction } = await discoverFieldExtractionRules(
        rows, { fields: [], nameMap }, { force: true, minNameMapValues: 1, minDistinctValues: 2, discoverImpl: fakeDiscovery });
      const dir = fieldExtraction.fields.find((f) => f.name === 'direction');
      assert.ok(dir, 'found001 renamed to direction by overlap');
      assert.equal(dir.regex, '~(?<value>[A-Z_]+)~');
      assert.deepStrictEqual(fieldExtraction.nameMap, [{ name: 'direction', variance: 'enum', values: ['REPLY', 'RECEIVE'] }]);
    });

    it('user-named fields survive the plausibility gate even with few observed values', async () => {
      // The regex captures only ONL_ENQUIRE_CUSTOMER everywhere. The truthful-label
      // check would keep the name only via hits>=2/majority; here we give the group
      // 2 values and make the regex capture both across rows, so the name sticks and
      // the distinct-value exemption is what lets it through the gate.
      const nameMap = [{ name: 'channel', values: ['ONL_ENQUIRE_CUSTOMER', 'ONL_OTHER'] }];
      const chRows = [
        { raw: 'x 000000b3 ABSLOG I ~REPLY~opA ONL_ENQUIRE_CUSTOMER tail' },
        { raw: 'x 0000082a ABSLOG I ~RECEIVE~opB ONL_OTHER tail' },
        { raw: 'x 00000a4e ABSLOG I ~REPLY~opC ONL_ENQUIRE_CUSTOMER tail' },
      ];
      const discovery = async () => ([{ name: 'found001', source: null, regex: '(?<value>ONL_[A-Z_]+)' }]);
      const { fieldExtraction } = await discoverFieldExtractionRules(
        chRows, { fields: [], nameMap }, { force: true, minNameMapValues: 1, discoverImpl: discovery });
      const ch = fieldExtraction.fields.find((f) => f.name === 'channel');
      assert.ok(ch, 'named field kept via nameMap exemption despite only 2 distinct values');
    });

    it('unnamed single-value constant still rejected by the gate', async () => {
      const constantDiscovery = async () => ([{ name: 'found001', source: null, regex: '(?<value>ABSLOG)' }]);
      const { fieldExtraction } = await discoverFieldExtractionRules(
        rows, { fields: [] }, { force: true, discoverImpl: constantDiscovery });
      assert.ok(!fieldExtraction.fields.some((f) => f.regex.includes('ABSLOG')), 'constant still gated out without a nameMap name');
    });

    it('discoverFieldRules drops rules whose regex cannot capture their own samples (mechanical backstop)', async () => {
      const rows = [
        { raw: '[5/9/17 10:35:41 NZST] x ~REPLY~opA id1' },
        { raw: '[5/9/17 10:36:02 NZST] x ~RECEIVE~opB id2' },
        { raw: '[5/9/17 10:37:19 NZST] x ~SCA_REQUEST~opC id3' },
        { raw: '[5/9/17 10:38:00 NZST] x ~REPLY~opD id4' },
        { raw: '[5/9/17 10:39:00 NZST] x ~RECEIVE~opE id5' },
        { raw: '[5/9/17 10:40:00 NZST] x ~SCA_REQUEST~opF id6' },
      ];
      const completeImpl = async () => ({
        success: true,
        data: JSON.stringify({
          fields: [
            { name: 'found001', source: null, regex: '~(?<value>[A-Z_]+)~', samples: ['REPLY'] },       // verifies, 3 distinct values
            { name: 'found002', source: null, regex: 'ZZZ(?<value>.+)', samples: ['REPLY'] },         // anchored to a token absent from the rows -> self-check drops it
            { name: 'found003', source: null, regex: '(?<value>NZST)', samples: ['NZST'] },         // matches but only 1 distinct value across rows -> gate drops it at default floor
          ],
        }),
      });
      // discoverFieldRules is not exported, but discoverFieldExtractionRules passes
      // options through, so completeImpl reaches it on a forced run. minDistinctValues
      // default 5 would drop everything in this 6-row fixture, so lower it to 3:
      // found001 has exactly 3 distinct captures (REPLY/RECEIVE/SCA_REQUEST).
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST'] }];
      const { fieldExtraction } = await discoverFieldExtractionRules(rows, { fields: [], nameMap }, {
        force: true, minNameMapValues: 1, minDistinctValues: 3, completeImpl,
      });
      const names = fieldExtraction.fields.map((f) => f.name);
      assert.ok(names.includes('direction'), 'verifying rule kept (renamed to the named group)');
      assert.ok(!names.includes('found002'), 'non-capturing rule dropped by the self-check');
      assert.ok(!names.includes('found003'), 'single-distinct-value rule dropped by the gate');
    });

    it('named mode: fields keep their LLM names; no foundNNN renaming', async () => {
      const nameMap = [{ name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST', 'SCA_RESPONSE', 'PROV_REQUEST'] }];
      const richRows = [
        { raw: '[5/9/17 10:35:41 NZST] 000000b3 ABSLOG I ~REPLY~MF_X_opA_V1~opA pContext[C1] t1' },
        { raw: '[5/9/17 10:36:02 NZST] 0000082a ABSLOG I ~RECEIVE~MF_X_opB_V2~opB pContext[C2] t2' },
        { raw: '[5/30/17 09:01:11 NZST] 00000a4e ABSLOG I ~SCA_REQUEST~MF_X_opC_V1~opC pContext[C3] t3' },
        { raw: '[5/30/17 09:02:22 NZST] 00000b5f ABSLOG I ~REPLY~MF_X_opD_V1~opD pContext[C4] t4' },
        { raw: '[5/30/17 09:03:33 NZST] 00000c60 ABSLOG I ~RECEIVE~MF_X_opE_V2~opE pContext[C5] t5' },
        { raw: '[5/30/17 09:04:44 NZST] 00000d71 ABSLOG I ~SCA_REQUEST~MF_X_opF_V1~opF pContext[C6] t6' },
      ];
      const inventing = async () => ([
        { name: 'direction', source: null, regex: '~(?<value>[A-Z_]+)~' },
        { name: 'pContext', source: null, regex: 'pContext\\[(?<value>[^\\]]+)\\]' },
      ]);
      const { fieldExtraction } = await discoverFieldExtractionRules(
        richRows, { fields: [], nameMap }, { force: true, minNameMapValues: 1, minDistinctValues: 3, discoverImpl: inventing });
      const names = fieldExtraction.fields.map((f) => f.name);
      assert.ok(names.includes('direction'), 'user-given name kept');
      assert.ok(!names.some((n) => /^found\d+$/.test(n)), 'no foundNNN renaming remains');
    });

    it('traceFieldExtract max_tokens default is 16384 (histogram prompt + reasoning fit)', () => {
      assert.equal(config.traceFieldExtract.max_tokens, 16384);
    });

    it('nameMap groups with fewer than minNameMapValues values (default 5) are dropped from the persisted map', async () => {
      const nameMap = [
        { name: 'direction', values: ['REPLY', 'RECEIVE', 'SCA_REQUEST', 'SCA_RESPONSE', 'PROV_REQUEST'] },
        { name: 'channel', values: ['ONL_ENQUIRE_CUSTOMER'] }, // only 1 value -> dropped
        { name: 'business_process', values: ['BPM8-22008'] },   // only 1 value -> dropped
      ];
      const { fieldExtraction } = await discoverFieldExtractionRules(
        rows, { fields: [], nameMap }, { force: true, discoverImpl: fakeDiscovery });
      assert.deepStrictEqual(fieldExtraction.nameMap.map((g) => g.name), ['direction']);
    });

    it('minNameMapValues is configurable via options and config default is 5', async () => {
      assert.equal(config.traceFieldExtract.min_name_map_values, 5);
      const nameMap = [
        { name: 'channel', values: ['ONL_ENQUIRE_CUSTOMER', 'X1', 'X2'] },
        { name: 'direction', values: ['REPLY', 'RECEIVE'] },
      ];
      const { fieldExtraction } = await discoverFieldExtractionRules(
        rows, { fields: [], nameMap }, { force: true, minNameMapValues: 2, discoverImpl: fakeDiscovery });
      assert.deepStrictEqual(fieldExtraction.nameMap.map((g) => g.name).sort(), ['channel', 'direction']);
    });
  });
});
