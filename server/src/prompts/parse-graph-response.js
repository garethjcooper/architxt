import { createLogger } from '../utils/logger.js';
import { parseJsonString } from './graph-parser.js';

const logger = createLogger('parse-graph-response');

// Match the canonical heading while tolerating common Unicode dashes that
// LLMs substitute for the ASCII hyphen (U+002D), e.g. non-breaking hyphen
// U+2011, en dash U+2013, em dash U+2014, minus sign U+2212.
const DASH_CLASS = '[-\u2011\u2013\u2014\u2212]';
const GRAPH_DATA_HEADING_RE = new RegExp(`^(#{1,6}\\s*)?ARCHITXT${DASH_CLASS}GRAPH${DASH_CLASS}DATA\\s*$`, 'im');

/**
 * Parse a response that uses the universal Architxt graph output format.
 *
 * @param {string|object|null} raw
 * @param {object} [options]
 * @param {string} [options.mode='narrative-graph-known'] - Template mode; used only for logging warnings when graph section is missing.
 * @param {boolean} [options.expectGraph=true] - If true, log a warning when the graph section is missing.
 * @param {string} [options.defaultSource='llm'] - Source value to set on nodes that do not already specify one.
 * @returns {{ narrative: string, graph: { nodes: object[], edges: object[] }, error?: string }}
 */
export function parseGraphResponse(raw, { mode = 'narrative-graph-known', expectGraph = true, defaultSource = 'llm' } = {}) {
  if (raw === null || raw === undefined) {
    return { narrative: '', graph: { nodes: [], edges: [] } };
  }

  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else {
    logger.warn('Graph response must be a string', { type: typeof raw });
    return { narrative: '', graph: { nodes: [], edges: [] } };
  }

  const trimmed = text.trim();
  if (trimmed === '') {
    return { narrative: '', graph: { nodes: [], edges: [] } };
  }

  const match = trimmed.match(GRAPH_DATA_HEADING_RE);
  let narrative = trimmed;
  let graphJson = null;

  if (match && match.index !== undefined) {
    // Find the last occurrence of the heading.
    let lastIndex = match.index;
    let rest = trimmed.slice(lastIndex + match[0].length);
    let nextMatch;
    while ((nextMatch = rest.match(GRAPH_DATA_HEADING_RE)) !== null) {
      lastIndex = lastIndex + match[0].length + nextMatch.index;
      rest = rest.slice(nextMatch.index + nextMatch[0].length);
    }

    narrative = trimmed.slice(0, lastIndex).trim();
    const afterHeading = trimmed.slice(lastIndex + match[0].length).trim();
    graphJson = afterHeading;
  } else if (expectGraph) {
    // No heading found: the entire response may be bare graph JSON (common for
    // stored mental-model content). Try to parse the whole text as graph JSON.
    graphJson = trimmed;
  } else {
    narrative = trimmed;
  }

  const graph = parseGraphJson(graphJson, defaultSource);
  if (!graph) {
    return {
      narrative,
      graph: { nodes: [], edges: [] },
      error: expectGraph ? 'Graph section found but contained no usable nodes or edges.' : null,
    };
  }

  return {
    narrative,
    graph,
    error: null,
  };
}

function parseGraphJson(text, defaultSource) {
  if (!text || typeof text !== 'string') return null;
  const jsonText = extractFirstJson(stripOuterCodeFences(text));
  if (!jsonText) return null;
  const parsed = parseJsonString(jsonText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const nodes = (Array.isArray(parsed.nodes) ? parsed.nodes : [])
    .map((n) => normalizeGraphNode(n, defaultSource))
    .filter(Boolean);
  const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
  // A valid graph response may legitimately have zero nodes and zero edges.
  // Treat any object with the canonical graph shape as a graph, even when empty.
  if (!Array.isArray(parsed.nodes) && !Array.isArray(parsed.edges)) return null;
  return { nodes, edges };
}

const OUTER_FENCE_RE = /^```(?:markdown|json)?\s*\n?([\s\S]*?)\n?```\s*$/;

function stripOuterCodeFences(text) {
  const trimmed = text.trim();
  const match = trimmed.match(OUTER_FENCE_RE);
  return match ? match[1].trim() : trimmed;
}

function normalizeGraphNode(n, defaultSource) {
  if (!n || typeof n !== 'object') return null;
  const id = typeof n.id === 'string' && n.id.length > 0 ? n.id : null;
  if (!id) return null;
  const name = typeof n.name === 'string' && n.name.length > 0 ? n.name : null;
  if (!name) return null;
  return {
    id,
    name,
    label: typeof n.label === 'string' ? n.label : undefined,
    type: typeof n.type === 'string' ? n.type : undefined,
    provenance: typeof n.provenance === 'string' ? n.provenance : undefined,
    source: typeof n.source === 'string' ? n.source : defaultSource,
  };
}

function extractFirstJson(text) {
  // Try to find the first top-level { or [ and balance braces/brackets.
  const startMatch = text.match(/[\{\[]/);
  if (!startMatch) return null;
  const start = startMatch.index;
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') {
      stack.push(ch);
    } else if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return null;
      if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) return null;
      if (stack.length === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Convenience: parse a graph-only response.
 * @param {string|object|null} raw
 * @returns {{ narrative: string, graph: { nodes: object[], edges: object[] } }}
 */
export function parseGraphOnlyResponse(raw) {
  return parseGraphResponse(raw, { mode: 'graph-known', expectGraph: true });
}
