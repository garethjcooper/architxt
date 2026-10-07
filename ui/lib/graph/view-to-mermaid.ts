'use client';

import type { ViewNode, ViewEdge } from '@/lib/types';
import { truncateLabel } from '@/lib/graph/render-utils';

export interface ViewToMermaidOptions {
  /**
   * Flowchart direction.
   * Elk directions are normalised: DOWN -> TB, UP -> BT, LEFT -> RL, RIGHT -> LR.
   */
  direction?: 'TB' | 'TD' | 'LR' | 'RL' | 'BT' | 'DOWN' | 'UP' | 'LEFT' | 'RIGHT';
  /** Optional flowchart title rendered as Mermaid front matter. */
  title?: string;
  /** Include edge labels. Defaults to true. */
  showEdgeLabels?: boolean;
}

const DIRECTION_MAP: Record<string, 'TB' | 'BT' | 'RL' | 'LR'> = {
  DOWN: 'TB',
  UP: 'BT',
  LEFT: 'RL',
  RIGHT: 'LR',
  TB: 'TB',
  TD: 'TB',
  BT: 'BT',
  RL: 'RL',
  LR: 'LR',
};

export interface MermaidEdgeInput extends ViewEdge {
  bundledCount?: number;
  bundledEdges?: ViewEdge[];
  bidirectional?: boolean;
  canonicalOnly?: boolean;
}

const RESERVED = new Set([
  'flowchart', 'graph', 'subgraph', 'end', 'direction', 'style', 'classDef', 'class',
  'linkStyle', 'click', 'call', 'tooltip', 'loop', 'alt', 'else', 'opt', 'par',
  'and', 'break', 'critical', 'option', 'over', 'rect', 'newlines', 'comment',
]);

function safeNodeId(id: string): string {
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
  return `"${label.replace(/"/g, '\\"')}"`;
}

function nodeLabel(node: ViewNode): string {
  const label = node.label || node.name || node.text;
  return truncateLabel(label || node.id, 28);
}

function edgeTypeLabel(edge: MermaidEdgeInput, nodeById: Map<string, ViewNode>): string | undefined {
  const count = edge.bundledCount || 1;
  const base = edge.label || edge.edge_type;
  // For canonical-only hindsight edges that have no human-readable label,
  // fall back to the resolved source/target node labels so the diagram reads
  // like "ICMS -> FUSE" instead of the raw edge id.
  const needsFallback =
    count === 1 &&
    (!base || edge.canonicalOnly || edge.edge_type === 'hindsight' || (edge.id && edge.id.startsWith('hindsight-')));
  if (needsFallback) {
    const sourceLabel = nodeById.get(edge.source)?.label || nodeById.get(edge.source)?.name || edge.source;
    const targetLabel = nodeById.get(edge.target)?.label || nodeById.get(edge.target)?.name || edge.target;
    return `${sourceLabel} → ${targetLabel}`;
  }
  if (count > 1) {
    // For bundles where every edge has the same edge_type, show the type;
    // otherwise just show the count so we don't pick one arbitrary label.
    const bundledTypes = (edge.bundledEdges || []).map((e) => e.edge_type);
    const allTypes = new Set([edge.edge_type, ...bundledTypes].filter(Boolean));
    const commonType = allTypes.size === 1 ? Array.from(allTypes)[0] : undefined;
    if (edge.bidirectional) {
      return commonType ? `${commonType} ↔ ${count}` : `↔ ${count}`;
    }
    return commonType ? `${commonType} × ${count}` : `×${count}`;
  }
  return base;
}

/**
 * Convert a view graph (ViewNode[], ViewEdge[]) into a Mermaid flowchart
 * source string.
 */
export function viewToMermaid(
  nodes: ViewNode[],
  edges: MermaidEdgeInput[],
  options: ViewToMermaidOptions = {},
) {
  const { direction = 'TB', title, showEdgeLabels = true } = options;
  const flowchartDirection = DIRECTION_MAP[direction] ?? 'TB';
  const nodeSet = new Set(nodes.map((n) => n.id));
  const visibleEdges = edges.filter((e) => nodeSet.has(e.source) && nodeSet.has(e.target));

  const lines: string[] = [];

  if (title && title.trim()) {
    lines.push('---');
    lines.push(`title: ${title.trim()}`);
    lines.push('config:');
    lines.push('  layout: elk');
    lines.push('---');
  }

  lines.push(`flowchart ${flowchartDirection}`);

  for (const node of nodes) {
    const id = safeNodeId(node.id);
    const label = nodeLabel(node);
    lines.push(`    ${id}[${quotedLabel(label)}]`);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of visibleEdges) {
    const fromId = safeNodeId(edge.source);
    const toId = safeNodeId(edge.target);
    const label = showEdgeLabels ? edgeTypeLabel(edge, nodeById) : undefined;
    const arrow = label ? `-.${quotedLabel(label)}.->` : '-->';
    lines.push(`    ${fromId} ${arrow} ${toId}`);
  }

  return lines.join('\n').trim();
}
