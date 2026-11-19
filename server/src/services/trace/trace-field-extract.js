import { complete } from '../llm/client.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';
import { XMLParser } from 'fast-xml-parser';
import { findTopLevelJsonRanges } from './parsers/json-scan.js';
import { buildFieldRegexCache } from './regex-compile.js';

const logger = createLogger('trace-field-extract');

const XML_DECL_REGEX = /^<\?xml[^?]*\?>/;
const XML_ROOT_REGEX = /^<([A-Za-z_:][A-Za-z0-9_:.]*)/;
const JSON_ROOT_REGEX = /^(\{|\[)/;

const DELIMITER_MAP = {
  comma: ',',
  tab: '\t',
  pipe: '|',
  semicolon: ';',
  space: ' ',
};

/** Convert common escaped or named delimiter specs into a real character. */
function resolveDelimiter(delimiterSpec) {
  if (typeof delimiterSpec !== 'string') return null;
  const trimmed = delimiterSpec.trim();
  if (trimmed.length === 0) return null;

  // Named delimiter.
  if (DELIMITER_MAP[trimmed]) return DELIMITER_MAP[trimmed];

  // Single literal character.
  if (trimmed.length === 1) return trimmed;

  // Common JSON-escaped or C-style escapes.
  if (trimmed === '\\\\t' || trimmed === '\\t') return '\t';
  if (trimmed === '\\\\n') return '\n';
  if (trimmed === '\\\\r') return '\r';
  if (trimmed === '\\\\r\\\\n' || trimmed === 'CRLF') return '\r\n';
  if (trimmed.startsWith('\\\\x') && trimmed.length === 4) {
    const code = parseInt(trimmed.slice(2), 16);
    if (!Number.isNaN(code)) return String.fromCharCode(code);
  }

  return null;
}

/**
 * RFC-4180-style split: respects double-quoted fields, so delimiters inside
 * quotes (e.g. "Smith, John") don't split. A quote only opens a quoted field
 * at the start of a field; "" inside a quoted field is an escaped quote.
 *
 * When `respectQuotes` is false (e.g. quoteChar: "" in the profile), quotes
 * are ordinary characters and a bare quote never opens a quoted field —
 * otherwise JSON cells containing `"` would swallow the rest of the row.
 */
function splitDelimited(line, delimiter, respectQuotes = true) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  let fieldStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (respectQuotes && ch === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
      fieldStart = true;
    } else {
      cur += ch;
      fieldStart = false;
    }
  }
  out.push(cur);
  return out;
}

function safeFieldName(name, index) {
  if (typeof name !== 'string' || !name.trim()) return `column_${index}`;
  const cleaned = name
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^[0-9]/, '_$&')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 64);
  return cleaned || `column_${index}`;
}

/**
 * True when a header cell is shaped like a data value (hex id, number,
 * timestamp, date, time, uuid) rather than a column name — such cells reject
 * the first row as a header.
 */
export function isValueShapedCell(cell) {
  const shape = tokenShape(String(cell ?? '').trim());
  return shape === 'hex' || shape === 'number' || shape === 'datetime'
    || shape === 'timestamp' || shape === 'date' || shape === 'time' || shape === 'uuid';
}

/** Detect whether rows look like delimited records. */
function inferDelimiter(rawRows, respectQuotes = true) {
  const candidates = [',', '\t', '|', ';'];
  let best = { delimiter: ',', count: 0 };
  for (const delimiter of candidates) {
    let total = 0;
    for (const raw of rawRows.slice(0, 10)) {
      total += splitDelimited(raw, delimiter, respectQuotes).length - 1;
    }
    if (total > best.count) best = { delimiter, count: total };
  }
  return best.delimiter;
}

/**
 * Discover deterministic column extraction rules for delimited rows.
 *
 * Uses the configured delimiter (or infers one). If a raw sample string is
 * supplied and hasHeader is true, the first line of the sample is used as the
 * header row. Otherwise generic column_0, column_1 names are used.
 *
 * @param {object} params
 * @param {object[]} [params.rows] - Parsed records ({ raw }).
 * @param {string} [params.sample] - Original raw sample text (may include header line).
 * @param {object} [params.parserConfig] - Delimited parser config.
 */
export function discoverDelimitedColumnRules({ rows = [], sample = null, parserConfig }) {
  const input = parserConfig?.config?.input || {};
  const hasHeader = input.hasHeader === true || parserConfig?.config?.header === true;
  // quoteChar: "" disables quoting — quotes in JSON/XML cells are ordinary
  // characters and must not open a quoted field (which would swallow tabs).
  const respectQuotes = input.quoteChar !== '' && parserConfig?.config?.input?.quoteChar !== '';

  // Prefer the raw sample for delimited because the row parser strips the header row.
  let sourceLines = [];
  if (typeof sample === 'string' && sample.trim().length > 0) {
    sourceLines = sample.split(/\r?\n/).filter((line) => line.length > 0);
  } else {
    sourceLines = rows.map((r) => r.raw).filter((r) => typeof r === 'string' && r.length > 0);
  }

  if (sourceLines.length === 0) return { fields: [], payload: { format: 'delimited', fields: [] }, matched: {} };

  let delimiter = resolveDelimiter(input.delimiter) || resolveDelimiter(parserConfig?.config?.delimiter) || inferDelimiter(sourceLines, respectQuotes);

  logger?.debug?.('delimited field extraction', { delimiter: JSON.stringify(delimiter), hasHeader, lineCount: sourceLines.length, hasSample: typeof sample === 'string' });

  // If the resolved delimiter produces no multi-column rows, try inference.
  const testSplit = sourceLines.slice(0, 5).map((raw) => splitDelimited(raw, delimiter, respectQuotes).length);
  if (testSplit.every((n) => n <= 1)) {
    const inferred = inferDelimiter(sourceLines, respectQuotes);
    logger?.debug?.('delimiter produced no splits, using inferred', { configured: JSON.stringify(delimiter), inferred: JSON.stringify(inferred) });
    delimiter = inferred;
  }

  const splitRows = sourceLines.map((raw) => splitDelimited(raw, delimiter, respectQuotes));
  const maxColumns = Math.max(...splitRows.map((cols) => cols.length));

  // A header row is only plausible if its cells look like names, not values:
  // reject when any cell is a high-variance shape (hex/number/datetime) or
  // when multiple cells sanitize to the same name (duplicate React keys).
  const looksLikeHeader = (cells) => {
    if (!cells || cells.length < 2) return false;
    const names = cells.map((c, i) => safeFieldName(c, i));
    if (new Set(names).size !== names.length) return false;
    return !cells.some((c) => isValueShapedCell(c));
  };

  let names = Array.from({ length: maxColumns }, (_, i) => `column_${i}`);
  let dataRows = splitRows;
  if (typeof sample === 'string' && sample.trim().length > 0 && hasHeader && splitRows.length > 1) {
    if (looksLikeHeader(splitRows[0])) {
      names = [...splitRows[0].map((name, i) => safeFieldName(name, i)), ...Array.from({ length: Math.max(0, maxColumns - splitRows[0].length) }, (_, j) => `column_${splitRows[0].length + j}`)];
      dataRows = splitRows.slice(1);
    } else {
      logger?.debug?.('first line rejected as header (value-shaped or duplicate cells), using column_N names', { firstLine: splitRows[0].slice(0, 5) });
    }
  }

  const fields = [];
  const matched = {};
  const usedNames = new Set();
  for (let i = 0; i < maxColumns; i++) {
    // The header row can be narrower than the widest data row (embedded
    // delimiters/newlines in a cell inflate maxColumns) — fall back to a
    // generated name so no field ever ends up with an undefined/null name.
    // Also dedupe: duplicate header cells must not produce duplicate keys.
    let field = names[i] ?? `column_${i}`;
    if (usedNames.has(field)) field = `${field}_${i}`;
    usedNames.add(field);
    const samples = [];
    const seen = new Set();
    for (const cols of dataRows) {
      const value = cols[i]?.trim() ?? '';
      if (value && value.length <= 1024 && !seen.has(value)) {
        seen.add(value);
        samples.push(value);
        if (samples.length >= 5) break;
      }
    }
    // Unified shape: delimited columns are source-less fields (value comes
    // from the parser at record time); an optional regex refines within the
    // column value.
    fields.push({ name: field, ordinal: i, source: null, regex: null, samples });
    matched[field] = samples;
  }

  return {
    fields,
    payload: { format: 'delimited', fields: [] },
    matched: { payload: matched },
  };
}

