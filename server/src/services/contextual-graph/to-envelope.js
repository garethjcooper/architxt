import { normalizeGraph } from '../../prompts/normalize-graph.js';
import { normalizeNarrative } from './normalize-model-output.js';
import { config } from '../../config.js';

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
  const { knownCatalog = new Map(), activity = 'unknown', mode = 'generic', preserveParallelEdges = true } = options;

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
      .map(normalizeNarrative)
      .filter((n) => n !== null)
    : (typeof extracted.narrative === 'string' && extracted.narrative.trim().length > 0
        ? [{ narrative_name: '', narrative: extracted.narrative, evidence: [] }]
        : []);

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

export function isEnvelopeEmpty(envelope) {
  const hasNarrative = Array.isArray(envelope.narratives) && envelope.narratives.some(
    (n) => n && typeof n === 'object' && typeof n.narrative === 'string' && n.narrative.trim().length > 0,
  );
  const hasNodes = Array.isArray(envelope.graph?.nodes) && envelope.graph.nodes.length > 0;
  const hasEdges = Array.isArray(envelope.graph?.edges) && envelope.graph.edges.length > 0;
  const hasTables = Array.isArray(envelope.tables) && envelope.tables.length > 0;
  const hasDiagrams = Array.isArray(envelope.diagrams) && envelope.diagrams.length > 0;
  return !hasNarrative && !hasNodes && !hasEdges && !hasTables && !hasDiagrams;
}

function tryParseObjectFromContent(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') return null;
  const trimmed = rawContent.trim();

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (!fenceMatch) return null;
    try {
      parsed = JSON.parse(fenceMatch[1].trim());
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * Normalize a mental model reflect_response, falling back to parsing raw content
 * as a standard envelope when configured and structured_output is missing or invalid.
 *
 * Only valid standard envelopes are accepted from the fallback. Plain text or
 * markdown that does not parse as the envelope shape is treated as no fallback.
 *
 * @param {object} reflectResponse - The model's reflect_response object.
 * @param {object} [options] - Options passed through to toEnvelope.
 * @returns {{ envelope: object, usedFallback: boolean }}
 */
export function toEnvelopeWithFallback(reflectResponse, options = {}) {
  const structuredOutput = reflectResponse?.structured_output ?? null;

  if (structuredOutput && typeof structuredOutput === 'object' && !Array.isArray(structuredOutput)) {
    return { envelope: toEnvelope(structuredOutput, options), usedFallback: false };
  }

  if (!config.mentalModel?.noStructuredOutputFallbackContent) {
    return { envelope: toEnvelope({}, options), usedFallback: false };
  }

  const rawContent = reflectResponse?.content ?? reflectResponse?.text ?? null;
  const parsed = tryParseObjectFromContent(rawContent);
  if (!parsed) {
    return { envelope: toEnvelope({}, options), usedFallback: false };
  }

  const envelope = toEnvelope(parsed, options);
  if (isEnvelopeEmpty(envelope)) {
    return { envelope: toEnvelope({}, options), usedFallback: false };
  }

  return { envelope, usedFallback: true };
}
