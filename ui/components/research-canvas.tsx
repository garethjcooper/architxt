'use client';

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import cytoscape from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import cytoscapeFcose from 'cytoscape-fcose';
import cytoscapeAvsdf from 'cytoscape-avsdf';
import {
  type GraphNode,
  type GraphEdge,
  type GraphCanvas,
} from '@/lib/api/client';
import {
  toCytoscapeElements,
  toPreviewCytoscapeElements,
} from '@/lib/graph/cytoscape-elements';

export type SelectionKind = 'table' | 'graph' | 'diagram' | 'text' | 'anchor' | 'tag' | 'edge';

export interface ResearchSelection {
  source: 'table' | 'graph' | 'diagram' | 'text' | 'anchor' | 'tag' | 'edge';
  kind: SelectionKind;
  ids: string[];
  context: string;
}

export type { GraphNode, GraphEdge, GraphCanvas };

export type { GraphLayout };

type GraphLayout = 'fcose' | 'avsdf' | 'cose' | 'dagre' | 'breadthfirst' | 'concentric' | 'circle';

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
  /** How to interpret `nodeFilters`/`edgeFilters`.
   *  - 'active' (default): filters list types that should stay visible.
   *  - 'hidden': filters list types that should be dimmed. */
  filterMode?: 'active' | 'hidden';
  /** Called with the Cytoscape instance once it is created. */
  onCyReady?: (cy: cytoscape.Core) => void;
  /** Called when the user hovers over a node or edge. */
  onHover?: (info: { kind: 'node' | 'edge'; data: any }) => void;
  /** Called when the user left-clicks (taps) a node. */
  onNodeClick?: (nodeId: string) => void;
  /** IDs of nodes that should be highlighted as having a discovery/load error. */
  errorNodeIds?: Set<string>;
  /** When true, adding/removing nodes or edges will not trigger a full re-layout.
   *  Existing nodes keep their positions; new nodes are seeded near the current
   *  graph center. A layout still runs on first render, explicit layout changes,
   *  or if any node is unpositioned. */
  preserveLayoutOnUpdate?: boolean;
  /** If provided, new nodes with no position are placed around this source node
   *  in the sparsest direction. Falls back to the graph center if missing. */
  placementSourceNodeId?: string;
  /** Optional temporary nodes/edges to render as a dimmed preview. */
  previewGraph?: GraphCanvas;
  /** Edge ID to highlight (e.g. when hovering a corresponding list row). */
  highlightedEdgeId?: string | null;
  /** Called when the user hovers over or leaves an edge on the canvas. */
  onEdgeHover?: (edgeId: string | null) => void;
  /** Node ID to highlight (e.g. when hovering a corresponding list row). */
  highlightedNodeId?: string | null;
  /** Called when the user hovers over or leaves a node on the canvas. */
  onNodeHover?: (nodeId: string | null) => void;
}

// Tunable distance from the source node when seeding new nodes. Increase this
// to space new nodes further out; decrease to pack them closer.
const NEW_NODE_PLACEMENT_RADIUS = 60;

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

