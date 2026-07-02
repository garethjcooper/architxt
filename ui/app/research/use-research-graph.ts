import { useMemo } from 'react';
import type { GraphNode, GraphEdge, ResearchStepSummary, DiscoverStepResponse } from '@/lib/api/client';

function edgeKey(e: GraphEdge): string {
  return `${e.source}|${e.target}|${e.label || e.relationship_type || ''}`;
}

export function resolveNodeType(n: GraphNode): string {
  if (n.type) return n.type;
  if (typeof n.id === 'string' && n.id.includes(':')) {
    return n.id.split(':')[0];
  }
  return 'other';
}

export function canonicalEntityId(type: string, id: string): string {
  if (!id || type === 'other' || id.includes(':')) return id;
  return `${type}:${id}`;
}

function canonicalNodeId(n: GraphNode): string {
  const type = resolveNodeType(n);
  if (typeof n.id !== 'string') return n.id;
  if (n.id.includes(':') || type === 'other') return n.id;
  return `${type}:${n.id}`;
}

function normalizeNode(n: GraphNode): GraphNode {
  return { ...n, id: canonicalNodeId(n), type: resolveNodeType(n) };
}

function normalizeEdgeEndpoints(
  e: GraphEdge,
  canonicalIdByRaw: Map<string, string>,
): GraphEdge {
  const source = canonicalIdByRaw.get(e.source) || e.source;
  const target = canonicalIdByRaw.get(e.target) || e.target;
  if (source === e.source && target === e.target) return e;
  return { ...e, source, target };
}

function mergeMentalModelAppliedFlags(
  nodeMap: Map<string, GraphNode>,
  appliedIds: Set<string>,
) {
  for (const id of appliedIds) {
    const node = nodeMap.get(id);
    if (node) node.mental_model_applied = true;
  }
}

function buildCanonicalIdMap(nodes: GraphNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of nodes) {
    if (!n?.id) continue;
    const normalized = normalizeNode(n);
    if (normalized.id !== n.id) {
      map.set(n.id, normalized.id);
    }
    // Also index by a de-prefixed id so "COM-007" can resolve to "a-com:COM-007".
    if (typeof n.id === 'string' && n.id.includes(':')) {
      const bare = n.id.split(':').slice(1).join(':');
      if (!map.has(bare)) map.set(bare, normalized.id);
    }
  }
  return map;
}

function canonicalizeIds(ids: string[], map: Map<string, string>): string[] {
  return ids.map((id) => map.get(id) || id);
}

export function mergeStepNodes(
  trail: ResearchStepSummary[],
  selectedStepIds: Set<number>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();
  const mentalModelAppliedIds = new Set<string>();
  for (const step of trail.filter((s) => selectedStepIds.has(s.id))) {
    const nodes = step.canvas?.graph?.nodes || [];
    const edges = step.canvas?.graph?.edges || [];
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
        existing.mention_count = Math.max(existing.mention_count ?? 1, normalized.mention_count ?? 1);
        existing.prominence = Math.max(existing.prominence ?? 0, normalized.prominence ?? 0);
        if ((normalized.source === 'canonical' || normalized.source === 'alias') && existing.source !== 'canonical' && existing.source !== 'alias') {
          existing.source = normalized.source;
        }
      }
    }
    for (const e of edges) {
      if (!e || !e.source || !e.target) continue;
      const normalizedEdge = normalizeEdgeEndpoints(e, canonicalMap);
      const key = edgeKey(normalizedEdge);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { ...normalizedEdge, relationship_type: normalizedEdge.relationship_type || normalizedEdge.link_type });
      }
    }
  }
  mergeMentalModelAppliedFlags(nodeMap, mentalModelAppliedIds);
  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()).filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target)),
  };
}

