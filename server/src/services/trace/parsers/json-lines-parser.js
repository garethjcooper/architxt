import { BaseTraceParser, buildUnparsedRecord } from './base-parser.js';
import { compileOptionalRegex } from '../regex-compile.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('trace-json-lines-parser');

/**
 * JSON-lines format engine — row detection only.
 *
 * Reads files where each line is an independent JSON object (NDJSON). Records
 * may be grouped when `recordStartPath`/`recordStartPattern` is provided; otherwise
 * every valid JSON object is one record.
 *
 * Output records are intentionally flat and raw: `{ raw, unparsed? }`.
 * No field extraction, fieldMap, kindMap, or attribute mapping happens here.
 */
export class JsonLinesParser extends BaseTraceParser {
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
    const lines = text.split(/\r?\n/);

    const objects = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      try {
        objects.push({ lineNumber: i + 1, obj: JSON.parse(line) });
      } catch (err) {
        logger.warn('Failed to parse JSON line', { lineNumber: i + 1, error: err.message });
      }
    }

    const records = this.groupObjectsIntoRecords(objects);

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
   * @param {{ lineNumber: number, obj: object }[]} objects
   * @returns {Array<{ main: object, continuation: object[], lineNumbers: number[] }>}
   */
  groupObjectsIntoRecords(objects) {
    const records = [];
    let current = null;

    for (const item of objects) {
      if (this.isRecordStart(item.obj)) {
        if (current) records.push(current);
        current = { main: item.obj, continuation: [], lineNumbers: [item.lineNumber] };
      } else if (current) {
        current.continuation.push(item.obj);
        current.lineNumbers.push(item.lineNumber);
      } else {
        // Continuation before any start: treat as a singleton record.
        current = { main: item.obj, continuation: [], lineNumbers: [item.lineNumber] };
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
 * Find JSON object boundaries for a json-lines profile.
 *
 * Each non-empty line that parses as valid JSON becomes its own record range.
 * Invalid lines are grouped with the preceding valid object so they count as
 * unparsed content within that chunk.
 *
 * @param {string[]} lines
 * @returns {Array<{ startLine: number, endLine: number }>}
 */
export function findJsonObjectBoundaries(lines) {
  const ranges = [];
  let currentStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      JSON.parse(line);
      if (i > currentStart) {
        ranges.push({ startLine: currentStart, endLine: i - 1 });
      }
      currentStart = i;
    } catch {
      // Not a valid JSON line — belongs to current record.
    }
  }

  if (currentStart < lines.length) {
    ranges.push({ startLine: currentStart, endLine: lines.length - 1 });
  }

  return ranges;
}
