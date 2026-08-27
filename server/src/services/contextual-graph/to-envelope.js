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
 * @returns {{ narrative: string, narrative_name: string, graph: { name: string, nodes: object[], edges: object[] }, tables: object[], diagrams: object[] }}
 */
export function toEnvelope(structuredOutput, options = {}) {
  const { knownCatalog = new Map(), activity = 'unknown', mode = 'generic' } = options;

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
  });

  return {
    narrative: typeof extracted.narrative === 'string' ? extracted.narrative : '',
    narrative_name: typeof extracted.narrative_name === 'string' ? extracted.narrative_name : '',
    graph: {
      name: normalizedGraph.name || graphInput.name || '',
      nodes: normalizedGraph.nodes,
      edges: normalizedGraph.edges,
    },
    tables: Array.isArray(extracted.tables) ? extracted.tables : [],
    diagrams: Array.isArray(extracted.diagrams) ? extracted.diagrams : [],
  };
}
