import { BaseTraceParser, buildUnparsedRecord } from './base-parser.js';
import { compileStartRegex, compileOptionalRegex } from '../regex-compile.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('trace-plaintext-parser');

/**
 * Plaintext format engine — row detection only.
 *
 * Records are logical text blocks. A block starts when a physical line matches
 * `recordStartPattern` (or `recordStartRule`). Subsequent lines that do not
 * start a new record are appended to the current block.
 *
 * Output records are intentionally flat and raw: `{ raw, unparsed? }`.
 * No field extraction, fieldMap, kindMap, or attribute mapping happens here.
 */
export class PlaintextParser extends BaseTraceParser {
  constructor(profileConfig) {
    super(profileConfig);
    const records = this.config.records || {};
    this.recordStartPattern = records.recordStartPattern;
    this.recordStartRule = records.recordStartRule;
    this.payloadStitching = records.payloadStitching;
    // Compiled once at construction (validated fail-fast by the registry).
    this.recordStartRegex = compileOptionalRegex(this.recordStartPattern, compileStartRegex);
    this.recordStartRuleRegex = compileOptionalRegex(this.recordStartRule?.pattern, compileStartRegex);
  }

  /**
   * @param {string} _filePath
   * @param {Buffer|string} content
   * @returns {Promise<Array<object>>}
   */
  async parseFile(_filePath, content) {
    const text = this.decode(content, this.config.input?.encoding || 'utf-8');
    const lines = text.split(/\r?\n/);

    const records = [];
    let currentLines = [];

    const isStart = (line) => {
      if (!line.trim()) return false;
      if (this.recordStartRule) return matchRecordStartRule(line, this.recordStartRule, this.recordStartRuleRegex);
      if (this.recordStartRegex) return this.recordStartRegex.test(line);
      return true;
    };

    const flush = () => {
      if (currentLines.length === 0) return;
      const raw = currentLines.join('\n');
      records.push(raw.trim() ? { raw } : buildUnparsedRecord(raw));
      currentLines = [];
    };

    for (const line of lines) {
      if (isStart(line)) {
        flush();
        currentLines = [line];
      } else if (currentLines.length > 0) {
        currentLines.push(line);
      } else {
        // Continuation before any start: treat as unparsed singleton.
        records.push(buildUnparsedRecord(line));
      }
    }
    flush();

    return records;
  }
}

/**
 * Detect record-start boundaries in raw plaintext source lines.
 *
 * @param {string[]} lines
 * @param {object} parserConfig
 * @returns {Array<{startLine: number, endLine: number}>}
 */
export function findRecordStartLines(lines, parserConfig) {
  const config = parserConfig || {};
  const records = config.records || {};
  const recordStartPattern = records.recordStartPattern;
  const recordStartRule = records.recordStartRule;

  const regex = compileOptionalRegex(recordStartPattern, compileStartRegex);
  const ruleRegex = compileOptionalRegex(recordStartRule?.pattern, compileStartRegex);

  const isStart = (line) => {
    if (!line.trim()) return false;
    if (recordStartRule) return matchRecordStartRule(line, recordStartRule, ruleRegex);
    if (regex) return regex.test(line);
    return true;
  };

  const ranges = [];
  let currentStart = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isStart(line)) {
      if (currentStart != null) {
        ranges.push({ startLine: currentStart, endLine: i - 1 });
      }
      currentStart = i;
    }
  }
  if (currentStart != null) {
    ranges.push({ startLine: currentStart, endLine: lines.length - 1 });
  }

  if (!regex && !recordStartRule && ranges.length === 0) {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== '') ranges.push({ startLine: i, endLine: i });
    }
  }

  return ranges;
}

function matchRecordStartRule(line, rule, compiledRuleRegex) {
  if (!rule) return true;
  if (rule.minLength != null && line.length < rule.minLength) return false;
  if (rule.pattern) {
    const re = compiledRuleRegex || compileStartRegex(rule.pattern);
    if (re && !re.test(line)) return false;
  }
  return true;
}
