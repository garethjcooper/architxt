/**
 * Parse section-focus directives from raw query text.
 *
 * Shared logic between frontend and backend. Returns parsed directives
 * plus the remaining intent text (query with directive blocks stripped).
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

export const SECTION_DIRECTIVE_CONFIG = {
  graph:     { cardinality: 'single', merge: 'concat' },
  table:     { cardinality: 'multiple' },
  diagram:   { cardinality: 'multiple' },
  narrative: { cardinality: 'single', merge: 'concat' },
};

/**
 * Supported Mermaid diagram types for #diagram directives.
 * This is the single source of truth for what #type values are accepted.
 */
export const VALID_MERMAID_DIAGRAM_TYPES = new Set([
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
  'architecture-beta',
  'requirementDiagram',
  'journey',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Deployment',
]);

function matchDirectiveLine(line) {
  const m = line.match(/^#(graph|table|diagram|narrative)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function matchSubDirective(line) {
  const m = line.match(/^#(name|type)\s+(.*)$/i);
  if (!m) return null;
  const value = m[2].trim();
  if (!value) return null;
  return { key: m[1].toLowerCase(), value };
}

function matchEndLine(line) {
  return /^#end\b/i.test(line);
}

function deriveTopicFromDirective(directive, kind) {
  if (kind === 'diagram') {
    if (directive.name && directive.type) return `${directive.name} (${directive.type})`;
    if (directive.name) return directive.name;
    if (directive.type) return `Diagram (${directive.type})`;
    return 'Diagram';
  }
  return directive.name || 'Table';
}

export function parseSectionDirectives(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '' };
  }

  const focus = {};
  const strippedLines = [];
  const topicCandidates = [];
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

    const blockStart = i;
    i += 1;
    let name;
    let type;
    const bodyLines = [];
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
      strippedLines.push(...lines.slice(blockStart, i));
      continue;
    }

    const body = bodyLines.join('\n').trim();
    const config = SECTION_DIRECTIVE_CONFIG[directive] || { cardinality: 'single', merge: 'override' };

    if (config.cardinality === 'multiple') {
      if (!focus[directive]) focus[directive] = [];
      if (directive === 'diagram') {
        const d = { name, type, content: body };
        focus[directive].push(d);
        topicCandidates.push(deriveTopicFromDirective(d, 'diagram'));
      } else {
        const t = { name, content: body };
        focus[directive].push(t);
        topicCandidates.push(deriveTopicFromDirective(t, 'table'));
      }
    } else {
      if (config.merge === 'concat' && focus[directive]) {
        focus[directive] = focus[directive] + (body ? '\n' + body : '');
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

  const intentText = remainingText || topicCandidates[0] || '';

  return Object.keys(focus).length > 0
    ? { intentText, sectionFocus: focus }
    : { intentText };
}
