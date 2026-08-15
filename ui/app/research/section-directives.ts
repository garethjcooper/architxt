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
  graph:     { cardinality: 'single', merge: 'concat' },
  table:     { cardinality: 'multiple' },
  diagram:   { cardinality: 'multiple' },
  narrative: { cardinality: 'single', merge: 'concat' },
};

export interface TableDirective {
  /** Explicit name from #name sub-directive, or omitted so LLM generates one */
  name?: string;
  /** Remaining content after #name (or entire content if no #name) */
  content: string;
}

export interface DiagramDirective {
  /** Explicit name from #name sub-directive */
  name?: string;
  /** Mermaid diagram type from #type sub-directive (e.g. sequenceDiagram) */
  type?: string;
  /** Remaining Mermaid source after #name/#type */
  content: string;
}

export interface ParsedSectionFocus {
  intentText: string;
  sectionFocus?: Record<string, string | string[] | TableDirective[] | DiagramDirective[]>;
}

/**
 * Extract #name and #type values from a diagram block.
 * Returns { name, type, content } where content is the remaining Mermaid body.
 */
function extractDiagramAttributes(content: string): DiagramDirective {
  const text = content.trim();

  // Parse #name value, stopping at the next line break or the #type keyword.
  let pos = 0;
  if (text.startsWith('#name')) {
    pos = 5;
    while (pos < text.length && /\s/.test(text[pos])) pos += 1;
  }
  if (pos === 0) return { content: text };

  let nameEnd = text.indexOf('\n', pos);
  let typeStart = text.indexOf('#type', pos);
  if (typeStart !== -1 && (nameEnd === -1 || typeStart < nameEnd)) {
    nameEnd = typeStart;
  }
  if (nameEnd === -1) nameEnd = text.length;

  const name = text.slice(pos, nameEnd).trim();
  pos = nameEnd;
  while (pos < text.length && /\s/.test(text[pos])) pos += 1;

  // Parse #type value if present.
  let type: string | undefined;
  if (text.slice(pos).startsWith('#type')) {
    pos += 5;
    while (pos < text.length && /\s/.test(text[pos])) pos += 1;
    const typeEnd = text.indexOf('\n', pos);
    type = text.slice(pos, typeEnd === -1 ? text.length : typeEnd).trim();
    pos = typeEnd === -1 ? text.length : typeEnd;
    while (pos < text.length && /\s/.test(text[pos])) pos += 1;
  }

  return { name, type, content: text.slice(pos).trim() };
}

/**
 * Extract #name value from table block content.
 * Returns { name, content } where content is everything after #name.
 *
 * Supports both multiline and inline:
 *   #name Billing\nInvoices          → name="Billing", content="Invoices"
 *   #name Data Flows list items #end → name="Data Flows", content="list items"
 */
function extractTableName(content: string): TableDirective {
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

export function parseSectionDirectives(rawQuery: string): ParsedSectionFocus {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus: Record<string, string | string[] | TableDirective[]> = {};
  let firstDirectiveContent: string | null = null;
  let anyDirectiveFound = false;

  // Block style: #directive ...content... #end
  // Content may start on the same line as the keyword or on the next line.
  const blockRe = /#(graph|table|diagram|narrative)\b\s*([\s\S]*?)(?:\r?\n)?#end\b/gi;
  let blockMatch: RegExpExecArray | null;
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
        // table/diagram: collect as directive objects
        if (!focus[key]) focus[key] = [];
        if (key === 'diagram') {
          (focus[key] as DiagramDirective[]).push(extractDiagramAttributes(content));
        } else {
          (focus[key] as TableDirective[]).push(extractTableName(content));
        }
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
