import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge } from '@/lib/api/client';

export interface TableItem {
  name: string;
  columns?: string[];
  rows: Record<string, unknown>[];
}

export interface DiagramItem {
  name: string;
  type: string;
  content: string;
}

type EnvelopeLike = {
  synthesis?: { narrative?: string | null } | null;
  canvas?: {
    graph?: { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
    tables?: TableItem[] | null;
    diagrams?: DiagramItem[] | null;
  } | null;
};

export interface GraphMergeResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  addedNodes: number;
  addedEdges: number;
  skippedNodes: number;
  skippedEdges: number;
}

function nodeId(n: GraphNode): string {
  return n.id;
}

function edgeKey(e: GraphEdge): string {
  const from = e.from || '';
  const to = e.to || '';
  const type = e.type || '';
  const label = e.label || '';
  return `${from}|${to}|${type}|${label}`;
}

function edgeEndpoints(e: GraphEdge): Set<string> {
  const set = new Set<string>();
  if (e.from) set.add(e.from);
  if (e.to) set.add(e.to);
  return set;
}

/**
 * Merge source graph nodes/edges into a target graph.
 *
 * Rules:
 * - Nodes are keyed by `id`. First occurrence wins; later duplicates are skipped.
 * - Edges are keyed by `(from, to, type, label)`. First occurrence wins.
 * - After merging, orphan nodes (nodes with no incident edge) are removed.
 *
 * Returns the merged graph plus counts for UX feedback.
 */
export function mergeGraphs(
  target: { nodes: GraphNode[]; edges: GraphEdge[] },
  source: { nodes: GraphNode[]; edges: GraphEdge[] }
): GraphMergeResult {
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();

  for (const n of target.nodes) {
    nodeMap.set(nodeId(n), n);
  }
  for (const e of target.edges) {
    edgeMap.set(edgeKey(e), e);
  }

  let addedNodes = 0;
  let skippedNodes = 0;
  for (const n of source.nodes) {
    const id = nodeId(n);
    if (nodeMap.has(id)) {
      skippedNodes++;
    } else {
      nodeMap.set(id, n);
      addedNodes++;
    }
  }

  let addedEdges = 0;
  let skippedEdges = 0;
  for (const e of source.edges) {
    const key = edgeKey(e);
    if (edgeMap.has(key)) {
      skippedEdges++;
    } else {
      edgeMap.set(key, e);
      addedEdges++;
    }
  }

  // Filter out orphan nodes — every node must have at least one incident edge.
  const connectedNodeIds = new Set<string>();
  for (const e of edgeMap.values()) {
    for (const id of edgeEndpoints(e)) {
      connectedNodeIds.add(id);
    }
  }

  const nodes: GraphNode[] = [];
  let removedOrphans = 0;
  for (const n of nodeMap.values()) {
    if (connectedNodeIds.has(nodeId(n))) {
      nodes.push(n);
    } else {
      removedOrphans++;
    }
  }

  const edges = Array.from(edgeMap.values());

  return {
    nodes,
    edges,
    addedNodes,
    addedEdges,
    skippedNodes,
    skippedEdges: skippedEdges + removedOrphans,
  };
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
