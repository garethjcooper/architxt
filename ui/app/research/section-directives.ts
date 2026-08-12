/**
 * Parse section-focus directives from a user query.
 *
 * Supported syntax:
 *   Block style:
 *     #graph
 *     CRM, ERP
 *     #end
 *
 *   Inline style:
 *     #graph: CRM, ERP
 *
 * Recognised directives: #graph, #table, #narrative
 * Everything outside directives is preserved as clean query text.
 *
 * Cardinality rules (defined in SECTION_DIRECTIVE_CONFIG):
 *   - #graph    → single  (multiple blocks are concatenated)
 *   - #narrative → single (multiple blocks are concatenated)
 *   - #table    → multiple (each block becomes its own array entry)
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

  // Block style: #directive\n...content...\n#end
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

  // Inline style: #directive: content (stops before another directive, newline, or EOS)
  const inlineRe = /#(graph|table|narrative):\s*([^\r\n#]*?)(?=\s*#(?:graph|table|narrative):|\r?\n|$)/gi;
  let inlineMatch: RegExpExecArray | null;
  let inlineStripped = blockStripped;
  while ((inlineMatch = inlineRe.exec(blockStripped)) !== null) {
    const key = inlineMatch[1].toLowerCase();
    const content = inlineMatch[2].trim();
    if (content) {
      const config = SECTION_DIRECTIVE_CONFIG[key] || { cardinality: 'single', merge: 'override' };
      if (config.cardinality === 'multiple') {
        if (!focus[key]) focus[key] = [];
        (focus[key] as string[]).push(content);
      } else {
        if (config.merge === 'concat' && focus[key]) {
          focus[key] = (focus[key] as string) + '\n' + content;
        } else {
          focus[key] = content;
        }
      }
    }
    inlineStripped = inlineStripped.replace(inlineMatch[0], '');
  }

  const intentText = inlineStripped.replace(/\s+/g, ' ').trim();

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}
