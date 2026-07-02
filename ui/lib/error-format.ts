export function formatErrorValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(formatErrorValue).filter(Boolean).join('\n');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.error_message === 'string') return obj.error_message;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

export function formatErrorSummary(value: unknown, maxLength = 200): string {
  const text = formatErrorValue(value);
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength)}…`;
}
