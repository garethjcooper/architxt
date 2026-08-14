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

  for (const roleResult of response.roles || []) {
    const roleLabel = roleResult.role.replace(/^sys_/, '').replace(/_/g, ' ');
    if (roleResult.result?.narrative) {
      narratives.push(`## ${roleLabel}\n\n${roleResult.result.narrative}`);
    }
    const graph = extractGraphFromJsonResult(roleResult.result?.json_result);
    if (graph) {
      graphs.push(graph);
      if (!roleResult.result?.narrative) {
        const found = roleResult.entities?.filter((e) => e.found).map((e) => e.entity) || [];
        const modelNames = roleResult.entities
          ?.flatMap((e) => e.model_results.filter((m) => m.found).map((m) => m.name))
          .filter((v, i, a) => a.indexOf(v) === i) || [];
        const lines = [
          `## ${roleLabel}`,
          '',
          `- Entities covered: ${found.join(', ') || 'none'}`,
          `- Models applied: ${modelNames.join(', ') || 'none'}`,
        ];
        narratives.push(lines.join('\n'));
      }
    }
    if (roleResult.result?.errors && roleResult.result.errors.length > 0) {
      for (const err of roleResult.result.errors) {
        errors.push(`${roleResult.role}: ${err.model || 'model'} — ${err.error}`);
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
          .map((s) => `${s.entity} (${s.role})`) || [],
        mental_model_referenced_entity_ids: response.entities,
      },
    },
    tool_calls_used: 0,
  };
}

function extractGraphFromJsonResult(
  jsonResult: PrebuiltResponse['roles'][number]['result']['json_result'],
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
