'use client';

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import cytoscape from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import cytoscapeFcose from 'cytoscape-fcose';
import cytoscapeAvsdf from 'cytoscape-avsdf';

export type SelectionKind = 'table' | 'graph' | 'diagram' | 'text' | 'anchor' | 'tag' | 'edge';

export interface ResearchSelection {
  source: 'table' | 'graph' | 'diagram' | 'text' | 'anchor' | 'tag' | 'edge';
  kind: SelectionKind;
  ids: string[];
  context: string;
}

interface GraphNode {
  id: string;
  label: string;
  label_long?: string;
  type?: string;
  category?: string;
  source?: string;
  mention_count?: number;
  prominence?: number;
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  mental_model_applied?: boolean;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  weight?: number;
  relationship_type?: string;
  edge_source?: 'co_occurrence' | 'mental_model' | 'synthesize';
  confidence?: number;
  source_fact_ids?: string[];
  label_long?: string;
}

export type { GraphNode, GraphEdge, GraphCanvas, InteractiveGraphProps };

export type { GraphLayout };

type GraphLayout = 'fcose' | 'avsdf' | 'cose' | 'dagre' | 'breadthfirst' | 'concentric' | 'circle';

interface GraphCanvas {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface InteractiveGraphProps {
  graph: GraphCanvas;
  selectedIds?: string[];
  onSelect?: (selection: ResearchSelection) => void;
  onAddToQuery?: (selection: ResearchSelection) => void;
  layoutName?: GraphLayout;
  layoutAnimate?: boolean;
  showMentalModelLabels?: boolean;
  showEdgeLabels?: boolean;
  edgeFilters?: Set<string>;
  nodeFilters?: Set<string>;
  /** Called with the Cytoscape instance once it is created. */
  onCyReady?: (cy: cytoscape.Core) => void;
  /** Called when the user hovers over a node or edge. */
  onHover?: (info: { kind: 'node' | 'edge'; data: any }) => void;
}

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

export function mapTypeName(type?: string | null): string {
  if (!type) return 'Other';
  return type;
}

function truncateLabel(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function registerLayouts() {
  if (typeof cytoscapeDagre === 'function') {
    try {
      cytoscape.use(cytoscapeDagre);
    } catch {
      // already registered
    }
  }
  if (typeof cytoscapeFcose === 'function') {
    try {
      cytoscape.use(cytoscapeFcose);
    } catch {
      // already registered
    }
  }
  if (typeof cytoscapeAvsdf === 'function') {
    try {
      cytoscape.use(cytoscapeAvsdf);
    } catch {
      // already registered
    }
  }
}
registerLayouts();

export function InteractiveGraph({
  graph,
  selectedIds,
  onSelect,
  onAddToQuery,
  layoutName = 'cose',
  layoutAnimate = true,
  showMentalModelLabels = true,
  showEdgeLabels = false,
  edgeFilters,
  nodeFilters,
  onCyReady,
  onHover,
}: InteractiveGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [cyInstance, setCyInstance] = useState<cytoscape.Core | null>(null);
  const [ready, setReady] = useState(false);
  const styleRef = useRef<cytoscape.StylesheetStyle[] | null>(null);

  const elements = useMemo(() => {
    const allNodes = graph.nodes || [];
    const allEdges = graph.edges || [];

    const nodeIds = new Set(allNodes.map((n) => n.id));
    const visibleEdges = allEdges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );

    return {
      nodes: allNodes.map((n) => ({
        data: {
          id: n.id,
          label: truncateLabel(n.label),
          fullLabel: n.label,
          label_long: n.label_long,
          qualifiedId: n.type ? `${n.type}:${n.id}` : n.id,
          type: n.type || (typeof n.id === 'string' && n.id.includes(':') ? n.id.split(':')[0] : 'other'),
          category: n.category || mapTypeName(n.type || (typeof n.id === 'string' && n.id.includes(':') ? n.id.split(':')[0] : undefined)),
          backgroundColor: n.color || colorForType(n.type || (typeof n.id === 'string' && n.id.includes(':') ? n.id.split(':')[0] : undefined)),
          source: n.source || 'hindsight',
          mental_model_applied: n.mental_model_applied ?? false,
        },
      })),
      edges: visibleEdges.map((e) => ({
        data: {
          id: e.id,
          source: e.source,
          target: e.target,
          weight: typeof e.weight === 'number' ? e.weight : 1,
          label: typeof e.label === 'string' ? e.label : '',
          relationship_type: e.relationship_type,
          label_long: e.label_long,
          edge_source: e.edge_source,
        },
      })),
    };
  }, [graph]);

  const prevElementsRef = useRef(elements);
  const prevSnapshotRef = useRef({ nodeIds: new Set<string>(), edgeIds: new Set<string>() });
  const prevLayoutNameRef = useRef<GraphLayout>(layoutName);
  const prevLayoutAnimateRef = useRef<boolean>(layoutAnimate);
  const showEdgeLabelsRef = useRef(showEdgeLabels);

  useEffect(() => {
    showEdgeLabelsRef.current = showEdgeLabels;
  });

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(fullLabel)',
            'background-color': 'data(backgroundColor)',
            width: 16,
            height: 16,
            color: 'rgba(255,255,255,0.75)',
            'font-size': '9px',
            'font-weight': 'normal',
            'text-valign': 'top',
            'text-halign': 'right',
            'text-margin-y': -3,
            'text-margin-x': 4,
            'text-background-color': '#1a1a2e',
            'text-background-opacity': 0.65,
            'text-background-padding': '1px',
            'border-width': 0,
            'transition-property': 'background-color, border-color, opacity',
            'transition-duration': 0.2,
          },
        },
        {
          selector: 'node[source="mental_model_referenced"]',
          style: {
            'background-opacity': 0.5,
            opacity: 0.7,
          },
        },
        {
          selector: 'edge',
          style: {
            width: 0.4,
            'line-color': 'rgba(255,255,255,0.12)',
            'target-arrow-color': 'rgba(255,255,255,0.12)',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.4,
            'curve-style': 'bezier',
            'control-point-step-size': 12,
            label: '',
            color: 'rgba(255,255,255,0.55)',
            'font-size': '7px',
            'text-background-color': '#1a1a2e',
            'text-background-opacity': 0.5,
            'text-background-padding': '2px',
            'text-rotation': 'none',
            'text-margin-y': -8,
            'text-margin-x': 0,
            'text-max-width': '120px',
            'text-wrap': 'ellipsis',
            'transition-property': 'line-color, width, opacity',
            'transition-duration': 0.2,
          },
        },
        {
          selector: 'edge[edge_source = "synthesize"]',
          style: {
            width: 0.75,
            'line-color': 'rgba(139,92,246,0.4)',
            'target-arrow-color': 'rgba(139,92,246,0.4)',
            color: 'rgba(196,181,253,0.85)',
            'text-background-color': '#2e1065',
            'font-size': '7px',
          },
        },
        {
          selector: 'edge[edge_source = "mental_model"]',
          style: {
            width: 0.75,
            'line-color': 'rgba(66,165,245,0.4)',
            'target-arrow-color': 'rgba(66,165,245,0.4)',
            'target-arrow-shape': 'triangle',
            'font-size': '7px',
          },
        },
        // Subtle relationship-type colours for mental-model edges where we know the type.
        {
          selector: 'edge[edge_source = "mental_model"][relationship_type = "calls"]',
          style: {
            'line-color': 'rgba(100,210,200,0.45)',
            'target-arrow-color': 'rgba(100,210,200,0.45)',
          },
        },
        {
          selector: 'edge[edge_source = "mental_model"][relationship_type = "depends_on"]',
          style: {
            'line-color': 'rgba(210,160,120,0.45)',
            'target-arrow-color': 'rgba(210,160,120,0.45)',
          },
        },
        {
          selector: 'edge[edge_source = "mental_model"][relationship_type = "sends"]',
          style: {
            'line-color': 'rgba(180,150,210,0.45)',
            'target-arrow-color': 'rgba(180,150,210,0.45)',
          },
        },
        {
          selector: 'edge[edge_source = "mental_model"][relationship_type = "reads"]',
          style: {
            'line-color': 'rgba(150,190,160,0.45)',
            'target-arrow-color': 'rgba(150,190,160,0.45)',
          },
        },
        {
          selector: 'edge[edge_source = "mental_model"][relationship_type = "writes"]',
          style: {
            'line-color': 'rgba(220,140,150,0.45)',
            'target-arrow-color': 'rgba(220,140,150,0.45)',
          },
        },
        {
          selector: 'edge[edge_source != "mental_model"]',
          style: {
            width: 0.4,
          },
        },
        {
          selector: ':selected',
          style: {
            'background-color': '#10b981',
            'line-color': 'rgba(16,185,129,0.7)',
            'target-arrow-color': 'rgba(16,185,129,0.7)',
            'border-color': '#10b981',
            color: '#ffffff',
            'text-opacity': 1,
          },
        },
        {
          selector: '.hidden-label',
          style: {
            label: '',
          },
        },
        {
          selector: '.dimmed',
          style: {
            opacity: 0.12,
            'text-opacity': 0.15,
            'z-index': 0,
          },
        },
        {
          selector: '.dimmed-edge',
          style: {
            opacity: 0.15,
            'text-opacity': 0.1,
            'z-index': 0,
          },
        },
        {
          selector: '.dimmed-node',
          style: {
            opacity: 0.25,
            'text-opacity': 0.2,
            'z-index': 0,
          },
        },
        {
          selector: 'edge.show-label',
          style: {
            label: 'data(label)',
            'z-index': 9999,
          },
        },
      ],
      wheelSensitivity: 1,
      minZoom: 0.05,
      maxZoom: 5,
    });

    cyRef.current = cy;
    onCyReady?.(cy);
    setCyInstance(cy);

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const currentCy = cyRef.current;
        if (!currentCy || currentCy.destroyed()) return;
        const delta = e.deltaY;
        const step = 0.08;
        const factor = delta < 0 ? 1 + step : 1 - step;
        currentCy.zoom({
          level: currentCy.zoom() * factor,
          renderedPosition: { x: e.offsetX, y: e.offsetY },
        });
      }
    };
    containerRef.current?.addEventListener('wheel', onWheel, { passive: false });
    cy.on('tap', (event) => {
      const target = event.target;
      if (target === cy) {
        cy.elements().unselect();
        return;
      }
      if (target.isNode?.() || target.isEdge?.()) {
        const id = target.id();
        const kind = target.isNode() ? 'graph' : 'edge';
        const label = target.data('label') || id;
        onSelect?.({ source: 'graph', kind, ids: [id], context: String(label) });
      }
    });
    cy.on('dbltap', 'node, edge', (event) => {
      const target = event.target;
      const id = target.id();
      const kind = target.isNode() ? 'graph' : 'edge';
      const label = target.data('label') || id;
      onAddToQuery?.({ source: 'graph', kind, ids: [id], context: String(label) });
    });

    cy.on('layoutstop', () => {
      if (!cyRef.current || cyRef.current.destroyed()) return;
      cyRef.current.fit(undefined, 20);
      setReady(true);
    });

    const showEdgeLabel = (e: cytoscape.EventObject) => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      if (showEdgeLabelsRef.current) return;
      currentCy.edges().removeClass('show-label');
      (e.target as cytoscape.EdgeSingular).addClass('show-label');
      onHover?.({ kind: 'edge', data: (e.target as cytoscape.EdgeSingular).data() });
    };
    const hideEdgeLabels = () => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      if (showEdgeLabelsRef.current) return;
      currentCy.edges().removeClass('show-label');
    };
    cy.on('mouseover', 'edge', showEdgeLabel);
    cy.on('mouseout', 'edge', hideEdgeLabels);

    const highlightNeighbourhood = (e: cytoscape.EventObject) => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      const node = e.target as cytoscape.NodeSingular;
      const neighbourhood = node.closedNeighborhood();
      currentCy.elements().not(neighbourhood).addClass('dimmed');
      neighbourhood.removeClass('dimmed');
      onHover?.({ kind: 'node', data: node.data() });
    };
    const clearHighlight = () => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      currentCy.elements().removeClass('dimmed');
    };
    cy.on('mouseover', 'node', highlightNeighbourhood);
    cy.on('mouseout', 'node', clearHighlight);

    return () => {
      cy.destroy();
      cyRef.current = null;
      setCyInstance(null);
      containerRef.current?.removeEventListener('wheel', onWheel);
    };
  }, [onSelect, onAddToQuery, showMentalModelLabels, onHover]);

  useEffect(() => {
    const cy = cyInstance;
    if (!cy) return;

    const nextNodeIds = new Set(elements.nodes.map((n) => n.data.id));
    const nextEdgeIds = new Set(elements.edges.map((e) => e.data.id));
    const prev = prevSnapshotRef.current;

    cy.elements().forEach((el) => {
      const id = el.id();
      if (el.isNode() ? !nextNodeIds.has(id) : !nextEdgeIds.has(id)) {
        el.remove();
      }
    });

    elements.nodes.forEach((n) => {
      const existing = cy.getElementById(n.data.id);
      if (existing.length === 0) {
        cy.add({ group: 'nodes', data: n.data });
      } else {
        existing.data(n.data);
      }
    });

    elements.edges.forEach((e) => {
      const existing = cy.getElementById(e.data.id);
      if (existing.length === 0) {
        cy.add({ group: 'edges', data: e.data });
      } else {
        existing.data(e.data);
      }
    });

    const layoutChanged = layoutName !== prevLayoutNameRef.current || layoutAnimate !== prevLayoutAnimateRef.current;
    prevLayoutNameRef.current = layoutName;
    prevLayoutAnimateRef.current = layoutAnimate;

    const nodeSetChanged =
      prev.nodeIds.size !== nextNodeIds.size ||
      Array.from(nextNodeIds).some((id) => !prev.nodeIds.has(id)) ||
      Array.from(prev.nodeIds).some((id) => !nextNodeIds.has(id));

    const edgeSetChanged =
      prev.edgeIds.size !== nextEdgeIds.size ||
      Array.from(nextEdgeIds).some((id) => !prev.edgeIds.has(id)) ||
      Array.from(prev.edgeIds).some((id) => !nextEdgeIds.has(id));

    prevSnapshotRef.current = { nodeIds: nextNodeIds, edgeIds: nextEdgeIds };
    prevElementsRef.current = elements;

    const hasUnpositionedNodes =
      cy.nodes().length > 0 &&
      cy.nodes().toArray().some((n) => {
        const p = n.position();
        return p.x === 0 && p.y === 0;
      });

    if (!nodeSetChanged && !edgeSetChanged && !layoutChanged && cy.nodes().length > 0 && !hasUnpositionedNodes) {
      return;
    }

    const runLayout = () => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        // Container has no size yet; observe it and run once it does.
        let resizeObserver: ResizeObserver | null = null;
        const tryRun = () => {
          if (!containerRef.current) return;
          const r = containerRef.current.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          resizeObserver?.disconnect();
          innerRunLayout();
        };
        resizeObserver = new ResizeObserver(tryRun);
        resizeObserver.observe(container);
        return;
      }

      innerRunLayout();
    };

    const seedNewNodePositions = () => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      const positionedNodes = currentCy.nodes().filter((n) => {
        const p = n.position();
        return !(p.x === 0 && p.y === 0);
      });
      if (positionedNodes.length === 0) return;

      let cx = 0;
      let cy = 0;
      positionedNodes.forEach((n) => {
        const p = n.position();
        cx += p.x;
        cy += p.y;
      });
      cx /= positionedNodes.length;
      cy /= positionedNodes.length;

      currentCy.nodes().forEach((n) => {
        const p = n.position();
        if (p.x === 0 && p.y === 0) {
          // Slightly jitter so overlapping new nodes don't sit exactly on top of each other.
          const angle = Math.random() * 2 * Math.PI;
          const radius = 20 + Math.random() * 30;
          n.position({
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius,
          });
        }
      });
    };

    const innerRunLayout = () => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      setReady(false);
      currentCy.resize();

      // If only edges changed, don't run a layout; just keep the current view.
      if (!nodeSetChanged && !layoutChanged && !hasUnpositionedNodes) {
        setReady(true);
        return;
      }

      const name = layoutName || 'cose';

      // Data-driven updates (node/edge changes) should snap into place without
      // flying across the canvas. Only explicit layout/animate changes animate.
      const isUserDrivenLayoutChange = layoutChanged;
      const shouldAnimate = isUserDrivenLayoutChange && layoutAnimate;

      seedNewNodePositions();

      let layout;
      switch (name) {
        case 'dagre':
          layout = currentCy.layout({
            name: 'dagre',
            rankDir: 'TB',
            padding: 20,
            fit: true,
            animate: shouldAnimate,
            animationDuration: shouldAnimate ? 450 : 0,
            spacingFactor: 1,
            nodeDimensionsIncludeLabels: true,
            useDagreEdgeControlPoints: true,
          } as any);
          break;
        case 'fcose':
          layout = currentCy.layout({
            name: 'fcose',
            animate: shouldAnimate,
            animationDuration: shouldAnimate ? 450 : 0,
            fit: true,
            padding: 20,
            // For data-driven updates, start from current positions so existing
            // nodes don't fly in from scratch. For user-driven layout changes,
            // allow a fresh random start.
            randomize: isUserDrivenLayoutChange ? true : false,
            nodeRepulsion: 4500,
            idealEdgeLength: 80,
            edgeElasticity: 0.45,
            nestingFactor: 0.1,
            gravity: 0.25,
            gravityRange: 3.8,
            gravityCompound: 1.0,
            gravityRangeCompound: 1.5,
            layoutCells: 25,
            nodeSeparation: 60,
            uniformNodeDimensions: false,
            tile: true,
            tilingPaddingVertical: 10,
            tilingPaddingHorizontal: 10,
            packComponents: true,
            sampleSize: 25,
          } as any);
          break;
        case 'breadthfirst':
          layout = currentCy.layout({
            name: 'breadthfirst',
            directed: true,
            padding: 20,
            fit: true,
            animate: shouldAnimate,
            animationDuration: shouldAnimate ? 450 : 0,
            circle: false,
            spacingFactor: 1.2,
          } as any);
          break;
        case 'avsdf':
          layout = currentCy.layout({
            name: 'avsdf',
            animate: shouldAnimate ? 'end' : false,
            animationDuration: shouldAnimate ? 450 : 0,
            fit: true,
            padding: 20,
            nodeSeparation: 90,
            minNodeSpacing: 80,
          } as any);
          break;
        case 'concentric':
          layout = currentCy.layout({
            name: 'concentric',
            fit: true,
            padding: 30,
            animate: shouldAnimate,
            animationDuration: shouldAnimate ? 450 : 0,
            concentric: () => 1,
            levelWidth: () => 60,
            minNodeSpacing: 40,
          } as any);
          break;
        case 'circle':
          layout = currentCy.layout({
            name: 'circle',
            fit: true,
            padding: 30,
            animate: shouldAnimate,
            animationDuration: shouldAnimate ? 450 : 0,
          } as any);
          break;
        default:
          layout = currentCy.layout({
            name: 'cose',
            animate: shouldAnimate,
            animationDuration: shouldAnimate ? 450 : 0,
            fit: true,
            padding: 20,
            nodeRepulsion: 400000,
            idealEdgeLength: 120,
            edgeElasticity: 100,
            nestingFactor: 1.2,
            gravity: 80,
            numIter: 1000,
            tilingPaddingVertical: 10,
            tilingPaddingHorizontal: 10,
          } as any);
      }
      layout.run();
    };

    requestAnimationFrame(runLayout);
  }, [elements, layoutName, layoutAnimate, cyInstance]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Apply edge and node filter dimming without removing elements. Active edges
    // connect active node types; active nodes are endpoints of active edges.
    const hasEdgeFilters = edgeFilters && edgeFilters.size > 0;
    const hasNodeFilters = nodeFilters && nodeFilters.size > 0;
    if (!hasEdgeFilters && !hasNodeFilters) {
      cy.elements().removeClass('dimmed-edge dimmed-node');
      return;
    }

    let activeEdges = cy.edges();
    if (edgeFilters) {
      activeEdges = activeEdges.filter((e) => {
        const type = e.data('relationship_type');
        return type ? edgeFilters.has(type) : false;
      });
    }

    let activeNodes = cy.nodes();
    if (nodeFilters) {
      activeNodes = activeNodes.filter((n) => {
        const type = n.data('type');
        return type ? nodeFilters.has(type) : false;
      });
    }

    const activeNodeIds = new Set(activeNodes.map((n) => n.id()));
    activeEdges = activeEdges.filter((e) => activeNodeIds.has(e.source().id()) && activeNodeIds.has(e.target().id()));

    const finalActiveNodeIds = new Set<string>();
    const activeEdgeIds = new Set(activeEdges.map((e) => e.id()));
    activeEdges.forEach((e) => {
      finalActiveNodeIds.add(e.source().id());
      finalActiveNodeIds.add(e.target().id());
    });

    cy.nodes().forEach((n) => {
      if (finalActiveNodeIds.has(n.id())) {
        n.removeClass('dimmed-node');
      } else {
        n.addClass('dimmed-node');
      }
    });
    cy.edges().forEach((e) => {
      if (activeEdgeIds.has(e.id())) {
        e.removeClass('dimmed-edge');
      } else {
        e.addClass('dimmed-edge');
      }
    });
  }, [elements, edgeFilters, nodeFilters]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedIds) return;
    cy.elements().unselect();
    for (const id of selectedIds) {
      const el = cy.getElementById(id);
      if (el.length > 0) el.select();
    }
  }, [selectedIds]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (showEdgeLabels) {
      cy.edges().addClass('show-label');
    } else {
      cy.edges().removeClass('show-label');
    }
  }, [showEdgeLabels]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    // When cy becomes ready, ensure the current label setting is applied to all edges.
    if (showEdgeLabels) {
      cy.edges().addClass('show-label');
    }
  }, [cyInstance]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
          Building graph…
        </div>
      )}
    </div>
  );
}

export default InteractiveGraph;
