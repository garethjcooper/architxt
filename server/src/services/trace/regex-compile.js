/**
 * Central regex compilation for trace profiles.
 *
 * Every regex a profile can declare is compiled exactly once through this
 * module and validated up front:
 *
 *   - records.recordStartPattern        (plaintext, json-lines, json-nd)
 *   - records.recordStartRule.pattern   (plaintext)
 *   - records.recordStartRule.keyRegex  (delimited)
 *   - fieldExtraction.fields[].regex    (field extraction, incl. within-field)
 *
 * An invalid pattern throws at profile-load / validation time with the exact
 * config path, instead of surfacing as a per-record warning mid-parse.
 *
 * Two flavours exist:
 *   - compileStartRegex: supports the `/body/flags` literal form and always
 *     adds the multiline flag, matching the historical plaintext engines.
 *   - compilePlainRegex: plain `new RegExp(src)`, matching the json engines.
 */

/**
 * Compile a record-start pattern. Accepts either a bare pattern source or the
 * `/body/flags` literal form; the `m` flag is always present so `^`/`$`
 * anchor per line.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
export function compileStartRegex(pattern) {
  let body = pattern;
  let flags = '';
  const literalMatch = pattern.match(/^\/(.*)\/([a-z]*)$/);
  if (literalMatch) {
    body = literalMatch[1];
    flags = literalMatch[2] || '';
  }
  return new RegExp(body, flags.includes('m') ? flags : flags + 'm');
}

/**
 * Compile a plain regex source (no literal-form handling, no added flags) —
 * used by the JSON engines and for field-extraction regexes.
 *
 * @param {string} src
 * @returns {RegExp}
 */
export function compilePlainRegex(src) {
  return new RegExp(src);
}

/**
 * Compile a regex source or return null for empty input. Throws on invalid
 * syntax — callers that want to validate should use this directly.
 *
 * @param {string|null|undefined} src
 * @param {(src: string) => RegExp} [compile]
 * @returns {RegExp|null}
 */
export function compileOptionalRegex(src, compile = compilePlainRegex) {
  if (typeof src !== 'string' || src === '') return null;
  return compile(src);
}

/**
 * Build a per-spec regex cache for fieldExtraction.fields. Returns a Map from
 * regex source to a compiled RegExp, so per-record application never
 * recompiles. Invalid sources throw (fail-fast) — call validate first.
 *
 * @param {object|null|undefined} fieldExtraction
 * @returns {Map<string, RegExp>}
 */
export function buildFieldRegexCache(fieldExtraction) {
  const cache = new Map();
  const fields = Array.isArray(fieldExtraction?.fields) ? fieldExtraction.fields : [];
  for (const f of fields) {
    if (typeof f?.regex === 'string' && f.regex !== '' && !cache.has(f.regex)) {
      cache.set(f.regex, compilePlainRegex(f.regex));
    }
  }
  return cache;
}

/**
 * Validate every regex declared by a trace profile config and throw on the
 * first invalid one, with the exact config path in the message.
 *
 * @param {object} profileConfig - The full tfp_config object (parser + fieldExtraction).
 * @throws {Error} on the first invalid regex.
 */
export function validateTraceProfileRegexes(profileConfig) {
  const parserConfig = profileConfig?.parser?.config || {};
  const records = parserConfig.records || {};
  const rule = records.recordStartRule || {};

  assertValidRegex(records.recordStartPattern, 'parser.config.records.recordStartPattern', compileStartRegex);
  assertValidRegex(rule.pattern, 'parser.config.records.recordStartRule.pattern', compileStartRegex);
  assertValidRegex(rule.keyRegex, 'parser.config.records.recordStartRule.keyRegex', compilePlainRegex);

  const fields = Array.isArray(profileConfig?.fieldExtraction?.fields)
    ? profileConfig.fieldExtraction.fields
    : [];
  fields.forEach((f, i) => {
    assertValidRegex(f?.regex, `fieldExtraction.fields[${i}].regex`, compilePlainRegex);
  });
}

function assertValidRegex(src, path, compile) {
  if (typeof src !== 'string' || src === '') return;
  try {
    compile(src);
  } catch (err) {
    throw new Error(`Invalid regex at ${path}: ${err.message}`);
  }
}
