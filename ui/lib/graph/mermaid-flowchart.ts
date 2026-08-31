'use client';

import { truncateLabel, colorForType } from '@/components/research-canvas';
import type { GraphNode, GraphEdge } from '@/lib/api/client';

export interface GraphToMermaidOptions {
  /** Flowchart direction: TB (top-bottom) or LR (left-right). */
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  /** Optional explicit Mermaid renderer ('dagre' or 'elk'). */
  defaultRenderer?: 'dagre' | 'elk';
  /** When true, include edge type labels. Defaults to true. */
  showEdgeLabels?: boolean;
}

function safeNodeId(id: string): string {
  // Mermaid node ids must be alphanumeric plus limited punctuation.
  // Replace anything else with underscores, ensuring we never start with a digit.
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return /^[0-9]/.test(sanitized) ? `n_${sanitized}` : sanitized;
}

function nodeLabel(node: GraphNode): string {
  const label = node.name || node.label || node.id;
  return truncateLabel(label, 28).replace(/"/g, '\\"');
}

function nodeStyle(node: GraphNode): string {
  const id = safeNodeId(node.id);
  const color = node.color || colorForType(node.type);
  // Remove leading '#' for Mermaid hex colors.
  const hex = color.replace(/^#/, '');
  return `style ${id} fill:#${hex},stroke:#ffffff33,color:#fff;`;
}

/**
 * Convert a canonical graph envelope into a Mermaid flowchart source string.
 */
export function graphToMermaid(
  graph: { name?: string | null; nodes: GraphNode[]; edges: GraphEdge[] },
  options: GraphToMermaidOptions = {},
): string {
  const { direction = 'TB', defaultRenderer, showEdgeLabels = true } = options;
  const nodeSet = new Set(graph.nodes.map((n) => n.id));
  const visibleEdges = graph.edges.filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));

  const lines: string[] = ['flowchart ' + direction];
  if (defaultRenderer) {
    lines.unshift(`%%{init: {'flowchart': {'defaultRenderer': '${defaultRenderer}'}}}%%`);
  }

  for (const node of graph.nodes) {
    const id = safeNodeId(node.id);
    const label = nodeLabel(node);
    const shape = node.type ? `["${label}"]` : `[${label}]`;
    lines.push(`    ${id}${shape}`);
  }

  for (const edge of visibleEdges) {
    const fromId = safeNodeId(edge.from);
    const toId = safeNodeId(edge.to);
    const label = showEdgeLabels && edge.label ? `|${edge.label.replace(/"/g, '\\"')}|` : '';
    const arrow = edge.type || edge.label ? `-.-${label}->` : '-->';
    lines.push(`    ${fromId} ${arrow} ${toId}`);
  }

  for (const node of graph.nodes) {
    lines.push(`    ${nodeStyle(node)}`);
  }

  return lines.join('\n').trim();
}
