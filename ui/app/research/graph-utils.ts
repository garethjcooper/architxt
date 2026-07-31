'use client';

import type { GraphNode, GraphEdge } from '@/lib/api/client';

/**
 * Graph canonicalization and synthesis utilities shared across Research and Explore.
 *
 * All graph normalization functions live here so Research step/session merging,
 * Prebuilt responses, and Explore canvas operations use the same ID rules,
 * endpoint completion, and node shape.
 */

export function isGraph(value: unknown): value is { nodes: GraphNode[]; edges: GraphEdge[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as any).nodes) &&
    Array.isArray((value as any).edges)
  );
}

export function resolveNodeType(n: GraphNode): string {
  if (n.type) return n.type;
  if (typeof n.id === 'string' && n.id.includes(':')) {
    // For "found:some-flow" the prefix is the discovered category.
    // For "a-com:COM-001" the prefix is the known entity type abbreviation.
    const prefix = n.id.split(':')[0];
    return prefix;
  }
  return 'other';
}

/**
 * Return a stable display type for a node. Known entity ids use the entity's
 * canonical type abbreviation (e.g. "a-com"). Discovered ids use "found".
 * Otherwise falls back to the explicit node type or "other".
 */
export function displayNodeType(n: GraphNode): string {
  if (typeof n.id === 'string' && n.id.startsWith('found:')) return 'found';
  if (typeof n.id === 'string' && n.id.includes(':')) {
    return n.id.split(':')[0];
  }
  return n.type || 'other';
}

export function canonicalNodeId(n: GraphNode): string {
  const type = resolveNodeType(n);
  if (typeof n.id !== 'string') return n.id;
  if (n.id.includes(':') || type === 'other') return n.id;
  return `${type}:${n.id}`;
}

export function normalizeNode(n: GraphNode): GraphNode {
  const type = resolveNodeType(n);
  const id = canonicalNodeId(n);
  return { ...n, id, type };
}

export function normalizeEdgeEndpoints(
  e: GraphEdge,
  canonicalIdByRaw: Map<string, string>,
): GraphEdge {
  const from = canonicalIdByRaw.get(e.from) || e.from;
  const to = canonicalIdByRaw.get(e.to) || e.to;
  if (from === e.from && to === e.to) return e;
  return { ...e, from, to };
}

export function buildCanonicalIdMap(nodes: GraphNode[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of nodes) {
    if (!n?.id) continue;
    const normalized = normalizeNode(n);
    if (normalized.id !== n.id) {
      map.set(n.id, normalized.id);
    }
    // Also index by a de-prefixed id so "COM-007" can resolve to "a-com:COM-007".
    if (typeof n.id === 'string' && n.id.includes(':')) {
      const bare = n.id.split(':').slice(1).join(':');
      if (!map.has(bare)) map.set(bare, normalized.id);
    }
  }
  return map;
}

export function edgeKey(e: GraphEdge): string {
  return `${e.from}|${e.to}|${e.label || e.type || ''}`;
}

/**
 * Synthesize minimal nodes for edge endpoints that are missing from the graph.
 * Discovered-only mental-model responses intentionally omit known entities from
 * the `nodes` array while still referencing them in edges. Use the global bank
 * graph for display metadata and canonical ID resolution when available;
 * otherwise fall back to the raw id.
 *
 * Synthetic nodes always carry id, name, label, and type so the canvas renderer
 * has a stable display shape.
 */
