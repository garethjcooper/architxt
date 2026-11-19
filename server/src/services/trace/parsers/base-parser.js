export class BaseTraceParser {
  /**
   * @param {object} profileConfig - The parser-specific section of a trace profile.
   */
  constructor(profileConfig) {
    this.config = normalizeTraceConfig(profileConfig || {});
    const rawCap = this.config.records?.maxRecordBytes;
    this.maxRecordBytes = normalizeMaxRecordBytes(rawCap);
  }

  /**
   * Parse a single file and return detected raw trace records.
   *
   * Each record is a flat object. The only guaranteed keys are `raw`. Records
   * that could not be assigned a clean row boundary have `unparsed: true`. No
   * field extraction, fieldMap, kindMap, or attribute mapping happens at this stage.
   *
   * @param {string} _filePath
   * @param {Buffer|string} _content
   * @returns {Promise<Array<object>>}
   */
  async parseFile(_filePath, _content) {
    throw new Error(`parseFile not implemented for ${this.constructor.name}`);
  }

  /**
   * Apply the per-record size cap to a parsed record list.
   *
   * Records whose `raw` exceeds `records.maxRecordBytes` are marked
   * `oversized: true` (and `unparsed: true`) so downstream stages skip them
   * before any regex/stitching work. Returns `{ records, oversizedCount }`.
   * A cap of 0/undefined means unlimited.
   *
   * @param {object[]} records
   * @returns {{ records: object[], oversizedCount: number }}
   */
  applyRecordSizeCap(records) {
    if (!this.maxRecordBytes || !Array.isArray(records)) {
      return { records, oversizedCount: 0 };
    }
    let oversizedCount = 0;
    const out = records.map((record) => {
      if (record && typeof record.raw === 'string' && record.raw.length > this.maxRecordBytes) {
        oversizedCount += 1;
        return { ...record, unparsed: true, oversized: true };
      }
      return record;
    });
    return { records: out, oversizedCount };
  }

  /**
   * Decode content to a string using the configured encoding.
   *
   * @param {Buffer|string} content
   * @param {string} encoding
   * @returns {string}
   */
  decode(content, encoding = 'utf-8') {
    if (Buffer.isBuffer(content)) {
      const enc = encoding.toLowerCase().replace(/[-_]/g, '');
      if (enc === 'utf8' || enc === 'utf16le') return content.toString(enc);
      // Best-effort: try native encodings, otherwise fall back to utf-8.
      try {
        return content.toString(enc || 'utf-8');
      } catch {
        return content.toString('utf-8');
      }
    }
    return String(content);
  }
}

function normalizeMaxRecordBytes(raw) {
  if (raw === undefined || raw === null || raw === 0) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error('records.maxRecordBytes must be a non-negative integer');
  }
  return n;
}

/**
 * Build an empty/unparsed record for content that could not be parsed into a
 * clean row.
 *
 * @param {string} raw - Raw row content for debugging.
 * @returns {object}
 */
export function buildUnparsedRecord(raw) {
  return { raw, unparsed: true };
}

/**
 * Normalize a trace parser config into the canonical nested shape.
 *
 * The parser engines historically expect:
 *   { input: {...}, records: {...} }
 *
 * LLM-generated configs often arrive as a flat object with keys such as
 * `recordStartPattern`, `variants`, `stitchPayload`, `delimiter`, etc. This
 * function maps those flat keys into the canonical shape without discarding
 * any already-nested keys, so both formats are accepted.
 *
 * Exported as `normalizeTraceConfigForChunker` so the chunker can apply the
 * same mapping before calling engine-specific detectors.
 *
 * @param {object} raw
 * @returns {object}
 */
export function normalizeTraceConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { input: {}, records: {} };
  }

  // Already canonical: respect it but fill in defaults.
  const input = raw.input || {};
  const records = raw.records || {};

  const normalized = {
    input: { ...input },
    records: { ...records },
  };

  // If a flat config was supplied, copy known flat keys into the canonical shape.
  if (raw.delimiter !== undefined) normalized.input.delimiter = raw.delimiter;
  if (raw.hasHeader !== undefined) normalized.input.hasHeader = raw.hasHeader;
  if (raw.encoding !== undefined) normalized.input.encoding = raw.encoding;
  if (raw.quoteChar !== undefined) normalized.input.quoteChar = raw.quoteChar;
  if (raw.recordStartPattern !== undefined) normalized.records.recordStartPattern = raw.recordStartPattern;
  if (raw.multilineColumn !== undefined) normalized.records.multilineColumn = raw.multilineColumn;
  if (raw.payloadStitching !== undefined) normalized.records.payloadStitching = raw.payloadStitching;
  if (raw.variants !== undefined) normalized.records.variants = raw.variants;
  if (raw.recordStartRule !== undefined) normalized.records.recordStartRule = raw.recordStartRule;

  return normalized;
}

export const normalizeTraceConfigForChunker = normalizeTraceConfig;
