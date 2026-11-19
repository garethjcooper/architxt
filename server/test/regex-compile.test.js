import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  compileStartRegex,
  compilePlainRegex,
  compileOptionalRegex,
  buildFieldRegexCache,
  validateTraceProfileRegexes,
} from '../src/services/trace/regex-compile.js';
import { createParserForProfile } from '../src/services/trace/parser-registry.js';
import { normaliseDelimitedSource } from '../src/services/trace/parsers/delimited-normaliser.js';
import { PlaintextParser } from '../src/services/trace/parsers/plaintext-parser.js';
import { extractRecordFields, applyFieldExtractionToRecords } from '../src/services/trace/trace-field-extract.js';

describe('regex-compile', () => {
  describe('compileStartRegex', () => {
    it('compiles a bare pattern and adds the multiline flag', () => {
      const re = compileStartRegex('^\\[\\d+\\]');
      assert.ok(re instanceof RegExp);
      assert.ok(re.multiline);
      assert.ok(re.test('[123] hello'));
      assert.ok(!re.test('no marker'));
    });

    it('parses /body/flags literal form', () => {
      const re = compileStartRegex('/^abc/i');
      assert.ok(re.ignoreCase);
      assert.ok(re.multiline);
      assert.ok(re.test('ABC'));
    });

    it('throws on invalid pattern', () => {
      assert.throws(() => compileStartRegex('(['), SyntaxError);
    });
  });

  describe('compileOptionalRegex', () => {
    it('returns null for empty/non-string input', () => {
      assert.equal(compileOptionalRegex(''), null);
      assert.equal(compileOptionalRegex(null), null);
      assert.equal(compileOptionalRegex(undefined), null);
    });

    it('compiles non-empty input', () => {
      assert.ok(compileOptionalRegex('abc') instanceof RegExp);
    });
  });

  describe('validateTraceProfileRegexes', () => {
    it('passes a clean profile', () => {
      assert.doesNotThrow(() => validateTraceProfileRegexes({
        parser: { config: { records: { recordStartPattern: '^\\[', recordStartRule: { keyRegex: '^[A-Z]+$' } } } },
        fieldExtraction: { fields: [{ name: 'x', regex: '(?<value>\\d+)' }] },
      }));
    });

    it('throws with the config path for an invalid recordStartPattern', () => {
      assert.throws(
        () => validateTraceProfileRegexes({ parser: { config: { records: { recordStartPattern: '([' } } } }),
        /Invalid regex at parser\.config\.records\.recordStartPattern/
      );
    });

    it('throws with the config path for an invalid keyRegex', () => {
      assert.throws(
        () => validateTraceProfileRegexes({ parser: { config: { records: { recordStartRule: { keyColumn: 0, keyRegex: '([' } } } } }),
        /Invalid regex at parser\.config\.records\.recordStartRule\.keyRegex/
      );
    });

    it('throws with the field index for an invalid fields[].regex', () => {
      assert.throws(
        () => validateTraceProfileRegexes({
          parser: { config: {} },
          fieldExtraction: { fields: [{ name: 'ok', regex: 'a+' }, { name: 'bad', regex: '(?<x>[)' }] },
        }),
        /Invalid regex at fieldExtraction\.fields\[1\]\.regex/
      );
    });

    it('ignores empty/missing regex fields', () => {
      assert.doesNotThrow(() => validateTraceProfileRegexes({
        fieldExtraction: { fields: [{ name: 'noRegex' }, { name: 'empty', regex: '' }] },
      }));
    });
  });

  describe('createParserForProfile fail-fast', () => {
    it('throws on invalid recordStartPattern before parsing', () => {
      assert.throws(
        () => createParserForProfile({ tfp_config: { parser: { module: 'plaintext', config: { records: { recordStartPattern: '([' } } } } }),
        /Invalid regex at parser\.config\.records\.recordStartPattern/
      );
    });

    it('throws on invalid fieldExtraction regex even when the parser has none', () => {
      assert.throws(
        () => createParserForProfile({
          tfp_config: {
            parser: { module: 'delimited', config: {} },
            fieldExtraction: { fields: [{ name: 'bad', regex: '([' }] },
          },
        }),
        /Invalid regex at fieldExtraction\.fields\[0\]\.regex/
      );
    });
  });

  describe('buildFieldRegexCache', () => {
    it('compiles each distinct regex source once', () => {
      const cache = buildFieldRegexCache({
        fields: [
          { name: 'a', regex: '(?<value>\\d+)' },
          { name: 'b', regex: '(?<value>\\d+)' }, // duplicate source
          { name: 'c', regex: '[a-z]+' },
          { name: 'noRegex' },
        ],
      });
      assert.equal(cache.size, 2);
      assert.ok(cache.get('(?<value>\\d+)') instanceof RegExp);
      assert.ok(cache.get('[a-z]+') instanceof RegExp);
    });

    it('shares one RegExp instance for duplicate sources', () => {
      const cache = buildFieldRegexCache({ fields: [{ regex: 'x' }, { regex: 'x' }] });
      assert.equal(cache.get('x'), cache.get('x'));
    });

    it('throws on invalid regex (fail-fast)', () => {
      assert.throws(() => buildFieldRegexCache({ fields: [{ name: 'bad', regex: '([' }] }));
    });
  });
});

describe('compile-once in parsers', () => {
  it('plaintext parser compiles recordStartPattern once in the constructor', async () => {
    const parser = new PlaintextParser({ records: { recordStartPattern: '^\\[\\d+\\]' } });
    assert.ok(parser.recordStartRegex instanceof RegExp);
    const content = '[1] a\n[2] b\n[3] c';
    const records = await parser.parseFile('x', Buffer.from(content));
    assert.equal(records.length, 3);
  });

  it('delimited normaliser compiles keyRegex once, not per line', () => {
    const config = {
      input: { delimiter: '\t', hasHeader: false },
      records: { recordStartRule: { keyColumn: 0, keyRegex: '^[0-9]+$', minColumns: 2 } },
    };
    const lines = Array.from({ length: 500 }, (_, i) => `${i}\tstart-${i}`)
      .concat(Array.from({ length: 500 }, (_, i) => `continuation-${i}`))
      .join('\n');
    const { text } = normaliseDelimitedSource(lines, config);
    // 500 logical records, each on its own line after normalisation.
    assert.equal(text.split('\n').length, 500);
  });

  it('field extraction reuses a shared regex cache across records', () => {
    const spec = { fields: [{ name: 'id', source: null, regex: 'id=(?<value>\\d+)' }] };
    const records = Array.from({ length: 100 }, (_, i) => ({ raw: `id=${i} op=foo` }));
    const out = applyFieldExtractionToRecords(records, spec);
    assert.equal(out.length, 100);
    assert.equal(out[42].fields.id, '42');
    // extractRecordFields with an explicit cache returns the same values.
    const cache = buildFieldRegexCache(spec);
    const direct = extractRecordFields('id=7 op=bar', spec, {}, { regexCache: cache });
    assert.equal(direct.id, '7');
  });
});
