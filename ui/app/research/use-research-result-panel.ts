import { useCallback, useMemo, useState } from 'react';
import type { GraphEdge, GraphNode } from '@/lib/api/client';
import type { GraphLayout } from '@/components/research-canvas';

export type CanvasView = 'graph' | 'components';

export interface UseResearchResultPanelOptions {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  allEdges?: GraphEdge[];
}

export function useResearchResultPanel(options: UseResearchResultPanelOptions = {}) {
  const [canvasView, setCanvasView] = useState<CanvasView>('graph');
  const [graphLayout, setGraphLayout] = useState<GraphLayout>('avsdf');
  const [graphLayoutAnimate, setGraphLayoutAnimate] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [edgeFilters, setEdgeFilters] = useState<Set<string>>(new Set());
  const [nodeFilters, setNodeFilters] = useState<Set<string>>(new Set());
  const [showNarrativePlain, setShowNarrativePlain] = useState(false);

  const toggleEdgeFilter = useCallback((type: string) => {
    setEdgeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleNodeFilter = useCallback((type: string) => {
    setNodeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const graphNodes = useMemo(() => options.nodes ?? [], [options.nodes]);
  const graphEdges = useMemo(() => options.edges ?? [], [options.edges]);
  const allGraphEdges = useMemo(() => options.allEdges ?? graphEdges, [options.allEdges, graphEdges]);

  return {
    canvasView,
    setCanvasView,
    graphNodes,
    graphEdges,
    allGraphEdges,
    graphLayout,
    setGraphLayout,
    graphLayoutAnimate,
    setGraphLayoutAnimate,
    showEdgeLabels,
    setShowEdgeLabels,
    edgeFilters,
    toggleEdgeFilter,
    nodeFilters,
    toggleNodeFilter,
    showNarrativePlain,
    setShowNarrativePlain,
  };
}
