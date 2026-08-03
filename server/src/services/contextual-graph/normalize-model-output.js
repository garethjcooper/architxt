import { createHash } from 'crypto';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('contextual-graph-normalize-model-output');

/**
 * Hash the raw generated content for change detection.
 * @param {string} text
 * @returns {string}
 */
export function contentHash(text) {
  return createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

/**
 * Extract the first balanced JSON object from a string.
 * Returns null if no balanced object is found.
 */
function extractFirstJson(text) {
  const startMatch = text.match(/[\\{\\[]/);
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
    if (ch === '\\\\') {
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

function stripOuterCodeFences(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|json)?\\s*\\n?([\\s\\S]*?)\\n?```\\s*$/);
  return match ? match[1].trim() : trimmed;
}

function normalizeNode(n) {
  if (!n || typeof n !== 'object') return null;
  const id = typeof n.id === 'string' && n.id.length > 0 ? n.id : null;
  const name = typeof n.name === 'string' && n.name.length > 0 ? n.name : null;
  if (!id || !name) return null;
  return {
    id,
    name,
    type: typeof n.type === 'string' ? n.type : undefined,
    provenance: typeof n.provenance === 'string' ? n.provenance : undefined,
  };
}

function normalizeEdge(e) {
  if (!e || typeof e !== 'object') return null;
  const from = typeof e.from === 'string' && e.from.length > 0 ? e.from : null;
  const to = typeof e.to === 'string' && e.to.length > 0 ? e.to : null;
  const type = typeof e.type === 'string' && e.type.length > 0 ? e.type : null;
  if (!from || !to || !type) return null;
  return {
    from,
    to,
    type,
    label: typeof e.label === 'string' ? e.label : undefined,
    detail: typeof e.detail === 'string' ? e.detail : undefined,
    evidence: Array.isArray(e.evidence) ? e.evidence : undefined,
  };
}

function normalizeTable(t) {
  if (!t || typeof t !== 'object') return null;
  const name = typeof t.name === 'string' && t.name.length > 0 ? t.name : null;
  const columns = Array.isArray(t.columns) ? t.columns.filter((c) => typeof c === 'string') : [];
  const rows = Array.isArray(t.rows) ? t.rows.filter((r) => r && typeof r === 'object') : [];
  if (!name) return null;
  return { name, columns, rows };
}

function dropIsolatedNodes(nodes, edges) {
  const endpointIds = new Set();
  for (const e of edges) {
    endpointIds.add(e.from);
    endpointIds.add(e.to);
  }
  return nodes.filter((n) => endpointIds.has(n.id));
}

/**
 * Parse and normalize a contextual-graph mental-model output envelope.
 *
 * @param {string|object|null} raw
 * @returns {{
 *   narrative: string,
 *   graph: { nodes: object[], edges: object[] },
 *   tables: object[],
 *   errors: string[],
 *   raw: string
 * }}
 */
export function normalizeModelOutput(raw) {
  const rawString = raw === null || raw === undefined ? '' : (typeof raw === 'string' ? raw : JSON.stringify(raw));
  const errors = [];

  if (rawString.trim() === '') {
    return { narrative: '', graph: { nodes: [], edges: [] }, tables: [], errors, raw: rawString };
  }

  let parsed = null;
  let jsonText = null;

  // 1. Try direct JSON.parse on the whole string.
  try {
    jsonText = stripOuterCodeFences(rawString);
    parsed = JSON.parse(jsonText);
  } catch {
    // 2. Fallback: extract the first balanced JSON object.
    const extracted = extractFirstJson(stripOuterCodeFences(rawString));
    if (extracted) {
      try {
        parsed = JSON.parse(extracted);
        jsonText = extracted;
      } catch (err) {
        errors.push(`Failed to parse extracted JSON: ${err.message}`);
      }
    }
    if (!parsed) {
      errors.push('Unable to parse JSON envelope from model output');
      return { narrative: '', graph: { nodes: [], edges: [] }, tables: [], errors, raw: rawString };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('Model output is not a JSON object');
    return { narrative: '', graph: { nodes: [], edges: [] }, tables: [], errors, raw: rawString };
  }

  // 3. Validate required top-level keys and fill defaults.
  const narrative = typeof parsed.narrative === 'string' ? parsed.narrative : '';
  if (!Object.prototype.hasOwnProperty.call(parsed, 'narrative')) {
    errors.push('Missing required top-level key: narrative');
  }

  const graphInput = parsed.graph && typeof parsed.graph === 'object' && !Array.isArray(parsed.graph)
    ? parsed.graph
    : { nodes: [], edges: [] };
  if (!Object.prototype.hasOwnProperty.call(parsed, 'graph')) {
    errors.push('Missing required top-level key: graph');
  }

  const tablesInput = Array.isArray(parsed.tables) ? parsed.tables : [];
  if (!Object.prototype.hasOwnProperty.call(parsed, 'tables')) {
    errors.push('Missing required top-level key: tables');
  }

  // 4. Normalize graph nodes/edges and drop isolated nodes.
  const nodes = (Array.isArray(graphInput.nodes) ? graphInput.nodes : [])
    .map(normalizeNode)
    .filter(Boolean);
  const edges = (Array.isArray(graphInput.edges) ? graphInput.edges : [])
    .map(normalizeEdge)
    .filter(Boolean);
  const connectedNodes = dropIsolatedNodes(nodes, edges);

  // 5. Validate tables.
  const tables = tablesInput.map(normalizeTable).filter(Boolean);
  if (tables.length !== tablesInput.length) {
    errors.push('Some table entries are missing a valid name');
  }

  // Warn if graph-producing roles returned nodes without edges.
  if (nodes.length > 0 && edges.length === 0) {
    logger.warn('Model output contained graph nodes but zero edges; all nodes dropped', { nodeCount: nodes.length });
  }

  return {
    narrative,
    graph: { nodes: connectedNodes, edges },
    tables,
    errors,
    raw: rawString,
  };
}
