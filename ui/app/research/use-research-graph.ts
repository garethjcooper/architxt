'use client';

import { useMemo } from 'react';
import type { GraphNode, GraphEdge, ResearchStepSummary, DiscoverStepResponse } from '@/lib/api/client';
import {
  canonicalNodeId,
  normalizeNode,
  normalizeEdgeEndpoints,
  buildCanonicalIdMap,
  edgeKey,
  normalizeGraphShape,
  synthesizeMissingNodesForGraph,
  mergeGraphs,
} from './graph-utils';

const NO_REMERGE: unique symbol = Symbol('NO_REMERGE');

function mergeMentalModelAppliedFlags(
  nodeMap: Map<string, GraphNode>,
  appliedIds: Set<string>,
) {
  for (const id of appliedIds) {
    const node = nodeMap.get(id);
    if (node) node.mental_model_applied = true;
  }
}

function mergeNodeFields(existing: GraphNode, incoming: GraphNode): GraphNode {
  const merged = { ...incoming };
  for (const [key, value] of Object.entries(existing)) {
    const k = key as keyof GraphNode;
    if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
      (merged as any)[k] = value;
    }
  }
  return merged;
}

export function mergeStepNodes(
  trail: ResearchStepSummary[],
  selectedStepIds: Set<number>,
) {
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const mentalModelAppliedIds = new Set<string>();
  for (const step of trail.filter((s) => selectedStepIds.has(s.id))) {
    const { nodes, edges } = normalizeGraphShape(step.canvas?.graph);
    const meta = step.canvas?.meta;

    const canonicalMap = buildCanonicalIdMap(nodes);
    for (const id of canonicalizeIds(meta?.mental_model_applied_to || [], canonicalMap)) {
      mentalModelAppliedIds.add(id);
    }

    for (const n of nodes) {
      if (!n || !n.id) continue;
      const normalized = normalizeNode(n);
      const existing = nodeMap.get(normalized.id);
      if (!existing) {
        nodeMap.set(normalized.id, { ...normalized });
      } else {
        const merged = mergeNodeFields(existing, normalized);
        if ((normalized.source === 'canonical' || normalized.source === 'alias') && existing.source !== 'canonical' && existing.source !== 'alias') {
          merged.source = normalized.source;
        }
        nodeMap.set(normalized.id, merged);
      }
    }
    for (const e of edges) {
      if (!e || !e.from || !e.to) continue;
      const normalizedEdge = normalizeEdgeEndpoints(e, canonicalMap);
      const key = edgeKey(normalizedEdge);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { ...normalizedEdge, id: key, type: normalizedEdge.type || '' });
      }
    }
  }
  mergeMentalModelAppliedFlags(nodeMap, mentalModelAppliedIds);
  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };
}

function canonicalizeIds(ids: string[], map: Map<string, string>): string[] {
  return ids.map((id) => map.get(id) || id);
}

