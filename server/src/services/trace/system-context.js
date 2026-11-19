/**
 * System trace context
 *
 * Canonical context text automatically prepended to the effective context of
 * any trace document (doc_source_type = 'trace'), ahead of any user-selected
 * context. It concisely describes the format and content of the trace
 * document output so downstream consumers (Hindsight retain, diffs, agent
 * recall) can interpret the document without extra prompting.
 *
 * This is a code constant, not a DB row: it never appears in the contexts
 * list, has no usage counts, and cannot be edited or deleted by users.
 */

export const SYSTEM_TRACE_CONTEXT_NAME = 'system-trace';

export const SYSTEM_TRACE_CONTEXT_TEXT = [
  'SYSTEM TRACE CONTEXT (system-trace):',
  'This document is a processed trace, not a free-text document. Its content is',
  'a Trace Sequence Analysis report generated from a raw trace file by a trace',
  'profile. Structure:',
  '',
  '- Title: `# Trace Sequence Analysis: <filename>`, followed by a header listing',
  '  the input format, order/correlation/token/entity/direction fields, rows used,',
  '  and any truncation or capping applied.',
  '- One `## Sequence N — `<tokens>` section per mined sequence, where the heading',
  '  shows the sequence signature (display tokens joined by the configured',
  '  separator, default "$"). Each section lists its frequency, example trace',
  '  keys, and a step table with columns Step | Entity | Direction | Token (plus',
  '  token-component columns when configured). The Entity and Direction columns',
  '  are the key fields: they always come first, identify who performed the step',
  '  and in which direction, and are the columns to join on when correlating',
  '  steps across sequences.',
  '- An optional final `## Sequence transitions (adjacent traces, one level deep)`',
  '  section with a From sequence | To sequence | Traces table.',
  '',
  'Field values come from the trace profile parser (records are { raw, fields }',
  'pairs); missing values render as "-" by default.',
].join('\n');

/**
 * Compute the effective context for a document.
 *
 * For trace documents the system trace text is always prepended, followed by
 * the user-selected context (if any). Non-trace documents get the user
 * context unchanged.
 *
 * @param {string|null|undefined} userContext - The user-selected context text
 * @param {string|null|undefined} docSourceType - documents.doc_source_type
 * @returns {string|null} effective context text, or null when empty
 */
export function applySystemTraceContext(userContext, docSourceType) {
  const user = typeof userContext === 'string' && userContext.trim() !== '' ? userContext : null;
  if (docSourceType !== 'trace') {
    return user;
  }
  if (!user) {
    return SYSTEM_TRACE_CONTEXT_TEXT;
  }
  return `${SYSTEM_TRACE_CONTEXT_TEXT}\n\n---\n\n${user}`;
}
