/**
 * Compatibility shim over @architxt/aql.
 *
 * The server still consumes the old { intentText, sectionFocus } shape for
 * prompt variables. The canonical parser now lives in @architxt/aql; this file
 * preserves the historical export names so callers don't need to change.
 */

import { parseAql, toSectionFocus, MERMAID_DIAGRAM_TYPES } from '@architxt/aql';

/**
 * Supported Mermaid diagram types for #diagram directives.
 * Re-exported from @architxt/aql for backward compatibility.
 */
export const VALID_MERMAID_DIAGRAM_TYPES = MERMAID_DIAGRAM_TYPES;

/**
 * Parse section-focus directives from raw query text.
 *
 * Delegates to @architxt/aql and converts the block structure into the legacy
 * server shape:
 *   graph     -> string
 *   narrative -> string
 *   table     -> Array<{name?, content}>
 *   diagram   -> Array<{name?, type, content}>
 */
export function parseSectionDirectives(rawQuery) {
  const aqlQuery = parseAql(rawQuery || '');
  return toSectionFocus(aqlQuery);
}
