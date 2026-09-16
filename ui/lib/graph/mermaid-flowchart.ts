'use client';

import { truncateLabel, colorForType } from '@/lib/graph/render-utils';
import type { GraphNode, GraphEdge } from '@/lib/api/client';

export interface GraphToMermaidOptions {
  /** Flowchart direction: TB (top-bottom) or LR (left-right). */
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  /** Optional explicit Mermaid renderer ('dagre' or 'elk'). */
  defaultRenderer?: 'dagre' | 'elk';
  /** When true, include edge type labels. Defaults to true. */
  showEdgeLabels?: boolean;
}

const RESERVED = new Set([
  'flowchart', 'graph', 'subgraph', 'end', 'direction', 'style', 'classDef', 'class',
  'linkStyle', 'click', 'call', 'tooltip', 'loop', 'alt', 'else', 'opt', 'par',
  'and', 'break', 'critical', 'option', 'over', 'rect', 'newlines', 'comment',
]);

function safeNodeId(id: string): string {
  // Mermaid ids need to start with a letter or be quoted.
  // Replace any character that is not alphanumeric/underscore with underscore.
  let sanitized = id.replace(/[^a-zA-Z0-9_]/g, '_');
  if (!sanitized || /^[0-9]/.test(sanitized)) {
    sanitized = `n_${sanitized || 'x'}`;
  }
  if (RESERVED.has(sanitized)) {
    sanitized = `n_${sanitized}`;
  }
  return sanitized;
}

function quotedLabel(label: string): string {
  // Wrap labels in double quotes and escape any inner quotes.
  return `"${label.replace(/"/g, '\\"')}"`;
}

function nodeLabel(node: GraphNode): string {
  const label = node.name || node.label || node.id;
  return truncateLabel(label, 28);
}

/**
 * Convert a canonical graph envelope into a Mermaid flowchart source string.
 */
export function graphToMermaid(
  graph: { name?: string | null; nodes: GraphNode[]; edges: GraphEdge[] },
  options: GraphToMermaidOptions = {},
): string {
  const { direction = 'TB', defaultRenderer = 'elk', showEdgeLabels = true } = options;
  const nodeSet = new Set(graph.nodes.map((n) => n.id));
  const visibleEdges = graph.edges.filter((e) => nodeSet.has(e.from) && nodeSet.has(e.to));

  const lines: string[] = ['flowchart ' + direction];
  lines.unshift(`%%{init: {'layout': '${defaultRenderer}'}}%%`);

  for (const node of graph.nodes) {
    const id = safeNodeId(node.id);
    const label = nodeLabel(node);
    // Always quote labels so spaces and punctuation are safe.
    lines.push(`    ${id}[${quotedLabel(label)}]`);
  }

  for (const edge of visibleEdges) {
    const fromId = safeNodeId(edge.from);
    const toId = safeNodeId(edge.to);
    const label = showEdgeLabels && edge.label ? ` ${quotedLabel(edge.label)} ` : '';
    const arrow = label ? `-.${label}.->` : '-->';
    lines.push(`    ${fromId} ${arrow} ${toId}`);
  }

  return lines.join('\n').trim();
}
