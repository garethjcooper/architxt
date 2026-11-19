import { createLogger } from '../../../utils/logger.js';
import { compileOptionalRegex } from '../regex-compile.js';

const logger = createLogger('trace-delimited-normaliser');

/**
 * Normalise a delimited source text so that multi-line logical records become
 * single parseable rows.
 *
 * This is purely a row-boundary operation. It does not extract fields or map
 * attributes. It recognises:
 *  - a configured `recordStartRule` that marks which physical lines begin a record
 *  - a `multilineColumn` that absorbs continuation lines as a single cell
 *  - XML/JSON payload stitching when `payloadStitching` is set to 'xml' or 'json'
 *
 * The function returns a single string where logical-record separators are
 * preserved as newlines, and any embedded newlines inside a multi-line cell are
 * replaced with a placeholder so csv-parse can treat the logical record as one
 * row. Callers restore the placeholder back to newlines after tokenisation.
 *
 * @param {string} text
 * @param {object} config
 * @returns {{ text: string, multilineColumnIndex: number|undefined }}
 */
/**
 * Resolve the effective recordStartRule for a set of lines.
 *
 * `minColumns` is a guard against continuation lines that accidentally match
 * the key regex. But if the strict rule (with minColumns) matches zero start
 * lines while the relaxed rule (key column/regex only) matches at least one,
 * the minColumns value is clearly wrong for this input — fall back to the
 * relaxed rule so the file isn't detected as a single record.
 */
function resolveEffectiveRule(lines, rule, delimiter, keyRegex) {
  if (!rule || rule.minColumns == null) return { rule, keyRegex };
  const relaxed = { ...rule, minColumns: undefined };
  const strictStarts = lines.filter((l) => isStartLine(l, rule, delimiter, keyRegex)).length;
  if (strictStarts > 0) return { rule, keyRegex };
  const relaxedStarts = lines.filter((l) => isStartLine(l, relaxed, delimiter, keyRegex)).length;
  return relaxedStarts > 0 ? { rule: relaxed, keyRegex } : { rule, keyRegex };
}

function isStartLine(line, rule, delimiter, keyRegex) {
  if (!line.trim()) return false;
  if (!rule) return true;
  const row = line.split(delimiter);
  if (rule.minColumns != null && row.length < rule.minColumns) return false;
  if (rule.keyColumn != null && rule.keyRegex != null) {
    const key = row[Number(rule.keyColumn)];
    // keyRegex is compiled once by the caller — never per line.
    if (key == null || !(keyRegex || compileOptionalRegex(rule.keyRegex)).test(key.trim())) return false;
  }
  return true;
}

export function normaliseDelimitedSource(text, config) {
  const input = config?.input || {};
  const records = config?.records || {};
  const delimiter = input.delimiter || '\t';
  const lineTerminator = input.lineTerminator || '\n';
  const recordStartRuleRaw = records.recordStartRule;
  const keyRegex = compileOptionalRegex(recordStartRuleRaw?.keyRegex);
  const { rule: recordStartRule } = resolveEffectiveRule(text.split(/\r?\n/), recordStartRuleRaw, delimiter, keyRegex);
  const multilineColumnRaw = records.multilineColumn;
  const payloadStitching = records.payloadStitching;
  const placeholder = input.multiLinePlaceholder || '\u0000';

  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return { text: '', multilineColumnIndex: undefined };

  // Resolve multiline column index and name.
  let header = null;
  const hasHeader = input.hasHeader ?? false;
  if (hasHeader) {
    header = lines[0].split(delimiter).map((c) => c.trim());
  }
  const multilineColumnIndex = resolveMultilineColumnIndex(multilineColumnRaw, header);

  const logicalRecords = [];
  let currentRecordLines = [lines[0]];

  const isStart = (line) => isStartLine(line, recordStartRule, delimiter, keyRegex);

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    const start = isStart(line);

    if (start) {
      flushRecord(currentRecordLines, logicalRecords, {
        delimiter,
        multilineColumnIndex,
        payloadStitching,
        placeholder,
      });
      currentRecordLines = [line];
    } else {
      currentRecordLines.push(line);
    }
  }
  flushRecord(currentRecordLines, logicalRecords, {
    delimiter,
    multilineColumnIndex,
    payloadStitching,
    placeholder,
  });

  return {
    text: logicalRecords.join(lineTerminator),
    multilineColumnIndex,
  };
}

function flushRecord(recordLines, out, opts) {
  if (recordLines.length === 0) return;
  const { delimiter, multilineColumnIndex, payloadStitching, placeholder } = opts;

  if (recordLines.length === 1) {
    out.push(recordLines[0]);
    return;
  }

  // Multi-line record: join continuation lines into the target cell and replace
  // their newlines with a placeholder.
  const firstRow = recordLines[0].split(delimiter);
  const continuationText = recordLines.slice(1).join(placeholder);

  // The continuation actually lands in the column where the merged cell sits:
  // the configured multilineColumn if it matches the first row's shape, else the
  // payload (last) column under stitching, else the last column. Use the first
  // row's actual column count — not the header's — so a short row doesn't
  // misattribute the continuation to the wrong column.
  let targetIndex = multilineColumnIndex;
  if (targetIndex != null && (targetIndex < 0 || targetIndex >= firstRow.length)) {
    targetIndex = null; // configured column doesn't exist on this row
  }
  if (targetIndex == null && payloadStitching) {
    targetIndex = firstRow.length - 1;
  }
  if (targetIndex == null) {
    targetIndex = firstRow.length - 1;
  }

  if (targetIndex != null) {
    while (firstRow.length <= targetIndex) firstRow.push('');
    firstRow[targetIndex] = (firstRow[targetIndex] || '') + continuationText;
  } else {
    firstRow.push(continuationText);
  }

  out.push(firstRow.join(delimiter));
}