/**
 * Split a raw row into a header portion and an optional payload.
 *
 * The payload is detected if the row contains a contiguous XML declaration + root
 * element, or a JSON object/array. Everything before the payload is the header.
 */
export function splitHeaderAndPayload(raw) {
  if (typeof raw !== 'string') return { header: '', payload: null };

  const trimmed = raw.trim();
  if (!trimmed) return { header: '', payload: null };

  // Pick the payload by the EARLIEST delimiter position: a record that starts
  // with '{' / '[' is whole-record JSON even if a string value later contains
  // '<' (e.g. an XML payload field). For rows whose header legitimately starts
  // before any JSON delimiter (plaintext + JSON payload), a '{' appearing
  // after the first non-whitespace char still counts. The XML branch wins ties
  // only when it starts at or before the JSON delimiter.
  const xmlIndex = findPayloadIndex(trimmed, '<', (slice) => XML_DECL_REGEX.test(slice) || XML_ROOT_REGEX.test(slice));
  const jsonIndex = findPayloadIndex(trimmed, '{', (slice) => JSON_ROOT_REGEX.test(slice.trim()));
  // A leading '[' could be a plaintext log timestamp ("[5/9/17 ...]") — only
  // treat it as a JSON array root when the content from that point actually
  // parses as a leading JSON value.
  const jsonArrIndex = findPayloadIndex(trimmed, '[', (slice) => JSON_ROOT_REGEX.test(slice.trim()) && parseLeadingJson(slice) !== null);
  const effectiveJsonIndex = jsonIndex === -1 ? jsonArrIndex
    : jsonArrIndex === -1 ? jsonIndex
    : Math.min(jsonIndex, jsonArrIndex);

  // A raw record that STARTS with a JSON object is whole-record JSON, regardless
  // of any '<' inside string values. Verified by an actual leading parse: a '{'
  // that merely appears inside the header text is not trusted on its own.
  if (trimmed.startsWith('{') && parseLeadingJson(trimmed) !== null) {
    return { header: '', payload: { format: 'json', content: trimmed } };
  }
  if (xmlIndex === 0 && (XML_DECL_REGEX.test(trimmed) || XML_ROOT_REGEX.test(trimmed))) {
    return { header: '', payload: { format: 'xml', content: trimmed } };
  }

  const xmlFirst = xmlIndex !== -1 && (effectiveJsonIndex === -1 || xmlIndex < effectiveJsonIndex);
  if (xmlFirst) {
    return {
      header: trimmed.slice(0, xmlIndex).trim(),
      payload: { format: 'xml', content: trimmed.slice(xmlIndex) },
    };
  }
  if (effectiveJsonIndex !== -1) {
    return {
      header: trimmed.slice(0, effectiveJsonIndex).trim(),
      payload: { format: 'json', content: trimmed.slice(effectiveJsonIndex) },
    };
  }

  return { header: trimmed, payload: null };
}

function findPayloadIndex(text, firstChar, predicate) {
  let index = text.indexOf(firstChar);
  while (index !== -1) {
    const slice = text.slice(index);
    if (predicate(slice)) return index;
    index = text.indexOf(firstChar, index + 1);
  }
  return -1;
}

/**
 * Extract deterministic payload fields from XML or JSON content.
 *
 * - XML: leaf text nodes with their full dotted path, literal namespaces kept.
 * - JSON: scalar leaf values with their full dotted path.
 * - Repeated elements/keys are skipped beyond the first occurrence.
 */
export function extractPayloadFields(payload) {
  if (!payload || typeof payload.content !== 'string') return { fields: [] };

  try {
    if (payload.format === 'xml') return extractXmlFields(payload.content);
    if (payload.format === 'json') {
      // json-nd continuation records join multiple JSON values with newlines;
      // extract fields from the leading (main) value.
      const leading = parseLeadingJson(payload.content);
      if (leading !== null) return extractJsonFields(JSON.stringify(leading));
      return extractJsonFields(payload.content);
    }
  } catch (err) {
    logger.warn('Payload extraction failed', { format: payload.format, error: err.message });
  }

  return { fields: [] };
}

function extractXmlFields(xmlText) {
  const parser = new XMLParser({
    // Attributes are captured too (prefixed `@`) — the id/correlation attrs
    // typically live on the record's top element.
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    parseTagValue: false,
    trimValues: true,
    alwaysCreateTextNode: false,
  });

  const root = parser.parse(xmlText);
  // Re-root at the single document element so field paths match the JSON
  // engines' shape (no root-tag prefix): <event traceId="t1"><msg>x</msg></event>
  // yields { "@traceId": ..., "msg": ... }, not { "event.@traceId": ... }.
  // This keeps the per-record field map uniform across xml/json engines for
  // downstream sequence mining. The XML declaration (?xml) and namespace
  // declarations are document metadata and are skipped.
  let startObj = root;
  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const keys = Object.keys(root).filter((k) => k !== '?xml' && !k.startsWith('@xmlns'));
    if (keys.length === 1 && root[keys[0]] && typeof root[keys[0]] === 'object') {
      startObj = root[keys[0]];
    }
  }
  const fields = [];
  const seenPaths = new Set();

  function walk(obj, path) {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      // Skip arrays entirely: only record the first element if we want none-array mode.
      if (obj.length === 0) return;
      walk(obj[0], path);
      return;
    }

    if (typeof obj !== 'object') {
      const text = String(obj).trim();
      if (text && text.length <= 1024 && !seenPaths.has(path)) {
        seenPaths.add(path);
        fields.push({ path, samples: [text] });
      }
      return;
    }

    for (const key of Object.keys(obj)) {
      // Skip the XML declaration pseudo-node and namespace declarations —
      // they are document metadata, not per-record fields.
      if (key === '?xml' || key.startsWith('@xmlns')) continue;
      walk(obj[key], path ? `${path}.${key}` : key);
    }
  }

  walk(startObj, '');
  return { format: 'xml', fields };
}

