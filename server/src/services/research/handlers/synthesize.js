/**
 * Synthesize handler for research discovery.
 *
 * Compiles a corpus from one or more prior research steps (narratives,
 * entities, and edges) and asks the LLM configured in `config.research.synthesize`
 * to produce a synthesized narrative and graph.
 *
 * Output:
 *   { narrative: string, graph?: { nodes: [], edges: [] } }
 */

import { generateCompletion } from '../../llm/client.js';
import { config } from '../../../config.js';
import { createLogger } from '../../../utils/logger.js';

const logger = createLogger('research-synthesize');

const DEFAULT_SYNTHESIZE_SCHEMA = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    graph: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Exact entity id from the source corpus. Do not invent or concatenate ids.' },
              label: { type: 'string', description: 'Short entity name or label from the source corpus. Use the exact short label; do NOT append the id in parentheses.' },
              label_long: { type: 'string', description: 'Optional longer form. Use this only if the corpus provides it.' },
              type: { type: 'string', description: 'Entity type from the source corpus.' },
            },
            required: ['id', 'label'],
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'Exact id of an existing node in graph.nodes.' },
              target: { type: 'string', description: 'Exact id of an existing node in graph.nodes.' },
              label: { type: 'string', description: 'Concise relationship label. Prefer short verbs or phrases from the source corpus (e.g., "communicates with", "sends eBill files").' },
              relationship_type: { type: 'string', description: 'A stable relationship type to group this edge by in the UI. Prefer one of the types already present in the source corpus, or "synthesized" if no existing type fits.' },
              label_long: { type: 'string', description: 'Optional longer description of the relationship. Use this to aggregate, clarify, or add context (e.g., "ICMS sends billing-related eBill files to BillDB via the MoveIT transfer service").' },
            },
            required: ['source', 'target', 'label'],
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },
  required: ['narrative', 'graph'],
};

function formatEntity(entity) {
  const shortLabel = entity.label || entity.id;
  const longLabel = entity.label_long || entity.label || entity.id;
  const typeSuffix = entity.type ? ` (${entity.type})` : '';
  const mentionSuffix = entity.mention_count ? ` [mentions: ${entity.mention_count}]` : '';
  return `- id: ${entity.id}, label: ${shortLabel}, label_long: ${longLabel}${typeSuffix}${mentionSuffix}`;
}

function formatEdge(edge) {
  const label = edge.label_long || edge.label || 'related';
  return `- ${edge.source} → ${edge.target} (${label})${edge.label_long ? ` [long: ${edge.label_long}]` : ''}`;
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
        label: n.label || n.id,
        label_long: n.label_long || n.label || n.id,
        type: n.type || 'entity',
        ...(n.mention_count !== undefined && { mention_count: n.mention_count }),
      });
    }

    for (const e of graph.edges || []) {
      const key = `${e.source}|${e.target}|${e.label || ''}`;
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);
      edges.push({
        source: e.source,
        target: e.target,
        label: e.label || 'related',
        label_long: e.label_long || e.label || 'related',
        ...(e.weight !== undefined && { weight: e.weight }),
      });
    }
  }

  return { nodes, edges, narratives };
}

