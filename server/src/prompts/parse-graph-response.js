import { createLogger } from '../utils/logger.js';
import { parseJsonString } from './graph-parser.js';

const logger = createLogger('parse-graph-response');

const OUTER_FENCE_RE = /^```(?:markdown|json)?\s*\n?([\s\S]*?)\n?```\s*$/;

/**
 * Parse a response that uses the contextual Architxt JSON envelope.
 *
 * Expected shape:
 *   { "narrative": "...", "graph": { "nodes": [], "edges": [] } }
 *
 * Graph-only responses may omit "narrative" (it defaults to "").
 * Narrative-only responses may omit "graph" (it defaults to empty).
 *
 * @param {string|object|null} raw
 * @param {object} [options]
 * @param {string} [options.mode='narrative-graph-known'] - Template mode; used only for logging warnings when the graph section is missing.
 * @param {boolean} [options.expectGraph=true] - If true, log a warning when the graph section is missing.
 * @param {string} [options.defaultSource='llm'] - Source value to set on nodes that do not already specify one.
 * @returns {{ narrative: string, graph: { nodes: object[], edges: object[] }, error?: string }}
 */
export function parseGraphResponse(raw, { mode = 'narrative-graph-known', expectGraph = true, defaultSource = 'llm' } = {}) {
  if (raw === null || raw === undefined) {
    return { narrative: '', graph: { nodes: [], edges: [] } };
  }

  if (typeof raw !== 'string') {
    logger.warn('Graph response must be a string', { type: typeof raw });
    return { narrative: '', graph: { nodes: [], edges: [] } };
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return { narrative: '', graph: { nodes: [], edges: [] } };
  }

  const parsed = parseEnvelope(trimmed, defaultSource);
  if (!parsed) {
    return {
      narrative: '',
      graph: { nodes: [], edges: [] },
      error: expectGraph
        ? 'Response is not a valid contextual JSON envelope.'
        : null,
    };
  }

  const { narrative, graph } = parsed;

  if (parsed.graph && parsed.graph._malformed) {
    const { _malformed, ...graph } = parsed.graph;
    return { narrative, graph, error: 'Graph section found but contained no usable nodes or edges.' };
  }

  if (!parsed.graph) {
    if (expectGraph) {
      return { narrative, graph: { nodes: [], edges: [] }, error: 'Response envelope is missing the graph section.' };
    }
    return { narrative, graph: { nodes: [], edges: [] }, error: null };
  }

  const graphPresent = parsed.graph && typeof parsed.graph === 'object' && !Array.isArray(parsed.graph)
    && (Array.isArray(parsed.graph.nodes) || Array.isArray(parsed.graph.edges));

  if (expectGraph && !graphPresent) {
    return { narrative, graph, error: 'Graph section found but contained no usable nodes or edges.' };
  }

  return { narrative, graph, error: null };
}

function parseEnvelope(text, defaultSource) {
  const stripped = stripOuterCodeFences(text);
  const parsed = parseJsonString(stripped);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const hasNarrativeKey = Object.prototype.hasOwnProperty.call(parsed, 'narrative');
  const hasGraphKey = Object.prototype.hasOwnProperty.call(parsed, 'graph');

  if (!hasNarrativeKey && !hasGraphKey) {
    return null;
  }

  const narrative = hasNarrativeKey && typeof parsed.narrative === 'string' ? parsed.narrative.trim() : '';

  let graph = null;
  if (hasGraphKey) {
    const graphInput = parsed.graph;
    if (graphInput && typeof graphInput === 'object' && !Array.isArray(graphInput)
      && (Array.isArray(graphInput.nodes) || Array.isArray(graphInput.edges))) {
      const nodes = (Array.isArray(graphInput.nodes) ? graphInput.nodes : [])
        .map((n) => normalizeGraphNode(n, defaultSource))
        .filter(Boolean);
      const edges = Array.isArray(graphInput.edges) ? graphInput.edges : [];
      graph = { nodes, edges };
    } else if (graphInput && typeof graphInput === 'object' && !Array.isArray(graphInput)) {
      // graph key exists but has no usable nodes/edges arrays
      graph = { nodes: [], edges: [], _malformed: true };
    } else {
      graph = { nodes: [], edges: [] };
    }
  }

  return { narrative, graph };
}

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

/**
 * Convenience: parse a graph-only response.
 * @param {string|object|null} raw
 * @returns {{ narrative: string, graph: { nodes: object[], edges: object[] } }}
 */
export function parseGraphOnlyResponse(raw) {
  return parseGraphResponse(raw, { mode: 'graph-known', expectGraph: true });
}