export function useResearchGraph(
  trail: ResearchStepSummary[],
  selectedStepIds: Set<number>,
  globalGraph: { nodes: GraphNode[]; edges: GraphEdge[] } | null,
  globalEntities: GraphNode[],
  result: DiscoverStepResponse | null = null,
  viewMode: 'step' | 'session' = 'session',
  activeStepId: number | null = null,
) {
  const selectedStepNodes = useMemo(
    () => mergeStepNodes(trail, selectedStepIds),
    [trail, selectedStepIds],
  );

  const mentalModelAppliedIds = useMemo(() => {
    const ids = new Set<string>();
    if (viewMode === 'session') {
      for (const step of trail.filter((s) => selectedStepIds.has(s.id))) {
        for (const id of step.canvas?.meta?.mental_model_applied_to || []) {
          ids.add(id);
        }
      }
    } else if (result?.canvas?.meta?.mental_model_applied_to) {
      for (const id of result.canvas.meta.mental_model_applied_to) {
        ids.add(id);
      }
    }
    return ids;
  }, [trail, selectedStepIds, result?.canvas?.meta, viewMode]);

  const graph = useMemo(() => {
    const resultGraph = normalizeGraphShape(result?.canvas?.graph);
    const resultGraphNodes = resultGraph.nodes;
    const resultGraphEdges = resultGraph.edges;
    const hasStepData = resultGraphNodes.length > 0 || resultGraphEdges.length > 0;
    const hasSessionData = selectedStepNodes.nodes.length > 0 || selectedStepNodes.edges.length > 0;

    // Step view: only the active result/prebuilt step. Session view: merge of
    // selected trail steps. The global bank graph is intentionally *not* mixed
    // into the research-derived entity/edge lists; it only powers the dedicated
    // Global tabs.
    let workingNodes: GraphNode[];
    let workingEdges: GraphEdge[];
    if (viewMode === 'step') {
      workingNodes = resultGraphNodes;
      workingEdges = resultGraphEdges;
    } else {
      workingNodes = hasSessionData ? selectedStepNodes.nodes : [];
      workingEdges = hasSessionData ? selectedStepNodes.edges : [];
    }
    const hasQueryData = workingNodes.length > 0 || workingEdges.length > 0;
    if (!hasQueryData && viewMode === 'step' && !hasStepData && hasSessionData) {
      // If the user switches to step view but nothing is actively loaded, fall
      // back gracefully to the selected session data rather than empty state.
      workingNodes = selectedStepNodes.nodes;
      workingEdges = selectedStepNodes.edges;
    }

    const nodeMap = new Map<string, GraphNode>();
    for (const n of workingNodes) {
      if (!n || !n.id) continue;
      const normalized = normalizeNode(n);
      const existing = nodeMap.get(normalized.id);
      if (!existing) {
        nodeMap.set(normalized.id, { ...normalized });
      } else {
        const merged = mergeNodeFields(existing, normalized);
        if ((normalized.source === 'canonical' || normalized.source === 'alias') && existing.source !== 'canonical' && existing.source !== 'alias') {
          merged.source = normalized.source;
        }
        nodeMap.set(normalized.id, merged);
      }
    }

    mergeMentalModelAppliedFlags(nodeMap, mentalModelAppliedIds);

    // Synthesize nodes for edge endpoints that are not in the working node set.
    // This is required for discovered-only results, where known entities are
    // intentionally omitted as standalone nodes but still appear as edge endpoints.
    const { nodes: synthesizedNodes, edges: synthesizedEdges } = synthesizeMissingNodesForGraph(
      { nodes: Array.from(nodeMap.values()), edges: workingEdges },
      { nodes: globalEntities, edges: [] },
    );

    // Re-apply mental-model flags after synthesis.
    for (const n of synthesizedNodes) {
      if (mentalModelAppliedIds.has(n.id)) {
        n.mental_model_applied = true;
      }
    }

    return {
      nodes: synthesizedNodes,
      edges: synthesizedEdges,
    };
  }, [globalEntities, selectedStepNodes, result?.canvas?.graph, result?.canvas?.graph?.edges, viewMode, mentalModelAppliedIds]);

  const graphNodes = graph.nodes;
  const graphEdges = graph.edges;

  const inScopeNodeIds = useMemo(() => new Set(graphNodes.map((n) => n.id)), [graphNodes]);

  const referencedOutOfScopeIds = useMemo(() => {
    const ids = new Set<string>();
    if (viewMode === 'session') {
      // Show referenced entities from the whole trail, not just the checked merge subset.
      for (const step of trail) {
        for (const id of step.canvas?.meta?.mental_model_referenced_entity_ids || []) {
          ids.add(id);
        }
      }
    } else if (result?.canvas?.meta?.mental_model_referenced_entity_ids) {
      for (const id of result.canvas.meta.mental_model_referenced_entity_ids) {
        ids.add(id);
      }
    }
    return ids;
  }, [trail, result?.canvas?.meta, viewMode]);

  const entities = useMemo(() => {
    // Build a map of every node returned by any trail step so the All list is stable
    // across Merge/Step mode and not limited to the checked merge selection.
    const allNodes = new Map<string, GraphNode>();
    for (const step of viewMode === 'session' ? trail : trail.filter((s) => s.id === activeStepId)) {
      const { nodes } = normalizeGraphShape(step.canvas?.graph);
      for (const raw of nodes) {
        if (!raw?.id) continue;
        const n = normalizeNode(raw);
        const existing = allNodes.get(n.id);
        if (!existing) {
          allNodes.set(n.id, { ...n });
        } else {
          if ((n.source === 'canonical' || n.source === 'alias') && existing.source !== 'canonical' && existing.source !== 'alias') {
            existing.source = n.source;
          }
        }
      }
    }

    // Also include nodes from the active result if in step mode.
    if (viewMode === 'step') {
      const { nodes } = normalizeGraphShape(result?.canvas?.graph);
      for (const raw of nodes) {
        if (!raw?.id) continue;
        const n = normalizeNode(raw);
        if (!allNodes.has(n.id)) {
          allNodes.set(n.id, { ...n });
        }
      }
    }

    // Add referenced/out-of-scope IDs that are not already represented.
    for (const id of referencedOutOfScopeIds) {
      if (allNodes.has(id)) continue;
      // Try to find node metadata anywhere in the trail.
      for (const step of trail) {
        const { nodes } = normalizeGraphShape(step.canvas?.graph);
        const raw = nodes.find((n) => n.id === id);
        if (raw) {
          allNodes.set(id, { ...normalizeNode(raw), source: 'mental_model_referenced' });
          break;
        }
      }
    }

    const merged = Array.from(allNodes.values());
    // In-scope first, then out-of-scope, both sorted by in-scope priority.
    const inScopeNodes = merged.filter((n) => inScopeNodeIds.has(n.id));
    const outOfScopeNodes = merged.filter((n) => !inScopeNodeIds.has(n.id));
    const byName = (a: GraphNode, b: GraphNode) =>
      (a.name || a.label || a.id).localeCompare(b.name || b.label || b.id);
    return [
      ...inScopeNodes.sort(byName).map((n) => ({ ...n, inScope: true })),
      ...outOfScopeNodes.sort(byName).map((n) => ({ ...n, inScope: false })),
    ];
  }, [graphNodes, referencedOutOfScopeIds, trail, inScopeNodeIds, viewMode, activeStepId, result?.canvas?.graph?.nodes]);

  const entityInScopeCount = graphNodes.length;
  const entityTotalCount = entities.length;

  const inScopeEdgeKeys = useMemo(() => new Set(graphEdges.map(edgeKey)), [graphEdges]);

  const edges = useMemo(() => {
    const allEdges = new Map<string, GraphEdge>();
    const sources = viewMode === 'session' ? trail : trail.filter((s) => s.id === activeStepId);
    for (const step of sources) {
      for (const e of normalizeGraphShape(step.canvas?.graph).edges) {
        if (!e || !e.from || !e.to) continue;
        const key = edgeKey(e);
        if (!allEdges.has(key)) {
          allEdges.set(key, { ...e, id: key, type: e.type || '' });
        }
      }
    }

    if (viewMode === 'step') {
      for (const e of normalizeGraphShape(result?.canvas?.graph).edges) {
        if (!e || !e.from || !e.to) continue;
        const key = edgeKey(e);
        if (!allEdges.has(key)) {
          allEdges.set(key, { ...e, id: key, type: e.type || '' });
        }
      }
    }

    const merged = Array.from(allEdges.values());
    const inScopeEdges = merged.filter((e) => inScopeEdgeKeys.has(edgeKey(e)));
    const outOfScopeEdges = merged.filter((e) => !inScopeEdgeKeys.has(edgeKey(e)));
    return [
      ...inScopeEdges.map((e) => ({ ...e, inScope: true })),
      ...outOfScopeEdges.map((e) => ({ ...e, inScope: false })),
    ];
  }, [graphEdges, trail, viewMode, activeStepId, result?.canvas?.graph?.edges, inScopeEdgeKeys]);

  const edgeInScopeCount = graphEdges.length;
  const edgeTotalCount = edges.length;

  const selectedStepEdges = useMemo(() => {
    const edgeMap = new Map<string, GraphEdge>();
    if (viewMode === 'session') {
      for (const step of trail.filter((s) => selectedStepIds.has(s.id))) {
        for (const e of normalizeGraphShape(step.canvas?.graph).edges) {
          if (!e || !e.from || !e.to) continue;
          const key = edgeKey(e);
          if (!edgeMap.has(key)) edgeMap.set(key, { ...e, id: key, type: e.type || '' });
        }
      }
    } else if (result?.canvas?.graph) {
      for (const e of normalizeGraphShape(result.canvas.graph).edges) {
        if (!e || !e.from || !e.to) continue;
        const key = edgeKey(e);
        if (!edgeMap.has(key)) edgeMap.set(key, { ...e, id: key, type: e.type || '' });
      }
    }
    return Array.from(edgeMap.values());
  }, [trail, selectedStepIds, result?.canvas?.graph?.edges, viewMode]);

  const globalCooccurrenceEdges = useMemo(() => {
    if (!globalGraph) return [];
    const allEdges = globalGraph.edges.filter((e) => {
      const lt = e.type;
      return e.source === 'co_occurrence' || /co_?occurrence/i.test(lt || '');
    });
    const nodeMapForGlobal = new Map((globalEntities || []).map((n) => [n.id, n]));
    return allEdges.filter((e) => nodeMapForGlobal.has(e.from) && nodeMapForGlobal.has(e.to));
  }, [globalGraph, globalEntities]);

  return {
    graphNodes,
    graphEdges,
    entities,
    entityInScopeCount,
    entityTotalCount,
    edges,
    edgeInScopeCount,
    edgeTotalCount,
    globalEntities,
    globalCooccurrenceEdges,
    selectedStepEdges,
    viewMode,
    activeStepId,
  };
}

export {
  canonicalNodeId,
  normalizeNode,
};