function extractJsonFields(jsonText) {
  const root = JSON.parse(jsonText);
  const fields = [];
  const seenPaths = new Set();

  function walk(obj, path) {
    if (obj === null || obj === undefined) return;

    if (Array.isArray(obj)) {
      if (obj.length === 0) return;
      walk(obj[0], path);
      return;
    }

    if (typeof obj !== 'object') {
      const text = String(obj).trim();
      if (text && text.length <= 1024 && !seenPaths.has(path)) {
        seenPaths.add(path);
        fields.push({ path, samples: [text] });
      }
      return;
    }

    for (const key of Object.keys(obj)) {
      walk(obj[key], path ? `${path}.${key}` : key);
    }
  }

  walk(root, '');
  return { format: 'json', fields };
}

/**
 * Parse a raw record's payload content that may contain multiple concatenated
 * JSON values (json-nd continuation records are joined with newlines).
 * Returns the first parseable value, or null.
 */
function parseLeadingJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Fall back to the first complete top-level value from the shared scanner.
    const first = findTopLevelJsonRanges(text)[0];
    if (!first) return null;
    try {
      return JSON.parse(text.slice(first.start, first.end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Strip `samples` arrays from a fieldExtraction block. Samples are preview
 * material only — they belong in API responses, not in the stored config.
 */
export function stripFieldExtractionSamples(fieldExtraction) {
  if (!fieldExtraction || typeof fieldExtraction !== 'object') return fieldExtraction;
  if (!Array.isArray(fieldExtraction.fields)) return fieldExtraction;
  return {
    ...fieldExtraction,
    fields: fieldExtraction.fields.map(({ samples, ...rest }) => rest),
  };
}

/**
 * Apply unified fieldExtraction.fields rules to a list of rows and collect
 * matched samples per field name.
 */
export function applyFieldRules(rows, fieldList) {
  const result = {};
  for (const f of fieldList || []) {
    if (typeof f?.name === 'string') result[f.name] = [];
  }

  for (const row of rows) {
    const values = extractRecordFields(row.raw, { fields: fieldList });
    for (const [name, vals] of Object.entries(result)) {
      if (vals.length >= 10) continue;
      const v = values[name];
      if (v != null && !vals.includes(v)) vals.push(v);
    }
  }
  return result;
}

/**
 * Materialize the fields of a single raw record using fieldExtraction rules.
 *
 * Unified shape: fieldExtraction.fields is a list of { name, source, regex } —
 * - source null: regex applies to the whole raw record (or the header
 *   portion when a payload is present); without a regex the raw record is
 *   the value (not used today, but supported).
 * - source "<field>": regex is applied WITHIN that field's value, so one
 *   source field can feed several output fields (concatenated/multi-purpose
 *   columns). The source may itself be a parser-provided column (delimited)
 *   or another extracted field; resolution is multi-pass until stable.
 * Payload leaf paths (XML/JSON) are expanded as before when a
 * whole-record payload exists or a payload block is specified. Returns a
 * flat map of field name to string value. Parser-provided record.fields
 * (e.g. delimited columns) are seeds and resolvable sources; an explicit
 * fields[] entry wins over a same-named parser column.
 */
export function extractRecordFields(raw, fieldExtraction, parserFields = {}, options = {}) {
  const fields = {};
  if (typeof raw !== 'string') {
    return fields;
  }

  const { header, payload } = splitHeaderAndPayload(raw);
  const spec = fieldExtraction && typeof fieldExtraction === 'object' ? fieldExtraction : null;
  const unifiedFields = Array.isArray(spec?.fields) ? spec.fields : [];
  const payloadSpecified = Boolean(spec) && 'payload' in spec;

  // Seed with parser-provided fields (delimited columns etc.) — these are
  // also resolvable sources for within-field regexes. Empty-string columns
  // are seeded too: key PRESENCE (not non-emptiness) is what tells the
  // whole-record fallback below that the parser already owns this name.
  for (const [k, v] of Object.entries(parserFields || {})) {
    if (v != null) fields[k] = String(v);
  }

  // Compile every field regex once per call. Callers mapping many records
  // (applyFieldExtractionToRecords) should build the cache once and pass it
  // via options.regexCache so it is shared across all records.
  const regexCache = options.regexCache || buildFieldRegexCache(spec);

  const applyRegexWithin = (regexSrc, text) => {
    if (typeof regexSrc !== 'string' || !regexSrc || typeof text !== 'string' || !text) return null;
    const re = regexCache.get(regexSrc);
    if (!re) {
      logger.warn('Field regex missing from compile cache', { regex: regexSrc });
      return null;
    }
    const match = re.exec(text);
    const value = match ? (match.groups?.value ?? match[1] ?? match[0]) : null;
    return value != null && value !== '' ? String(value) : null;
  };

  // Multi-pass resolution: whole-record (source null) fields first, then
  // fields whose source is already resolved. Up to N passes covers chains.
  const pending = unifiedFields.filter((f) => typeof f?.name === 'string');
  const maxPasses = Math.max(1, pending.length);
  for (let pass = 0; pass < maxPasses && pending.length > 0; pass++) {
    let progressed = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const f = pending[i];
      if (f.source == null || f.source === '') {
        // Whole-record field. With a regex: apply to the header portion
        // when a payload exists, else the whole record (a regex is a
        // deliberate refinement and wins over a same-named parser column).
        // Without a regex, keep any parser-provided field of the same name
        // (delimited columns) — the whole-record value is only the fallback
        // when the parser gave us nothing for this name.
        const text = payload && header !== '' ? header : raw;
        if (f.regex) {
          const value = applyRegexWithin(f.regex, text);
          if (value != null) fields[f.name] = value;
        } else if (!(f.name in fields)) {
          // No regex and the parser did not provide this name at all (e.g.
          // plaintext/json engines): the whole-record value is the fallback.
          // A blank parser column still counts as provided — its value is ''.
          const value = text || null;
          if (value != null) fields[f.name] = value;
        }
        pending.splice(i, 1);
        progressed = true;
      } else if (fields[f.source] != null) {
        // Within-field regex: apply to the source field's value.
        const value = f.regex ? applyRegexWithin(f.regex, fields[f.source]) : fields[f.source];
        if (value != null) fields[f.name] = value;
        pending.splice(i, 1);
        progressed = true;
      }
    }
    if (!progressed) break; // unresolved sources (missing/cyclic) are skipped
  }

  // First pass: skip payload field expansion when a payload is stitched onto a
  // header line (delimited/plaintext) — those payloads are huge and noisy.
  // Whole-record JSON/XML (json-lines/json-nd, header === '') still expands.
  //
  // When the profile specifies a payload, expand the payload's ACTUAL content
  // (split off above) rather than re-extracting from the spec's field list —
  // the spec may be stale or its format mismatched with the engine.
  const expandWholeRecordPayload = !payloadSpecified && header === '' && raw.trim() !== '';
  // json-nd/json-lines records can carry a leading non-JSON prefix (log line
  // before the first '{'); treat those as whole-record payloads too.
  const isEnginePayload = options?.enginePayload === true;
  if (payload && header !== '' && !isEnginePayload) {
    return fields;
  }
  if (payload || expandWholeRecordPayload) {
    let extracted;
    try {
      extracted = extractPayloadFields(payload || { format: 'json', content: raw });
    } catch (err) {
      logger.warn('Payload extraction failed during field application', { format: payload?.format, error: err.message });
      extracted = { fields: [] };
    }
    for (const field of extracted.fields || []) {
      if (field.samples && field.samples.length > 0) {
        fields[field.path] = String(field.samples[0]);
      }
    }
  }

  return fields;
}

/**
 * Enrich parsed records with concrete per-row field values derived from the
 * profile's fieldExtraction rules, merged over any parser-provided fields.
 *
 * @param {object[]} records - Parsed records ({ raw, fields?, unparsed? }).
 * @param {object} [fieldExtraction] - Profile fieldExtraction rules, if any.
 * @returns {object[]} New record objects with a merged `fields` map.
 */
export function applyFieldExtractionToRecords(records, fieldExtraction, options = {}) {
  if (!Array.isArray(records)) return records;
  const rules = fieldExtraction && typeof fieldExtraction === 'object' ? fieldExtraction : null;
  // Compile the spec's regexes exactly once for the whole batch.
  const regexCache = buildFieldRegexCache(rules);
  // Unified fields[] entries are explicit rules and win over parser-provided
  // columns of the same name (e.g. a within-column regex override).
  return records.map((record) => {
    if (!record || typeof record !== 'object' || typeof record.raw !== 'string') return record;
    const derived = extractRecordFields(record.raw, rules, record.fields || {}, { ...options, regexCache });
    return { ...record, fields: { ...(record.fields || {}), ...derived } };
  });
}

/**
 * Find rows that are not fully matched by existing whole-record fields.
 */
function findUnmatchedRows(rows, fieldList) {
  return rows.filter((row) => {
    const { header } = splitHeaderAndPayload(row.raw);
    if (!header) return false;

    for (const f of fieldList || []) {
      if (f?.source != null && f.source !== '') continue; // only whole-record fields gate matching
      if (typeof f?.regex !== 'string') continue;
      try {
        if (new RegExp(f.regex).test(header)) return false;
      } catch { /* ignore invalid regex */ }
    }

    return true;
  });
}


/**
 * Deterministically pick up to `max` evenly spread rows — repeated runs must
 * see the same representative rows.
 */
function sampleRowsForDiscovery(rows, max = 25) {
  if (!Array.isArray(rows) || rows.length <= max) return rows || [];
  const picked = [];
  for (let i = 0; i < max; i++) {
    picked.push(rows[Math.floor((i * rows.length) / max)]);
  }
  return picked;
}

// Rows eligible for the LLM prompt: only parsed records with a string raw.
function validRowsForPrompt(rows) {
  return (rows || []).filter((r) => typeof r?.raw === 'string');
}

async function discoverFieldRules(rows, options = {}) {
  if (rows.length === 0) return [];

  // Value-histogram pre-stage over ALL provided rows — the LLM sees a compact
  // list of repeating values (value + shape + support + example context),
  // never the raw rows. Position-agnostic, suits variable plaintext.
  // LLM-stage defaults: minSupport 2 with NO fractional floor (a 2%-of-rows
  // floor silently culled near-unique-but-real values like datetimes), and a
  // cap to keep the prompt focused on the dominant repeating values.
  const nameMap = Array.isArray(options.nameMap) ? options.nameMap : [];
  const llmKnobs = { minSupport: 2, maxEntries: 40, ...(options.histogram || {}) };
  const histogram = buildValueHistogram(rows, llmKnobs);
  let entries = histogram.entries;
  // Guarantee every user-named value set is visible to the LLM: nameMap groups
  // are ground-truth intent, so inject up to 3 of their values (looked up in a
  // full minSupport:1 histogram) when the support filter dropped them.
  if (nameMap.length && entries.length > 0) {
    const full = buildValueHistogram(rows, { ...llmKnobs, minSupport: 1, maxEntries: -1 });
    const byValue = new Map(full.entries.map((e) => [e.value, e]));
    const present = new Set(entries.map((e) => e.value));
    const injected = [];
    for (const g of nameMap) {
      if (!g || !Array.isArray(g.values)) continue;
      let added = 0;
      for (const v of g.values) {
        if (added >= 3) break;
        const key = String(v);
        if (present.has(key)) continue;
        const e = byValue.get(key);
        if (e) {
          present.add(key);
          injected.push({ ...e, named: g.name });
          added += 1;
        }
      }
    }
    if (injected.length) entries = [...entries, ...injected];
  }
  if (entries.length === 0) return [];
  // Several FULL example rows, in addition to the value list: the model needs
  // whole rows together to align "this token sits at this position between these
  // anchors", which a value-only list cannot show. Evenly-spread + deterministic
  // so repeated runs see the same rows.
  const allHeaders = validRowsForPrompt(rows)
    .map((r) => splitHeaderAndPayload(r.raw).header || r.raw)
    .filter((h) => typeof h === 'string' && h.length > 0);
  const sampleRows = sampleRowsForDiscovery(allHeaders, options.exampleRows ?? 12)
    .map((h) => (h.length > 400 ? `${h.slice(0, 400)}…` : h));
  // One full example row per nameMap value (first row containing it, deduped) —
  // the user's named examples are the most informative rows for anchoring those
  // fields; without them the model only sees the values as histogram lines.
  const nameMapRows = [];
  const seenRows = new Set(sampleRows);
  const namedValues = nameMap.flatMap((g) => (Array.isArray(g.values) ? g.values.map(String) : []));
  for (const v of namedValues) {
    if (!v) continue;
    const hit = allHeaders.find((h) => h.includes(v) && !seenRows.has(h));
    if (hit) {
      seenRows.add(hit);
      nameMapRows.push(hit.length > 400 ? `${hit.slice(0, 400)}…` : hit);
    }
  }
  const exampleRows = [...sampleRows, ...nameMapRows];
  const anchorRow = exampleRows[0] || splitHeaderAndPayload(rows[0].raw).header || rows[0].raw;
  const { system, user } = buildHistogramPrompt(entries, anchorRow, nameMap, exampleRows);
  const llmOptions = {
    provider: options.provider || config.traceFieldExtract?.provider || config.traceProfileSuggest?.provider,
    model: options.model || config.traceFieldExtract?.model || config.traceProfileSuggest?.model,
    temperature: options.temperature ?? config.traceFieldExtract?.temperature ?? 0.0,
    max_tokens: options.max_tokens || config.traceFieldExtract?.max_tokens || 4096,
  };

  const completeFn = options.completeImpl || complete;
  const result = await completeFn(`${system}\n\n${user}`, llmOptions);
  if (!result.success) {
    throw new Error(`LLM field extraction failed: ${result.error}`);
  }

  const parsed = parseLlmJson(result.data);
  if (!parsed || !Array.isArray(parsed.fields)) {
    throw new Error('LLM field extraction returned unexpected shape');
  }

  return parsed.fields
    .filter((f) => typeof f.name === 'string' && typeof f.regex === 'string')
    .map((f, i) => ({
      name: f.name,
      ordinal: i,
      source: typeof f.source === 'string' ? f.source : null,
      regex: f.regex,
      samples: Array.isArray(f.samples) ? f.samples.slice(0, 5) : [],
    }))
    // Mechanical self-check: drop any rule whose regex fails to capture at least
    // one of its own claimed samples WITHIN THE FULL ROWS — the model's "verify
    // before emitting" is not reliable enough on its own. The sample is the
    // captured value, so the check runs the regex against the full headers (a
    // bare sample string would never match an anchored regex) and requires the
    // captured value to equal one of the claimed samples.
    // EXCEPTION — high-variance nameMap groups (hex/number/datetime, marked
    // variance:"high" or auto-detected): their listed values are near-unique
    // per row, so sample equality can never hold for a correct regex. For
    // those, accept the rule if it captures a shape-matching value in a solid
    // share of rows (shape purity + row coverage) instead.
    .filter((f) => {
      if (!f.samples.length) return true; // nothing claimed, nothing to check
      let re;
      try { re = new RegExp(f.regex, 'g'); } catch { return false; }
      const claimed = new Set(f.samples.map(String));
      const group = (nameMap || []).find((g) => g && g.name === f.name);
      const isHigh = group?.variance === 'high';
      let hitRows = 0;
      let shapeHits = 0;
      let captures = 0;
      for (const h of allHeaders) {
        re.lastIndex = 0;
        let m;
        let rowHit = false;
        while ((m = re.exec(h)) !== null) {
          const v = m.groups?.value ?? m[1] ?? m[0];
          if (v != null && v !== '') {
            captures++;
            if (claimed.has(String(v))) return true;
            if (isHigh) {
              rowHit = true;
              if (group.values.some((gv) => tokenShape(String(gv)) === tokenShape(String(v)))) shapeHits++;
            }
          }
          if (m.index === re.lastIndex) re.lastIndex++;
        }
        if (rowHit) hitRows++;
      }
      if (!isHigh) return false;
      // High-variance gate: shape purity >= 0.8 AND row coverage >= 0.8.
      return captures > 0 && shapeHits / captures >= 0.8 && hitRows / allHeaders.length >= 0.8;
    });
}

function parseLlmJson(text) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Classify a nameMap group as "enum" (listed values recur across rows — a
 * captured value is likely to equal a listed sample) or "high" (high-variance:
 * hex/number/datetime values are near-unique per row, so sample equality can
 * never hold and the gate must use shape + row coverage instead).
 * A group's own "variance" config field ("enum" | "high") wins; otherwise the
 * classification is derived from listed-value row coverage over allHeaders.
 * Returns the group with a resolved `variance` so downstream consumers know
 * what was calculated upstream.
 */
const HIGH_VARIANCE_SHAPES = new Set(['hex', 'uuid', 'timestamp', 'datetime', 'date', 'time', 'number']);
function classifyNameMapGroups(nameMap, allHeaders) {
  return (nameMap || []).map((g) => {
    if (!g || typeof g.name !== 'string' || !Array.isArray(g.values) || !g.values.length) return g;
    let variance = g.variance === 'high' || g.variance === 'enum' ? g.variance : null;
    if (!variance) {
      const values = g.values.map(String).filter(Boolean);
      const listedRows = allHeaders.filter((h) => values.some((v) => h.includes(v))).length;
      const coverage = allHeaders.length ? listedRows / allHeaders.length : 0;
      // Also treat shape as a signal: a group whose listed values are mostly
      // high-variance shapes is "high" even if a tiny sample made them recur.
      const highShapes = values.filter((v) => HIGH_VARIANCE_SHAPES.has(tokenShape(v))).length;
      variance = coverage < 0.5 || highShapes / values.length >= 0.5 ? 'high' : 'enum';
    }
    return { ...g, variance };
  });
}

/**
 * Classify a token's shape: hex, numeric, timestamp-ish, tilde-delimited,
 * bracketed, quoted, uuid, or generic word. Used by the pre-scan stages.
 */
function tokenShape(token) {
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?([Z+-]\d{2}:?\d{2})?)?$/.test(token)) return 'timestamp';
  // Compound short date+time with a single space separator, e.g. "5/9/17 10:35:41:868"
  // — checked BEFORE plain date/time so the longer form wins and isn't split into
  // its parts. (ISO "2026-01-01 10:35:41" is already covered by "timestamp" above.)
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4} \d{1,2}:\d{2}(?::\d{2})?(?::\d{2,3})?$/.test(token)) return 'datetime';
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(token)) return 'date';
  if (/^\d{1,2}:\d{2}:\d{2}(:\d{2,3})?(\.\d+)?$/.test(token)) return 'time';
  if (/^\d+$/.test(token) && (token === '0' || !token.startsWith('0'))) return 'number';
  if (/^[0-9a-fA-F]+$/.test(token) && token.length >= 6) return 'hex';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return 'uuid';
  if (/^~[^~]+~$/.test(token)) return 'tilde';
  if (/^\[[^\]]+\]$/.test(token)) return 'bracketed';
  if (/^["'][^"']+["']$/.test(token)) return 'quoted';
  if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token)) return 'word';
  return 'other';
}

