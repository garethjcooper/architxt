'use client';

import type {
  PrebuiltResponse,
  DiscoverStepResponse,
  GraphNode,
  GraphEdge,
} from '@/lib/api/client';
import {
  isGraph,
  mergeGraphs,
  normalizeGraphShape,
  normalizeNode,
  synthesizeMissingNodesForGraph,
  canonicalNodeId,
} from './graph-utils';

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
  const errors: string[] = [];

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
    if (dimension.result?.errors && dimension.result.errors.length > 0) {
      for (const err of dimension.result.errors) {
        errors.push(`${dimension.dimension}: ${err.model || 'model'} — ${err.error}`);
      }
    }
  }

  const errorMessage = errors.length > 0 ? errors.join('\n') : undefined;
  const narrativeParts = narratives.length > 0 ? narratives : ['No prebuilt results available.'];
  if (errorMessage) {
    narrativeParts.push('', 'Errors:', errorMessage);
  }

  return {
    session_id: response.session_id ?? 0,
    step_id: response.step_id ?? 0,
    status: 'completed',
    bank_id: bankId,
    viewpoint_ids: [],
    query_depth: 'prebuilt',
    synthesis: {
      narrative: narrativeParts.join('\n'),
    },
    canvas: {
      graph: graphs.length > 0 ? mergeGraphs(...graphs) : { nodes: [], edges: [] },
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

function extractGraphFromJsonResult(
  jsonResult: PrebuiltResponse['dimensions'][number]['result']['json_result'],
): { nodes: GraphNode[]; edges: GraphEdge[] } | null {
  if (!jsonResult) return null;

  if (Array.isArray(jsonResult)) {
    const graphs = jsonResult.filter(isGraph);
    if (graphs.length === 0) return null;
    return graphs.length === 1 ? graphs[0] : mergeGraphs(...graphs);
  }

  return isGraph(jsonResult) ? jsonResult : null;
}

export {
  normalizeNode,
  canonicalNodeId,
  synthesizeMissingNodesForGraph,
  normalizeGraphShape,
  mergeGraphs,
};
