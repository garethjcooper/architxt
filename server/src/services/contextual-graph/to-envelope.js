import { normalizeGraph } from '../../prompts/normalize-graph.js';

/**
 * Convert a raw structured-output envelope (from Hindsight Reflect, Synthesize,
 * or stored mental-model content) into a canonical normalized envelope used by
 * the UI and research pipeline.
 *
 * This is the single place where graph normalization happens. All handlers that
 * produce or read contextual-graph output should route through here.
 *
 * @param {object} structuredOutput - Raw envelope from model/Hindsight.
 * @param {object} [options]
 * @param {Map} [options.knownCatalog] - Known entity catalog for graph normalization.
 * @param {string} [options.activity='unknown'] - Activity label passed to normalizeGraph.
 * @param {string} [options.mode='generic'] - Mode passed to normalizeGraph.
 * @param {boolean} [options.preserveParallelEdges=false] - Passed to normalizeGraph.
 * @returns {{ narratives: Array<{ narrative: string, narrative_name: string }>, graph: { name: string, nodes: object[], edges: object[] }, tables: object[], diagrams: object[] }}
 */
export function toEnvelope(structuredOutput, options = {}) {
  const { knownCatalog = new Map(), activity = 'unknown', mode = 'generic', preserveParallelEdges = false } = options;

  const extracted = structuredOutput && typeof structuredOutput === 'object' && !Array.isArray(structuredOutput)
    ? structuredOutput
    : {};

  const graphInput = extracted.graph && typeof extracted.graph === 'object' && !Array.isArray(extracted.graph)
    ? extracted.graph
    : { nodes: [], edges: [] };

  const normalizedGraph = normalizeGraph(graphInput, {
    activity,
    knownCatalog,
    mode,
    preserveParallelEdges,
  });

  const narratives = Array.isArray(extracted.narratives)
    ? extracted.narratives
      .filter((n) => n && typeof n === 'object' && !Array.isArray(n) && typeof n.narrative === 'string')
      .map((n) => ({ narrative_name: typeof n.narrative_name === 'string' ? n.narrative_name : '', narrative: n.narrative }))
    : [];

  return {
    narratives,
    graph: {
      name: normalizedGraph.name || graphInput.name || '',
      nodes: normalizedGraph.nodes,
      edges: normalizedGraph.edges,
    },
    tables: Array.isArray(extracted.tables) ? extracted.tables : [],
    diagrams: Array.isArray(extracted.diagrams) ? extracted.diagrams : [],
  };
}