function resolveMultilineColumnIndex(raw, header) {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && header) {
    const index = header.findIndex((h) => h === raw.trim());
    return index >= 0 ? index : Number(raw);
  }
  return Number(raw);
}

/**
 * Find logical record ranges in raw delimited source lines.
 *
 * This is the chunker's view of the same boundaries the parser will use. It
 * honours `recordStartRule` and is intentionally ignorant of field values.
 *
 * @param {string[]} lines
 * @param {object} parserConfig
 * @returns {Array<{startLine: number, endLine: number}>}
 */
export function findDelimitedRecordRanges(lines, parserConfig) {
  const config = normalizeForRanges(parserConfig);
  const input = config.input || {};
  const records = config.records || {};
  const delimiter = input.delimiter || '\\t';
  const ruleRaw = records.recordStartRule;
  const keyRegex = compileOptionalRegex(ruleRaw?.keyRegex);
  const { rule } = resolveEffectiveRule(lines, ruleRaw, delimiter, keyRegex);

  const ranges = [];
  let currentStart = null;

  const isStart = (line) => isStartLine(line, rule, delimiter, keyRegex);

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

  if (!rule && ranges.length === 0) {
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].trim() !== '') ranges.push({ startLine: i, endLine: i });
    }
  }

  return ranges;
}

function normalizeForRanges(parserConfig) {
  const raw = parserConfig || {};
  const input = raw.input || {};
  const records = raw.records || {};
  if (raw.delimiter !== undefined) input.delimiter = raw.delimiter;
  if (raw.recordStartRule !== undefined) records.recordStartRule = raw.recordStartRule;
  return { input, records };
}

/**
 * Detect which column carries a structured (XML/JSON) payload by scanning the
 * row for a cell that opens with '<' or '{' / '['. Returns the last such column
 * index, or null when none found.
 */
function detectPayloadColumnIndex(row) {
  let found = null;
  for (let i = 0; i < row.length; i += 1) {
    const v = row[i].trim();
    if (v.startsWith('<') || v.startsWith('{') || v.startsWith('[')) found = i;
  }
  return found;
}

/**
 * Analyze a delimited source for warnings that affect row detection.
 *
 * This is a thin wrapper over findDelimitedRecordRanges that checks whether the
 * configured multi-line settings make sense. When the source has a header row,
 * it also reports which columns absorb continuation lines in multi-line records.
 *
 * @param {string} text
 * @param {object} parserConfig
 * @returns {{ hasMultiLineColumns: boolean, hasMultipleMultiLineColumns: boolean, multiLineColumns: string[], warnings: string[] }}
 */
export function analyzeDelimitedSource(text, parserConfig) {
  const config = normalizeForRanges(parserConfig);
  const input = config.input || {};
  const records = config.records || {};
  const warnings = [];

  const lines = text.split(/\r?\n/);
  const ranges = findDelimitedRecordRanges(lines, parserConfig);

  const hasMultiLineColumns = ranges.some((r) => r.startLine !== r.endLine);

  // Which columns carry continuation lines? Only meaningful with a header row
  // (hasHeader) or when we can fall back to column_N names. Continuation lines
  // land in the configured multilineColumn, or the last column when
  // payloadStitching is set.
  const delimiter = input.delimiter || '\t';
  const hasHeader = input.hasHeader ?? false;
  const header = hasHeader && lines.length > 0
    ? lines[0].split(delimiter).map((c) => c.trim())
    : null;
  const multiLineColumns = new Set();
  if (hasMultiLineColumns) {
    const configuredIndex = resolveMultilineColumnIndex(records.multilineColumn, header);
    for (const r of ranges) {
      if (r.startLine === r.endLine) continue;
      const firstRow = lines[r.startLine].split(delimiter);
      // Attribute the continuation to the column it actually lands in: the
      // configured multilineColumn only when the row has that column; else the
      // payload column when one opens with an XML/JSON structure; else the last
      // column of the row.
      let idx = configuredIndex;
      if (idx != null && (idx < 0 || idx >= firstRow.length)) idx = null;
      // Under payload stitching the continuation is appended to the last column
      // by design; otherwise prefer the column that visibly holds an XML/JSON
      // payload over the last column.
      if (idx == null && !records.payloadStitching) idx = detectPayloadColumnIndex(firstRow);
      if (idx == null) idx = firstRow.length - 1;
      const name = (header && header[idx]) || `column_${idx}`;
      multiLineColumns.add(name);
    }
  }
  const multiLineColumnNames = Array.from(multiLineColumns);
  const hasMultipleMultiLineColumns = multiLineColumnNames.length > 1;

  if (hasMultiLineColumns && !records.multilineColumn && !records.payloadStitching) {
    warnings.push('Detected multi-line records but neither records.multilineColumn nor records.payloadStitching is set.');
  }

  return {
    hasMultiLineColumns,
    hasMultipleMultiLineColumns,
    multiLineColumns: multiLineColumnNames,
    warnings,
  };
}
