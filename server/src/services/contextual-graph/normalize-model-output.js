import { createHash, randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger.js';
import { MERMAID_DIAGRAM_TYPES } from '@architxt/aql';

const logger = createLogger('contextual-graph-normalize-model-output');

function ensureSectionId(section) {
  if (section && typeof section === 'object' && typeof section.id === 'string' && section.id.length > 0) {
    return section;
  }
  return { ...section, id: randomUUID() };
}

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

const LIKELY_SHORT_ID_RE = /^[a-f0-9]{8}$/i;
const UUID_RE = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const UUID_ONLY_RE = new RegExp(UUID_RE, 'gi');
const BRACKETED_EVIDENCE_RE = new RegExp(`【\\s*(${UUID_RE})\\s*】`, 'gi');
const PARENTHESIZED_EVIDENCE_RE = new RegExp(`\\(\\s*(?:${UUID_RE}(?:\\s*,\\s*)?)+\\s*\\)`, 'gi');

function warnIfShortEvidence(evidence, context) {
  if (!Array.isArray(evidence)) return;
  for (const id of evidence) {
    if (typeof id === 'string' && LIKELY_SHORT_ID_RE.test(id)) {
      logger.warn('Evidence ID looks like a truncated/short hash; model should emit the full Hindsight memory ID', { context, evidenceId: id });
    }
  }
}

/**
 * Remove inline Hindsight memory IDs from narrative prose, whether bracketed
 * (【...】) or parenthesized (uuid, uuid). Any full UUIDs found inline are
 * extracted and added to the evidence array so the data is not lost.
 */
function cleanInlineEvidence(narrative, evidence) {
  if (typeof narrative !== 'string') return { narrative: '', evidence };
  const found = new Set(evidence);
  const extractBracketed = (match, id) => {
    found.add(id.toLowerCase());
    return '';
  };
  const extractParenthesized = (match) => {
    const ids = match.match(UUID_ONLY_RE) || [];
    for (const id of ids) {
      found.add(id.toLowerCase());
    }
    return '';
  };
  let cleaned = narrative.replace(BRACKETED_EVIDENCE_RE, extractBracketed);
  cleaned = cleaned.replace(PARENTHESIZED_EVIDENCE_RE, extractParenthesized);
  // Also collapse any leftover empty brackets/parentheses or multiple spaces left behind.
  const tidy = cleaned
    .replace(/【\s*】/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:!?\)\]\}】])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return { narrative: tidy, evidence: Array.from(found) };
}

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

function inferNarrativeName(narrative) {
  if (typeof narrative !== 'string') return '';
  // 1. First markdown heading.
  const headingMatch = narrative.match(/^#{1,6}\s+(.+?)$/m);
  if (headingMatch) return headingMatch[1].trim();

  const lines = narrative.split(/\n/);
  const firstNonEmpty = lines.find((l) => l.trim());
  if (!firstNonEmpty) return '';
  const trimmed = firstNonEmpty.trim();

  // 2. First standalone bold/italic line.
  const boldMatch = trimmed.match(/^(?:\*\*|__)([^*_]+)(?:\*\*|__)$/);
  if (boldMatch) return boldMatch[1].trim();

  // 3. Plain-text fallback: first line/sentence, stripped of inline markdown, truncated.
  const stripped = trimmed
    .replace(/(\*\*|__)([^*_]+)\1/g, '$2')
    .replace(/(\*|_)([^*_]+)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  if (!stripped) return '';
  const sentence = stripped.split(/[.!?](?:\s|$)/)[0].trim();
  const name = sentence.length > 50 ? `${sentence.slice(0, 47).trim()}...` : sentence;
  return name || '';
}

export function normalizeEnvelopeForApi(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { narratives: [], graph: { name: '', nodes: [], edges: [] }, tables: [], diagrams: [] };
  }
  const narrativesInput = Array.isArray(envelope.narratives) ? envelope.narratives : [];
  const graphInput = envelope.graph && typeof envelope.graph === 'object' && !Array.isArray(envelope.graph)
    ? envelope.graph
    : { name: '', nodes: [], edges: [] };
  const tablesInput = Array.isArray(envelope.tables) ? envelope.tables : [];
  const diagramsInput = Array.isArray(envelope.diagrams) ? envelope.diagrams : [];

  return {
    narratives: narrativesInput.map(normalizeNarrative).filter((n) => n !== null).map(ensureSectionId),
    graph: {
      name: typeof graphInput.name === 'string' ? graphInput.name : '',
      nodes: Array.isArray(graphInput.nodes) ? graphInput.nodes : [],
      edges: Array.isArray(graphInput.edges) ? graphInput.edges : [],
    },
    tables: tablesInput.map(normalizeTable).filter((t) => t !== null).map(ensureSectionId),
    diagrams: diagramsInput.map(normalizeDiagram).filter((d) => d !== null).map(ensureSectionId),
  };
}

export function normalizeNarrative(n) {
  if (!n || typeof n !== 'object' || Array.isArray(n)) return null;
  const rawNarrative = typeof n.narrative === 'string' ? n.narrative : '';
  let narrative_name = typeof n.narrative_name === 'string' ? n.narrative_name : '';
  if (!narrative_name && rawNarrative) {
    narrative_name = inferNarrativeName(rawNarrative);
  }
  if (!narrative_name && rawNarrative) {
    narrative_name = 'Narrative';
  }
  const evidence = Array.isArray(n.evidence)
    ? n.evidence.filter((id) => typeof id === 'string')
    : [];
  const { narrative, evidence: cleanedEvidence } = cleanInlineEvidence(rawNarrative, evidence);
  warnIfShortEvidence(cleanedEvidence, { narrative: narrative_name || 'unnamed' });
  return { id: n.id, narrative_name, narrative, evidence: cleanedEvidence };
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
  let evidence = Array.isArray(t.evidence)
    ? t.evidence.filter((id) => typeof id === 'string')
    : [];
  // Backfill table-level evidence from row-level evidence when the model leaves
  // the table-level array empty but rows are backed by evidence.
  if (evidence.length === 0 && rows.length > 0) {
    evidence = deriveTableEvidenceFromRows(rows);
  }
  warnIfShortEvidence(evidence, { table: name });
  return { id: t.id, name, columns, rows, evidence };
}

/**
 * Derive table-level evidence as the sorted, deduplicated union of all row-level
 * evidence arrays. Returns an empty array if no rows carry evidence.
 */
function deriveTableEvidenceFromRows(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (Array.isArray(row.evidence)) {
      for (const id of row.evidence) {
        if (typeof id === 'string') ids.add(id.toLowerCase());
      }
    }
  }
  return Array.from(ids).sort();
}

