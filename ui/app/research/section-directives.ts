/**
 * Parse section-focus directives from a user query.
 *
 * Supported syntax (block style ONLY):
 *   #graph
 *   CRM, ERP
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
 */

export const SECTION_DIRECTIVE_CONFIG: Record<string, {
  cardinality: 'single' | 'multiple';
  merge?: 'concat' | 'override';
}> = {
  graph:     { cardinality: 'single', merge: 'concat' },
  table:     { cardinality: 'multiple' },
  narrative: { cardinality: 'single', merge: 'concat' },
};

export function parseSectionDirectives(rawQuery: string): {
  intentText: string;
  sectionFocus?: Record<string, string | string[]>;
} {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus: Record<string, string | string[]> = {};

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
        if (!focus[key]) focus[key] = [];
        (focus[key] as string[]).push(content);
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

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}
