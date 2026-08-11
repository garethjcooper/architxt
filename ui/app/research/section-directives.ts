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
 */
export function parseSectionDirectives(rawQuery: string): {
  intentText: string;
  sectionFocus?: Record<string, string>;
} {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus: Record<string, string> = {};

  // Block style: #directive\n...content...\n#end
  const blockRe = /#(graph|table|narrative)\s*(?:\n|\r\n?)([\s\S]*?)(?:\r?\n)?#end\b/gi;
  let blockMatch: RegExpExecArray | null;
  let blockStripped = rawQuery;
  while ((blockMatch = blockRe.exec(rawQuery)) !== null) {
    const key = blockMatch[1].toLowerCase();
    const content = blockMatch[2].trim();
    if (content) focus[key] = content;
    blockStripped = blockStripped.replace(blockMatch[0], '');
  }

  // Inline style: #directive: content
  const inlineRe = /#(graph|table|narrative):\s*(.+?)(?:\r?\n|$)/gi;
  let inlineMatch: RegExpExecArray | null;
  let inlineStripped = blockStripped;
  while ((inlineMatch = inlineRe.exec(blockStripped)) !== null) {
    const key = inlineMatch[1].toLowerCase();
    const content = inlineMatch[2].trim();
    if (content) focus[key] = content;
    inlineStripped = inlineStripped.replace(inlineMatch[0], '');
  }

  const intentText = inlineStripped.replace(/\s+/g, ' ').trim();

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}