function buildCorpus(intentText, sourceSteps) {
  const { nodes, edges, narratives } = collectFromSteps(sourceSteps);

  const sections = [
    'User intent:',
    intentText,
    '',
    'Source material:',
  ];

  if (narratives.length > 0) {
    sections.push(...narratives);
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

  sections.push('', 'Now produce the synthesis.');

  return { corpus: sections.join('\n'), nodes, edges };
}

function buildSynthesisPrompt(intentText, sourceSteps) {
  const { corpus } = buildCorpus(intentText, sourceSteps);
  const cfg = config.research.synthesize;

  const messages = [
    {
      role: 'system',
      content: `${cfg.system_prompt}\n\n${cfg.task_prompt}\n\nRespond with a JSON object matching this schema:\n${JSON.stringify(DEFAULT_SYNTHESIZE_SCHEMA, null, 2)}`,
    },
    {
      role: 'user',
      content: corpus,
    },
  ];

  return messages;
}

function parseSynthesisResponse(rawContent) {
  if (!rawContent || typeof rawContent !== 'string') {
    return { narrative: '', graph: { nodes: [], edges: [] } };
  }

  const trimmed = rawContent.trim();

  // Try to find a JSON object inside Markdown code fences.
  let jsonText = trimmed;
  const fencedMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fencedMatch) {
    jsonText = fencedMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText);
    const narrative = typeof parsed.narrative === 'string' ? parsed.narrative : trimmed;
    const graphNodes = Array.isArray(parsed.graph?.nodes)
      ? parsed.graph.nodes.map((n) => {
          if (!n || typeof n !== 'object') return n;
          const id = n.id;
          let label = typeof n.label === 'string' ? n.label : n.label_long || id;
          // Defensive normalization: if the model appended " (id)" to the label,
          // strip it so the label matches the short corpus label used elsewhere.
          if (typeof id === 'string' && typeof label === 'string') {
            const suffix = ` (${id})`;
            if (label.endsWith(suffix)) {
              label = label.slice(0, -suffix.length);
            }
          }
          return { ...n, label };
        })
      : [];
    const graphEdges = Array.isArray(parsed.graph?.edges) ? parsed.graph.edges : [];

    // Fallback: if the top-level JSON has no graph but the narrative contains a
    // fenced JSON graph, extract that graph so we don't lose structured output
    // when the model embeds it inside Markdown.
    if (graphNodes.length === 0 && graphEdges.length === 0 && typeof parsed.narrative === 'string') {
      const narrativeFencedMatch = parsed.narrative.match(/```json\s*\n?([\s\S]*?)```/);
      if (narrativeFencedMatch) {
        try {
          const embedded = JSON.parse(narrativeFencedMatch[1].trim());
          const embeddedNodes = Array.isArray(embedded.nodes) ? embedded.nodes : [];
          const embeddedEdges = Array.isArray(embedded.edges) ? embedded.edges : [];
          if (embeddedNodes.length > 0 || embeddedEdges.length > 0) {
            return { narrative, graph: { nodes: embeddedNodes, edges: embeddedEdges } };
          }
        } catch {
          // ignore embedded parse failure
        }
      }
    }

    return { narrative, graph: { nodes: graphNodes, edges: graphEdges } };
  } catch {
    // If the LLM returned plain Markdown, treat the whole response as the narrative.
    return { narrative: trimmed, graph: { nodes: [], edges: [] } };
  }
}

export async function handleSynthesize(serverId, bankId, query, options = {}) {
  const intentText = query;
  const sourceSteps = options?.source_steps || [];
  const cfg = config.research.synthesize;

  logger.info('Running synthesize handler', {
    intentText,
    sourceStepCount: sourceSteps.length,
    provider: cfg.provider,
    model: cfg.model,
  });

  if (!cfg.model) {
    return {
      success: true,
      narrative: 'Synthesis is not configured: missing model.',
      graph: { nodes: [], edges: [] },
      calls: [],
    };
  }

  // Guard: ensure we have something to synthesize.
  const { nodes, edges } = collectFromSteps(sourceSteps);
  const hasNarratives = sourceSteps.some((s) => s.synthesis?.narrative);
  if (!hasNarratives && nodes.length === 0 && edges.length === 0) {
    return {
      success: true,
      narrative: 'No source material available for synthesis.',
      graph: { nodes: [], edges: [] },
      calls: [],
    };
  }

  const messages = buildSynthesisPrompt(intentText, sourceSteps);

  const llmResult = await generateCompletion(messages, {
    provider: cfg.provider,
    model: cfg.model,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
  });

  if (!llmResult.success) {
    throw new Error(`Synthesis LLM call failed: ${llmResult.error}`);
  }

  const { nodes: corpusNodes, edges: corpusEdges } = buildCorpus(intentText, sourceSteps);
  const parsed = parseSynthesisResponse(llmResult.data.content);
  const allowedNodeIds = new Set(corpusNodes.map((n) => n.id));

  // Keep only nodes that exist in the corpus. For edges, require both endpoints
  // to be grounded corpus nodes; allow the LLM to express synthesized
  // relationship labels derived from the narrative, not just exact corpus-edge
  // labels. This prevents the graph from being reduced to nodes-only when the
  // synthesis produces rephrased or merged relationship descriptions.
  const filteredNodes = parsed.graph.nodes.filter((n) => allowedNodeIds.has(n.id));
  const filteredEdges = parsed.graph.edges.filter((e) => {
    const sourceOk = allowedNodeIds.has(e.source);
    const targetOk = allowedNodeIds.has(e.target);
    return sourceOk && targetOk;
  });

  logger.info('Synthesize graph filtered', {
    rawNodes: parsed.graph.nodes.length,
    rawEdges: parsed.graph.edges.length,
    keptNodes: filteredNodes.length,
    keptEdges: filteredEdges.length,
    corpusNodes: corpusNodes.length,
    corpusEdges: corpusEdges.length,
  });

  // Mark edges as synthesized so the UI can style them distinctly. Give them a
  // stable relationship type so they participate in edge-type filters/colors.
  const taggedEdges = filteredEdges.map((e) => ({
    ...e,
    edge_source: 'synthesize',
    relationship_type: e.relationship_type || 'synthesized',
    label: e.label || e.relationship_type || 'synthesized',
  }));

  return {
    success: true,
    narrative: parsed.narrative,
    graph: { nodes: filteredNodes, edges: taggedEdges },
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
