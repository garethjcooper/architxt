import type { GraphNode, GraphEdge } from '@/lib/api/client';

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

/**
 * Attempt to extract a synthetic graph section from markdown rendered by
 * `buildEnvelopeMarkdown`. If found, returns the parsed graph and the markdown
 * with the entire `## Graph` section removed. This lets a narrative-level
 * "Add" path still merge graph data into `canvas.graph` instead of polluting
 * `synthesis.narrative`.
 */
export function extractGraphFromMarkdown(markdown: string): {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  cleanedMarkdown: string;
} {
  // Match a level-2 heading that begins a Graph section, up to the next level-2 heading or EOF.
  const graphSectionRegex = /^## Graph\b[\s\S]*?(?=^## [^#]|\Z)/m;
  const match = graphSectionRegex.exec(markdown);
  if (!match) {
    return { graph: null, cleanedMarkdown: markdown };
  }

  const section = match[0];
  const jsonBlockMatch = section.match(/```json\s*([\s\S]*?)\s*```/);
  if (!jsonBlockMatch) {
    return { graph: null, cleanedMarkdown: markdown };
  }

  try {
    const graph = JSON.parse(jsonBlockMatch[1]);
    if (!graph || typeof graph !== 'object') {
      return { graph: null, cleanedMarkdown: markdown };
    }
    const cleanedMarkdown = normalizeSpacing(markdown.replace(graphSectionRegex, ''));
    return {
      graph: {
        nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
        edges: Array.isArray(graph.edges) ? graph.edges : [],
      },
      cleanedMarkdown,
    };
  } catch {
    return { graph: null, cleanedMarkdown: markdown };
  }
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
