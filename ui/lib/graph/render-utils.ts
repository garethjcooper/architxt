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
  'var(--color-diagram-edge-mental-writes)', // red
  'var(--color-diagram-node-entity)', // green
  'var(--color-accent-tertiary-fg)', // yellow
  'var(--color-syntax-keyword)', // blue
  'var(--color-diagram-edge-synthesize)', // purple
  'var(--color-syntax-function)', // cyan
  'var(--color-accent-tertiary-fg)', // orange
  'var(--color-diagram-edge-mental-writes)', // pink
  'var(--color-syntax-keyword)', // light blue
  'var(--color-diagram-node-entity)', // light green
  'var(--color-accent-tertiary-fg)', // tan
  'var(--color-syntax-function)', // teal
  'var(--color-accent-tertiary-fg)', // bright yellow
  'var(--color-diagram-edge-mental-depends)', // amber
  'var(--color-syntax-function)', // sky
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
  if (!type) return 'var(--color-aql-directive-sub)';
  return TYPE_PALETTE[hashString(type) % TYPE_PALETTE.length];
}

export function colorForEdge(edge?: { source?: string | null; type?: string | null }): string {
  const source = edge?.source;
  const rel = edge?.type;
  if (source === 'synthesize') return 'var(--color-diagram-edge-synthesize)';
  if (source === 'mental_model') {
    if (rel === 'calls') return 'var(--color-diagram-edge-mental-calls)';
    if (rel === 'depends_on') return 'var(--color-diagram-edge-mental-depends)';
    if (rel === 'sends') return 'var(--color-diagram-edge-mental-sends)';
    if (rel === 'reads') return 'var(--color-diagram-edge-mental-reads)';
    if (rel === 'writes') return 'var(--color-diagram-edge-mental-writes)';
    return 'var(--color-diagram-edge-mental-default)';
  }
  return 'var(--color-border-subtle)';
}

export function mapTypeName(type?: string | null): string {
  if (!type) return 'Other';
  return type;
}

export function truncateLabel(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