/**
 * Tokenize a header into values for the histogram: split on whitespace, then
 * split off common delimiters (brackets, tildes, equals) so "~REPLY~OP_V1~op"
 * and "[5/9/17" produce useful tokens rather than glued blobs.
 */
function tokenizeHeaderForHistogram(header, minTokenLength = 2) {
  const tokens = [];
  // Compound date+time spans one whitespace boundary (e.g. "[5/9/17 10:35:41:868 NZST]").
  // Capture those pairs first as single "datetime" tokens so the histogram sees the
  // longer form instead of separate date/time tokens. Generic format — derived purely
  // from repeated digit/delimiter/date/time structure, no log-format assumptions.
  const datetimeRe = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4} \d{1,2}:\d{2}(?::\d{2})?(?::\d{2,3})?|\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[Z+-]\d{2}:?\d{2})?)\b/g;
  const spans = [];
  let m;
  while ((m = datetimeRe.exec(header)) !== null) {
    spans.push([m.index, m.index + m[0].length]);
  }

  let last = 0;
  for (const [s, e] of spans) {
    emitTokens(header.slice(last, s));
    const dt = header.slice(s, e);
    if (dt.length >= minTokenLength) tokens.push(dt);
    last = e;
  }
  emitTokens(header.slice(last));

  return tokens;

  function emitTokens(text) {
    for (const piece of text.split(/\s+/)) {
      // Split on delimiter chars but keep the delimiters attached to tokens so
      // decorated values remain recognizable as single tokens.
      const parts = piece.split(/(?<=[\]~=])|(?=[\[~=])/).filter(Boolean);
      for (const p of parts) {
        const t = p.replace(/^[\[\]~=]+|[\[\]~=]+$/g, '');
        if (t.length >= minTokenLength) tokens.push(t.length > 120 ? `${t.slice(0, 120)}…` : t);
      }
    }
  }
}

