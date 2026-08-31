'use client';

import { useMemo, useState } from 'react';
import type { GraphNode, GraphEdge } from '@/lib/api/client';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { DiagramControls } from '@/components/diagram-controls';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
import { graphToMermaid } from '@/lib/graph/mermaid-flowchart';

export interface GraphViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  graph: { name?: string | null; nodes: GraphNode[]; edges: GraphEdge[] };
  title?: string;
}

type Direction = 'TB' | 'LR' | 'BT' | 'RL';
type Renderer = 'dagre' | 'elk';

export function GraphViewModal({ open, onOpenChange, graph, title }: GraphViewModalProps) {
  const [direction, setDirection] = useState<Direction>('TB');
  const [renderer, setRenderer] = useState<Renderer>('dagre');
  const [fitToPage, setFitToPage] = useState(true);
  const containerRef = { current: null as HTMLDivElement | null };

  const source = useMemo(() => {
    if (!graph.nodes.length && !graph.edges.length) return '';
    return graphToMermaid(graph, { direction, defaultRenderer: renderer, showEdgeLabels: true });
  }, [graph, direction, renderer]);

  const isEmpty = !graph.nodes.length && !graph.edges.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col" showCloseButton>
        <DialogHeader className="shrink-0">
          <DialogTitle>{title || graph.name || 'Graph view'}</DialogTitle>
        </DialogHeader>
        <div className="shrink-0 flex items-center gap-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60">Direction</span>
            <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
              <SelectTrigger className="h-7 w-20 text-xs bg-white/5 border-white/10 px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="TB">TB</SelectItem>
                <SelectItem value="LR">LR</SelectItem>
                <SelectItem value="BT">BT</SelectItem>
                <SelectItem value="RL">RL</SelectItem>
              </SelectPopup>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60">Renderer</span>
            <Select value={renderer} onValueChange={(v) => setRenderer(v as Renderer)}>
              <SelectTrigger className="h-7 w-24 text-xs bg-white/5 border-white/10 px-2">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="dagre">dagre</SelectItem>
                <SelectItem value="elk">elk</SelectItem>
              </SelectPopup>
            </Select>
          </div>
          <div className="ml-auto text-[11px] text-white/40">
            {graph.nodes.length} nodes · {graph.edges.length} edges
          </div>
        </div>
        <div className="flex-1 min-h-0 rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden relative">
          {isEmpty ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
              No graph data available.
            </div>
          ) : (
            <div
              ref={(el) => { containerRef.current = el; }}
              className="absolute inset-0 p-3 overflow-hidden"
            >
              <MermaidDiagram
                content={source}
                name={graph.name || 'Graph'}
                type="flowchart"
                defaultRenderer={renderer}
                className="h-full"
              />
              <DiagramControls
                targetRef={containerRef as React.RefObject<HTMLElement | null>}
                fitToPage={fitToPage}
                onFitToPageChange={setFitToPage}
                className="top-2 right-2"
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
