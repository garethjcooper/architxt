/**
 * Convert a structured table into a Markdown table.
 * Useful for rendering mental-model table output as human-readable Markdown.
 */
export interface TableLike {
  name?: string;
  columns?: string[];
  rows?: Array<Record<string, any> | any[]>;
}

function escapeMdCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/(?<!\\\\)\|/g, '\\\\|')
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, '')
    .trim();
}

function getRowValue(row: Record<string, any> | any[], column: string, index: number): unknown {
  if (Array.isArray(row)) return row[index] ?? '';
  if (row && typeof row === 'object') return row[column] ?? '';
  return '';
}

export function tableToMarkdown(table: TableLike): string {
  const name = table.name;
  const columns = Array.isArray(table.columns)
    ? table.columns.filter((c) => typeof c === 'string')
    : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];

  if (columns.length === 0) {
    if (rows.length === 0) return name ? `**${name}**\n\n*No data.*` : '*No data.*';
    // Infer columns from first row if not provided.
    const first = rows[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      columns.push(...Object.keys(first));
    }
  }

  if (columns.length === 0) return name ? `**${name}**\n\n*No columns.*` : '*No columns.*';

  const header = `| ${columns.map(escapeMdCell).join(' | ')} |`;
  const separator = `| ${columns.map(() => '---').join(' | ')} |`;
  const bodyLines = rows.map((row) =>
    `| ${columns.map((col, idx) => escapeMdCell(getRowValue(row, col, idx))).join(' | ')} |`
  );

  const lines = [header, separator, ...bodyLines];
  if (name) lines.unshift(`**${escapeMdCell(name)}**`, '');
  return lines.join('\n');
}

/**
 * Convert multiple tables into a single Markdown document.
 */
export function tablesToMarkdown(tables: TableLike[]): string {
  if (!Array.isArray(tables) || tables.length === 0) return '';
  return tables.map(tableToMarkdown).join('\n\n');
}
