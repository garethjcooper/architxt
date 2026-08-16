/**
 * Architxt Query Language (AQL) parser.
 *
 * Shared source of truth for both server and UI. Parses a compact line-based
 * query syntax with block directives (#graph, #table, #diagram, #narrative),
 * sub-directives (#name, #type), terminator (#end), and entity/edge references
 * [[Label (type:id)]] / [[src — label → target]].
 */

export const BLOCK_DIRECTIVES = Object.freeze([
  'graph',
  'table',
  'diagram',
  'narrative',
]);

export const SUB_DIRECTIVE_KEYS = Object.freeze([
  'name',
  'type',
  'end',
]);

export const MERMAID_DIAGRAM_TYPES = Object.freeze([
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

export const ALLOWED_KEYS_BY_BLOCK = Object.freeze({
  graph: new Set(),
  narrative: new Set(),
  table: new Set(['name']),
  diagram: new Set(['name', 'type']),
});

/**
 * @typedef {Object} ParseError
 * @property {string} message
 * @property {number} line
 */

/**
 * @typedef {Object} Reference
 * @property {'entity'|'edge'} kind
 * @property {string} raw
 * @property {string} [id]
 * @property {string} [type]
 * @property {string} [label]
 * @property {string} [from]
 * @property {string} [to]
 * @property {string} [edgeLabel]
 */

/**
 * @typedef {Object} Block
 * @property {'graph'|'table'|'diagram'|'narrative'} kind
 * @property {string} body
 * @property {Reference[]} bodyReferences
 * @property {string} [name]
 * @property {string} [type]
 */

/**
 * @typedef {Object} AqlQuery
 * @property {string} intentText
 * @property {Reference[]} references
 * @property {Block[]} blocks
 * @property {ParseError[]} [errors]
 */

/**
 * Convert parsed AQL blocks into the legacy section-focus shape used by the server
 * prompt templates and the UI API callers.
 *
 *   graph     -> string (concatenated bodies)
 *   narrative -> string (concatenated bodies)
 *   table     -> Array<{name?, content}>
 *   diagram   -> Array<{name?, type, content}>
 *
 * If the query has no directives and only plain text, it is returned as an
 * implicit narrative (matching the old behavior).
 */
export function toSectionFocus(aqlQuery) {
  const { intentText, blocks, errors } = aqlQuery;
  if (errors?.length) {
    return { intentText, sectionFocus: {} };
  }
  if (blocks.length === 0) {
    return intentText ? { intentText, sectionFocus: { narrative: intentText } } : { intentText: '' };
  }

  const sectionFocus = {};
  const topicCandidates = [];

  for (const block of blocks) {
    const { kind, name, type, body } = block;
    if (kind === 'graph' || kind === 'narrative') {
      if (sectionFocus[kind]) {
        sectionFocus[kind] = sectionFocus[kind] + (body ? '\n' + body : '');
      } else {
        sectionFocus[kind] = body;
      }
      if (body) topicCandidates.push(body);
      continue;
    }

    if (kind === 'table') {
      if (!sectionFocus.table) sectionFocus.table = [];
      sectionFocus.table.push({ name, content: body });
      topicCandidates.push(name || 'Table');
      continue;
    }

    if (kind === 'diagram') {
      if (!sectionFocus.diagram) sectionFocus.diagram = [];
      sectionFocus.diagram.push({ name, type, content: body });
      if (name && type) topicCandidates.push(`${name} (${type})`);
      else if (name) topicCandidates.push(name);
      else if (type) topicCandidates.push(`Diagram (${type})`);
      else topicCandidates.push('Diagram');
    }
  }

  const effectiveIntent = intentText || topicCandidates[0] || '';

  return {
    intentText: effectiveIntent,
    sectionFocus,
  };
}

export function formatEntityToken(label, id, type) {
  const qualified = type && !id.startsWith(`${type}:`) ? `${type}:${id}` : id;
  return `[[${label} (${qualified})]]`;
}

export function formatEdgeToken(source, target, label) {
  return `[[${source} — ${label} → ${target}]]`;
}

/**
 * @param {string} rawId
 * @returns {{ type: string|null, id: string }}
 */
function parseQualifiedId(rawId) {
  const colonIdx = rawId.indexOf(':');
  if (colonIdx > 0) {
    return { type: rawId.slice(0, colonIdx), id: rawId.slice(colonIdx + 1) };
  }
  return { type: null, id: rawId };
}

/**
 * @param {string} valueText
 * @returns {string}
 */
function parseValue(valueText) {
  const v = valueText.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

/**
 * Find entity references in text.
 *
 * @param {string} text
 * @returns {Reference[]}
 */
export function parseEntityReferences(text) {
  const references = [];
  const entityRe = /\[\[([^\[\]]+?)(?:\s*\(([^\)]+?)\))?\]\]/g;
  for (const match of text.matchAll(entityRe)) {
    const inner = match[0].slice(2, -2);
    const parenIdx = inner.lastIndexOf('(');
    const label = inner.slice(0, parenIdx > 0 ? parenIdx : inner.length).trim();
    const rawId = parenIdx > 0 ? inner.slice(parenIdx + 1, -1).trim() : '';
    const { id, type } = rawId ? parseQualifiedId(rawId) : { id: label, type: null };
    references.push({
      kind: 'entity',
      raw: match[0],
      id,
      type,
      label,
    });
  }
  return references;
}

/**
 * Find edge references in text.
 *
 * @param {string} text
 * @returns {Reference[]}
 */
export function parseEdgeReferences(text) {
  const references = [];
  const edgeRe = /\[\[[^\[\]—]+?\s*—\s*[^\[\]—→]+?\s*→\s*[^\[\]]+?\]\]/g;
  for (const match of text.matchAll(edgeRe)) {
    const inner = match[0].slice(2, -2);
    const parts = inner.split(/\s*—\s*|\s*→\s*/);
    if (parts.length >= 3) {
      const from = parts[0].trim();
      const edgeLabel = parts[1].trim();
      const to = parts.slice(2).join(' → ').trim();
      references.push({
        kind: 'edge',
        raw: match[0],
        from,
        to,
        edgeLabel,
      });
    }
  }
  return references;
}

/**
 * Find all references in text.
 *
 * @param {string} text
 * @returns {Reference[]}
 */
export function parseReferences(text) {
  return [...parseEntityReferences(text), ...parseEdgeReferences(text)];
}

/**
 * Strip reference markup, leaving only the human-readable label.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripReferences(text) {
  return text
    .replace(/\[\[([^\[\]]+?)\s*\([^\)]+?\)\]\]/g, '$1')
    .replace(/\[\[([^\[\]—]+?)\s*—\s*([^\[\]—→]+?)\s*→\s*([^\[\]]+?)\]\]/g, '$1 — $2 → $3');
}

/**
 * @param {string} line
 * @returns {{ keyword: string, value: string, raw: string, lineStartOffset: number }|null}
 */
function matchDirectiveLine(line) {
  const m = line.match(/^([ \t]*)(#([a-zA-Z][a-zA-Z0-9_-]*))(?:[ \t]+([^\n]*?))?[ \t]*$/);
  if (!m) return null;
  return {
    raw: m[0],
    keyword: m[3].toLowerCase(),
    value: m[4] || '',
    lineStartOffset: m[1].length,
  };
}

/**
 * Parse an AQL query string.
 *
 * @param {string} rawQuery
 * @returns {AqlQuery}
 */
export function parseAql(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '', references: [], blocks: [] };
  }

  const errors = [];
  const blocks = [];
  const strippedLines = [];
  const lines = rawQuery.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blockStack = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      strippedLines.push('');
      continue;
    }

    const directive = matchDirectiveLine(rawLine);
    if (!directive) {
      if (blockStack.length > 0) {
        blockStack[blockStack.length - 1].bodyLines.push(rawLine);
      } else {
        strippedLines.push(rawLine);
      }
      continue;
    }

    const { keyword, value } = directive;

    if (keyword === 'end') {
      if (blockStack.length === 0) {
        errors.push({ message: 'No opening directive for #end', line: lineNum });
      } else {
        blocks.push(blockStack.pop());
      }
      continue;
    }

    if (BLOCK_DIRECTIVES.includes(keyword)) {
      blockStack.push({
        kind: keyword,
        name: undefined,
        type: undefined,
        bodyLines: [],
        startLine: lineNum,
      });
      continue;
    }

    if (SUB_DIRECTIVE_KEYS.includes(keyword)) {
      if (blockStack.length === 0) {
        errors.push({ message: `Sub-directive #${keyword} appears outside a block`, line: lineNum });
        continue;
      }
      const current = blockStack[blockStack.length - 1];
      const allowed = ALLOWED_KEYS_BY_BLOCK[current.kind];
      if (!allowed || !allowed.has(keyword)) {
        errors.push({ message: `#${keyword} is not allowed in #${current.kind} block`, line: lineNum });
        continue;
      }

      const parsedValue = parseValue(value);

      if (keyword === 'type' && parsedValue && !MERMAID_DIAGRAM_TYPES.includes(parsedValue)) {
        errors.push({ message: `Unknown diagram type '${parsedValue}'`, line: lineNum });
      }

      current[keyword] = parsedValue;
      continue;
    }

    // Any other #word is an error, even inside a block body.
    errors.push({ message: `Unknown directive #${keyword}`, line: lineNum });
  }

  for (const open of blockStack) {
    errors.push({
      message: `Unclosed #${open.kind} block (started on line ${open.startLine})`,
      line: open.startLine,
    });
  }

  const builtBlocks = blocks.map((b) => {
    const body = b.bodyLines.join('\n').trim();
    const refs = parseReferences(body);
    return {
      kind: b.kind,
      name: b.name,
      type: b.type,
      body,
      bodyReferences: refs,
    };
  });

  const remainingText = strippedLines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const allReferences = parseReferences(rawQuery);
  const intentText = remainingText;

  return errors.length > 0
    ? { intentText, references: allReferences, blocks: builtBlocks, errors }
    : { intentText, references: allReferences, blocks: builtBlocks };
}