export function useResearchGraph(
  trail: ResearchStepSummary[],
  selectedStepIds: Set<number>,
  globalGraph: { nodes: GraphNode[]; edges: GraphEdge[] } | null,
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
    const resultGraphNodes = result?.canvas?.graph?.nodes || [];
    const resultGraphEdges = result?.canvas?.graph?.edges || [];
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
        nodeMap.set(normalized.id, { ...normalized, depth: Math.min(normalized.depth ?? 0, 1) });
      } else {
        existing.mention_count = Math.max(existing.mention_count ?? 1, normalized.mention_count ?? 1);
        existing.prominence = Math.max(existing.prominence ?? 0, normalized.prominence ?? 0);
        if ((normalized.source === 'canonical' || normalized.source === 'alias') && existing.source !== 'canonical' && existing.source !== 'alias') {
          existing.source = normalized.source;
        }
      }
    }

    mergeMentalModelAppliedFlags(nodeMap, mentalModelAppliedIds);

    const canonicalIdMap = buildCanonicalIdMap(workingNodes);
    const edgeMap = new Map<string, GraphEdge>();
    for (const e of workingEdges) {
      if (!e || !e.source || !e.target) continue;
      // Re-canonicalize edge endpoints in case edges were loaded from a result
      // where node/edge ids do not share the same prefix convention.
      const normalizedEdge = normalizeEdgeEndpoints(e, canonicalIdMap);
      if (!nodeMap.has(normalizedEdge.source) || !nodeMap.has(normalizedEdge.target)) continue;
      const key = edgeKey(normalizedEdge);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { ...normalizedEdge, id: key, relationship_type: normalizedEdge.relationship_type || normalizedEdge.link_type });
      }
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges: Array.from(edgeMap.values()),
    };
  }, [globalGraph, selectedStepNodes, result?.canvas?.graph, result?.canvas?.graph?.edges, viewMode, mentalModelAppliedIds]);

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
      for (const raw of step.canvas?.graph?.nodes || []) {
        if (!raw?.id) continue;
        const n = normalizeNode(raw);
        const existing = allNodes.get(n.id);
        if (!existing) {
          allNodes.set(n.id, { ...n });
        } else {
          existing.mention_count = Math.max(existing.mention_count ?? 1, n.mention_count ?? 1);
          existing.prominence = Math.max(existing.prominence ?? 0, n.prominence ?? 0);
        }
      }
    }

    // Also include nodes from the active result if in step mode.
    if (viewMode === 'step') {
      for (const raw of result?.canvas?.graph?.nodes || []) {
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
        const raw = step.canvas?.graph?.nodes.find((n) => n.id === id);
        if (raw) {
          allNodes.set(id, { ...normalizeNode(raw), source: 'mental_model_referenced' });
          break;
        }
      }
    }

    const merged = Array.from(allNodes.values());
    // In-scope first, then out-of-scope, both sorted by prominence/mention_count.
    const inScopeNodes = merged.filter((n) => inScopeNodeIds.has(n.id));
    const outOfScopeNodes = merged.filter((n) => !inScopeNodeIds.has(n.id));
    const byRelevance = (a: GraphNode, b: GraphNode) =>
      (b.prominence ?? 0) - (a.prominence ?? 0) || (b.mention_count ?? 1) - (a.mention_count ?? 1);
    return [
      ...inScopeNodes.sort(byRelevance).map((n) => ({ ...n, inScope: true })),
      ...outOfScopeNodes.sort(byRelevance).map((n) => ({ ...n, inScope: false })),
    ];
  }, [graphNodes, referencedOutOfScopeIds, trail, inScopeNodeIds, viewMode, activeStepId, result?.canvas?.graph?.nodes]);

  const entityInScopeCount = graphNodes.length;
  const entityTotalCount = entities.length;

  const inScopeEdgeKeys = useMemo(() => new Set(graphEdges.map(edgeKey)), [graphEdges]);

  const edges = useMemo(() => {
    const allEdges = new Map<string, GraphEdge>();
    const sources = viewMode === 'session' ? trail : trail.filter((s) => s.id === activeStepId);
    for (const step of sources) {
      for (const e of step.canvas?.graph?.edges || []) {
        if (!e || !e.source || !e.target) continue;
        const key = edgeKey(e);
        if (!allEdges.has(key)) {
          allEdges.set(key, { ...e, relationship_type: e.relationship_type || e.link_type });
        }
      }
    }

    if (viewMode === 'step') {
      for (const e of result?.canvas?.graph?.edges || []) {
        if (!e || !e.source || !e.target) continue;
        const key = edgeKey(e);
        if (!allEdges.has(key)) {
          allEdges.set(key, { ...e, relationship_type: e.relationship_type || e.link_type });
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
        for (const e of step.canvas?.graph?.edges || []) {
          if (!e || !e.source || !e.target) continue;
          const key = edgeKey(e);
          if (!edgeMap.has(key)) edgeMap.set(key, { ...e, relationship_type: e.relationship_type || e.link_type });
        }
      }
    } else if (result?.canvas?.graph?.edges) {
      for (const e of result.canvas.graph.edges) {
        if (!e || !e.source || !e.target) continue;
        const key = edgeKey(e);
        if (!edgeMap.has(key)) edgeMap.set(key, { ...e, relationship_type: e.relationship_type || e.link_type });
      }
    }
    return Array.from(edgeMap.values());
  }, [trail, selectedStepIds, result?.canvas?.graph?.edges, viewMode]);

  const globalEntities = useMemo(() => {
    if (!globalGraph) return [];
    return globalGraph.nodes.map((n) => ({ ...n, depth: Math.min(n.depth ?? 0, 1) }));
  }, [globalGraph]);

  const globalCooccurrenceEdges = useMemo(() => {
    if (!globalGraph) return [];
    const allEdges = globalGraph.edges.filter((e) => {
      const lt = e.link_type || e.relationship_type;
      return e.edge_source === 'co_occurrence' || /co_?occurrence/i.test(lt || '');
    });
    const nodeMapForGlobal = new Map(globalEntities.map((n) => [n.id, n]));
    return allEdges.filter((e) => nodeMapForGlobal.has(e.source) && nodeMapForGlobal.has(e.target));
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
