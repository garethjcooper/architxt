/**
 * Build a cleaned, delimited standard log from flat trace records.
 *
 * The standard log is a flat, line-oriented format where each record becomes
 * one line with a fixed set of leading columns followed by dynamic columns.
 *
 * Configurable via profile.standardLog:
 *   - delimiter: column separator (default '|')
 *   - maxRawLength: max characters for the raw/evidence column (default 200)
 *   - stripXmlFromRaw: remove XML tags from raw column (default true)
 *   - cleanOperation: trim operation at first '~' if present (default false to stay faithful)
 */

const DEFAULT_FIXED_COLUMNS = [
  'timestamp',
  'direction',
  'service',
  'operation',
  'traceId',
  'messageId',
  'parentId',
];

export function buildStandardLog(records, standardLogConfig = {}) {
  const delimiter = standardLogConfig.delimiter || '|';
  const maxRawLength = standardLogConfig.maxRawLength ?? 200;
  const stripXmlFromRaw = standardLogConfig.stripXmlFromRaw ?? true;
  const cleanOperation = standardLogConfig.cleanOperation ?? false;

  const rows = records.map((record) => buildStandardRow(record, {
    maxRawLength,
    stripXmlFromRaw,
    cleanOperation,
  }));

  const dynamicKeys = collectDynamicKeys(rows);
  const header = [...DEFAULT_FIXED_COLUMNS, ...dynamicKeys];

  const delimitedLines = [
    header.join(delimiter),
    ...rows.map((row) => formatRow(row, header, delimiter)),
  ];

  return {
    delimiter,
    header,
    rows,
    delimited: delimitedLines.join('\n'),
  };
}

function buildStandardRow(record, options) {
  const { maxRawLength, stripXmlFromRaw, cleanOperation } = options;

  const fixed = {};
  for (const key of DEFAULT_FIXED_COLUMNS) {
    let value = record[key];
    if (key === 'operation' && cleanOperation && typeof value === 'string') {
      const tilde = value.indexOf('~');
      if (tilde > 0) value = value.slice(0, tilde);
    }
    fixed[key] = normalizeCell(value);
  }

  // Dynamic columns: everything else except reserved keys and already-included fixed keys.
  const reserved = new Set([...DEFAULT_FIXED_COLUMNS, 'unparsed']);
  const dynamic = {};
  for (const [key, value] of Object.entries(record)) {
    if (reserved.has(key)) continue;
    dynamic[key] = normalizeCell(value);
  }

  if (record.raw != null) {
    let raw = String(record.raw);
    if (stripXmlFromRaw) raw = stripXml(raw);
    if (maxRawLength > 0 && raw.length > maxRawLength) {
      raw = raw.slice(0, maxRawLength) + '...';
    }
    dynamic.raw = raw;
  }

  return { ...fixed, ...dynamic };
}

function normalizeCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  return str.trim();
}

function stripXml(text) {
  return text.replace(/\u003c[^\u003e]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function collectDynamicKeys(rows) {
  const keys = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!DEFAULT_FIXED_COLUMNS.includes(key)) keys.add(key);
    }
  }
  return Array.from(keys).sort();
}

function formatRow(row, header, delimiter) {
  return header.map((key) => row[key] ?? '').join(delimiter);
}
