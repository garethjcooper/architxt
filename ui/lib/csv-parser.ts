/**
 * Simple CSV parser that respects double-quote delimiters and escaped quotes.
 * RFC 4180-ish: "fields","may contain, commas","and ""escaped"" quotes"
 */

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/**
 * Parse raw CSV text.
 * Auto-detects header row by checking if the first row contains known column names.
 * If no header detected, returns empty headers and all rows as data.
 */
export function parseCsv(
  text: string,
  headerHints?: string[]
): CsvParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const allRows = lines.map(parseCsvLine);
  const firstRow = allRows[0];

  // Header detection: if any cell matches a hint (case-insensitive), treat as header
  const hints = headerHints || [];
  const isHeader =
    hints.length > 0 &&
    firstRow.some((cell) =>
      hints.some((h) => cell.toLowerCase() === h.toLowerCase())
    );

  if (isHeader) {
    return { headers: firstRow, rows: allRows.slice(1) };
  }

  return { headers: [], rows: allRows };
}

/**
 * Strip surrounding double quotes from a field if present.
 */
export function stripQuotes(val: string): string {
  if (val.length >= 2 && val.startsWith('"') && val.endsWith('"')) {
    return val.slice(1, -1);
  }
  return val;
}
