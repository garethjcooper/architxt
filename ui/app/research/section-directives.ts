/**
 * Parse section-focus directives from a user query.
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
 *   #table
 *   capabilities
 *   #end
 *
 *   #narrative
 *   business impact
 *   #end
 *
 * Directives must be explicitly closed with #end. No inline colon syntax.
 * Multiple blocks of the same type are collected according to cardinality
 * rules in SECTION_DIRECTIVE_CONFIG.
 *
 * Table blocks may optionally contain a #name sub-directive on its own line.
 * If omitted, the LLM should generate a short name (4–6 words) from the content.
 */

export const SECTION_DIRECTIVE_CONFIG: Record<string, {
  cardinality: 'single' | 'multiple';
  merge?: 'concat' | 'override';
}> = {
  topic:     { cardinality: 'single', merge: 'concat' },
  graph:     { cardinality: 'single', merge: 'concat' },
  table:     { cardinality: 'multiple' },
  narrative: { cardinality: 'single', merge: 'concat' },
};

export interface TableDirective {
  /** Explicit name from #name sub-directive, or omitted so LLM generates one */
  name?: string;
  /** Remaining content after #name (or entire content if no #name) */
  content: string;
}

export interface ParsedSectionFocus {
  intentText: string;
  sectionFocus?: Record<string, string | string[] | TableDirective[]>;
}

/**
 * Extract #name value from the first line of a table block content.
 * Returns { name, content } where content is everything after #name.
 */
function extractTableName(content: string): TableDirective {
  const nameRe = /^#name\s+(.+?)(?:\r?\n|$)/i;
  const match = content.match(nameRe);
  if (match) {
    const name = match[1].trim();
    const remaining = content.slice(match[0].length).trim();
    return { name, content: remaining };
  }
  return { content };
}

export function parseSectionDirectives(rawQuery: string): ParsedSectionFocus {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus: Record<string, string | string[] | TableDirective[]> = {};

  // Block style ONLY: #directive\n...content...\n#end
  const blockRe = /#(graph|table|narrative)\s*(?:\n|\r\n?)([\s\S]*?)(?:\r?\n)?#end\b/gi;
  let blockMatch: RegExpExecArray | null;
  let blockStripped = rawQuery;
  while ((blockMatch = blockRe.exec(rawQuery)) !== null) {
    const key = blockMatch[1].toLowerCase();
    const content = blockMatch[2].trim();
    if (content) {
      const config = SECTION_DIRECTIVE_CONFIG[key] || { cardinality: 'single', merge: 'override' };
      if (config.cardinality === 'multiple') {
        // table: collect as TableDirective objects
        if (!focus[key]) focus[key] = [];
        (focus[key] as TableDirective[]).push(extractTableName(content));
      } else {
        // single
        if (config.merge === 'concat' && focus[key]) {
          focus[key] = (focus[key] as string) + '\n' + content;
        } else {
          focus[key] = content;
        }
      }
    }
    blockStripped = blockStripped.replace(blockMatch[0], '');
  }

  const intentText = blockStripped.replace(/\s+/g, ' ').trim();

  // Implicit narrative: loose text outside directives becomes narrative focus
  // when no explicit #topic or #narrative is present.
  if (intentText && !focus.narrative) {
    focus.narrative = intentText;
  }

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}