/**
 * Deterministic value histogram over ALL rows (no sampling) — the pre-stage.
 * For every distinct value in every row header it counts row-support and keeps
 * one short example context (a window around the value, not the row start). Constants
 * (values in >= constantRatio of rows) are excluded; the rest are sorted by
 * support desc and capped at maxEntries. All thresholds are knobs:
 * minSupport is an absolute floor, minSupportPct an optional fractional
 * floor (0 = off), so minSupport: 1 really means 1.
 *
 * This is position-agnostic: it finds "this value repeats in N rows" wherever
 * it sits, which suits variable plaintext where columns shift.
 */
const DEFAULT_HISTOGRAM_STOPWORDS = new Set([
  'the','a','an','and','or','of','to','from','in','on','at','by','for','with','is','are','was','were',
  'be','been','it','its','this','that','as','if','not','no','yes','request','response','received','module',
  'message','data','handler','custom','completed','successfully','started','subflow',
]);

function buildValueHistogram(rows, {
  minSupport = 2,
  minSupportPct = 0,
  constantRatio = 0.9,
  maxEntries = 60,
  contextChars = 120,
  minTokenLength = 2,
  includeShapes = null,   // e.g. ['word'] — null = all shapes
  stopwords = null,       // null = DEFAULT_HISTOGRAM_STOPWORDS; [] = none; pass array to override
} = {}) {
  const headers = rows
    .map((r) => splitHeaderAndPayload(r.raw).header || r.raw)
    .filter((h) => typeof h === 'string' && h.length > 0);

  const totalRows = headers.length;
  if (totalRows === 0) return { entries: [], totalRows, totalCandidates: 0, truncated: false };

  const stop = stopwords === null ? DEFAULT_HISTOGRAM_STOPWORDS : new Set(stopwords.map((w) => String(w).toLowerCase()));
  const shapes = includeShapes ? new Set(includeShapes) : null;

  // value -> { count, shape, contexts: Set }
  const valueStats = new Map();
  headers.forEach((h, rowIdx) => {
    const seenInRow = new Set();
    for (const t of tokenizeHeaderForHistogram(h, minTokenLength)) {
      if (stop.has(t.toLowerCase())) continue;
      if (seenInRow.has(t)) continue; // count each value once per row
      seenInRow.add(t);
      let v = valueStats.get(t);
      if (!v) {
        v = { count: 0, shape: tokenShape(t), contexts: new Set() };
        valueStats.set(t, v);
      }
      v.count += 1;
      if (v.contexts.size < 2) {
        // Context window: `contextChars` chars before and after the value,
        // with ellipses marking truncation — not just the start of the row.
        const idx = h.indexOf(t);
        const start = Math.max(0, idx - contextChars);
        const end = Math.min(h.length, idx + t.length + contextChars);
        let ctx = h.slice(start, end);
        if (start > 0) ctx = `…${ctx}`;
        if (end < h.length) ctx = `${ctx}…`;
        v.contexts.add(ctx);
      }
    }
  });

  const minCount = Math.max(minSupport, Math.ceil(totalRows * minSupportPct));
  const constantCutoff = constantRatio >= 1 ? Infinity : Math.ceil(totalRows * constantRatio);
  const sorted = [...valueStats.entries()]
    .filter(([, v]) => v.count >= minCount && v.count < constantCutoff && (!shapes || shapes.has(v.shape)))
    .map(([value, v]) => ({
      value: value.length > 80 ? `${value.slice(0, 80)}…` : value,
      count: v.count,
      rowCount: totalRows,
      shape: v.shape,
      contexts: [...v.contexts].slice(0, 2),
    }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));

  const totalCandidates = sorted.length;
  const capped = maxEntries >= 0 ? sorted.slice(0, maxEntries) : sorted;

  return { entries: capped, totalRows, totalCandidates, truncated: capped.length < totalCandidates };
}

