/**
 * Parse section-focus directives from a user query.
 *
 * Supported syntax (block style, line-based):
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
 *   #diagram
 *   #name Entity lifecycle
 *   #type sequenceDiagram
 *   Alice->>Bob: Hello
 *   #end
 *
 *   #narrative
 *   business impact
 *   #end
 *
 * Each block must start on its own line with a directive keyword and end on its
 * own line with #end. Sub-directives (#name, #type) must also start on their own
 * line. Multiple blocks of the same type are collected according to cardinality
 * rules in SECTION_DIRECTIVE_CONFIG.
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

/** Check whether a trimmed line is one of the block directive keywords. */
function matchDirectiveLine(line: string): string | null {
  const m = line.match(/^#(graph|table|diagram|narrative)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function matchSubDirective(line: string): { key: string; value: string } | null {
  const m = line.match(/^#(name|type)\s+(.*)$/i);
  if (!m) return null;
  const value = m[2].trim();
  if (!value) return null;
  return { key: m[1].toLowerCase(), value };
}

function matchEndLine(line: string): boolean {
  return /^#end\b/i.test(line);
}

function deriveTopicFromDirective(directive: TableDirective | DiagramDirective, kind: 'table' | 'diagram'): string {
  if (kind === 'diagram') {
    const d = directive as DiagramDirective;
    if (d.name && d.type) return `${d.name} (${d.type})`;
    if (d.name) return d.name;
    if (d.type) return `Diagram (${d.type})`;
    return 'Diagram';
  }
  const t = directive as TableDirective;
  return t.name || 'Table';
}

export function parseSectionDirectives(rawQuery: string): ParsedSectionFocus {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus: Record<string, string | string[] | TableDirective[]> = {};
  const strippedLines: string[] = [];
  const topicCandidates: string[] = [];
  const lines = rawQuery.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    const directive = matchDirectiveLine(trimmed);

    if (!directive) {
      strippedLines.push(lines[i]);
      i += 1;
      continue;
    }

    // Consume block from #directive to matching #end.
    const blockStart = i;
    i += 1;
    let name: string | undefined;
    let type: string | undefined;
    const bodyLines: string[] = [];
    let closed = false;

    while (i < lines.length) {
      const lineTrimmed = lines[i].trim();
      if (matchEndLine(lineTrimmed)) {
        closed = true;
        i += 1;
        break;
      }

      const sub = matchSubDirective(lineTrimmed);
      if (sub) {
        if (sub.key === 'name') name = sub.value;
        if (sub.key === 'type') type = sub.value;
      } else {
        bodyLines.push(lines[i]);
      }
      i += 1;
    }

    if (!closed) {
      // Unclosed directive: treat original lines as loose text and continue.
      strippedLines.push(...lines.slice(blockStart, i));
      continue;
    }

    const body = bodyLines.join('\n').trim();
    const config = SECTION_DIRECTIVE_CONFIG[directive] || { cardinality: 'single', merge: 'override' };

    if (config.cardinality === 'multiple') {
      if (!focus[directive]) focus[directive] = [];
      if (directive === 'diagram') {
        const d: DiagramDirective = { name, type, content: body };
        (focus[directive] as DiagramDirective[]).push(d);
        topicCandidates.push(deriveTopicFromDirective(d, 'diagram'));
      } else {
        const t: TableDirective = { name, content: body };
        (focus[directive] as TableDirective[]).push(t);
        topicCandidates.push(deriveTopicFromDirective(t, 'table'));
      }
    } else {
      if (config.merge === 'concat' && focus[directive]) {
        focus[directive] = (focus[directive] as string) + (body ? '\n' + body : '');
      } else {
        focus[directive] = body;
      }
      if (body) topicCandidates.push(body);
    }
  }

  const remainingText = strippedLines
    .map(l => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Implicit narrative only for plain queries with no directives at all.
  if (remainingText && Object.keys(focus).length === 0) {
    focus.narrative = remainingText;
  }

  // Topic: external text wins; otherwise derive a concise topic from the first
  // directive block so the API never receives an empty intent_text.
  const intentText = remainingText || topicCandidates[0] || '';

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}
