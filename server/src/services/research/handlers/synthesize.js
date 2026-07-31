/**
 * Synthesize handler for research discovery.
 *
 * Compiles a corpus from one or more prior research steps (narratives,
 * entities, and edges) and asks the configured LLM to produce a synthesized
 * narrative and graph using the v0.3.5 universal prompt templates.
 *
 * Output:
 *   { success: true, narrative: string, graph: { nodes: [], edges: [] }, calls: [] }
 */

import * as llmClient from '../../llm/client.js';
import { config } from '../../../config.js';
import { createLogger } from '../../../utils/logger.js';
import { loadAndComposeWithCatalog } from '../../../prompts/template-service.js';
import { parseGraphResponse } from '../../../prompts/parse-graph-response.js';
import { normalizeGraph } from '../../../prompts/normalize-graph.js';
import { loadEntityCatalog } from '../../../prompts/entity-catalog.js';

const logger = createLogger('research-synthesize');

const DISCOVERY_MODES = new Set([
  'graph-discovery',
  'narrative-graph-discovery',
  'graph-discovered-only',
  'narrative-graph-discovered-only',
]);

function resolveTemplate(requestedTemplate, outputMode, allowDiscovery) {
  if (typeof requestedTemplate === 'string' && DISCOVERY_MODES.has(requestedTemplate)) return requestedTemplate;

  // Legacy UI output_mode values map to v0.3.5 template names.
  if (outputMode === 'narrative') return 'narrative';
  if (outputMode === 'graph-only') return allowDiscovery ? 'graph-discovery' : 'graph-known';
  if (outputMode === 'narrative+graph') {
    return allowDiscovery ? 'narrative-graph-discovery' : 'narrative-graph-known';
  }
  return 'narrative-graph-known';
}

function formatEntity(entity) {
  const name = entity.name || entity.id;
  const typeSuffix = entity.type ? ` (${entity.type})` : '';
  return `- id: ${entity.id}, name: ${name}${typeSuffix}`;
}

function formatEdge(edge) {
  const label = edge.detail || edge.label || 'related';
  return `- ${edge.from} → ${edge.to} (${label})${edge.detail ? ` [detail: ${edge.detail}]` : ''}`;
}

function collectFromSteps(sourceSteps) {
  const seenNodeIds = new Set();
  const seenEdgeKeys = new Set();
  const nodes = [];
  const edges = [];
  const narratives = [];

  for (const step of sourceSteps) {
    const canvas = step.canvas || {};
    const graph = canvas.graph || {};
    const synthesis = step.synthesis || {};

    if (synthesis.narrative) {
      narratives.push(`## Step: ${step.intent_text || 'untitled'}\n${synthesis.narrative}`);
    }

    for (const n of graph.nodes || []) {
      const key = n.id;
      if (seenNodeIds.has(key)) continue;
      seenNodeIds.add(key);
      nodes.push({
        id: n.id,
        name: n.name || n.id,
        type: n.type || 'entity',
      });
    }

    for (const e of graph.edges || []) {
      const key = `${e.from}|${e.to}|${e.type || e.detail || e.label || ''}`;
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);
      edges.push({
        from: e.from,
        to: e.to,
        type: e.type || 'related',
        label: e.label,
        detail: e.detail,
        ...(e.weight !== undefined && { weight: e.weight }),
      });
    }
  }

  return { nodes, edges, narratives };
}

function buildCorpus(intentText, sourceSteps) {
  const { nodes, edges, narratives } = collectFromSteps(sourceSteps);

  const sections = [
    '# Synthesis request',
    '',
    'User intent:',
    intentText,
    '',
    'Source material:',
  ];

  if (narratives.length > 0) {
    sections.push('', ...narratives);
  }

  if (nodes.length > 0) {
    sections.push('', 'Entities:', ...nodes.map(formatEntity));
  }

  if (edges.length > 0) {
    sections.push('', 'Relationships:', ...edges.map(formatEdge));
  }

  if (nodes.length === 0 && edges.length === 0 && narratives.length === 0) {
    sections.push('(No source material provided.)');
  }

  return { corpus: sections.join('\n'), nodes, edges };
}