/**
 * Deterministic plausibility gate for a discovered rule, evaluated over ALL
 * row headers. Keeps a rule only if it matches >=2 rows, yields >=2 distinct
 * captured values (rejects constants), and the captured values have a dominant
 * shape covering >=50% of matches (rejects mixed grab-bag fields).
 */
function isPlausibleFieldRule(field, allHeaders, { minRows = 2, minDistinctValues = 5, shapeRatio = 0.5 } = {}) {
  if (!field.regex) return true;
  let re;
  try {
    re = new RegExp(field.regex, 'g');
  } catch {
    return false;
  }
  let matchedRows = 0;
  const values = new Set();
  for (const h of allHeaders) {
    re.lastIndex = 0;
    const m = re.exec(h);
    if (!m) continue;
    matchedRows += 1;
    const v = m.groups?.value ?? m[1] ?? m[0];
    if (v) values.add(v);
  }
  if (matchedRows < minRows || values.size < minDistinctValues) return false;
  const shapeCounts = new Map();
  for (const v of values) {
    const s = tokenShape(v);
    shapeCounts.set(s, (shapeCounts.get(s) || 0) + 1);
  }
  let dominant = 0;
  for (const c of shapeCounts.values()) dominant = Math.max(dominant, c);
  return dominant / values.size >= shapeRatio;
}

/**
 * Deterministic positional pre-scan over ALL rows (no sampling). Tokenizes each
 * row's header on whitespace, builds a position -> values matrix, and returns
 * candidate variable positions: those whose values vary across rows but share
 * a consistent shape. Each candidate carries up to 5 example values and its
 * support count, so the LLM only has to write an anchored regex per candidate
 * instead of eyeballing raw rows — full data coverage with a tiny prompt.
 */
function buildPositionalCandidates(rows, { minSupport = 2, maxCandidates = 40 } = {}) {
  const headers = rows
    .map((r) => splitHeaderAndPayload(r.raw).header || r.raw)
    .filter((h) => typeof h === 'string' && h.length > 0)
    .map((h) => h.length > 400 ? `${h.slice(0, 400)}…` : h);

  const maxCols = Math.min(
    60,
    headers.reduce((m, h) => Math.max(m, h.split(/\s+/).length), 0)
  );
  const positions = [];
  for (let i = 0; i < maxCols; i++) positions.push(new Map()); // token -> count

  for (const h of headers) {
    const cols = h.split(/\s+/);
    for (let i = 0; i < Math.min(cols.length, maxCols); i++) {
      const t = cols[i];
      positions[i].set(t, (positions[i].get(t) || 0) + 1);
    }
  }

  const candidates = [];
  for (let i = 0; i < maxCols; i++) {
    const valueCounts = positions[i];
    if (valueCounts.size < 2) continue; // constant column (or empty) — not a field
    const total = headers.length;
    const shapeCounts = new Map();
    for (const [t, count] of valueCounts.entries()) {
      const s = tokenShape(t);
      shapeCounts.set(s, (shapeCounts.get(s) || 0) + count);
    }
    // Dominant shape = the shape covering the most rows.
    let dominantShape = null;
    let dominantRows = 0;
    for (const [s, count] of shapeCounts.entries()) {
      if (count > dominantRows) {
        dominantShape = s;
        dominantRows = count;
      }
    }
    // Keep the position if the dominant shape covers most rows; positions where
    // values are wildly mixed (no shape majority) are too noisy to be fields.
    if (dominantShape === null || dominantRows / total < 0.5) continue;
    // Sort by frequency desc, then alphabetically for determinism.
    const sorted = [...valueCounts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const support = sorted[0][1];
    // A position is a candidate when its values vary (checked above) and the
    // dominant shape covers a majority of rows. Pure one-off positions (every
    // value unique, e.g. a free-text tail at the last column) still pass —
    // that's often exactly the field we want — but require minSupport distinct
    // values unless the position is dominant-shaped and frequent.
    if (valueCounts.size < minSupport && support < minSupport) continue;
    candidates.push({
      position: i,
      shape: dominantShape,
      support,
      rowCount: total,
      examples: sorted.slice(0, 5).map(([v]) => v.length > 80 ? `${v.slice(0, 80)}…` : v),
    });
    if (candidates.length >= maxCandidates) break;
  }
  return candidates;
}


/**
 * Assign user-provided names to discovered fields deterministically: a field
 * gets a nameMap group's name when the majority of its matched values across
 * the rows belong to that group's value set.
 * The LLM is still asked for names, but this mapping overrides it.
 */
function applyNameMapToFields(fields, allHeaders, nameMap, { purityThreshold = 0.8 } = {}) {
  const groups = (nameMap || []).filter((g) => g && typeof g.name === 'string' && Array.isArray(g.values) && g.values.length > 0);
  if (!groups.length) return fields;
  const valueSets = groups.map((g) => ({ name: g.name, set: new Set(g.values), total: g.values.length }));
  return fields.map((f) => {
    if (!f.regex) return f;
    let re;
    try { re = new RegExp(f.regex, 'g'); } catch { return f; }
    // Collect ALL captured values across ALL headers, not just the first match
    // per row — a regex whose leftmost match is the wrong token must not earn a
    // name via a incidental later match.
    const matched = new Set();
    for (const h of allHeaders) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(h)) !== null) {
        const v = m.groups?.value ?? m[1] ?? m[0];
        if (v) matched.add(v);
        if (m.index === re.lastIndex) re.lastIndex += 1; // empty-match guard
      }
    }
    let best = null;
    for (const g of valueSets) {
      let hits = 0;
      for (const v of matched) if (g.set.has(v)) hits += 1;
      if (!best || hits > best.hits) best = { name: g.name, hits, total: g.total };
    }
    // A name is only assigned if the regex actually captures a solid share of
    // the group's example values (>= half, min 2) AND the large majority of
    // everything it captures belongs to that group (purity). Without the purity
    // bar, a grab-bag regex like "any all-caps word" earns a name just because
    // it incidentally captures a few group values alongside everything else.
    if (!best || best.hits < 2) return f;
    if (best.hits < Math.ceil(best.total / 2)) return f;
    const purity = best.hits / matched.size;
    if (purity < purityThreshold) return f;
    return { ...f, name: best.name };
  });
}