function normalizeDiagram(d) {
  if (!d || typeof d !== 'object') return null;
  const name = typeof d.name === 'string' && d.name.length > 0 ? d.name : null;
  const type = typeof d.type === 'string' && d.type.length > 0 ? d.type : null;
  let content = typeof d.content === 'string' ? d.content.trim() : '';
  if (!name) return null;
  if (!type) return null;
  if (!MERMAID_DIAGRAM_TYPES.includes(type)) return null;
  if (!content) return null;

  // Models sometimes emit the literal two-character sequence \n instead of real
  // newlines. Repair that so Mermaid receives proper line breaks.
  content = content.replace(/\\n/g, '\n');
  const evidence = Array.isArray(d.evidence)
    ? d.evidence.filter((id) => typeof id === 'string')
    : [];
  warnIfShortEvidence(evidence, { diagram: name });
  return { id: d.id, name, type, content, evidence };
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
 *   narratives: Array<{ narrative_name: string, narrative: string }>,
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
    return { narratives: [], graph: { nodes: [], edges: [] }, tables: [], diagrams: [], errors, raw: rawString };
  }

  let parsed = null;
  let jsonText = null;

  const preprocessed = preprocessModelText(rawString);

  // 1. Try direct JSON.parse on the preprocessed text.
  let preprocessedJsonText = null;
  try {
    preprocessedJsonText = sanitizeJsonText(preprocessed);
    parsed = JSON.parse(preprocessedJsonText);
  } catch {
    // 2. Fallback: the model may have wrapped the JSON as a string-escaped literal.
    const unescapedJsonText = unescapeStringifiedJson(preprocessedJsonText || sanitizeJsonText(preprocessed));
    try {
      parsed = JSON.parse(unescapedJsonText);
      jsonText = unescapedJsonText;
    } catch {
      // 3. Last fallback: find the first balanced JSON object that actually parses.
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
  }

  if (!parsed) {
    errors.push('Unable to parse JSON envelope from model output');
    return { narratives: [], graph: { nodes: [], edges: [] }, tables: [], diagrams: [], errors, raw: rawString };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('Model output is not a JSON object');
    return { narratives: [], graph: { nodes: [], edges: [] }, tables: [], diagrams: [], errors, raw: rawString };
  }

  // 3. Validate required top-level keys and fill defaults.
  if (!Object.prototype.hasOwnProperty.call(parsed, 'narratives')) {
    errors.push('Missing required top-level key: narratives');
  }
  const narrativesInput = Array.isArray(parsed.narratives) ? parsed.narratives : [];
  if (!Array.isArray(parsed.narratives)) {
    errors.push('narratives must be an array');
  }

  const graphInput = parsed.graph && typeof parsed.graph === 'object' && !Array.isArray(parsed.graph)
    ? parsed.graph
    : { name: '', nodes: [], edges: [] };
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
    narratives: narrativesInput.map(normalizeNarrative).filter((n) => n !== null).map(ensureSectionId),
    graph: {
      name: typeof graphInput.name === 'string' ? graphInput.name : '',
      nodes: connectedNodes,
      edges,
    },
    tables: tables.map(ensureSectionId),
    diagrams: diagrams.map(ensureSectionId),
    errors,
    raw: rawString,
  };
}
