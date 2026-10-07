'use client';

import { Copy, Download, Map as MapIcon, Code2 } from 'lucide-react';
import type { Node, Edge } from '@xyflow/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  copyReactFlowSvg,
  copyReactFlowPng,
  downloadReactFlowSvg,
  downloadReactFlowPng,
} from '@/lib/reactflow-export';
import type { ViewNode, ViewEdge } from '@/lib/types';
import { viewToMermaid, type MermaidEdgeInput } from '@/lib/graph/view-to-mermaid';
import { copyText } from '@/lib/clipboard-utils';

export interface ViewExportMenuProps {
  /** The React Flow wrapper element. */
  container: HTMLElement | null;
  /** Current React Flow nodes (with `data.node` ViewNode and display flags). */
  nodes: Node[];
  /** Current React Flow edges. */
  edges: Edge[];
  /** Optional direction for Mermaid flowchart export. */
  mermaidDirection?: 'TB' | 'TD' | 'LR' | 'RL' | 'BT' | 'DOWN' | 'UP' | 'LEFT' | 'RIGHT';
  /** Optional title for Mermaid front matter. */
  mermaidTitle?: string;
  /** Whether to include edge labels in Mermaid export. Defaults to true. */
  showMermaidEdgeLabels?: boolean;
}

export function ViewExportMenu({
  container,
  nodes,
  edges,
  mermaidDirection = 'TB',
  mermaidTitle,
  showMermaidEdgeLabels = true,
}: ViewExportMenuProps) {
  const imageDisabled = !container || nodes.length === 0;
  const mermaidDisabled = nodes.length === 0;

  const viewNodes = nodes
    .map((n) => (n.data as { node?: ViewNode } | undefined)?.node)
    .filter((n): n is ViewNode => Boolean(n));
  const viewNodesById = new Map(viewNodes.map((n) => [n.id, n]));
  const viewEdges: MermaidEdgeInput[] = edges
    .map((e) => {
      const data = (e.data ?? {}) as Partial<ViewEdge> & {
        bundledEdges?: ViewEdge[];
        bundledCount?: number;
        bidirectional?: boolean;
        canonicalOnly?: boolean;
      };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: data.label,
        edge_type: data.edge_type,
        properties: data.properties,
        style: data.style,
        ref_id: data.ref_id,
        source_ref_id: data.source_ref_id,
        target_ref_id: data.target_ref_id,
        bundledEdges: data.bundledEdges,
        bundledCount: data.bundledCount,
        bidirectional: data.bidirectional,
        canonicalOnly: data.canonicalOnly,
      } as MermaidEdgeInput;
    })
    .filter((e) => viewNodesById.has(e.source) && viewNodesById.has(e.target));

  const handleCopyMermaid = () => {
    const source = viewToMermaid(viewNodes, viewEdges, {
      direction: mermaidDirection,
      title: mermaidTitle,
      showEdgeLabels: showMermaidEdgeLabels,
    });
    void copyText(source, 'Mermaid flowchart');
  };

  const handleDownloadMermaid = () => {
    const source = viewToMermaid(viewNodes, viewEdges, {
      direction: mermaidDirection,
      title: mermaidTitle,
      showEdgeLabels: showMermaidEdgeLabels,
    });
    const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
    const date = new Date().toISOString().split('T')[0];
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `view-${date}.mmd`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <span
          role="button"
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          title={imageDisabled ? 'Canvas not ready' : 'Export view'}
        >
          <MapIcon className="h-3.5 w-3.5" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuItem
          disabled={imageDisabled}
          onClick={() => container && void copyReactFlowPng({ container, nodes, edges })}
        >
          <Copy className="h-3 w-3" /> Copy as PNG
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={imageDisabled}
          onClick={() => container && void downloadReactFlowPng({ container, nodes, edges })}
        >
          <Download className="h-3 w-3" /> Download PNG
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={imageDisabled}
          onClick={() => container && void copyReactFlowSvg({ container, nodes, edges })}
        >
          <Copy className="h-3 w-3" /> Copy as SVG
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={imageDisabled}
          onClick={() => container && void downloadReactFlowSvg({ container, nodes, edges })}
        >
          <Download className="h-3 w-3" /> Download SVG
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={mermaidDisabled}
          onClick={handleCopyMermaid}
        >
          <Code2 className="h-3 w-3" /> Copy as Mermaid
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={mermaidDisabled}
          onClick={handleDownloadMermaid}
        >
          <Code2 className="h-3 w-3" /> Download Mermaid
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