/**
 * Build the LLM prompt from the value histogram. The LLM receives only
 * observed values with their shape, support count, and one example context
 * row each — it must derive any delimiter/anchor from the context alone.
 * No format or delimiter hints are baked into the instructions.
 */
function buildHistogramPrompt(entries, anchorRow, nameMap = [], exampleRows = []) {
  const entryBlock = entries
    .map((e, i) => {
      const tag = e.named ? ` [NAMED GROUP: "${e.named}"]` : '';
      return `VALUE ${i + 1} (shape: ${e.shape}, in ${e.count}/${e.rowCount} rows)${tag}: "${e.value}"${e.contexts.length ? ` — e.g. in row: ${e.contexts[0].length > 200 ? `${e.contexts[0].slice(0, 200)}…` : e.contexts[0]}` : ''}`;
    })
    .join('\n');

  const anchorHint = anchorRow
    ? `A real row looks like: ${anchorRow.length > 300 ? `${anchorRow.slice(0, 300)}…` : anchorRow}`
    : '';

  const system = [
    'You are a log field discovery assistant.',
    'The user has already identified the fields they care about and given example values for each. Your ONLY task: for EACH named group below, write ONE anchored regex that extracts that field from a full log row, and verify it against the EXAMPLE ROWS and the group\'s example values. Do not invent any other fields — emit exactly one rule per named group, no more, no less.',
    'Derive all anchors, delimiters and character classes ONLY from what you observe in the value itself and the example rows — do not assume any particular log format.',
    'Use the EXAMPLE ROWS to align fields: write each regex so it anchors on the tokens before/after the value in those rows, matching the value\'s position, not just its characters. A regex that matches any token of this shape anywhere in the row is usually wrong — anchor it to its position using the surrounding tokens visible in the example rows.',
    'When several consecutive segments share the same delimiter shape, do NOT anchor on a generic single-segment match — it will also match the neighboring segment. Disambiguate by a distinguishing pattern visible in the examples (e.g. a repeated prefix inside the segment) or by the segment\'s ordinal position in the sequence (first, second, …).',
    'Generalize the character class to match the shape: digits for number shapes, hex digits for hex shapes, and so on — the regex should match sibling values of the same shape, not just the listed example.',
    'Always wrap the varying part in a capture group named exactly "value" — never name the group after the field.',
    'Never emit a literal alternation of example values (e.g. A|B|C) — always generalize to a pattern (character class, quantifier, anchors) that matches unseen values of the same kind.',
    'Use EXACTLY the user-given name for each field — do not rename, do not add extra fields.',
    'Cover EVERY named group; do not skip one because its support count is low.',
    'Return ONLY a JSON object with this exact shape:',
    '{',
    '  "fields": [',
    '    { "name": "<user-given name>", "source": null, "regex": "(?<value>[0-9a-f]{8,})", "samples": ["example1", "example2"] }',
    '  ]',
    '}',
    'Every regex you emit MUST actually capture its target in the provided EXAMPLE ROWS and in each of its own "samples" values — test each regex against the full rows and the value list before emitting it, and only emit rules that verify. A rule that matches nothing, or captures the wrong token in the example rows, must not be emitted.',
    'Output must be valid JSON only, no markdown, no commentary.',
  ].join('\n');

  const nameMapBlock = nameMap.length
    ? ['NAMED GROUPS (user-specified): the user has assigned these names to these value sets. For each group, write ONE field using EXACTLY the given name. The listed values are EXAMPLES of the kind — do NOT emit a literal alternation of them; generalize to a character-class/pattern regex that also matches unseen siblings of the same kind, and anchor it using the structure visible in the example rows:',
       ...nameMap.map((g) => `  name "${g.name}": ${g.values.map((v) => `"${v}"`).join(', ')}`),
       ''].join('\n')
    : '';

  const rowsBlock = exampleRows.length
    ? ['EXAMPLE ROWS (complete rows, align fields by position):', ...exampleRows.map((r, i) => `ROW ${i + 1}: ${r}`), ''].join('\n')
    : '';

  const user = `Write extraction rules for these observed values.\n\n${anchorHint}\n\n${rowsBlock}${nameMapBlock}${entryBlock}`;

  return { system, user };
}

/**
 * Merge new discovered fields into existing fields add-only.
 */
function mergeFieldRules(existing, discovered) {
  const seenNames = new Set((existing || []).map((f) => f.name));
  const seenRegexes = new Set((existing || []).map((f) => f.regex));
  const merged = [...(existing || [])];

  for (const field of discovered) {
    if (seenNames.has(field.name)) continue;
    if (field.regex && seenRegexes.has(field.regex)) continue;
    seenNames.add(field.name);
    if (field.regex) seenRegexes.add(field.regex);
    merged.push(field);
  }

  return merged;
}

/**
 * Merge new payload fields into existing payload fields add-only.
 */
function mergePayloadFields(existing, discovered) {
  const seenPaths = new Set((existing?.fields || []).map((f) => f.path));
  const merged = [...(existing?.fields || [])];

  for (const field of discovered?.fields || []) {
    if (seenPaths.has(field.path)) continue;
    seenPaths.add(field.path);
    merged.push(field);
  }

  return {
    format: existing?.format || discovered?.format || null,
    fields: merged,
  };
}

/**
 * Main entry point: discover or extend field extraction rules for a set of rows.
 *
 * @param {object[]} rows - Array of { raw: string } records.
 * @param {object} [existingRules] - Optional existing fieldExtraction rules to extend.
 * @param {object} [options] - LLM options override and parser/sample context.
 * @param {object} [options.parserConfig] - Parser config used for deterministic extraction.
 * @param {string} [options.sample] - Raw sample text for delimited header extraction.
 * @returns {Promise<{ fieldExtraction: object, matched: object }>}
 */