/**
 * Render directives and references for syntax highlighting.
 * Returns a list of spans with kind, text and metadata. This is deliberately
 * DOM-agnostic so it can be consumed by the React editor or a server renderer.
 *
 * @param {string} query
 * @returns {Array<{ kind: 'directive'|'reference'|'text', text: string, keyword?: string, value?: string, reference?: Reference }>}
 */
export function renderAqlTokens(query) {
  if (!query) return [];
  const tokens = [];
  let lastIndex = 0;
  const allReferences = parseReferences(query);
  const refsByIndex = new Map(allReferences.map((r) => [query.indexOf(r.raw), r]));
  const directiveRe = /(^|[\n])([ \t]*)(#[a-zA-Z][a-zA-Z0-9_-]*)(?:[ \t]+([^\n]*?))?[ \t]*(?=[\n]|$)/g;

  for (const match of query.matchAll(directiveRe)) {
    const matchStart = (match.index ?? 0) + match[1].length;
    const leadingWhitespace = match[2];
    const keywordText = match[3];
    const valueText = match[4] || '';
    const raw = leadingWhitespace + keywordText + (valueText ? ' ' + valueText : '');

    if (matchStart > lastIndex) {
      tokens.push({ kind: 'text', text: query.slice(lastIndex, matchStart) });
    }

    const keyword = keywordText.slice(1).toLowerCase();
    tokens.push({
      kind: 'directive',
      text: raw,
      keyword,
      value: parseValue(valueText),
    });
    lastIndex = matchStart + raw.length;
  }

  if (lastIndex < query.length) {
    tokens.push({ kind: 'text', text: query.slice(lastIndex) });
  }

  return tokens;
}
