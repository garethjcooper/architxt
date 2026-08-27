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
import { composeMentalModelPrompt, formatFocusVariable } from '../../../prompts/template-service.js';
import { normalizeModelOutput } from '../../contextual-graph/normalize-model-output.js';
import { normalizeGraph } from '../../../prompts/normalize-graph.js';
import { loadEntityCatalog } from '../../../prompts/entity-catalog.js';

const logger = createLogger('research-synthesize');

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
  const allowDiscovery = options?.allow_discovery === true;

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
      tables: [],
      calls: [],
    };
  }

  if (!cfg.model && !options?.model) {
    return {
      success: true,
      narrative: 'Synthesis is not configured: missing model.',
      graph: { nodes: [], edges: [] },
      tables: [],
      calls: [],
    };
  }

  const { corpus } = buildCorpus(intentText, sourceSteps);

  logger.info('Running synthesize handler', {
    intentText,
    sourceStepCount: sourceSteps.length,
    provider: cfg.provider,
    model: options?.model || cfg.model,
    template: 'generic',
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

  const focus = options?.section_focus || {};
  const requestedNarrative = focus.narrative && (typeof focus.narrative === 'string'
    ? focus.narrative.trim().length > 0
    : focus.narrative.content?.trim().length > 0);
  const activeSections = [
    focus.graph && 'graph',
    focus.table?.length && 'tables',
    focus.diagram?.length && 'diagrams',
    requestedNarrative && 'narrative',
  ].filter(Boolean);
  const requestedStructured = activeSections.includes('tables') || activeSections.includes('diagrams') || activeSections.includes('graph');
  // When the caller gave no directives at all, keep the legacy default: narrative is active.
  const hasAnyDirective = requestedNarrative || requestedStructured;

  const topic = intentText;
  const focusVars = {
    ARCHITXT_CORPUS: corpus,
    ARCHITXT_GRAPH_FOCUS: formatFocusVariable(focus.graph),
    ARCHITXT_TABLE_FOCUS: formatFocusVariable(focus.table),
    ARCHITXT_DIAGRAM_FOCUS: formatFocusVariable(focus.diagram),
    ARCHITXT_NARRATIVE_FOCUS: formatFocusVariable(focus.narrative),
  };
  const systemPrompt = await composeMentalModelPrompt(db, 'generic', topic, focusVars);

  // Make the user request match the active section directives. Avoid asking
  // for narrative when only structured sections are active.
  let userInstruction;
  if (requestedNarrative && requestedStructured) {
    userInstruction = 'Synthesize the source material above into a narrative and structured output. Follow the output format exactly.';
  } else if (requestedNarrative || !hasAnyDirective) {
    userInstruction = 'Synthesize the source material above into a narrative. Follow the output format exactly.';
  } else if (requestedStructured) {
    userInstruction = `Synthesize the source material above into the active structured output sections (${activeSections.join(', ')}). Do not produce narrative prose. Set narrative to an empty string. Follow the output format exactly.`;
  } else {
    userInstruction = 'Synthesize the source material above into a concise narrative and graph. Follow the output format exactly.';
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userInstruction },
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

  const parsed = normalizeModelOutput(llmResult.data.content);
  const normalized = normalizeGraph(parsed.graph, {
    activity: 'synthesize',
    knownCatalog,
    mode: 'generic',
  });

  // Filter nodes based on discovery permission.
  let filteredNodes;
  let filteredEdges;

  if (allowDiscovery) {
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
    allowDiscovery,
  });

  // Defense in depth: if narrative was not requested, scrub any model-generated
  // narrative so downstream consumers only see structured output.
  if (hasAnyDirective && !requestedNarrative) {
    parsed.narrative = '';
  }

  const graph = toInternalGraph({ nodes: filteredNodes, edges: filteredEdges });
  graph.name = normalized.name || parsed.graph?.name || '';

  logger.info('Synthesize handler completed', {
    intentText,
    templateName: 'generic',
    narrativeLength: parsed.narrative.length,
    narrativeNameLength: (parsed.narrative_name || '').length,
    graphNameLength: (graph.name || '').length,
    graphNodeCount: graph.nodes.length,
    graphEdgeCount: graph.edges.length,
  });

  return {
    success: true,
    narrative: parsed.narrative,
    narrative_name: parsed.narrative_name || '',
    graph,
    tables: parsed.tables || [],
    diagrams: parsed.diagrams || [],
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
