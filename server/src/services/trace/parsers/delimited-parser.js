import { parse as parseCsv } from 'csv-parse/sync';
import { BaseTraceParser, buildUnparsedRecord, normalizeTraceConfig } from './base-parser.js';
import { createLogger } from '../../../utils/logger.js';
import { normaliseDelimitedSource, findDelimitedRecordRanges } from './delimited-normaliser.js';

const logger = createLogger('trace-delimited-parser');

/**
 * Delimited format engine — row detection only.
 *
 * Uses `csv-parse` for robust tokenisation of CSV, TSV, pipe-delimited and
 * similar character-delimited files. Multi-line records are handled by a
 * dedicated upstream normaliser (`normaliseDelimitedSource`) that assembles
 * logical records before tokenisation.
 *
 * The parser emits raw records: `{ raw, unparsed? }`. No field extraction,
 * fieldMap, kindMap, or attribute mapping happens here.
 */
export class DelimitedParser extends BaseTraceParser {
  constructor(profileConfig) {
    super(profileConfig);
    const input = this.config.input || {};
    const records = this.config.records || {};
    this.delimiter = input.delimiter || '\t';
    this.hasHeader = input.hasHeader ?? false;
    this.quoteChar = input.quoteChar ?? '"';
    this.multilineColumn = records.multilineColumn;
  }

  resolveMultilineColumn() {
    if (typeof this.multilineColumn === 'number') return this.multilineColumn;
    if (typeof this.multilineColumn !== 'string' || !this.header) return undefined;
    const name = this.multilineColumn.trim();
    const index = this.header.findIndex((h) => h === name);
    return index >= 0 ? index : undefined;
  }

  /**
   * @param {string} _filePath
   * @param {Buffer|string} content
   * @returns {Promise<Array<object>>}
   */
  async parseFile(_filePath, content) {
    const text = Buffer.isBuffer(content) ? content.toString(inputEncoding(this.config)) : content;
    const { text: normalised, multilineColumnIndex: normalisedMultilineColumn } = normaliseDelimitedSource(text, this.config);
    this.normalisedMultilineColumnIndex = normalisedMultilineColumn;
    this.multilineColumnName = normalisedMultilineColumn != null && this.header
      ? this.header[normalisedMultilineColumn]
      : (typeof this.multilineColumn === 'string' ? this.multilineColumn.trim() : 'multilineValue');
    const placeholder = this.config.input?.multiLinePlaceholder || '\u0000';

    const quote = this.quoteChar === '' ? false : this.quoteChar;

    let rows;
    try {
      rows = parseCsv(normalised, {
        delimiter: this.delimiter,
        quote,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: false,
      });
    } catch (parseErr) {
      logger.warn('CSV parse failed, retrying with quote disabled', { error: parseErr.message, delimiter: this.delimiter });
      rows = parseCsv(normalised, {
        delimiter: this.delimiter,
        quote: false,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: false,
      });
    }

    // Restore newlines that the normaliser replaced with a placeholder to keep
    // multi-line payloads intact during line-based tokenisation.
    rows = rows.map((row) => row.map((cell) => (typeof cell === 'string' ? cell.replaceAll(placeholder, '\n') : cell)));

    const headerOffset = this.hasHeader ? 1 : 0;
    this.header = this.hasHeader ? rows[0] : null;
    const dataRows = this.hasHeader ? rows.slice(headerOffset) : rows;

    const records = [];
    for (const row of dataRows) {
      const raw = row.join(this.delimiter);
      if (!raw.trim()) continue;
      const record = { raw };
      // Seed positional fields in both modes so downstream field application
      // sees parser-provided columns and never falls back to the whole-record
      // value for a column_N entry. With a header the names come from the
      // header row; without one they are column_0…column_N.
      const fields = {};
      const names = this.header || row.map((_, i) => `column_${i}`);
      for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (name != null && name !== '') {
          fields[name] = row[i];
        }
      }
      record.fields = fields;
      records.push(record);
    }

    return records;
  }
}

function inputEncoding(config) {
  return config?.input?.encoding || 'utf-8';
}

/**
 * Re-export the shared delimited record-boundary detector for the chunker.
 *
 * The chunker must agree with the parser on where logical records begin and
 * end, otherwise chunks will be miscounted and coverage will be wrong.
 *
 * @param {string[]} lines
 * @param {object} config
 * @returns {Array<{ startLine: number, endLine: number }>}
 */
export function findRecordStartRows(lines, config) {
  return findDelimitedRecordRanges(lines, config);
}
