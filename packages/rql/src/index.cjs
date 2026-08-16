/**
 * CommonJS build of @architxt/rql.
 * Generated mirror of src/index.js for require() consumers.
 */

'use strict';

const BLOCK_DIRECTIVES = new Set(['graph', 'table', 'diagram', 'narrative']);
const SUB_DIRECTIVE_KEYS = new Set(['name', 'type', 'end']);
const MERMAID_DIAGRAM_TYPES = new Set([
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'mindmap', 'timeline',
  'gitGraph', 'architecture-beta', 'requirementDiagram', 'journey',
  'C4Context', 'C4Container', 'C4Component', 'C4Deployment',
]);
const ALLOWED_KEYS_BY_BLOCK = Object.freeze({
  graph: new Set(),
  narrative: new Set(),
  table: new Set(['name']),
  diagram: new Set(['name', 'type']),
});

function parseQualifiedId(rawId) {
  const colonIdx = rawId.indexOf(':');
  if (colonIdx > 0) return { type: rawId.slice(0, colonIdx), id: rawId.slice(colonIdx + 1) };
  return { type: null, id: rawId };
}

function parseValue(valueText) {
  const v = valueText.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return v.slice(1, -1);
  }
  return v;
}

function parseEntityReferences(text) {
  const references = [];
  const entityRe = /\[\[([^\[\]]+?)(?:\s*\(([^\)]+?)\))?\]\]/g;
  for (const match of text.matchAll(entityRe)) {
    const inner = match[0].slice(2, -2);
    const parenIdx = inner.lastIndexOf('(');
    const label = inner.slice(0, parenIdx > 0 ? parenIdx : inner.length).trim();
    const rawId = parenIdx > 0 ? inner.slice(parenIdx + 1, -1).trim() : '';
    const { id, type } = rawId ? parseQualifiedId(rawId) : { id: label, type: null };
    references.push({ kind: 'entity', raw: match[0], id, type, label });
  }
  return references;
}

function parseEdgeReferences(text) {
  const references = [];
  const edgeRe = /\[\[[^\[\]—]+?\s*—\s*[^\[\]—→]+?\s*→\s*[^\[\]]+?\]\]/g;
  for (const match of text.matchAll(edgeRe)) {
    const inner = match[0].slice(2, -2);
    const parts = inner.split(/\s*—\s*|\s*→\s*/);
    if (parts.length >= 3) {
      const from = parts[0].trim();
      const edgeLabel = parts[1].trim();
      const to = parts.slice(2).join(' → ').trim();
      references.push({ kind: 'edge', raw: match[0], from, to, edgeLabel });
    }
  }
  return references;
}

function parseReferences(text) {
  return [...parseEntityReferences(text), ...parseEdgeReferences(text)];
}

function stripReferences(text) {
  return text
    .replace(/\[\[([^\[\]]+?)\s*\([^\)]+?\)\]\]/g, '$1')
    .replace(/\[\[([^\[\]—]+?)\s*—\s*([^\[\]—→]+?)\s*→\s*([^\[\]]+?)\]\]/g, '$1 — $2 → $3');
}

function matchDirectiveLine(line) {
  const m = line.match(/^([ \t]*)(#([a-zA-Z][a-zA-Z0-9_-]*))(?:[ \t]+([^\n]*?))?[ \t]*$/);
  if (!m) return null;
  return { raw: m[0], keyword: m[3].toLowerCase(), value: m[4] || '', lineStartOffset: m[1].length };
}

function parseRql(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { intentText: '', references: [], blocks: [] };
  }

  const errors = [];
  const blocks = [];
  const strippedLines = [];
  const topicCandidates = [];
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
      strippedLines.push(rawLine);
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

    if (BLOCK_DIRECTIVES.has(keyword)) {
      blockStack.push({ kind: keyword, name: undefined, type: undefined, bodyLines: [], startLine: lineNum });
      continue;
    }

    if (SUB_DIRECTIVE_KEYS.has(keyword)) {
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
      if (keyword === 'type' && parsedValue && !MERMAID_DIAGRAM_TYPES.has(parsedValue)) {
        errors.push({ message: `Unknown diagram type '${parsedValue}'`, line: lineNum });
      }
      current[keyword] = parsedValue;
      continue;
    }

    errors.push({ message: `Unknown directive #${keyword}`, line: lineNum });
  }

  for (const open of blockStack) {
    errors.push({ message: `Unclosed #${open.kind} block (started on line ${open.startLine})`, line: open.startLine });
    strippedLines.push(...lines.slice(open.startLine - 1));
  }

  const builtBlocks = blocks.map((b) => {
    const body = b.bodyLines.join('\n').trim();
    const refs = parseReferences(body);
    return { kind: b.kind, name: b.name, type: b.type, body, bodyReferences: refs };
  });

  const remainingText = strippedLines.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const intentText = remainingText || topicCandidates[0] || '';
  const allReferences = parseReferences(rawQuery);

  return errors.length > 0
    ? { intentText, references: allReferences, blocks: builtBlocks, errors }
    : { intentText, references: allReferences, blocks: builtBlocks };
}

function renderRqlTokens(query) {
  if (!query) return [];
  const tokens = [];
  let lastIndex = 0;
  const allReferences = parseReferences(query);
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
    tokens.push({ kind: 'directive', text: raw, keyword: keywordText.slice(1).toLowerCase(), value: parseValue(valueText) });
    lastIndex = matchStart + raw.length;
  }

  if (lastIndex < query.length) {
    tokens.push({ kind: 'text', text: query.slice(lastIndex) });
  }

  return tokens;
}

module.exports = {
  BLOCK_DIRECTIVES,
  SUB_DIRECTIVE_KEYS,
  MERMAID_DIAGRAM_TYPES,
  ALLOWED_KEYS_BY_BLOCK,
  parseEntityReferences,
  parseEdgeReferences,
  parseReferences,
  stripReferences,
  parseRql,
  renderRqlTokens,
};
