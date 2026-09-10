// Non-Cytoscape graph rendering utilities and types extracted from the former
// research-canvas.tsx. Cytoscape components were removed; these helpers are still
// used by entity badges, query forms, and detection dialogs.

import {
  type GraphNode,
  type GraphEdge,
  type GraphCanvas,
} from '@/lib/api/client';

export type SelectionKind = 'table' | 'graph' | 'diagram' | 'text' | 'anchor' | 'tag' | 'edge';

export interface ResearchSelection {
  source: 'table' | 'graph' | 'diagram' | 'text' | 'anchor' | 'tag' | 'edge';
  kind: SelectionKind;
  ids: string[];
  context: string;
}

export type { GraphNode, GraphEdge, GraphCanvas };

export type GraphLayout = 'fcose' | 'avsdf' | 'cose' | 'dagre' | 'breadthfirst' | 'concentric' | 'circle';

const TYPE_PALETTE = [
  '#E06C75', // red
  '#98C379', // green
  '#E5C07B', // yellow
  '#61AFEF', // blue
  '#C678DD', // purple
  '#56B6C2', // cyan
  '#D19A66', // orange
  '#F0A0A0', // pink
  '#9CDCFE', // light blue
  '#B5CEA8', // light green
  '#CE9178', // tan
  '#4EC9B0', // teal
  '#FFEB3B', // bright yellow
  '#FF9800', // amber
  '#00BCD4', // sky
];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function colorForType(type?: string | null): string {
  if (!type) return '#64748b';
  return TYPE_PALETTE[hashString(type) % TYPE_PALETTE.length];
}

export function colorForEdge(edge?: { source?: string | null; type?: string | null }): string {
  const source = edge?.source;
  const rel = edge?.type;
  if (source === 'synthesize') return '#8b5cf6';
  if (source === 'mental_model') {
    if (rel === 'calls') return '#64d2c8';
    if (rel === 'depends_on') return '#d2a078';
    if (rel === 'sends') return '#b496d2';
    if (rel === 'reads') return '#96bea0';
    if (rel === 'writes') return '#dc8c96';
    return '#42a5f5';
  }
  return 'rgba(255,255,255,0.12)';
}

export function mapTypeName(type?: string | null): string {
  if (!type) return 'Other';
  return type;
}

export function truncateLabel(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
