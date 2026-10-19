import type { View, ViewNode, ViewEdge } from '@/lib/types';
import type { UnifiedEnvelope, GraphNode, GraphEdge } from '@/lib/api/client';
import { viewToMermaid, type ViewToMermaidOptions } from './view-to-mermaid';
import { bundleViewEdges, type BundledViewEdge } from './view-edges';
import type { EdgeMergeMode } from '@/app/views/components/view-editor-options';
import { ensureEnvelopeIds, uuidv4, graphToTableRows } from '@/lib/envelope-markdown';

export interface ViewToEnvelopeOptions {
  /** Flowchart direction passed through to the Mermaid export. */
  direction?: ViewToMermaidOptions['direction'];
  /** Optional title rendered as Mermaid front matter. */
  title?: string;
  /** Include edge labels in the Mermaid export. Defaults to true. */
  showEdgeLabels?: boolean;
  /** Edge merge mode for the Mermaid diagram. Defaults to 'full'. */
  edgeMergeMode?: EdgeMergeMode;
  /** Name used for the generated diagram. Defaults to the view name. */
  diagramName?: string;
  /** Name used for the generated graph. Defaults to the view name. */
  graphName?: string;
  /**
   * Which parts of the envelope to produce. Any combination of 'flowchart',
   * 'graph', and 'table' is supported. When multiple formats are included they
   * are delivered as a single standard envelope.
   */
  formats?: Array<'flowchart' | 'graph' | 'table'>;
}

function viewNodeToGraphNode(node: ViewNode): GraphNode {
  return {
    id: node.ref_id || node.id,
    name: node.name || node.label || node.text || node.id,
    label: node.label || node.name || node.text || '',
    type: node.entity_type || node.type || 'entity',
    properties: node.properties,
  };
}

function resolveGraphNodeId(nodeById: Map<string, ViewNode>, viewId: string): string {
  return nodeById.get(viewId)?.ref_id || viewId;
}

function collectEvidence(items: Record<string, any>[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    const evidence = item.properties?.evidence;
    if (Array.isArray(evidence)) {
      for (const id of evidence) {
        if (id) ids.add(String(id));
      }
    }
  }
  return Array.from(ids);
}

function viewEdgeToGraphEdge(edge: ViewEdge, nodeById: Map<string, ViewNode>): GraphEdge {
  return {
    id: edge.id,
    from: resolveGraphNodeId(nodeById, edge.source),
    to: resolveGraphNodeId(nodeById, edge.target),
    type: edge.edge_type || edge.type || '',
    label: edge.label || '',
    detail: edge.properties?.detail || '',
    properties: edge.properties,
    evidence: Array.isArray(edge.properties?.evidence) ? edge.properties.evidence : [],
  };
}

/**
 * Build a standard envelope from a view.
 *
 * The returned envelope can contain:
 * - A `flowchart` diagram whose `content` is the Mermaid source for the view.
 * - A merged graph with the view's nodes and edges converted to the canonical
 *   `GraphNode` / `GraphEdge` shape used by the workspace viewer.
 *
 * Both parts are produced in the same standard envelope when requested.
 */
export function viewToEnvelope(
  view: View,
  options: ViewToEnvelopeOptions = {},
): UnifiedEnvelope {
  const {
    direction = 'TB',
    title,
    showEdgeLabels = true,
    edgeMergeMode = 'full',
    diagramName = view.name || 'View diagram',
    graphName = view.name || 'View graph',
    formats = ['flowchart'],
  } = options;

  const nodes = view.graph?.nodes || [];
  const edges = view.graph?.edges || [];

  const includeFlowchart = formats.includes('flowchart');
  const includeGraph = formats.includes('graph');
  const includeTable = formats.includes('table');

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Compile all evidence referenced by the graph's nodes and edges so the
  // generated diagram can cite the same sources as the underlying data.
  const diagramEvidence = [
    ...collectEvidence(nodes),
    ...collectEvidence(edges),
  ];

  const diagrams: UnifiedEnvelope['diagrams'] = [];
  if (includeFlowchart) {
    // The workspace graph always stores the raw, unmerged edges so the data
    // remains complete. The Mermaid diagram, however, should match what the
    // user currently sees on the canvas, so we apply the same bundling mode.
    const bundledEdges: BundledViewEdge[] = bundleViewEdges(edges, edgeMergeMode);
    const mermaidSource = viewToMermaid(nodes, bundledEdges, {
      direction,
      title,
      showEdgeLabels,
    });

    diagrams.push({
      name: diagramName,
      type: 'flowchart',
      content: mermaidSource,
      evidence: diagramEvidence,
    });
  }

  const graph = includeGraph || includeTable
    ? {
        name: graphName,
        nodes: nodes.map(viewNodeToGraphNode),
        edges: edges.map((e) => viewEdgeToGraphEdge(e, nodeById)),
      }
    : { name: '', nodes: [], edges: [] };

  const tables: UnifiedEnvelope['tables'] = [];
  if (includeTable && (graph.nodes.length > 0 || graph.edges.length > 0)) {
    const { nodeRows, edgeRows } = graphToTableRows(graph);
    const graphEvidence = Array.from(
      new Set(graph.edges.flatMap((e) => e.evidence ?? []))
    );
    if (nodeRows.length > 0) {
      tables.push({
        name: `${graphName} nodes`,
        columns: ['id', 'type', 'label', 'name'],
        rows: nodeRows,
        evidence: graphEvidence,
      });
    }
    if (edgeRows.length > 0) {
      tables.push({
        name: `${graphName} edges`,
        columns: ['from_name', 'to_name', 'from', 'to', 'type', 'label', 'detail', 'properties', 'evidence'],
        rows: edgeRows,
        evidence: graphEvidence,
      });
    }
  }

  return ensureEnvelopeIds({
    narratives: [],
    graph,
    tables,
    diagrams,
  });
}
