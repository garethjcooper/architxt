import { BaseTraceParser, buildUnparsedRecord } from './base-parser.js';
import { findTopLevelJsonRanges } from './json-scan.js';
import { compileOptionalRegex } from '../regex-compile.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('trace-json-nd-parser');

/**
 * JSON-ND (newline-delimited document) format engine — row detection only.
 *
 * Handles files where each logical record is a complete JSON value that may span
 * many lines (pretty-printed objects or arrays). This is distinct from JSON-lines
 * (NDJSON), where each line is an independent JSON object.
 *
 * Output records are intentionally flat and raw: `{ raw, unparsed? }`.
 * No field extraction, fieldMap, kindMap, or attribute mapping happens here.
 */
export class JsonNdParser extends BaseTraceParser {
  constructor(profileConfig) {
    super(profileConfig);
    const input = this.config.input || {};
    const records = this.config.records || {};
    this.encoding = input.encoding || 'utf-8';
    this.recordStartPath = records.recordStartPath || null;
    this.recordStartPattern = compileOptionalRegex(records.recordStartPattern);
  }

  /**
   * @param {string} _filePath
   * @param {Buffer|string} content
   * @returns {Promise<Array<object>>}
   */
  async parseFile(_filePath, content) {
    const text = Buffer.isBuffer(content) ? content.toString(this.encoding) : content;

    let values = [];
    let rootIsArray = false;
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        rootIsArray = true;
        values = parsed.map((obj, index) => ({ index, obj }));
      } else {
        values = [{ index: 0, obj: parsed }];
      }
    } catch (parseErr) {
      logger.warn('Failed to parse entire file as single JSON value; falling back to top-level value scan', {
        error: parseErr.message,
      });
      values = scanTopLevelJsonValues(text);
    }

    // When the document is a single array, every element is already a candidate
    // record. recordStartPath/pattern are intended for filtering objects inside a
    // stream, not for turning array elements into records, so we bypass grouping.
    if (rootIsArray && !this.recordStartPattern) {
      return values.map(({ obj }) => ({ raw: JSON.stringify(obj) }));
    }

    const records = this.groupObjectsIntoRecords(values);

    const rows = [];
    for (const record of records) {
      const raw = this.renderRaw(record);
      rows.push({ raw });
    }

    return rows;
  }

  /**
   * Group JSON objects into logical records.
   *
   * A new record starts when `recordStartPath` resolves to a value matching
   * `recordStartPattern`, or when `recordStartPattern` matches the JSON-serialised
   * object if no path is given. Continuation objects are attached to the current
   * record until a new start is found.
   *
   * @param {{ index: number, obj: object }[]} objects
   * @returns {Array<{ main: object, continuation: object[], indices: number[] }>}
   */
  groupObjectsIntoRecords(objects) {
    const records = [];
    let current = null;

    for (const item of objects) {
      if (this.isRecordStart(item.obj)) {
        if (current) records.push(current);
        current = { main: item.obj, continuation: [], indices: [item.index] };
      } else if (current) {
        current.continuation.push(item.obj);
        current.indices.push(item.index);
      } else {
        // Continuation before any start: treat as a singleton record.
        current = { main: item.obj, continuation: [], indices: [item.index] };
      }
    }

    if (current) records.push(current);
    return records;
  }

  isRecordStart(obj) {
    if (!this.recordStartPath && !this.recordStartPattern) {
      // No grouping rule: every object is its own record.
      return true;
    }

    const haystack = this.recordStartPath
      ? String(getPath(obj, this.recordStartPath) ?? JSON.stringify(obj))
      : JSON.stringify(obj);

    if (this.recordStartPattern) {
      return this.recordStartPattern.test(haystack);
    }

    // Path given but no pattern: start a record whenever the path has a value.
    return getPath(obj, this.recordStartPath) !== undefined;
  }

  renderRaw(record) {
    if (record.continuation.length === 0) {
      return JSON.stringify(record.main);
    }
    return [record.main, ...record.continuation].map((o) => JSON.stringify(o)).join('\n');
  }
}

function getPath(obj, path) {
  if (!path) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let value = obj;
  for (const part of parts) {
    if (value == null || typeof value !== 'object') return undefined;
    value = value[part];
  }
  return value;
}

/**
 * Find JSON-ND object boundaries for a pretty-printed JSON file.
 *
 * Strategy:
 *   1. Try to parse the whole source as JSON.
 *      - If it is an array, return one range covering the whole file.
 *      - If it is an object, return one range covering the whole file.
 *      The parser itself will split array elements into records.
 *   2. If the whole file does not parse, scan top-level JSON values using
 *      brace/bracket/string tracking and return a range for each complete value.
 *
 * @param {string[]} lines
 * @returns {Array<{ startLine: number, endLine: number }>}
 */
export function findJsonNdObjectBoundaries(lines) {
  const text = lines.join('\n');

  try {
    JSON.parse(text);
    // Single JSON document: one range covering all lines.
    if (lines.length === 0) return [];
    return [{ startLine: 0, endLine: lines.length - 1 }];
  } catch {
    // Fall through to top-level value scanning.
  }

  // Line-relative mapping: expand char ranges from findTopLevelJsonRanges into
  // line ranges by counting newlines.
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  const lineOf = (charIndex) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= charIndex) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  return findTopLevelJsonRanges(text).map((r) => ({
    startLine: lineOf(r.start),
    endLine: lineOf(r.end),
  }));
}

/**
 * Scan a source string for top-level JSON values that could not be parsed as a
 * single JSON document. Returns each value as { index, obj }.
 *
 * @param {string} text
 * @returns {Array<{ index: number, obj: object }>}
 */
function scanTopLevelJsonValues(text) {
  const values = [];
  for (const range of findTopLevelJsonRanges(text)) {
    const snippet = text.slice(range.start, range.end + 1);
    try {
      values.push({ index: values.length, obj: JSON.parse(snippet) });
    } catch (err) {
      logger.warn('Failed to parse top-level JSON value', { error: err.message });
    }
  }
  return values;
}
