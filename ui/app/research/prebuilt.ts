'use client';

import type {
  PrebuiltResponse,
  DiscoverStepResponse,
  GraphNode,
  GraphEdge,
} from '@/lib/api/client';

function isGraph(value: unknown): value is { nodes: GraphNode[]; edges: GraphEdge[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as any).nodes) &&
    Array.isArray((value as any).edges)
  );
}

function mergeGraphs(graphs: { nodes: GraphNode[]; edges: GraphEdge[] }[]): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodeById = new Map<string, GraphNode>();
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const graph of graphs) {
    for (const n of graph.nodes) {
      if (!nodeById.has(n.id)) nodeById.set(n.id, n);
    }
    for (const e of graph.edges) {
      const key = e.id || `${e.source}|${e.target}|${e.label}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push(e);
    }
  }

  return {
    nodes: Array.from(nodeById.values()),
    edges,
  };
}

function extractGraphFromJsonResult(
  jsonResult: PrebuiltResponse['dimensions'][number]['result']['json_result'],
): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  if (!jsonResult) return null;

  if (Array.isArray(jsonResult)) {
    const graphs = jsonResult.filter(isGraph);
    if (graphs.length === 0) return null;
    return graphs.length === 1 ? graphs[0] : mergeGraphs(graphs);
  }

  return isGraph(jsonResult) ? jsonResult : null;
}

/**
 * Convert a prebuilt research response into the existing DiscoverStepResponse
 * shape so the existing ResearchResultPanel can render it without changes.
 */
export function transformPrebuiltToDiscoverResponse(
  response: PrebuiltResponse,
  bankId: string,
): DiscoverStepResponse {
  const narratives: string[] = [];
  const graphs: { nodes: GraphNode[]; edges: GraphEdge[] }[] = [];

  for (const dimension of response.dimensions || []) {
    if (dimension.result?.narrative) {
      narratives.push(`## ${dimension.dimension}\n\n${dimension.result.narrative}`);
    }
    const graph = extractGraphFromJsonResult(dimension.result?.json_result);
    if (graph) {
      graphs.push(graph);
      if (!dimension.result?.narrative) {
        const found = dimension.entities?.filter((e) => e.found).map((e) => e.entity) || [];
        const modelNames = dimension.entities
          ?.flatMap((e) => e.model_results.filter((m) => m.found).map((m) => m.name))
          .filter((v, i, a) => a.indexOf(v) === i) || [];
        const lines = [
          `## ${dimension.dimension}`,
          '',
          `- Entities covered: ${found.join(', ') || 'none'}`,
          `- Models applied: ${modelNames.join(', ') || 'none'}`,
        ];
        narratives.push(lines.join('\n'));
      }
    }
  }

  return {
    session_id: response.session_id ?? 0,
    step_id: response.step_id ?? 0,
    status: 'completed',
    bank_id: bankId,
    viewpoint_ids: [],
    query_depth: 'prebuilt',
    synthesis: {
      narrative: narratives.join('\n\n') || 'No prebuilt results available.',
    },
    canvas: {
      graph: graphs.length > 0 ? mergeGraphs(graphs) : { nodes: [], edges: [] },
      meta: {
        mental_model_applied_to: response.entities,
        mental_model_missing: response.entity_summary
          ?.filter((s) => !s.found)
          .map((s) => `${s.entity} (${s.dimension})`) || [],
        mental_model_referenced_entity_ids: response.entities,
      },
    },
    tool_calls_used: 0,
  };
}
