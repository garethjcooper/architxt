/**
 * Shared JSON structural scanning: bracket/string tracking over text or lines.
 *
 * Used by the json-lines / json-nd boundary detectors so the brace-tracking
 * logic lives in exactly one place.
 */

/**
 * Scan text char-by-char, calling back on each structural event.
 * Events: { type: 'valueStart', index } when a top-level value begins,
 *         { type: 'valueEnd', index } when it completes.
 */
export function scanJsonStructure(text, onEvent) {
  let depth = 0;
  let inString = false;
  let escape = false;
  let valueStarted = false;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{' || ch === '[') {
      if (depth === 0) { start = i; valueStarted = true; onEvent({ type: 'valueStart', index: i }); }
      depth++;
    } else if (ch === '}' || ch === ']') {
      if (depth > 0) depth--;
      if (depth === 0 && valueStarted) {
        onEvent({ type: 'valueEnd', index: i, start });
        valueStarted = false;
      }
    }
  }
  return { valueStarted, start };
}

/**
 * Find top-level JSON value ranges within text. Returns [{ start, end }] char
 * offsets (end inclusive). An unterminated trailing value is included with end
 * = text.length - 1.
 */
export function findTopLevelJsonRanges(text) {
  const ranges = [];
  const tail = scanJsonStructure(text, (ev) => {
    if (ev.type === 'valueEnd') ranges.push({ start: ev.start, end: ev.index });
  });
  if (tail.valueStarted && tail.start !== -1) {
    ranges.push({ start: tail.start, end: text.length - 1 });
  }
  return ranges;
}

/** True if the text contains at least one complete top-level JSON value. */
export function hasParseableLeadingJson(text) {
  return findTopLevelJsonRanges(text).length > 0;
}
