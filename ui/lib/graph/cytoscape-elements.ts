import { truncateLabel, colorForType, mapTypeName, type GraphNode, type GraphEdge } from '@/components/research-canvas';
import type cytoscape from 'cytoscape';

export interface CytoscapeNodeData {
  id: string;
  label: string;
  fullLabel: string | undefined;
  qualifiedId: string;
  type: string;
  category: string;
  backgroundColor: string;
  source: string;
  mental_model_applied?: boolean;
}

export interface CytoscapeEdgeData {
  id: string;
  source: string;
  target: string;
  weight: number;
  label: string;
  type: string | undefined;
  detail: string | undefined;
  cpDistance?: number;
}

function buildNodeData(n: GraphNode): CytoscapeNodeData {
  const inferredType = n.type || (typeof n.id === 'string' && n.id.includes(':') ? n.id.split(':')[0] : 'other');
  const backgroundColor = n.health
    ? { green: '#10b981', orange: '#f97316', red: '#ef4444' }[n.health]
    : n.color || colorForType(inferredType);
  return {
    id: n.id,
    label: truncateLabel(n.name || n.label || n.id),
    fullLabel: n.name || n.label,
    qualifiedId: n.type ? `${n.type}:${n.id}` : n.id,
    type: inferredType,
    category: mapTypeName(inferredType),
    backgroundColor,
    source: n.source || 'hindsight',
    mental_model_applied: n.mental_model_applied ?? false,
  };
}

function buildEdgeData(e: GraphEdge): CytoscapeEdgeData {
  return {
    id: e.id,
    source: e.from,
    target: e.to,
    weight: typeof e.weight === 'number' ? e.weight : 1,
    label: typeof e.label === 'string' ? e.label : '',
    type: e.type,
    detail: e.detail,
  };
}

/**
 * Convert a canonical GraphCanvas into Cytoscape element definitions.
 * This is the single place where canonical `from`/`to` edges become
 * Cytoscape `source`/`target` data.
 */
export function toCytoscapeElements(graph: { nodes: GraphNode[]; edges: GraphEdge[] }): cytoscape.ElementDefinition[] {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  const visibleEdges = graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  const cyNodes: cytoscape.ElementDefinition[] = graph.nodes.map((n) => ({
    group: 'nodes',
    data: buildNodeData(n),
  }));

  const cyEdges: cytoscape.ElementDefinition[] = visibleEdges.map((e) => ({
    group: 'edges',
    data: buildEdgeData(e),
  }));

  return [...cyNodes, ...cyEdges];
}

/**
 * Build Cytoscape elements for a preview graph that may reference nodes
 * from a base graph. Preview nodes that already exist in the base graph
 * are omitted.
 */
export function toPreviewCytoscapeElements(
  previewGraph: { nodes: GraphNode[]; edges: GraphEdge[] },
  baseGraph: { nodes: GraphNode[]; edges: GraphEdge[] },
): cytoscape.ElementDefinition[] {
  const realNodeIds = new Set(baseGraph.nodes.map((n) => n.id));
  const allNodeIds = new Set([...realNodeIds, ...previewGraph.nodes.map((n) => n.id)]);
  const visiblePreviewEdges = previewGraph.edges.filter(
    (e) => allNodeIds.has(e.from) && allNodeIds.has(e.to),
  );

  const cyNodes: cytoscape.ElementDefinition[] = previewGraph.nodes
    .filter((n) => !realNodeIds.has(n.id))
    .map((n) => {
      const data = buildNodeData(n);
      data.source = n.source || 'preview';
      return { group: 'nodes', data };
    });

  const cyEdges: cytoscape.ElementDefinition[] = visiblePreviewEdges.map((e) => ({
    group: 'edges',
    data: {
      ...buildEdgeData(e),
      id: `preview:${e.id}`,
    },
  }));

  return [...cyNodes, ...cyEdges];
}

/**
 * Compute parallel edge offsets for a list of Cytoscape edge definitions.
 * Mutates each edge's `data.cpDistance` based on how many edges share the
 * same source/target pair.
 */
export function applyParallelEdgeOffsets(
  edges: cytoscape.ElementDefinition[],
  step = 28,
): cytoscape.ElementDefinition[] {
  const pairCounts = new Map<string, number>();
  for (const e of edges) {
    const data = e.data as CytoscapeEdgeData;
    const pairKey = `${data.source}<->${data.target}`;
    const count = pairCounts.get(pairKey) || 0;
    pairCounts.set(pairKey, count + 1);
    const sign = count % 2 === 0 ? 1 : -1;
    data.cpDistance = count === 0 ? 0 : sign * Math.ceil(count / 2) * step;
  }
  return edges;
}