/**
 * Map the normalized canonical graph to the internal shape expected by the
 * research agent and downstream consumers. This emits only the canonical
 * GraphNode / GraphEdge fields; no legacy aliases or fallbacks are added.
 */
function toInternalGraph(graph) {
  return {
    nodes: (graph.nodes || []).map((n) => ({
      id: n.id,
      name: n.name,
    })),
    edges: (graph.edges || []).map((e) => ({
      from: e.from,
      to: e.to,
      type: e.type,
      provenance: e.provenance,
      label: e.label,
      detail: e.detail,
    })),
  };
}

export async function handleSynthesize(serverId, bankId, query, options = {}, db) {
  const intentText = query;
  const sourceSteps = options?.source_steps || [];
  const cfg = config.research.synthesize;
  const templateName = resolveTemplate(options?.template, options?.output_mode, options?.allow_discovery);

  if (!db) {
    return {
      success: false,
      error: 'db is required for synthesize template loading',
      code: 'MISSING_DB',
    };
  }

  // Guard: ensure we have something to synthesize.
  const { nodes: corpusNodes, edges: corpusEdges } = collectFromSteps(sourceSteps);
  const hasNarratives = sourceSteps.some((s) => s.synthesis?.narrative);
  if (!hasNarratives && corpusNodes.length === 0 && corpusEdges.length === 0) {
    return {
      success: true,
      narrative: 'No source material available for synthesis.',
      graph: { nodes: [], edges: [] },
      calls: [],
    };
  }

  if (!cfg.model && !options?.model) {
    return {
      success: true,
      narrative: 'Synthesis is not configured: missing model.',
      graph: { nodes: [], edges: [] },
      calls: [],
    };
  }

  const { corpus } = buildCorpus(intentText, sourceSteps);

  logger.info('Running synthesize handler', {
    intentText,
    sourceStepCount: sourceSteps.length,
    provider: cfg.provider,
    model: options?.model || cfg.model,
    template: templateName,
    maxTokens: options?.max_tokens ?? cfg.max_tokens,
    corpusChars: corpus.length,
  });

  logger.info('Synthesize corpus built', {
    intentText,
    corpusChars: corpus.length,
    sourceStepCount: sourceSteps.length,
    nodeCount: corpusNodes.length,
    edgeCount: corpusEdges.length,
    narrativeCount: sourceSteps.filter((s) => s.synthesis?.narrative).length,
  });

  const { prompt: systemPrompt, mode } = await loadAndComposeWithCatalog(db, templateName, {
    ARCHITXT_TOPIC: intentText,
    ARCHITXT_CORPUS: corpus,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: 'Synthesize the source material above into a narrative and graph. Follow the output format exactly.' },
  ];

  const completionFn = typeof options?.generateCompletion === 'function'
    ? options.generateCompletion
    : llmClient.generateCompletion;

  const llmResult = await completionFn(messages, {
    provider: cfg.provider,
    model: options?.model || cfg.model,
    temperature: cfg.temperature,
    max_tokens: options?.max_tokens ?? cfg.max_tokens,
  });

  if (!llmResult.success) {
    logger.error('Synthesize LLM call failed', {
      intentText,
      error: llmResult.error,
      code: llmResult.code,
    });
    throw new Error(`Synthesis LLM call failed: ${llmResult.error}`);
  }

  logger.info('Synthesize LLM response received', {
    intentText,
    contentLength: llmResult.data.content.length,
    usage: llmResult.data.usage,
    model: llmResult.data.model,
  });

  const catalogEntities = await loadEntityCatalog(db);
  const knownCatalog = new Map(catalogEntities.map((e) => [e.id, e]));

  const corpusNodeIds = new Set(corpusNodes.map((n) => n.id));

  const expectGraph = templateName !== 'narrative';
  const parsed = parseGraphResponse(llmResult.data.content, { mode, expectGraph });
  const normalized = normalizeGraph(parsed.graph, {
    activity: 'synthesize',
    knownCatalog,
    mode: templateName,
  });

  const discoveredOnly = templateName.includes('discovered-only');
  const discoveryMode = DISCOVERY_MODES.has(templateName);

  // Known templates: keep corpus/catalog nodes only.
  // Discovery templates: keep all normalized nodes.
  // Discovered-only templates: keep only discovered nodes as standalone nodes, but known/corpus
  // entities may still appear as endpoints of discovered edges.
  let filteredNodes;
  let filteredEdges;

  if (discoveredOnly) {
    // For discovered-only, start from nodes that are NOT already in the corpus/catalog.
    const discoveredNodes = normalized.nodes.filter(
      (n) => !corpusNodeIds.has(n.id) && !knownCatalog.has(n.id)
    );
    const discoveredNodeIds = new Set(discoveredNodes.map((n) => n.id));

    // Keep edges that touch at least one discovered node.
    const discoveredEdges = normalized.edges.filter(
      (e) => discoveredNodeIds.has(e.from) || discoveredNodeIds.has(e.to)
    );

    // Known/corpus nodes may appear as endpoints of discovered edges.
    const edgeEndpointIds = new Set();
    for (const e of discoveredEdges) {
      edgeEndpointIds.add(e.from);
      edgeEndpointIds.add(e.to);
    }

    filteredNodes = normalized.nodes.filter((n) => edgeEndpointIds.has(n.id));
    const keptNodeIds = new Set(filteredNodes.map((n) => n.id));
    filteredEdges = discoveredEdges.filter((e) => keptNodeIds.has(e.from) && keptNodeIds.has(e.to));
  } else if (discoveryMode) {
    filteredNodes = normalized.nodes;
    const keptNodeIds = new Set(filteredNodes.map((n) => n.id));
    filteredEdges = normalized.edges.filter((e) => keptNodeIds.has(e.from) && keptNodeIds.has(e.to));
  } else {
    filteredNodes = normalized.nodes.filter(
      (n) => corpusNodeIds.has(n.id) || knownCatalog.has(n.id)
    );
    const keptNodeIds = new Set(filteredNodes.map((n) => n.id));
    filteredEdges = normalized.edges.filter((e) => keptNodeIds.has(e.from) && keptNodeIds.has(e.to));
  }

  logger.info('Synthesize graph filtered', {
    intentText,
    rawNodes: parsed.graph.nodes.length,
    rawEdges: parsed.graph.edges.length,
    keptNodes: filteredNodes.length,
    keptEdges: filteredEdges.length,
    corpusNodes: corpusNodes.length,
    corpusEdges: corpusEdges.length,
    knownCatalogSize: knownCatalog.size,
    templateName,
    discoveredOnly,
  });

  const graph = toInternalGraph({ nodes: filteredNodes, edges: filteredEdges });

  const graphOnly = templateName.startsWith('graph-');

  logger.info('Synthesize handler completed', {
    intentText,
    templateName,
    narrativeLength: graphOnly ? 0 : parsed.narrative.length,
    graphNodeCount: graph.nodes.length,
    graphEdgeCount: graph.edges.length,
  });

  return {
    success: true,
    narrative: graphOnly ? '' : parsed.narrative,
    graph,
    calls: [
      {
        mode: 'synthesize',
        prompt_text: messages.map((m) => `## ${m.role}\n${m.content}`).join('\n\n'),
        response_text: llmResult.data.content,
        model: llmResult.data.model,
        usage: llmResult.data.usage || null,
      },
    ],
  };
}

export default {
  handleSynthesize,
};