export function synthesizeMissingNodesForGraph(
  graph: { nodes: GraphNode[]; edges: GraphEdge[] },
  globalGraph?: { nodes: GraphNode[]; edges: GraphEdge[] } | null,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const globalNodeById = new Map<string, GraphNode>();
  if (globalGraph?.nodes) {
    for (const n of globalGraph.nodes) {
      if (!n?.id) continue;
      globalNodeById.set(canonicalNodeId(n), n);
    }
  }

  const nodeMap = new Map<string, GraphNode>();
  for (const n of graph.nodes || []) {
    if (!n?.id) continue;
    const normalized = normalizeNode(n);
    const id = normalized.id;
    if (!nodeMap.has(id)) {
      nodeMap.set(id, { ...normalized });
    }
  }

  // Allow bare edge endpoints (e.g. "COM-024") to resolve to qualified global
  // node ids (e.g. "a-com:COM-024") when the global graph is available.
  const canonicalIdMap = buildCanonicalIdMap(graph.nodes || []);
  const edgeMap = new Map<string, GraphEdge>();
  for (const e of graph.edges || []) {
    if (!e || !e.from || !e.to) continue;
    const normalizedEdge = normalizeEdgeEndpoints(e, canonicalIdMap);
    for (const endpointId of [normalizedEdge.from, normalizedEdge.to]) {
      if (nodeMap.has(endpointId)) continue;
      const globalNode = globalNodeById.get(endpointId);
      const synthetic: GraphNode = globalNode
        ? { ...normalizeNode(globalNode), source: globalNode.source || 'canonical' }
        : makeSyntheticNode(endpointId);
      nodeMap.set(endpointId, synthetic);
    }
    if (!nodeMap.has(normalizedEdge.from) || !nodeMap.has(normalizedEdge.to)) continue;
    const key = normalizedEdge.id || edgeKey(normalizedEdge);
    if (!edgeMap.has(key)) {
      edgeMap.set(key, { ...normalizedEdge, id: key, type: normalizedEdge.type || '' });
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };
}

function makeSyntheticNode(endpointId: string): GraphNode {
  let type: string | undefined;
  let label = endpointId;
  let name = endpointId;

  if (endpointId.includes(':')) {
    const [prefix, ...rest] = endpointId.split(':');
    type = prefix === 'found' ? 'found' : prefix;
    const bare = rest.join(':');
    if (bare) {
      label = bare;
      name = bare;
    }
  }

  return {
    id: endpointId,
    name,
    label,
    type,
    source: 'canonical',
  };
}

/**
 * Merge multiple graph fragments into one graph. Nodes are de-duplicated by id,
 * edges by id or by (from, to, label). Incoming node data fills gaps in existing
 * nodes when present.
 */
export function mergeGraphs(
  ...graphs: Array<{ nodes: GraphNode[]; edges: GraphEdge[] } | null | undefined>
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeById = new Map<string, GraphNode>();
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const graph of graphs) {
    if (!graph) continue;
    for (const n of graph.nodes || []) {
      if (!n?.id) continue;
      const normalized = normalizeNode(n);
      const existing = nodeById.get(normalized.id);
      if (existing) {
        nodeById.set(normalized.id, mergeNodeData(existing, normalized));
      } else {
        nodeById.set(normalized.id, normalized);
      }
    }
    for (const e of graph.edges || []) {
      if (!e || !e.from || !e.to) continue;
      const key = e.id || edgeKey(e);
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ ...e, id: key, type: e.type || '' });
    }
  }

  return {
    nodes: Array.from(nodeById.values()),
    edges,
  };
}

function mergeNodeData(existing: GraphNode, incoming: GraphNode): GraphNode {
  const merged = { ...incoming };
  for (const [key, value] of Object.entries(existing)) {
    const k = key as keyof GraphNode;
    if (merged[k] === undefined || merged[k] === null || merged[k] === '') {
      (merged as any)[k] = value;
    }
  }
  return merged;
}

/**
 * Qualify a raw id with an explicit type prefix. If the id already has a prefix,
 * it is returned unchanged.
 */
export function qualifiedId(id: string, type?: string | null): string {
  if (id.includes(':')) return id;
  if (type) return `${type}:${id}`;
  return id;
}

/**
 * Qualify every node and edge endpoint in a graph, adding default edge metadata.
 */
export function qualifyGraph(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodeTypeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const nodes = graph.nodes.map((n) => ({ ...n, id: qualifiedId(n.id, n.type) }));
  const edges = graph.edges.map((e) => {
    const from = qualifiedId(e.from, nodeTypeById.get(e.from));
    const to = qualifiedId(e.to, nodeTypeById.get(e.to));
    return {
      ...e,
      from,
      to,
      id: e.id || edgeKey({ ...e, from, to }),
    };
  });
  return { nodes, edges };
}

export function normalizeGraphShape(
  graph:
    | { nodes: GraphNode[]; edges: GraphEdge[] }
    | { nodes: GraphNode[]; edges: GraphEdge[] }[]
    | null
    | undefined,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!graph) return { nodes: [], edges: [] };
  if (Array.isArray(graph)) {
    return {
      nodes: graph.flatMap((g) => g.nodes || []),
      edges: graph.flatMap((g) => g.edges || []),
    };
  }
  return {
    nodes: graph.nodes || [],
    edges: graph.edges || [],
  };
}
