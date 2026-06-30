'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import { colorForType, mapTypeName, type ResearchSelection, type GraphNode, type GraphEdge, type GraphLayout } from './research-canvas';

export interface ComponentDiagramProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedIds?: string[];
  onSelect?: (selection: ResearchSelection) => void;
  onAddToQuery?: (selection: ResearchSelection) => void;
  layoutName?: GraphLayout;
  layoutAnimate?: boolean;
  showEdgeLabels?: boolean;
  edgeFilters?: Set<string>;
  /** Called with the Cytoscape instance once it is created. */
  onCyReady?: (cy: cytoscape.Core) => void;
  /** Called when the user hovers over a node or edge. */
  onHover?: (info: { kind: 'node' | 'edge'; data: any }) => void;
}

function truncateLabel(label: string, max = 22): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

const RELATIONSHIP_COLOURS: Record<string, string> = {
  calls: 'rgba(100,210,200,0.55)',
  depends_on: 'rgba(210,160,120,0.55)',
  sends: 'rgba(180,150,210,0.55)',
  reads: 'rgba(150,190,160,0.55)',
  writes: 'rgba(220,140,150,0.55)',
};

export function ComponentDiagram({
  nodes,
  edges,
  selectedIds,
  onSelect,
  onAddToQuery,
  layoutName = 'dagre',
  layoutAnimate = true,
  showEdgeLabels = false,
  edgeFilters,
  onCyReady,
  onHover,
}: ComponentDiagramProps) {
  cytoscape.use(cytoscapeDagre);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [cyInstance, setCyInstance] = useState<cytoscape.Core | null>(null);
  const [ready, setReady] = useState(false);
  const showEdgeLabelsRef = useRef(showEdgeLabels);

  useEffect(() => {
    showEdgeLabelsRef.current = showEdgeLabels;
  });

  const { elements, nodeWidth } = useMemo(() => {
    const nodeById = new Map<string, GraphNode>();
    for (const n of nodes) {
      if (!n?.id) continue;
      nodeById.set(n.id, n);
    }

    const seenEdgeKeys = new Set<string>();
    const visibleEdges: { id: string; source: string; target: string; label: string; relationship_type?: string; edge_source?: string; weight?: number }[] = [];
    for (const e of edges) {
      if (!e?.source || !e?.target) continue;
      if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
      const label = e.label || e.relationship_type || '';
      if (!label) continue;
      const key = `${e.source}|${e.target}|${label}`;
      if (seenEdgeKeys.has(key)) continue;
      seenEdgeKeys.add(key);
      visibleEdges.push({
        id: e.id || key,
        source: e.source,
        target: e.target,
        label,
        relationship_type: e.relationship_type,
        edge_source: e.edge_source,
        weight: e.weight,
      });
    }

    // Compute a uniform box width from the average label length.
    const labels = Array.from(nodeById.values()).map((n) => truncateLabel(n.label));
    const avgChars = labels.length > 0
      ? labels.reduce((sum, l) => sum + l.length, 0) / labels.length
      : 0;
    // Approximate width: ~6.5px per char + horizontal padding (20px).
    const computedWidth = Math.max(80, Math.round(avgChars * 6.5 + 20));
    // Clamp to a sensible range.
    const nodeWidth = `${Math.min(computedWidth, 200)}px`;

    const cyNodes: cytoscape.ElementDefinition[] = Array.from(nodeById.values()).map((n) => ({
      group: 'nodes',
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
      },
    }));

    const edgeOffsetCount = new Map<string, number>();
    const cyEdges: cytoscape.ElementDefinition[] = visibleEdges.map((e, i) => {
      const pairKey = `${e.source}<->${e.target}`;
      const count = edgeOffsetCount.get(pairKey) || 0;
      edgeOffsetCount.set(pairKey, count + 1);
      // Alternating offsets: 0, +24, -24, +48, -48, ... for parallel/shared edges.
      const sign = count % 2 === 0 ? 1 : -1;
      const offset = count === 0 ? 0 : sign * Math.ceil(count / 2) * 28;
      return {
        group: 'edges',
        data: {
          id: e.id || `edge-${i}`,
          source: e.source,
          target: e.target,
          label: e.label,
          relationship_type: e.relationship_type || e.label,
          edge_source: e.edge_source,
          weight: e.weight ?? 1,
          cpDistance: offset,
        },
      };
    });

    return { elements: [...cyNodes, ...cyEdges], nodeWidth };
  }, [nodes, edges]);

  useEffect(() => {
    if (!containerRef.current || cyRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(backgroundColor)',
            'background-opacity': 1,
            shape: 'roundrectangle',
            width: nodeWidth,
            height: '36px',
            padding: '10px',
            color: '#000000',
            'font-size': '10px',
            'font-weight': 'normal',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-margin-y': 0,
            'text-margin-x': 0,
            'text-max-width': '160px',
            'text-wrap': 'ellipsis',
            'text-background-color': 'transparent',
            'text-background-opacity': 0,
            'text-background-padding': '0px',
            'border-width': 0,
            'transition-property': 'background-color, border-color, opacity',
            'transition-duration': 0.2,
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
            'control-point-distances': 'data(cpDistance)',
            'control-point-weights': 0.5,
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
          selector: 'edge.show-label',
          style: {
            label: 'data(label)',
            'z-index': 9999,
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
          },
        },
        {
          selector: 'edge[edge_source = "mental_model"]',
          style: {
            width: 0.75,
            'line-color': 'rgba(66,165,245,0.4)',
            'target-arrow-color': 'rgba(66,165,245,0.4)',
          },
        },
        ...Object.entries(RELATIONSHIP_COLOURS).map(([type, colour]) => ({
          selector: `edge[edge_source = "mental_model"][relationship_type = "${type}"]`,
          style: {
            'line-color': colour,
            'target-arrow-color': colour,
          },
        })),
        {
          selector: ':selected',
          style: {
            'background-color': '#10b981',
            'background-opacity': 0.25,
            'line-color': 'rgba(16,185,129,0.7)',
            'target-arrow-color': 'rgba(16,185,129,0.7)',
            'border-color': '#10b981',
            color: '#10b981',
            'text-opacity': 1,
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
        const kind = target.isNode() ? 'diagram' : 'edge';
        const label = target.data('fullLabel') || target.data('label') || id;
        onSelect?.({ source: 'diagram', kind, ids: [id], context: String(label) });
      }
    });

    cy.on('dbltap', 'node, edge', (event) => {
      const target = event.target;
      const id = target.id();
      const kind = target.isNode() ? 'diagram' : 'edge';
      const label = target.data('fullLabel') || target.data('label') || id;
      onAddToQuery?.({ source: 'diagram', kind, ids: [id], context: String(label) });
    });

    cy.on('layoutstop', () => {
      cy.fit(undefined, 20);
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
  }, [onSelect, onAddToQuery, onHover]);

  const prevElementsRef = useRef(elements);
  const prevSnapshotRef = useRef({ nodeIds: new Set<string>(), edgeIds: new Set<string>() });
  const prevLayoutNameRef = useRef<GraphLayout>(layoutName);
  const prevLayoutAnimateRef = useRef<boolean>(layoutAnimate);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const nextNodeIds = new Set<string>(
      elements
        .filter((el): el is cytoscape.ElementDefinition & { group: 'nodes' } => el.group === 'nodes')
        .map((n) => n.data.id as string)
        .filter(Boolean),
    );
    const nextEdgeIds = new Set<string>(
      elements
        .filter((el): el is cytoscape.ElementDefinition & { group: 'edges' } => el.group === 'edges')
        .map((e) => e.data.id as string)
        .filter(Boolean),
    );
    const prev = prevSnapshotRef.current;

    cy.elements().forEach((el) => {
      const id = el.id();
      if (el.isNode() ? !nextNodeIds.has(id) : !nextEdgeIds.has(id)) {
        el.remove();
      }
    });

    elements.forEach((el) => {
      if (el.group === 'nodes') {
        const n = el as cytoscape.ElementDefinition & { group: 'nodes' };
        const existing = cy.getElementById(n.data.id as string);
        if (existing.length === 0) {
          cy.add({ group: 'nodes', data: n.data });
        } else {
          existing.data(n.data);
        }
      } else {
        const e = el as cytoscape.ElementDefinition & { group: 'edges' };
        const existing = cy.getElementById(e.data.id as string);
        if (existing.length === 0) {
          cy.add({ group: 'edges', data: e.data });
        } else {
          existing.data(e.data);
        }
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
      if (rect.width === 0 || rect.height === 0) return;
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
      let cyPos = 0;
      positionedNodes.forEach((n) => {
        const p = n.position();
        cx += p.x;
        cyPos += p.y;
      });
      cx /= positionedNodes.length;
      cyPos /= positionedNodes.length;

      currentCy.nodes().forEach((n) => {
        const p = n.position();
        if (p.x === 0 && p.y === 0) {
          const angle = Math.random() * 2 * Math.PI;
          const radius = 20 + Math.random() * 30;
          n.position({
            x: cx + Math.cos(angle) * radius,
            y: cyPos + Math.sin(angle) * radius,
          });
        }
      });
    };

    const innerRunLayout = () => {
      const currentCy = cyRef.current;
      if (!currentCy || currentCy.destroyed()) return;
      setReady(false);
      currentCy.resize();

      if (!nodeSetChanged && !layoutChanged && !hasUnpositionedNodes) {
        setReady(true);
        return;
      }

      const name = layoutName || 'dagre';
      const isUserDrivenLayoutChange = layoutChanged;
      const shouldAnimate = isUserDrivenLayoutChange && layoutAnimate;

      seedNewNodePositions();

      let layout: cytoscape.Layouts;
      switch (name) {
        case 'cose':
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
        case 'dagre':
        default:
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
            edgeSep: 40,
            rankSep: 80,
            nodeSep: 40,
          } as any);
      }
      layout.run();
    };

    requestAnimationFrame(runLayout);
  }, [elements, layoutName, layoutAnimate]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Apply edge-filter dimming without removing elements. Active edges and
    // their endpoint nodes stay bright; everything else is muted.
    if (edgeFilters) {
      const activeEdges = cy.edges().filter((e) => {
        const type = e.data('relationship_type');
        return type ? edgeFilters.has(type) : false;
      });
      const activeNodeIds = new Set<string>();
      activeEdges.forEach((e) => {
        activeNodeIds.add(e.source().id());
        activeNodeIds.add(e.target().id());
      });
      cy.edges().not(activeEdges).addClass('dimmed-edge');
      activeEdges.removeClass('dimmed-edge');
      cy.nodes().forEach((n) => {
        if (activeNodeIds.has(n.id())) {
          n.removeClass('dimmed-node');
        } else {
          n.addClass('dimmed-node');
        }
      });
    } else {
      cy.elements().removeClass('dimmed-edge dimmed-node');
    }
  }, [elements, edgeFilters]);

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
    if (showEdgeLabels) {
      cy.edges().addClass('show-label');
    }
  }, [cyInstance]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedIds) return;
    cy.elements().unselect();
    for (const id of selectedIds) {
      const el = cy.getElementById(id);
      if (el.length > 0) el.select();
    }
  }, [selectedIds]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">Building component diagram…</div>
      )}
    </div>
  );
}
