/**
 * Parse section-focus directives from raw query text.
 *
 * Shared logic between frontend and backend. Returns parsed directives
 * plus the remaining intent text (query with directive blocks stripped).
 *
 * Supported syntax (block style ONLY):
 *
 *   #graph
 *   CRM, ERP
 *   #end
 *
 *   #table
 *   #name Billing Dependencies
 *   List all upstream and downstream dependencies
 *   #end
 *
 *   #narrative
 *   business impact
 *   #end
 *
 * Directives must be explicitly closed with #end. No inline colon syntax.
 * Multiple blocks of the same type are collected according to cardinality
 * rules in SECTION_DIRECTIVE_CONFIG.
 */

export const SECTION_DIRECTIVE_CONFIG = {
  graph:     { cardinality: 'single', merge: 'concat' },
  table:     { cardinality: 'multiple' },
  narrative: { cardinality: 'single', merge: 'concat' },
};

/**
 * Extract #name value from table block content.
 * Returns { name, content } where content is everything after #name.
 *
 * Supports both multiline and inline:
 *   #name Billing\nInvoices          → name="Billing", content="Invoices"
 *   #name Data Flows list items #end → name="Data Flows", content="list items"
 */
export function extractTableName(content) {
  const nameRe = /^#name\s+(.+?)(?:\r?\n|$)/i;
  const match = content.match(nameRe);
  if (match) {
    let name = match[1].trim();
    let remaining = content.slice(match[0].length).trim();

    // Inline case: no newline after #name and nothing remains.
    // Take first 1–2 words as the name; the rest becomes content.
    if (!remaining && !content.includes('\n')) {
      const words = name.split(/\s+/);
      if (words.length > 1) {
        // Heuristic: if second word is lowercase, treat first word as name.
        // Otherwise use first two words.
        const secondLower = /^[a-z]/.test(words[1]);
        const splitAt = secondLower ? 1 : 2;
        remaining = words.slice(splitAt).join(' ');
        name = words.slice(0, splitAt).join(' ');
      }
    }

    return { name, content: remaining };
  }
  return { content };
}

export function parseSectionDirectives(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus = {};
  let firstDirectiveContent = null;
  let anyDirectiveFound = false;

  // Block style: #directive ...content... #end
  // Content may start on the same line as the keyword or on the next line.
  const blockRe = /#(graph|table|narrative)\b\s*([\s\S]*?)(?:\r?\n)?#end\b/gi;
  let blockMatch;
  let blockStripped = rawQuery;
  while ((blockMatch = blockRe.exec(rawQuery)) !== null) {
    const key = blockMatch[1].toLowerCase();
    const content = blockMatch[2].trim();
    anyDirectiveFound = true;

    if (content) {
      if (firstDirectiveContent === null) {
        firstDirectiveContent = content;
      }

      const config = SECTION_DIRECTIVE_CONFIG[key] || { cardinality: 'single', merge: 'override' };
      if (config.cardinality === 'multiple') {
        // table: collect as TableDirective objects
        if (!focus[key]) focus[key] = [];
        focus[key].push(extractTableName(content));
      } else {
        // single
        if (config.merge === 'concat' && focus[key]) {
          focus[key] = focus[key] + '\n' + content;
        } else {
          focus[key] = content;
        }
      }
    }
    blockStripped = blockStripped.replace(blockMatch[0], '');
  }

  const remainingText = blockStripped.replace(/\s+/g, ' ').trim();

  // Implicit narrative: loose text outside directives becomes narrative focus
  // ONLY when no explicit directives are present. This makes plain queries
  // produce narrative-only output, while any directive suppresses implicit
  // narrative so the user controls output shape explicitly.
  if (remainingText && !focus.narrative && !anyDirectiveFound) {
    focus.narrative = remainingText;
  }

  // Topic fallback: if no loose text remains after stripping directives,
  // promote the first directive's content as the topic so ARCHITXT_TOPIC
  // is never empty.
  const intentText = remainingText || firstDirectiveContent || '';

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}