// Place unpositioned nodes around the source node (or graph center) at a fixed
// radius in the sparsest direction. Used for both real additions and previews.
function placeNodesNearSource(
  cy: cytoscape.Core,
  unpositionedNodes: cytoscape.NodeCollection,
  placementSourceNodeId?: string,
  radius: number = NEW_NODE_PLACEMENT_RADIUS,
) {
  if (unpositionedNodes.length === 0) return;

  const initialPositioned = cy.nodes().filter((n) => {
    const p = n.position();
    return !(p.x === 0 && p.y === 0);
  });
  if (initialPositioned.length === 0) return;

  const sourceNodeId = placementSourceNodeId || initialPositioned[initialPositioned.length - 1]?.id();
  const sourceNode = sourceNodeId ? cy.getElementById(sourceNodeId) : null;
  const sourcePos =
    sourceNode && sourceNode.length > 0
      ? sourceNode.position()
      : (() => {
          let cx = 0;
          let cy_ = 0;
          initialPositioned.forEach((n) => {
            const p = n.position();
            cx += p.x;
            cy_ += p.y;
          });
          return { x: cx / initialPositioned.length, y: cy_ / initialPositioned.length };
        })();

  const sampleCount = 24;
  const nearbyThreshold = radius * 1.25;

  // Maintain an array of positions that should be avoided, including nodes placed
  // earlier in this same call so batch-added nodes don't stack on each other.
  const obstaclePositions: { x: number; y: number }[] = [];
  initialPositioned.forEach((n) => {
    const p = n.position();
    obstaclePositions.push({ x: p.x, y: p.y });
  });

  const findBestAngle = (nodeRadius: number): number => {
    let bestAngle = 0;
    let bestCount = Infinity;
    for (let i = 0; i < sampleCount; i++) {
      const angle = (i / sampleCount) * 2 * Math.PI;
      const cx = sourcePos.x + Math.cos(angle) * nodeRadius;
      const cy_ = sourcePos.y + Math.sin(angle) * nodeRadius;
      let count = 0;
      for (const p of obstaclePositions) {
        const dx = p.x - cx;
        const dy = p.y - cy_;
        if (Math.sqrt(dx * dx + dy * dy) < nearbyThreshold) count++;
      }
      if (count < bestCount) {
        bestCount = count;
        bestAngle = angle;
      }
    }
    return bestAngle;
  };

  unpositionedNodes.forEach((n, idx) => {
    const ring = Math.floor(idx / 8);
    const nodeRadius = radius * (1 + ring * 0.5);
    const angle = findBestAngle(nodeRadius);
    const pos = {
      x: sourcePos.x + Math.cos(angle) * nodeRadius,
      y: sourcePos.y + Math.sin(angle) * nodeRadius,
    };
    n.position(pos);
    obstaclePositions.push(pos);
  });
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
  filterMode = 'active',
  onCyReady,
  onHover,
  onNodeClick,
  errorNodeIds,
  preserveLayoutOnUpdate = false,
  placementSourceNodeId,
  previewGraph,
  highlightedEdgeId,
  onEdgeHover,
  highlightedNodeId,
  onNodeHover,
}: InteractiveGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [cyInstance, setCyInstance] = useState<cytoscape.Core | null>(null);
  const [ready, setReady] = useState(false);
  const styleRef = useRef<cytoscape.StylesheetStyle[] | null>(null);

  const elements = useMemo(() => {
    return toCytoscapeElements(graph);
  }, [graph]);

  const previewElements = useMemo(() => {
    return toPreviewCytoscapeElements(previewGraph || { nodes: [], edges: [] }, graph);
  }, [previewGraph, graph]);

  const prevElementsRef = useRef(elements);
  const prevSnapshotRef = useRef({ nodeIds: new Set<string>(), edgeIds: new Set<string>() });
  const prevLayoutNameRef = useRef<GraphLayout>(layoutName);
  const prevLayoutAnimateRef = useRef<boolean>(layoutAnimate);
  const showEdgeLabelsRef = useRef(showEdgeLabels);
  const shouldFitOnLayoutStopRef = useRef<boolean>(true);
  const onNodeClickRef = useRef(onNodeClick);

  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  });

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
          selector: 'edge[healthColor]',
          style: {
            width: 0.75,
            'line-color': 'data(healthColor)',
            'target-arrow-color': 'data(healthColor)',
            'source-arrow-color': 'data(healthColor)',
          },
        },
        {
          selector: 'edge[source = "synthesize"]',
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
          selector: 'edge[source = "mental_model"]',
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
          selector: 'edge[source = "mental_model"][type = "calls"]',
          style: {
            'line-color': 'rgba(100,210,200,0.45)',
            'target-arrow-color': 'rgba(100,210,200,0.45)',
          },
        },
        {
          selector: 'edge[source = "mental_model"][type = "depends_on"]',
          style: {
            'line-color': 'rgba(210,160,120,0.45)',
            'target-arrow-color': 'rgba(210,160,120,0.45)',
          },
        },
        {
          selector: 'edge[source = "mental_model"][type = "sends"]',
          style: {
            'line-color': 'rgba(180,150,210,0.45)',
            'target-arrow-color': 'rgba(180,150,210,0.45)',
          },
        },
        {
          selector: 'edge[source = "mental_model"][type = "reads"]',
          style: {
            'line-color': 'rgba(150,190,160,0.45)',
            'target-arrow-color': 'rgba(150,190,160,0.45)',
          },
        },
        {
          selector: 'edge[source = "mental_model"][type = "writes"]',
          style: {
            'line-color': 'rgba(220,140,150,0.45)',
            'target-arrow-color': 'rgba(220,140,150,0.45)',
          },
        },
        {
          selector: 'edge[source != "mental_model"]',
          style: {
            width: 0.4,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'background-color': '#f59e0b',
            'border-color': '#f59e0b',
            'border-width': 2,
            'border-position': 'inside',
            color: '#ffffff',
            'text-opacity': 1,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': 'rgba(245,158,11,0.85)',
            'target-arrow-color': 'rgba(245,158,11,0.85)',
            'source-arrow-color': 'rgba(245,158,11,0.85)',
            width: 1,
            'z-index': 9998,
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
        {
          selector: 'node.preview',
          style: {
            opacity: 0.45,
            'border-width': 1,
            'border-color': 'rgba(255,255,255,0.4)',
            'border-style': 'dashed',
            'z-index': 1,
          },
        },
        {
          selector: 'edge.preview',
          style: {
            opacity: 0.35,
            'line-style': 'dashed',
            'z-index': 1,
          },
        },
        {
          selector: 'node.discovery-error',
          style: {
            'border-width': 1,
            'border-color': 'rgba(239,68,68,0.5)',
            'border-style': 'dashed',
            'border-position': 'inside',
          },
        },
        {
          selector: 'edge.edge-hover-highlight',
          style: {
            'z-index': 9998,
          },
        },
        {
          selector: 'node.node-hover-highlight',
          style: {
            'border-width': 2,
            'border-color': 'rgba(230,240,255,0.85)',
            'border-style': 'solid',
            'border-position': 'inside',
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
        if (target.isNode?.()) {
          onNodeClickRef.current?.(id);
        }
      }
    });
    cy.on('dbltap', 'node, edge', (event) => {
      const target = event.target;
      const id = target.id();
      const kind = target.isNode() ? 'graph' : 'edge';
      const label = target.data('label') || id;
      onAddToQuery?.({ source: 'graph', kind, ids: [id], context: String(label) });
    });

    // Track edge hover and report it to the parent so a corresponding edge list
    // can be scrolled/ synchronised.
    const handleEdgeMouseOver = (event: cytoscape.EventObject) => {
      const edge = event.target;
      if (!edge.isEdge?.()) return;
      onEdgeHover?.(edge.id());
    };
    const handleEdgeMouseOut = (event: cytoscape.EventObject) => {
      const edge = event.target;
      if (!edge.isEdge?.()) return;
      onEdgeHover?.(null);
    };
    cy.on('mouseover', 'edge', handleEdgeMouseOver);
    cy.on('mouseout', 'edge', handleEdgeMouseOut);

    // Track node hover and report it to the parent so a corresponding entity
    // list can be scrolled/ synchronised.
    const handleNodeMouseOver = (event: cytoscape.EventObject) => {
      const node = event.target;
      if (!node.isNode?.()) return;
      onNodeHover?.(node.id());
    };
    const handleNodeMouseOut = (event: cytoscape.EventObject) => {
      const node = event.target;
      if (!node.isNode?.()) return;
      onNodeHover?.(null);
    };
    cy.on('mouseover', 'node', handleNodeMouseOver);
    cy.on('mouseout', 'node', handleNodeMouseOut);

    cy.on('layoutstop', () => {
      if (!cyRef.current || cyRef.current.destroyed()) return;
      if (shouldFitOnLayoutStopRef.current) {
        cyRef.current.fit(undefined, 120);
        shouldFitOnLayoutStopRef.current = false;
      }
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

    const nextNodeIds = new Set(
      elements.filter((el) => el.group === 'nodes').map((n) => (n.data as any).id),
    );
    const nextEdgeIds = new Set(
      elements.filter((el) => el.group === 'edges').map((e) => (e.data as any).id),
    );
    const prev = prevSnapshotRef.current;

    cy.elements().forEach((el) => {
      const id = el.id();
      if (el.isNode() ? !nextNodeIds.has(id) : !nextEdgeIds.has(id)) {
        el.remove();
      }
    });

    elements.forEach((el) => {
      const data = el.data as any;
      const id = data.id;
      const existing = cy.getElementById(id);
      if (existing.length === 0) {
        cy.add({ group: el.group, data });
      } else {
        existing.data(data);
      }
    });

    cy.nodes().forEach((node) => {
      const id = node.id();
      node.toggleClass('discovery-error', errorNodeIds?.has(id) ?? false);
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

    const newNodesAdded = Array.from(nextNodeIds).some((id) => !prev.nodeIds.has(id));
    const isFirstRender = prev.nodeIds.size === 0 && nextNodeIds.size > 0;

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
      const unpositionedNodes = currentCy.nodes().filter((n) => {
        const p = n.position();
        return p.x === 0 && p.y === 0;
      });
      placeNodesNearSource(currentCy, unpositionedNodes, placementSourceNodeId);
    };

    const innerRunLayout = () => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;

      // Seed new nodes first so we can decide whether a full layout is needed.
      seedNewNodePositions();

      const stillHasUnpositionedNodes =
        currentCy.nodes().length > 0 &&
        currentCy.nodes().toArray().some((n) => {
          const p = n.position();
          return p.x === 0 && p.y === 0;
        });

      // If nothing about the nodes/edges changed and all nodes are positioned,
      // there is nothing to do (e.g. a canvas click or edge-only update).
      if (!nodeSetChanged && !edgeSetChanged && !layoutChanged && currentCy.nodes().length > 0 && !stillHasUnpositionedNodes) {
        return;
      }

      // When preserveLayoutOnUpdate is enabled, data-driven changes (adding or
      // removing nodes/edges) should not trigger a full re-layout. New nodes
      // were seeded above around the source node. We still run a full layout on
      // first render, explicit layout setting changes, or if seeding failed to
      // place every node.
      const isUserDrivenLayoutChange = layoutChanged;
      if (preserveLayoutOnUpdate && !isUserDrivenLayoutChange && !stillHasUnpositionedNodes && !isFirstRender) {
        return;
      }

      setReady(false);
      currentCy.resize();

      // For user-driven layout changes and first render we want to fit the view
      // once the layout finishes. Data-driven updates keep the current pan/zoom.
      shouldFitOnLayoutStopRef.current = isUserDrivenLayoutChange || isFirstRender;

      const name = layoutName || 'cose';
      const shouldAnimate = isUserDrivenLayoutChange && layoutAnimate;

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
  }, [elements, layoutName, layoutAnimate, cyInstance, errorNodeIds]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Apply edge and node filter dimming without removing elements.
    // - 'active' mode: filter lists types that should stay visible (Research default).
    // - 'hidden' mode: filter lists types that should be dimmed (Explore show/hide).
    const isHiddenMode = filterMode === 'hidden';
    const hasNodeFilters = nodeFilters && nodeFilters.size > 0;
    const hasEdgeFilters = edgeFilters && edgeFilters.size > 0;

    let visibleNodes = cy.nodes();
    if (hasNodeFilters) {
      visibleNodes = visibleNodes.filter((n) => {
        const type = n.data('type');
        if (!type) return false;
        const inSet = nodeFilters.has(type);
        return isHiddenMode ? !inSet : inSet;
      });
    }

    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id()));

    let visibleEdges = cy.edges();
    if (hasEdgeFilters) {
      visibleEdges = visibleEdges.filter((e) => {
        const type = e.data('type');
        if (!type) return false;
        const inSet = edgeFilters.has(type);
        return isHiddenMode ? !inSet : inSet;
      });
    }
    visibleEdges = visibleEdges.filter((e) => visibleNodeIds.has(e.source().id()) && visibleNodeIds.has(e.target().id()));

    const visibleEdgeIds = new Set(visibleEdges.map((e) => e.id()));

    cy.nodes().forEach((n) => {
      if (visibleNodeIds.has(n.id())) {
        n.removeClass('dimmed-node');
      } else {
        n.addClass('dimmed-node');
      }
    });
    cy.edges().forEach((e) => {
      if (visibleEdgeIds.has(e.id())) {
        e.removeClass('dimmed-edge');
      } else {
        e.addClass('dimmed-edge');
      }
    });
  }, [elements, edgeFilters, nodeFilters, filterMode]);

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
    const realNodeIds = new Set(
      elements.filter((el) => el.group === 'nodes').map((n) => (n.data as any).id),
    );
    const realEdgeIds = new Set(
      elements.filter((el) => el.group === 'edges').map((e) => (e.data as any).id),
    );
    const previewNodeIds = new Set(
      previewElements.filter((el) => el.group === 'nodes').map((n) => (n.data as any).id),
    );
    const previewEdgeIds = new Set(
      previewElements.filter((el) => el.group === 'edges').map((e) => (e.data as any).id),
    );

    // Remove any preview elements that are no longer in the preview or that have
    // become real elements.
    cy.nodes().forEach((n) => {
      if (n.hasClass('preview') && (realNodeIds.has(n.id()) || !previewNodeIds.has(n.id()))) {
        n.remove();
      }
    });
    cy.edges().forEach((e) => {
      if (e.hasClass('preview') && (realEdgeIds.has(e.id()) || !previewEdgeIds.has(e.id()))) {
        e.remove();
      }
    });

    // Add/update preview nodes.
    previewElements.filter((el) => el.group === 'nodes').forEach((n) => {
      const data = n.data as any;
      const existing = cy.getElementById(data.id);
      if (existing.length > 0 && existing.hasClass('preview')) {
        existing.data(data);
        existing.addClass('preview');
        return;
      }
      const added = cy.add({ group: 'nodes', data });
      added.addClass('preview');
    });

    // Add/update preview edges. Skip any edge whose source or target is not yet
    // present in Cytoscape (either as a real or preview node) to avoid crashes
    // during render races.
    const cyNodeIds = new Set(cy.nodes().map((n) => n.id()));
    previewElements.filter((el) => el.group === 'edges').forEach((e) => {
      const data = e.data as any;
      if (!cyNodeIds.has(data.source) || !cyNodeIds.has(data.target)) return;
      const existing = cy.getElementById(data.id);
      if (existing.length > 0 && existing.hasClass('preview')) {
        existing.data(data);
        existing.addClass('preview');
        return;
      }
      const added = cy.add({ group: 'edges', data });
      added.addClass('preview');
    });

    // Position unpositioned preview nodes around the source without triggering a
    // full layout.
    const unpositionedPreviewNodes = cy.nodes('.preview').filter((n) => {
      const p = n.position();
      return p.x === 0 && p.y === 0;
    });
    placeNodesNearSource(cy, unpositionedPreviewNodes, placementSourceNodeId);
  }, [previewElements, elements, placementSourceNodeId]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    // When cy becomes ready, ensure the current label setting is applied to all edges.
    if (showEdgeLabels) {
      cy.edges().addClass('show-label');
    }
  }, [cyInstance]);

  // Highlight the edge that the parent (e.g. edge list) asked for. We use
  // bypass styles for color because relationship-specific stylesheet rules are
  // more specific than our highlight class.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;

    const edge = highlightedEdgeId ? cy.getElementById(highlightedEdgeId) : null;
    if (edge && edge.isEdge?.() && edge.length > 0) {
      edge.addClass('edge-hover-highlight');
      edge.style('line-color', 'rgba(230,240,255,0.85)');
      edge.style('target-arrow-color', 'rgba(230,240,255,0.85)');
      edge.style('source-arrow-color', 'rgba(230,240,255,0.85)');
    }

    return () => {
      if (!cy || cy.destroyed()) return;
      if (edge && edge.isEdge?.() && edge.length > 0) {
        edge.removeClass('edge-hover-highlight');
        edge.removeStyle();
      }
    };
  }, [highlightedEdgeId]);

  // Highlight the node that the parent (e.g. entity list) asked for.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;

    const node = highlightedNodeId ? cy.getElementById(highlightedNodeId) : null;
    if (node && node.isNode?.() && node.length > 0) {
      node.addClass('node-hover-highlight');
    }

    return () => {
      if (!cy || cy.destroyed()) return;
      if (node && node.isNode?.() && node.length > 0) {
        node.removeClass('node-hover-highlight');
      }
    };
  }, [highlightedNodeId]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/40">
          {graph.nodes.length === 0 ? (
            <>
              <span className="text-white/50">Explore makes exclusive use of prebuilt mental models.</span>
              <span className="text-[11px] text-white/30">Ensure you have at least one set of Interface mental models for entities you want to use.</span>
            </>
          ) : (
            'Building graph…'
          )}
        </div>
      )}
    </div>
  );
}

export default InteractiveGraph;
