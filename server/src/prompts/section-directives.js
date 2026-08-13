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
  topic:     { cardinality: 'single', merge: 'concat' },
  graph:     { cardinality: 'single', merge: 'concat' },
  table:     { cardinality: 'multiple' },
  narrative: { cardinality: 'single', merge: 'concat' },
};

export function extractTableName(content) {
  const nameRe = /^#name\s+(.+?)(?:\r?\n|$)/i;
  const match = content.match(nameRe);
  if (match) {
    const name = match[1].trim();
    const remaining = content.slice(match[0].length).trim();
    return { name, content: remaining };
  }
  return { content };
}

export function parseSectionDirectives(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus = {};
  let topicBlockContent = null;

  // Block style ONLY: #directive\n...content...\n#end
  const blockRe = /#(topic|graph|table|narrative)\s*(?:\n|\r\n?)([\s\S]*?)(?:\r?\n)?#end\b/gi;
  let blockMatch;
  let blockStripped = rawQuery;
  while ((blockMatch = blockRe.exec(rawQuery)) !== null) {
    const key = blockMatch[1].toLowerCase();
    const content = blockMatch[2].trim();

    if (key === 'topic') {
      if (content) {
        topicBlockContent = topicBlockContent
          ? topicBlockContent + '\n' + content
          : content;
      }
      blockStripped = blockStripped.replace(blockMatch[0], '');
      continue;
    }

    if (content) {
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

  // When #topic is explicit, its content is the intent text and any loose
  // text outside directives becomes narrative focus.
  if (topicBlockContent !== null) {
    if (remainingText) {
      if (focus.narrative) {
        focus.narrative = remainingText + '\n' + focus.narrative;
      } else {
        focus.narrative = remainingText;
      }
    }
    return Object.keys(focus).length > 0
      ? { intentText: topicBlockContent, sectionFocus: focus }
      : { intentText: topicBlockContent };
  }

  // Legacy behaviour: no #topic block, loose text is the intent.
  return Object.keys(focus).length > 0
    ? { intentText: remainingText, sectionFocus: focus }
    : { intentText: remainingText };
}
