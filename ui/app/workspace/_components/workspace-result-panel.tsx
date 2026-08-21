'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  ResearchResultPanel,
  type ResearchCopyEvent,
} from '@/app/research/research-result-panel';
import type {
  DiscoverStepResponse,
  GraphEdge,
  GraphNode,
  ResearchStepSummary,
} from '@/lib/api/client';
import type { GraphLayout } from '@/components/research-canvas';

interface WorkspaceResultPanelProps {
  result: DiscoverStepResponse | ResearchStepSummary | null;
  loading: boolean;
  error: string | null;
  sessionName?: string;
  onCopy?: (event: ResearchCopyEvent) => void;
}

export function WorkspaceResultPanel({
  result,
  loading,
  error,
  sessionName,
  onCopy,
}: WorkspaceResultPanelProps) {
  const [canvasView, setCanvasView] = useState<'graph' | 'components'>('graph');
  const [graphLayout, setGraphLayout] = useState<GraphLayout>('avsdf');
  const [graphLayoutAnimate, setGraphLayoutAnimate] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [narrativeWidth, setNarrativeWidth] = useState(40);
  const [showNarrativePlain, setShowNarrativePlain] = useState(false);
  const [edgeFilters, setEdgeFilters] = useState<Set<string>>(new Set());
  const [nodeFilters, setNodeFilters] = useState<Set<string>>(new Set());

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

  const graphNodes: GraphNode[] = useMemo(
    () => result?.canvas?.graph?.nodes || [],
    [result?.canvas?.graph?.nodes]
  );
  const graphEdges: GraphEdge[] = useMemo(
    () => result?.canvas?.graph?.edges || [],
    [result?.canvas?.graph?.edges]
  );

  return (
    <ResearchResultPanel
      loading={loading}
      error={error}
      result={result}
      viewMode="step"
      trail={[]}
      selectedStepIds={new Set()}
      resultView="narrative"
      canvasView={canvasView}
      setCanvasView={setCanvasView}
      graphNodes={graphNodes}
      graphEdges={graphEdges}
      allGraphEdges={graphEdges}
      graphLayout={graphLayout}
      setGraphLayout={setGraphLayout}
      graphLayoutAnimate={graphLayoutAnimate}
      setGraphLayoutAnimate={setGraphLayoutAnimate}
      showEdgeLabels={showEdgeLabels}
      setShowEdgeLabels={setShowEdgeLabels}
      edgeFilters={edgeFilters}
      toggleEdgeFilter={toggleEdgeFilter}
      nodeFilters={nodeFilters}
      toggleNodeFilter={toggleNodeFilter}
      onGraphAddToQuery={() => {}}
      bottomFlex={1}
      narrativeWidth={narrativeWidth}
      sessionName={sessionName || 'reflect'}
      showNarrativePlain={showNarrativePlain}
      setShowNarrativePlain={setShowNarrativePlain}
      onCopy={onCopy}
    />
  );
}
