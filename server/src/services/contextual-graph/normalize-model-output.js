import { createHash } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { MERMAID_DIAGRAM_TYPES } from '@architxt/aql';

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

/**
 * Find the first substring that looks like a JSON object/array and actually parses.
 * Handles narrative text before the real envelope and skips brace pairs that are not JSON.
 */
function extractValidJson(text) {
  const sanitized = sanitizeJsonText(text);
  const re = /[\\{\\[]/g;
  let match;
  while ((match = re.exec(sanitized)) !== null) {
    const start = match.index;
    const stack = [];
    let inString = false;
    let escape = false;
    for (let i = start; i < sanitized.length; i += 1) {
      const ch = sanitized[i];
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
        if (!open) break;
        if ((open === '{' && ch !== '}') || (open === '[' && ch !== ']')) break;
        if (stack.length === 0) {
          const candidate = sanitized.slice(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            // Not valid JSON; continue scanning from after this candidate.
            re.lastIndex = i + 1;
            break;
          }
        }
      }
    }
  }
  return null;
}

const SMART_QUOTES = {
  '\u201C': "'", // left double quotation mark -> apostrophe (avoid breaking JSON strings)
  '\u201D': "'", // right double quotation mark -> apostrophe
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': ',',
  '\u2011': '-', // non-breaking hyphen
  '\u2013': '-', // en dash
  '\u2014': '-', // em dash
  '\u2026': '...',
  '\u00A0': ' ',
  '\u2007': ' ', // figure space
  '\u202F': ' ', // narrow no-break space
  '\u2060': '',  // word joiner
  '\uFEFF': '',  // zero-width no-break space (BOM handled separately, but be defensive)
};

function sanitizeJsonText(text) {
  return text
    .replace(/^\uFEFF/, '')
    .split('')
    .map((ch) => SMART_QUOTES[ch] || ch)
    .join('');
}

function stripOuterCodeFences(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Strip leading Markdown headings (e.g. "## Overview\n\n") so prose before the JSON envelope
 * does not break balanced-brace scanning or direct JSON.parse.
 */
function stripMarkdownHeadings(text) {
  return text.replace(/^(#{1,6}\s+.*\n+)+/, '').trim();
}


/**
 * Detect and fix literal newlines, carriage returns, and tabs that appear inside
 * apparent JSON string values (models sometimes emit them unescaped).
 * This is a best-effort scan; it respects escape sequences so \" and \\ are
 * handled correctly. Only double-quoted JSON strings are targeted.
 */
function fixUnescapedControlChars(text) {
  let inString = false;
  let escape = false;
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) {
      out.push('\\', ch);
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out.push(ch);
      continue;
    }
    if (inString) {
      if (ch === '\n' || ch === '\r') {
        out.push('\\n');
        continue;
      }
      if (ch === '\t') {
        out.push('\\t');
        continue;
      }
    }
    out.push(ch);
  }
  // If we ended mid-escape, flush it so we don't drop the backslash.
  if (escape) out.push('\\');
  return out.join('');
}

/**
 * Detect JSON that has been embedded as a string-escaped literal (`\"` instead of `"`).
 * When the text is not valid JSON but contains `{ \"` or `[ \"` we unescape the quotes
 * so the envelope becomes parseable.
 */
function unescapeStringifiedJson(text) {
  const hasEscapedObject = /\{\s*\\"/.test(text);
  const hasEscapedArray = /\[\s*\\"/.test(text);
  if (!hasEscapedObject && !hasEscapedArray) return text;
  return text.replace(/\\"/g, '"');
}

function preprocessModelText(text) {
  return fixUnescapedControlChars(stripMarkdownHeadings(stripOuterCodeFences(text)));
}

/**
 * Detect a Markdown table anywhere in the text.
 */
function looksLikeMarkdownTable(text) {
  return /^\s*\|.*\|\s*$/m.test(text) && /^\s*\|[-:\s|]+\|\s*$/m.test(text);
}

function extractProseBeforeTable(text) {
  const tableStart = text.search(/^\s*\|.*\|\s*$/m);
  if (tableStart === -1) return '';
  return text.slice(0, tableStart).replace(/^#{1,6}\s+/gm, '').trim();
}

/**
 * Parse a Markdown table into the normalized table shape.
 * Column names are normalized and mapped onto the canonical capability columns.
 */
function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  let rawColumns = [];
  let foundHeader = false;
  for (const line of lines) {
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!foundHeader) {
      if (cells.some((c) => /^[-:\s]+$/.test(c))) {
        foundHeader = true;
        continue;
      }
      rawColumns = cells;
      continue;
    }
    if (cells.some((c) => /^[-:\s]+$/.test(c))) continue;

    const row = {};
    rawColumns.forEach((rawCol, idx) => {
      const key = canonicalCapabilityColumn(rawCol);
      if (!key) return;
      const cell = cells[idx] ?? '';
      if (key === 'evidence') {
        row[key] = cell ? cell.split(/,\s*/).filter(Boolean) : [];
      } else {
        row[key] = cell;
      }
    });
    rows.push(row);
  }

  if (rawColumns.length === 0 || rows.length === 0) return null;

  const columns = CANONICAL_CAPABILITY_COLUMNS.filter((c) => rows.some((r) => Object.prototype.hasOwnProperty.call(r, c)));
  if (columns.length === 0) return null;

  return { name: 'capabilities', columns, rows };
}

const CANONICAL_CAPABILITY_COLUMNS = ['name', 'responsibility', 'purpose', 'business_capability_mapping', 'evidence'];

const CAPABILITY_COLUMN_ALIASES = {
  capability: 'name',
  capability_name: 'name',
  name: 'name',
  responsibility: 'responsibility',
  resp: 'responsibility',
  purpose: 'purpose',
  business_capability_mapping: 'business_capability_mapping',
  business_capability: 'business_capability_mapping',
  mapping: 'business_capability_mapping',
  evidence: 'evidence',
  evidence_ids: 'evidence',
  source: 'evidence',
};

function canonicalCapabilityColumn(raw) {
  const normalized = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return CAPABILITY_COLUMN_ALIASES[normalized] || null;
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
    properties: e.properties && typeof e.properties === 'object' && !Array.isArray(e.properties)
      ? e.properties
      : undefined,
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

function normalizeDiagram(d) {
  if (!d || typeof d !== 'object') return null;
  const name = typeof d.name === 'string' && d.name.length > 0 ? d.name : null;
  const type = typeof d.type === 'string' && d.type.length > 0 ? d.type : null;
  const content = typeof d.content === 'string' ? d.content.trim() : '';
  if (!name) return null;
  if (!type) return null;
  if (!MERMAID_DIAGRAM_TYPES.includes(type)) return null;
  if (!content) return null;
  return { name, type, content };
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
 *   diagrams: object[],
 *   errors: string[],
 *   raw: string
 * }}
 */
export function normalizeModelOutput(raw) {
  const rawString = raw === null || raw === undefined ? '' : (typeof raw === 'string' ? raw : JSON.stringify(raw));
  const errors = [];

  if (rawString.trim() === '') {
    return { narrative: '', graph: { nodes: [], edges: [] }, tables: [], diagrams: [], errors, raw: rawString };
  }

  let parsed = null;
  let jsonText = null;

  const preprocessed = preprocessModelText(rawString);

  // 1. Try direct JSON.parse on the whole string (after stripping fences, headings, smart quotes).
  try {
    jsonText = unescapeStringifiedJson(sanitizeJsonText(preprocessed));
    parsed = JSON.parse(jsonText);
  } catch {
    // 2. Fallback: find the first balanced JSON object that actually parses.
    const extracted = extractValidJson(unescapeStringifiedJson(sanitizeJsonText(preprocessed)));
    if (extracted) {
      try {
        parsed = JSON.parse(extracted);
        jsonText = extracted;
      } catch (err) {
        errors.push(`Failed to parse extracted JSON: ${err.message}`);
      }
    }
  }

  // 3. If still no envelope but the content looks like a Markdown table, synthesize
  //    a minimal envelope with the table under `tables`. Log a warning because the
  //    model ignored the required JSON envelope.
  if (!parsed && looksLikeMarkdownTable(preprocessed)) {
    const table = parseMarkdownTable(preprocessed);
    if (table) {
      logger.warn('Model output ignored JSON envelope and returned a Markdown table; synthesizing envelope', { tableName: table.name, rows: table.rows.length });
      parsed = {
        narrative: extractProseBeforeTable(preprocessed),
        graph: { nodes: [], edges: [] },
        tables: [table],
        diagrams: [],
      };
      jsonText = JSON.stringify(parsed);
    }
  }

  if (!parsed) {
    errors.push('Unable to parse JSON envelope from model output');
    return { narrative: '', graph: { nodes: [], edges: [] }, tables: [], diagrams: [], errors, raw: rawString };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('Model output is not a JSON object');
    return { narrative: '', graph: { nodes: [], edges: [] }, tables: [], diagrams: [], errors, raw: rawString };
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

  const diagramsInput = Array.isArray(parsed.diagrams) ? parsed.diagrams : [];
  if (!Object.prototype.hasOwnProperty.call(parsed, 'diagrams')) {
    errors.push('Missing required top-level key: diagrams');
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

  // 6. Validate diagrams.
  const diagrams = diagramsInput.map(normalizeDiagram).filter(Boolean);
  if (diagrams.length !== diagramsInput.length) {
    errors.push('Some diagram entries are missing a valid name, type, or valid Mermaid type');
  }

  // Warn if graph-producing roles returned nodes without edges.
  if (nodes.length > 0 && edges.length === 0) {
    logger.warn('Model output contained graph nodes but zero edges; all nodes dropped', { nodeCount: nodes.length });
  }

  return {
    narrative,
    graph: { nodes: connectedNodes, edges },
    tables,
    diagrams,
    errors,
    raw: rawString,
  };
}
