'use client';

import type { GraphEdge, GraphNode } from '@/lib/api/client';
import { EdgeTable } from './edge-table';

export type EdgeTab = 'found' | 'global';

export interface CompositeEdgesProps {
  edgeTab: EdgeTab;
  edges: Array<GraphEdge & { inScope?: boolean }>;
  globalEdges: GraphEdge[];
  nodeMap: Map<string, GraphNode>;
  onInsertToken: (token: string) => void;
}

export function CompositeEdges(props: CompositeEdgesProps) {
  const {
    edgeTab,
    edges,
    globalEdges,
    nodeMap,
    onInsertToken,
  } = props;

  const visibleEdges = edgeTab === 'global' ? globalEdges : edges;

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="overflow-y-auto px-3 py-2 min-h-0 flex-1">
        {visibleEdges.length > 0 ? (
          <EdgeTable
            edges={visibleEdges}
            nodeMap={nodeMap}
            onInsertToken={onInsertToken}
          />
        ) : (
          <p className="text-xs text-white/40">No {edgeTab === 'global' ? 'global' : 'selected'} edges.</p>
        )}
      </div>
    </div>
  );
}