export async function discoverFieldExtractionRules(rows, existingRules = null, options = {}) {
  const validRows = (rows || []).filter((r) => typeof r?.raw === 'string');
  if (validRows.length === 0) {
    return {
      fieldExtraction: existingRules || { fields: [], payload: { format: null, fields: [] } },
      matched: { fields: {}, payload: {} },
    };
  }

  // Delimited rows get deterministic column fields, no LLM. Columns become
  // source:null entries whose values come from the parser at record time.
  if (options.parserConfig?.module === 'delimited') {
    const existingPayloadFields = existingRules?.payload;
    const existingFields = Array.isArray(existingRules?.fields) ? existingRules.fields : [];
    const discovered = discoverDelimitedColumnRules({ rows: validRows, sample: options.sample, parserConfig: options.parserConfig });
    const existingNames = new Set(existingFields.map((f) => f.name));
    const mergedFields = [
      ...existingFields,
      ...discovered.fields.filter((f) => !existingNames.has(f.name)),
    ].map((f, i) => ({ ...f, ordinal: i }));
    const mergedPayload = mergePayloadFields(existingPayloadFields, discovered.payload);
    return {
      fieldExtraction: {
        fields: mergedFields,
        payload: mergedPayload,
      },
      matched: discovered.matched,
    };
  }

  const existingFields = Array.isArray(existingRules?.fields) ? existingRules.fields : [];
  const existingPayloadFields = existingRules?.payload;

  // Deterministic payload extraction from all rows. First pass: only expand
  // payloads for whole-record JSON/XML (no header) — stitched header+payload
  // rows (plaintext/delimited) produce huge noisy field sets.
  const allPayloadFields = [];
  const payloadSamples = {};
  for (const row of validRows) {
    const { header, payload } = splitHeaderAndPayload(row.raw);
    if (!payload || header !== '') continue;
    const discovered = extractPayloadFields(payload);
    for (const field of discovered.fields) {
      if (!payloadSamples[field.path]) payloadSamples[field.path] = new Set();
      for (const sample of field.samples || []) payloadSamples[field.path].add(sample);
    }
    allPayloadFields.push(discovered);
  }

  const mergedPayload = allPayloadFields.reduce(
    (acc, cur) => mergePayloadFields(acc, cur),
    existingPayloadFields || { format: null, fields: [] }
  );

  // Limit payload samples to 5 per path.
  const payloadMatched = {};
  for (const field of mergedPayload.fields) {
    payloadMatched[field.path] = [...(payloadSamples[field.path] || [])].slice(0, 5);
  }

  const allHeaders = validRows.map((r) => splitHeaderAndPayload(r.raw).header || r.raw);

  // Validate the user-authored nameMap once, up front, so every consumer
  // (prompt injection, deterministic renaming, gate exemption, persistence)
  // sees the same set: groups must have a name and at least minNameMapValues
  // example values — thinner groups are too weak to define a field reliably
  // (config: traceFieldExtract.min_name_map_values, env
  // ARCHITXT_TRACE_FIELD_EXTRACT_MIN_NAME_MAP_VALUES, default 5).
  const minNameMapValues = options.minNameMapValues ?? config.traceFieldExtract?.min_name_map_values ?? 5;
  const rawNameMap = Array.isArray(existingRules?.nameMap)
    ? existingRules.nameMap
        .filter((g) => g && typeof g.name === 'string' && Array.isArray(g.values))
        .map((g) => ({ name: g.name, variance: g.variance, values: g.values.map(String).filter(Boolean) }))
        .filter((g) => g.values.length >= minNameMapValues)
    : [];
  // Resolve each group's variance ("enum" | "high") once, upstream, so every
  // downstream consumer (LLM gate, plausibility gate, persistence) sees the
  // same classification. A group's own config "variance" wins; otherwise it is
  // auto-detected from listed-value row coverage and value shapes.
  const nameMap = classifyNameMapGroups(rawNameMap, allHeaders);

  // Field discovery: call the LLM only when some rows are not yet covered by
  // existing rules — UNLESS the caller forces a full re-discovery (the UI
  // Extract button does). Without the force flag, a single matching
  // whole-record rule would short-circuit discovery forever and Extract
  // would become a no-op that returns in milliseconds.
  // The prompt itself always gets a deterministic, evenly spread sample of
  // ALL rows (not just unmatched ones) so repeated runs see a stable input —
  // filtering to unmatched rows made each run discover different fields
  // depending on what the previous run already covered.
  const unmatchedRows = findUnmatchedRows(validRows, existingFields);
  const force = options.force === true;
  let newFields = [];
  // Discovery is nameMap-driven only (no open/foundNNN mode): without named
  // groups there is nothing for the LLM to anchor, so skip it entirely.
  if (nameMap.length && (force || unmatchedRows.length > 0)) {
    // Pre-scan covers ALL rows; the LLM only sees the compact candidate list.
    const discover = options.discoverImpl || discoverFieldRules;
    newFields = await discover(validRows, { nameMap, ...options });
    // Deterministic user-name assignment by matched-value overlap with nameMap,
    // BEFORE the quality gate, so user-named fields can be exempted from the
    // ">=2 distinct values" requirement (a named group may legitimately have
    // only one observed value so far).
    newFields = applyNameMapToFields(newFields, allHeaders, nameMap);
    const nameMapNames = new Set(nameMap.map((g) => g.name));
    // Deterministic quality gate over ALL rows. minDistinctValues (default 5)
    // is the "enough examples to be meaningful" knob — a field seen with 1-2
    // distinct values is usually not a real variable field. User-named fields
    // are exempt from the distinct-values floor (a named group may legitimately
    // have few observed values so far) but still need >=minRows matched rows.
    const gateOpts = { minDistinctValues: options.minDistinctValues ?? 5 };
    newFields = newFields.filter((f) => nameMapNames.has(f.name)
      ? isPlausibleFieldRule(f, allHeaders, { ...gateOpts, minDistinctValues: 1 })
      : isPlausibleFieldRule(f, allHeaders, gateOpts));
    // Reject brittle literal alternations: a regex that embeds >=2 of the
    // user-named values verbatim generalizes poorly — the model should have
    // written a character-class/pattern instead.
    const namedValues = new Set(nameMap.flatMap((g) => g.values || []));
    if (namedValues.size > 0) {
      newFields = newFields.filter((f) => {
        const embedded = [...namedValues].filter((v) => f.regex.includes(v));
        return embedded.length < 2;
      });
    }
  }

  let mergedFields = mergeFieldRules(existingFields, newFields);
  // Apply the deterministic nameMap naming to the FINAL merged set too, so
  // fields discovered in earlier runs get renamed retroactively when a
  // nameMap is present.
  mergedFields = applyNameMapToFields(mergedFields, allHeaders, nameMap);
  mergedFields = mergedFields.map((f, i) => ({ ...f, ordinal: i }));

  // nameMap is user-authored ground truth — persist it (and keep it in the
  // returned rules so subsequent extract runs honor it). Validation (including
  // the minNameMapValues floor) happened up front, so `nameMap` is already clean.

  // Collect field samples using the final rule set.
  const fieldMatched = applyFieldRules(validRows, mergedFields);

  return {
    fieldExtraction: {
      fields: mergedFields,
      payload: mergedPayload,
      nameMap,
    },
    matched: {
      fields: fieldMatched,
      payload: payloadMatched,
    },
  };
}

export { mergeFieldRules, mergePayloadFields, buildPositionalCandidates, buildValueHistogram, buildHistogramPrompt, applyNameMapToFields, isPlausibleFieldRule, tokenShape, classifyNameMapGroups, splitDelimited, safeFieldName, DEFAULT_HISTOGRAM_STOPWORDS };
