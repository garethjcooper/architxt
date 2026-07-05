'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import cytoscape from 'cytoscape';
import {
  serversApi,
  researchApi,
  mentalModelsApi,
  type Server,
  type DiscoverStepResponse,
  type PrebuiltResponse,
} from '@/lib/api/client';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { InteractiveGraph, type GraphCanvas, type GraphNode, type GraphEdge, type GraphLayout, colorForType, colorForEdge } from '@/components/research-canvas';
import { transformPrebuiltToDiscoverResponse } from '@/app/research/prebuilt';
import { ExploreToolbox, type TargetSelection, type PrebuiltDimensionStatus } from './toolbox';
import { GraphControls } from './graph-controls';

const logger = createLogger('ExplorePage');

const EXPLORE_DIMENSIONS = ['summary', 'interface', 'interface-found'];

function qualifiedId(id: string, type?: string | null): string {
  if (id.includes(':')) return id;
  if (type) return `${type}:${id}`;
  return id;
}

function qualifyNode(node: GraphNode): GraphNode {
  return { ...node, id: qualifiedId(node.id, node.type) };
}

function qualifyGraph(graph: GraphCanvas): GraphCanvas {
  const nodeTypeById = new Map(graph.nodes.map((n) => [n.id, n.type]));
  const nodes = graph.nodes.map((n) => qualifyNode(n));
  const edges = graph.edges.map((e) => ({
    ...e,
    source: qualifiedId(e.source, nodeTypeById.get(e.source)),
    target: qualifiedId(e.target, nodeTypeById.get(e.target)),
    edge_source: e.edge_source || 'mental_model',
    id: e.id || `${qualifiedId(e.source, nodeTypeById.get(e.source))}|${qualifiedId(e.target, nodeTypeById.get(e.target))}|${e.label || e.relationship_type || 'edge'}`,
  }));
  return { nodes, edges };
}

function normalizeGlobalEntity(n: GraphNode): GraphNode {
  const type = n.type || (typeof n.id === 'string' && n.id.includes(':') ? n.id.split(':')[0] : 'other');
  return qualifyNode({ ...n, type });
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function extractEntitySummary(prebuilt: { dimensions?: Array<{ dimension: string; result?: { narrative?: string; errors?: Array<{ model?: string; error: string }> } }> } | undefined, entityId: string): { text: string; ok: boolean; reason?: string } {
  const dimensions = prebuilt?.dimensions;
  if (!dimensions || dimensions.length === 0) {
    return { text: '', ok: false, reason: 'No summary data returned.' };
  }
  const summaryDim = dimensions.find((d) => d.dimension === 'summary');
  if (!summaryDim) {
    return { text: '', ok: false, reason: 'Summary dimension not found in response.' };
  }
  if (summaryDim.result?.errors && summaryDim.result.errors.length > 0) {
    const first = summaryDim.result.errors[0];
    return { text: '', ok: false, reason: `Summary failed: ${first.model || 'model'} — ${first.error}` };
  }
  const raw = summaryDim.result?.narrative;
  if (!raw || typeof raw !== 'string' || raw.trim().length === 0) {
    return { text: '', ok: false, reason: 'Summary returned empty text.' };
  }
  return { text: stripMarkdown(raw), ok: true };
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

function mergeGraphs(base: GraphCanvas, incoming: GraphCanvas): GraphCanvas {
  const nodeById = new Map(base.nodes.map((n) => [n.id, n]));
  for (const incomingNode of incoming.nodes) {
    const existing = nodeById.get(incomingNode.id);
    if (existing) {
      nodeById.set(incomingNode.id, mergeNodeData(existing, incomingNode));
    } else {
      nodeById.set(incomingNode.id, incomingNode);
    }
  }
  const edgeIds = new Set(base.edges.map((e) => e.id));
  const nextEdges = [...base.edges];
  for (const edge of incoming.edges) {
    if (!edgeIds.has(edge.id)) {
      nextEdges.push(edge);
      edgeIds.add(edge.id);
    }
  }
  return { nodes: Array.from(nodeById.values()), edges: nextEdges };
}

function removeEdgesAndOrphanNodes(
  graph: GraphCanvas,
  edgeIdsToRemove: Set<string>,
  protectedNodeIds: Set<string>
): GraphCanvas {
  const nextEdges = graph.edges.filter((e) => !edgeIdsToRemove.has(e.id));
  const remainingNodeIds = new Set<string>(protectedNodeIds);
  for (const e of nextEdges) {
    remainingNodeIds.add(e.source);
    remainingNodeIds.add(e.target);
  }
  const nextNodes = graph.nodes.filter((n) => remainingNodeIds.has(n.id));
  return { nodes: nextNodes, edges: nextEdges };
}

function removeNodeAndOrphanedNeighbors(graph: GraphCanvas, nodeId: string): GraphCanvas {
  const edgeIdsToRemove = new Set(
    graph.edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => e.id)
  );
  return removeEdgesAndOrphanNodes(graph, edgeIdsToRemove, new Set());
}

function buildPrebuiltDimensionStatuses(
  prebuilt: PrebuiltResponse,
  dimensionLabels: Map<string, string>
): PrebuiltDimensionStatus[] {
  return (prebuilt.dimensions || []).map((dim) => {
    const errors: string[] = [];
    if (dim.result?.errors) {
      for (const err of dim.result.errors) {
        errors.push(err.error);
      }
    }
    for (const ent of dim.entities || []) {
      for (const mr of ent.model_results || []) {
        if (mr.error) errors.push(`${mr.name}: ${mr.error}`);
        if (mr.graph_error) errors.push(`${mr.name}: ${mr.graph_error}`);
      }
    }

    const jsonResult = dim.result?.json_result;
    let nodeCount = 0;
    if (jsonResult) {
      if (Array.isArray(jsonResult)) {
        nodeCount = jsonResult.reduce((sum, g) => sum + (g.nodes?.length || 0), 0);
      } else {
        nodeCount = jsonResult.nodes?.length || 0;
      }
    }

    const hasData = dim.found_count > 0 || (dim.result?.narrative ? dim.result.narrative.trim().length > 0 : false);
    return {
      dimension: dim.dimension,
      label: dimensionLabels.get(dim.dimension) || dim.dimension,
      loaded: hasData && errors.length === 0,
      nodeCount: dim.dimension.startsWith('interface') ? nodeCount : undefined,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  });
}

export default function ExplorePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [globalGraph, setGlobalGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [globalGraphLoading, setGlobalGraphLoading] = useState(false);
  const [entitySearch, setEntitySearch] = useState('');

  const [graph, setGraph] = useState<GraphCanvas>({ nodes: [], edges: [] });
  const [discoveries, setDiscoveries] = useState<Map<string, DiscoverStepResponse>>(new Map());
  const [discovering, setDiscovering] = useState<Set<string>>(new Set());
  const [discoveryErrors, setDiscoveryErrors] = useState<Map<string, string>>(new Map());
  const [prebuiltDimensionStatuses, setPrebuiltDimensionStatuses] = useState<Map<string, PrebuiltDimensionStatus[]>>(new Map());
  const [dimensionLabels, setDimensionLabels] = useState<Map<string, string>>(new Map());
  const [showToolbox, setShowToolbox] = useState(true);
  const [showControls, setShowControls] = useState(false);
  const [autoScrollEntities, setAutoScrollEntities] = useState(true);
  const [autoScrollEdges, setAutoScrollEdges] = useState(true);
  const [graphLayout, setGraphLayout] = useState<GraphLayout>('cose');
  const [graphLayoutAnimate, setGraphLayoutAnimate] = useState(true);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [nodeFilters, setNodeFilters] = useState<Set<string>>(new Set());
  const [edgeFilters, setEdgeFilters] = useState<Set<string>>(new Set());
  const cyRef = useRef<cytoscape.Core | null>(null);
  const [toolboxNodeId, setToolboxNodeId] = useState<string | null>(null);
  const [toolboxTab, setToolboxTab] = useState<'node' | 'entities'>('entities');
  const [placementSourceNodeId, setPlacementSourceNodeId] = useState<string | null>(null);

  const errorNodeIds = useMemo(() => new Set(discoveryErrors.keys()), [discoveryErrors]);
  const [hoveredEntityId, setHoveredEntityId] = useState<string | null>(null);
  const [hoveredTargetDirection, setHoveredTargetDirection] = useState<'inbound' | 'outbound' | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [topFlex, setTopFlex] = useState(2);
  const bottomFlex = 5 - topFlex;
  const [leftFlex, setLeftFlex] = useState(1.0);
  const rightFlex = 5 - leftFlex;
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startTopFlexRef = useRef(2);
  const containerHeightRef = useRef(0);
  const isHorizontalDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startLeftFlexRef = useRef(1.1);
  const containerWidthRef = useRef(0);

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  const canvasEdges = useMemo(() => {
    return graph.edges
      .map((e) => ({
        ...e,
        sourceNode: nodeById.get(e.source),
        targetNode: nodeById.get(e.target),
      }))
      .filter((e) => e.sourceNode && e.targetNode)
      .sort((a, b) => {
        const aKey = `${a.source}|${a.target}`;
        const bKey = `${b.source}|${b.target}`;
        return aKey.localeCompare(bKey);
      });
  }, [graph.edges, nodeById]);

  const edgeListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchServers();
    mentalModelsApi.listStandardDimensions()
      .then((data) => {
        const map = new Map<string, string>();
        for (const d of Array.isArray(data) ? data : []) {
          if (d.value) map.set(d.value, d.label || d.value);
        }
        setDimensionLabels(map);
      })
      .catch((err) => {
        logger.warn('Failed to load standard dimension labels', err);
      });
  }, []);

  useEffect(() => {
    if (!selectedServerId) {
      setBanks([]);
      setSelectedBankId('');
      return;
    }
    fetchBanks(parseInt(selectedServerId, 10));
  }, [selectedServerId]);

  useEffect(() => {
    if (!selectedServerId || !selectedBankId) {
      setGlobalGraph(null);
      return;
    }
    const serverId = parseInt(selectedServerId, 10);
    setGlobalGraphLoading(true);
    serversApi.getBankGraph(serverId, selectedBankId)
      .then((data) => {
        const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
        setGlobalGraph({ nodes, edges: [] });
      })
      .catch((err) => {
        logger.error('Failed to fetch bank graph', err);
        toast.error('Failed to load bank entities');
        setGlobalGraph(null);
      })
      .finally(() => setGlobalGraphLoading(false));
  }, [selectedServerId, selectedBankId]);

  // Reset the canvas and any cached discovery data when the user switches server/bank.
  useEffect(() => {
    setGraph({ nodes: [], edges: [] });
    setDiscoveries(new Map());
    setDiscovering(new Set());
    setDiscoveryErrors(new Map());
    setPrebuiltDimensionStatuses(new Map());
    setToolboxNodeId(null);
    setEntitySearch('');
    setHoveredEntityId(null);
    setHoveredTargetDirection(null);
    setPlacementSourceNodeId(null);
  }, [selectedServerId, selectedBankId]);

  const globalEntities = useMemo(() => {
    if (!globalGraph) return [];
    return globalGraph.nodes.map(normalizeGlobalEntity);
  }, [globalGraph]);

  const canvasNodeIds = useMemo(() => new Set(graph.nodes.map((n) => n.id)), [graph.nodes]);

  const filteredGlobalEntities = useMemo(() => {
    if (!entitySearch.trim()) return globalEntities;
    const q = entitySearch.trim().toLowerCase();
    return globalEntities.filter((n) =>
      (n.label || '').toLowerCase().includes(q) ||
      (n.id || '').toLowerCase().includes(q) ||
      (n.type || '').toLowerCase().includes(q)
    );
  }, [globalEntities, entitySearch]);

  // Nodes list: current canvas nodes first, then searchable global nodes not yet on canvas.
  const toolboxNodes = useMemo(() => {
    const seen = new Set<string>(canvasNodeIds);
    const result = [...graph.nodes];
    for (const n of filteredGlobalEntities) {
      if (!seen.has(n.id)) {
        result.push(n);
        seen.add(n.id);
      }
    }
    return result;
  }, [graph.nodes, filteredGlobalEntities, canvasNodeIds]);

  const canvasEntities = useMemo(
    () =>
      [...graph.nodes].sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id)),
    [graph.nodes]
  );

  const fetchServers = async () => {
    try {
      const data = await serversApi.list();
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to fetch servers', err);
      toast.error('Failed to load servers');
    }
  };

  const fetchBanks = async (serverId: number) => {
    setLoadingBanks(true);
    try {
      const data = await serversApi.listBanks(serverId);
      setBanks(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to fetch banks', err);
      toast.error('Failed to load banks');
    } finally {
      setLoadingBanks(false);
    }
  };

  const runPrebuiltData = useCallback(async (qualifiedId: string) => {
    if (!selectedServerId || !selectedBankId) return;
    const serverId = parseInt(selectedServerId, 10);

    setDiscovering((prev) => new Set(prev).add(qualifiedId));
    setDiscoveryErrors((prev) => {
      const next = new Map(prev);
      next.delete(qualifiedId);
      return next;
    });

    try {
      const prebuilt = await researchApi.prebuiltOneshot({
        server_id: serverId,
        bank_id: selectedBankId,
        entities: [qualifiedId],
        dimensions: EXPLORE_DIMENSIONS,
      });
      if (!prebuilt.success) {
        throw new Error(prebuilt.error || 'Prebuilt research failed');
      }
      const transformed = transformPrebuiltToDiscoverResponse(prebuilt, selectedBankId);
      const qualifiedGraph = qualifyGraph(transformed.canvas?.graph || { nodes: [], edges: [] });
      const cached: DiscoverStepResponse = {
        ...transformed,
        canvas: { ...(transformed.canvas || { graph: { nodes: [], edges: [] } }), graph: qualifiedGraph },
      };
      setDiscoveries((prev) => {
        const next = new Map(prev);
        next.set(qualifiedId, cached);
        return next;
      });
      setPrebuiltDimensionStatuses((prev) => {
        const next = new Map(prev);
        next.set(qualifiedId, buildPrebuiltDimensionStatuses(prebuilt, dimensionLabels));
        return next;
      });

      // Build a clear missing-model warning even when no graph came back.
      const missingModels: string[] = [];
      for (const dim of prebuilt.dimensions || []) {
        for (const ent of dim.entities || []) {
          for (const mr of ent.model_results || []) {
            if (!mr.found) {
              missingModels.push(`${mr.name || mr.ext_id || 'model'}: ${mr.error || 'not found'}`);
            }
          }
        }
      }

      // Enrich the source node on the canvas with any extra fields from the
      // discovery response, but do not auto-add related nodes or edges here.
      const sourceNodeData = qualifiedGraph.nodes.find((n) => n.id === qualifiedId);
      const summary = extractEntitySummary(prebuilt, qualifiedId);
      const nodeWithSummary = sourceNodeData
        ? { ...sourceNodeData, summaryText: summary.ok ? summary.text : summary.reason || 'No summary available.' }
        : null;
      if (nodeWithSummary) {
        setGraph((prev) => {
          if (!prev.nodes.some((n) => n.id === qualifiedId)) return prev;
          return mergeGraphs(prev, { nodes: [nodeWithSummary], edges: [] });
        });
      }

      // Surface partial errors while still keeping any valid data.
      const warnings: string[] = [...missingModels];
      for (const dim of prebuilt.dimensions || []) {
        for (const ent of dim.entities || []) {
          for (const mr of ent.model_results || []) {
            if (mr.error) warnings.push(`${mr.name}: ${mr.error}`);
            if (mr.graph_error) warnings.push(`${mr.name}: ${mr.graph_error}`);
          }
        }
      }
      if (warnings.length > 0) {
        const message = warnings.join('; ');
        logger.warn('Explore discovery returned partial data', { entity: qualifiedId, error: message });
        setDiscoveryErrors((prev) => {
          const next = new Map(prev);
          next.set(qualifiedId, message);
          return next;
        });
      } else {
        setDiscoveryErrors((prev) => {
          const next = new Map(prev);
          next.delete(qualifiedId);
          return next;
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Explore discovery failed', { entity: qualifiedId, error: message });
      setDiscoveryErrors((prev) => {
        const next = new Map(prev);
        next.set(qualifiedId, message);
        return next;
      });
      toast.error(`Discovery failed for ${qualifiedId}: ${message}`);
    } finally {
      setDiscovering((prev) => {
        const next = new Set(prev);
        next.delete(qualifiedId);
        return next;
      });
    }
  }, [selectedServerId, selectedBankId, dimensionLabels]);

  const handleClickEntity = useCallback((entity: GraphNode) => {
    const qualified = qualifiedId(entity.id, entity.type);
    const nodeToAdd = qualifyNode({ ...entity, id: qualified });
    const exists = graph.nodes.some((n) => n.id === nodeToAdd.id);

    if (exists) {
      setGraph((prev) => removeNodeAndOrphanedNeighbors(prev, nodeToAdd.id));
      if (toolboxNodeId === nodeToAdd.id) {
        setToolboxNodeId(null);
      }
      if (placementSourceNodeId === nodeToAdd.id) {
        setPlacementSourceNodeId(null);
      }
    } else {
      setGraph((prev) => mergeGraphs(prev, { nodes: [nodeToAdd], edges: [] }));
      setPlacementSourceNodeId(nodeToAdd.id);
      runPrebuiltData(nodeToAdd.id);
    }
  }, [graph, toolboxNodeId, placementSourceNodeId, runPrebuiltData]);

  const handleHoverEntity = useCallback((entity: GraphNode | null) => {
    setHoveredEntityId(entity ? qualifiedId(entity.id, entity.type) : null);
  }, []);

  const handleHoverToolboxTarget = useCallback((payload: { targetId: string | null; direction?: 'inbound' | 'outbound' }) => {
    setHoveredEntityId(payload.targetId);
    setHoveredTargetDirection(payload.direction || null);
  }, []);

  const handleEdgeHover = useCallback((edgeId: string | null) => {
    setHoveredEdgeId(edgeId);
  }, []);

  const handleNodeHover = useCallback((nodeId: string | null) => {
    setHoveredNodeId(nodeId);
  }, []);

  // When an edge is hovered on the canvas, scroll the matching list row into view.
  useEffect(() => {
    if (!hoveredEdgeId || !edgeListRef.current || !autoScrollEdges) return;
    const row = edgeListRef.current.querySelector(`[data-edge-id="${CSS.escape(hoveredEdgeId)}"]`) as HTMLElement | null;
    if (row) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [hoveredEdgeId, autoScrollEdges]);

  const entityListRef = useRef<HTMLDivElement>(null);

  // When a node is hovered on the canvas, scroll the matching entity row into view.
  useEffect(() => {
    if (!hoveredNodeId || !entityListRef.current || !autoScrollEntities) return;
    const row = entityListRef.current.querySelector(`[data-node-id="${CSS.escape(hoveredNodeId)}"]`) as HTMLElement | null;
    if (row) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [hoveredNodeId, autoScrollEntities]);

  // Resizer: copy the research-page pattern using flex weights and document-level
  // mouse events. Default 2/3 split, double-click resets.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startTopFlexRef.current = topFlex;
    const container = leftPaneRef.current;
    if (container) {
      containerHeightRef.current = container.getBoundingClientRect().height;
    }
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [topFlex]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const containerHeight = containerHeightRef.current;
    if (containerHeight > 0) {
      const deltaFlex = (deltaY / containerHeight) * 5;
      const nextTopFlex = Math.min(Math.max(startTopFlexRef.current + deltaFlex, 0.8), 4.2);
      setTopFlex(nextTopFlex);
    }
  }, []);

  const handleResizeEnd = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleHorizontalResizeStart = useCallback((e: React.MouseEvent) => {
    isHorizontalDraggingRef.current = true;
    startXRef.current = e.clientX;
    startLeftFlexRef.current = leftFlex;
    const container = leftPaneRef.current?.parentElement;
    if (container) {
      containerWidthRef.current = container.getBoundingClientRect().width;
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [leftFlex]);

  const handleHorizontalResizeMove = useCallback((e: MouseEvent) => {
    if (!isHorizontalDraggingRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const containerWidth = containerWidthRef.current;
    if (containerWidth > 0) {
      const deltaFlex = (deltaX / containerWidth) * 5;
      const nextLeftFlex = Math.min(Math.max(startLeftFlexRef.current + deltaFlex, 0.5), 4.5);
      setLeftFlex(nextLeftFlex);
    }
  }, []);

  const handleHorizontalResizeEnd = useCallback(() => {
    isHorizontalDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const toggleNodeFilter = useCallback((type: string) => {
    setNodeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleEdgeFilter = useCallback((type: string) => {
    setEdgeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  useEffect(() => {
    setNodeFilters(new Set());
  }, [selectedBankId]);

  useEffect(() => {
    setEdgeFilters(new Set());
  }, [selectedBankId]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      handleResizeMove(e);
      handleHorizontalResizeMove(e);
    };
    const up = () => {
      handleResizeEnd();
      handleHorizontalResizeEnd();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleResizeMove, handleResizeEnd, handleHorizontalResizeMove, handleHorizontalResizeEnd]);

  const previewGraph = useMemo(() => {
    if (!hoveredEntityId) return undefined;

    const existingNode = graph.nodes.find((n) => n.id === hoveredEntityId);
    const existingEdgeIds = new Set(graph.edges.map((e) => e.id));

    // If the hover comes from the open toolbox, only preview edges between the
    // selected source node and the hovered target. This avoids cluttering the
    // canvas with unrelated discovery edges.
    if (toolboxNodeId && hoveredEntityId !== toolboxNodeId) {
      const discovery = discoveries.get(toolboxNodeId);
      const discoveryEdges = discovery?.canvas?.graph?.edges || [];
      const toolboxPreviewEdges = discoveryEdges.filter((e) => {
        const matchesDirection = hoveredTargetDirection
          ? hoveredTargetDirection === 'outbound'
            ? e.source === toolboxNodeId && e.target === hoveredEntityId
            : e.target === toolboxNodeId && e.source === hoveredEntityId
          : (e.source === toolboxNodeId && e.target === hoveredEntityId) ||
            (e.target === toolboxNodeId && e.source === hoveredEntityId);
        return matchesDirection && !existingEdgeIds.has(e.id);
      });

      if (existingNode) {
        return toolboxPreviewEdges.length > 0 ? { nodes: [], edges: toolboxPreviewEdges } : undefined;
      }

      const globalNode = globalEntities.find((n) => qualifiedId(n.id, n.type) === hoveredEntityId);
      const previewNode = globalNode
        ? qualifyNode({ ...globalNode })
        : { id: hoveredEntityId, label: hoveredEntityId };

      return { nodes: [previewNode], edges: toolboxPreviewEdges };
    }

    // Collect discovery edges that connect the hovered entity to another node
    // already on the canvas, but aren't on the canvas yet.
    const previewEdges: GraphEdge[] = [];
    for (const discovery of discoveries.values()) {
      const edges = discovery?.canvas?.graph?.edges || [];
      for (const e of edges) {
        if (existingEdgeIds.has(e.id)) continue;
        const connectsHovered = e.source === hoveredEntityId || e.target === hoveredEntityId;
        const otherEnd = e.source === hoveredEntityId ? e.target : e.source;
        if (connectsHovered && graph.nodes.some((n) => n.id === otherEnd)) {
          previewEdges.push(e);
        }
      }
    }

    if (existingNode) {
      // Hovered entity is already on the canvas: just preview missing edges.
      return previewEdges.length > 0 ? { nodes: [], edges: previewEdges } : undefined;
    }

    // Hovered entity is not on the canvas: show a ghost node near the source.
    const globalNode = globalEntities.find((n) => qualifiedId(n.id, n.type) === hoveredEntityId);
    const previewNode = globalNode
      ? qualifyNode({ ...globalNode })
      : { id: hoveredEntityId, label: hoveredEntityId };

    return { nodes: [previewNode], edges: [] };
  }, [hoveredEntityId, hoveredTargetDirection, graph.nodes, graph.edges, globalEntities, toolboxNodeId, discoveries]);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (discovering.has(nodeId)) {
      toast.info('Discovery still loading for this node');
      return;
    }
    // Always refresh cached discovery when opening the toolbox so corrected
    // server-side data is picked up without a manual refresh control.
    runPrebuiltData(nodeId);
    setToolboxNodeId(nodeId);
    setToolboxTab('node');
    setPlacementSourceNodeId(nodeId);
    setShowToolbox(true);
  }, [discovering, runPrebuiltData]);

  const handleApplyEdges = useCallback((nodeId: string, selections: TargetSelection[]) => {
    const discovery = discoveries.get(nodeId);
    if (!discovery?.canvas?.graph) {
      logger.warn('Apply edges called without discovery data', { nodeId });
      toast.error('No discovery data for selected node.');
      return;
    }
    const discoveryGraph = discovery.canvas.graph;
    const discoveryNodeById = new Map(discoveryGraph.nodes.map((n) => [n.id, n]));
    const globalNodeById = new Map(globalEntities.map((n) => [n.id, n]));
    const graphEdgeIds = new Set(graph.edges.map((e) => e.id));

    if (!graph.nodes.some((n) => n.id === nodeId)) {
      toast.error('Source node is no longer on the canvas.');
      return;
    }

    const nodesToAdd = new Map<string, GraphNode>();
    const edgesToAdd: GraphEdge[] = [];
    const edgeIdsToRemove = new Set<string>();
    const prebuiltToLoad = new Set<string>();

    for (const sel of selections) {
      const neighborEdges = discoveryGraph.edges.filter((e) => {
        if (sel.direction === 'outbound') {
          return e.source === nodeId && e.target === sel.targetId;
        }
        return e.target === nodeId && e.source === sel.targetId;
      });
      if (neighborEdges.length === 0) continue;

      if (sel.active) {
        const allPresent = neighborEdges.every((e) => graphEdgeIds.has(e.id));
        if (allPresent) continue;

        if (!graph.nodes.some((n) => n.id === sel.targetId)) {
          const discoveryNode = discoveryNodeById.get(sel.targetId);
          const globalNode = globalNodeById.get(sel.targetId);
          const baseNode = globalNode || discoveryNode || { id: sel.targetId, label: sel.targetId };
          const nodeToAdd = qualifyNode({ ...baseNode });
          if (nodeToAdd.id) {
            nodesToAdd.set(sel.targetId, nodeToAdd);
            prebuiltToLoad.add(sel.targetId);
          } else {
            logger.warn('Target node missing usable id', { targetId: sel.targetId });
          }
        }

        for (const edge of neighborEdges) {
          if (!graphEdgeIds.has(edge.id)) {
            edgesToAdd.push(edge);
          }
        }
      } else {
        for (const edge of neighborEdges) {
          edgeIdsToRemove.add(edge.id);
        }
      }
    }

    setGraph((prev) => {
      if (!prev.nodes.some((n) => n.id === nodeId)) return prev;
      const merged = mergeGraphs(prev, { nodes: Array.from(nodesToAdd.values()), edges: edgesToAdd });
      if (edgeIdsToRemove.size === 0) return merged;
      return { ...merged, edges: merged.edges.filter((e) => !edgeIdsToRemove.has(e.id)) };
    });

    for (const id of prebuiltToLoad) {
      runPrebuiltData(id);
    }

    logger.info('Explore applied node selections', {
      source: nodeId,
      addedNodes: nodesToAdd.size,
      addedEdges: edgesToAdd.length,
      removedEdges: edgeIdsToRemove.size,
    });
  }, [discoveries, globalEntities, graph, runPrebuiltData]);

  return (
    <PageShell title="Explore" loading={false}>
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-white/10">
        <ServerBankSelectors
          servers={servers}
          selectedServerId={selectedServerId}
          setSelectedServerId={setSelectedServerId}
          banks={banks}
          selectedBankId={selectedBankId}
          setSelectedBankId={setSelectedBankId}
          loadingBanks={loadingBanks}
        />
      </div>

      <div className="flex-1 min-h-0 flex">
        <div
          ref={leftPaneRef}
          className="min-w-0 flex flex-col gap-1"
          style={{ flex: leftFlex }}
        >
          <div
            className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col"
            style={{ flex: topFlex }}
          >
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
              <span className="font-medium text-sm truncate">Entity Summaries</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
                  <Switch
                    checked={autoScrollEntities}
                    onCheckedChange={(checked) => setAutoScrollEntities(Boolean(checked))}
                    size="sm"
                  />
                  Scroll
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                  {canvasEntities.length}
                </span>
              </div>
            </div>
            <div ref={entityListRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
              {globalGraphLoading ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-10 w-full bg-white/10" />
                  <Skeleton className="h-10 w-full bg-white/10" />
                  <Skeleton className="h-10 w-full bg-white/10" />
                </div>
              ) : canvasEntities.length === 0 ? (
                <div className="text-[11px] text-white/40 px-2 py-3">No entities on the canvas yet.</div>
              ) : (
                canvasEntities.map((entity) => {
                  const active = hoveredNodeId === entity.id;
                  const targetType = entity.type || (typeof entity.id === 'string' && entity.id.includes(':') ? entity.id.split(':')[0] : undefined);
                  const typeLine = targetType && !entity.id.startsWith(`${targetType}:`)
                    ? `${targetType}:${entity.id}`
                    : entity.id;
                  const summaryText = (entity as any).summaryText || 'No summary available.';
                  return (
                    <div
                      key={entity.id}
                      role="button"
                      tabIndex={0}
                      data-node-id={entity.id}
                      onClick={() => handleClickEntity(entity)}
                      onMouseEnter={() => handleHoverEntity(entity)}
                      onMouseLeave={() => handleHoverEntity(null)}
                      className={cn(
                        'w-full flex flex-col gap-1 rounded border bg-black/10 px-2 py-1.5 text-left transition-colors cursor-pointer',
                        active
                          ? 'border-emerald-500/30 bg-emerald-900/30'
                          : 'border-white/5 hover:bg-white/5'
                      )}
                      style={{ borderLeftColor: colorForType(targetType), borderLeftWidth: 3 }}
                    >
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <div className="text-xs text-white/90 truncate">{entity.label || entity.id}</div>
                        <div className="text-[10px] text-white/40 truncate">{typeLine}</div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger>
                          <div className="text-[11px] text-white/70 leading-snug line-clamp-4 whitespace-normal break-words text-left w-full">
                            {summaryText}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8} className="max-w-xs text-xs bg-black/90 border border-white/10 text-white/90 p-2">
                          {summaryText}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div
            onMouseDown={handleResizeStart}
            onDoubleClick={() => setTopFlex(2)}
            className="h-2 shrink-0 cursor-row-resize flex items-center justify-center group"
            title="Drag to resize top and bottom panels; double-click to reset"
          >
            <div className="w-16 h-1 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
          </div>

          <div
            ref={edgeListRef}
            className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col"
            style={{ flex: bottomFlex }}
          >
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
              <span className="font-medium text-sm">Edges</span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-white/60 cursor-pointer">
                  <Switch
                    checked={autoScrollEdges}
                    onCheckedChange={(checked) => setAutoScrollEdges(Boolean(checked))}
                    size="sm"
                  />
                  Scroll
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                  {canvasEdges.length}
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
              {canvasEdges.length === 0 && (
                <div className="text-[11px] text-white/40 px-2 py-3">No edges on the canvas yet.</div>
              )}
              {canvasEdges.map((e) => {
                const active = hoveredEdgeId === e.id;
                const edgeColor = colorForEdge(e);
                return (
                  <button
                    key={e.id}
                    type="button"
                    data-edge-id={e.id}
                    onMouseEnter={() => setHoveredEdgeId(e.id)}
                    onMouseLeave={() => setHoveredEdgeId(null)}
                    className={cn(
                      'w-full text-left rounded border px-2 py-1.5 transition-colors',
                      active
                        ? 'bg-emerald-900/30 border-emerald-500/30'
                        : 'bg-black/10 border-white/5 hover:bg-white/5'
                    )}
                    style={{ borderLeftColor: edgeColor, borderLeftWidth: 3 }}
                  >
                    <div className="text-xs text-white/90 whitespace-normal break-words leading-snug">{e.label_long || e.label || e.relationship_type || 'Edge'}</div>
                    <div className="text-[10px] text-white/40 truncate">
                      {e.sourceNode?.label || e.source} → {e.targetNode?.label || e.target}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          onMouseDown={handleHorizontalResizeStart}
          onDoubleClick={() => setLeftFlex(1.0)}
          className="w-3 shrink-0 cursor-col-resize flex flex-col items-center justify-center group"
          title="Drag to resize left and right panels; double-click to reset"
        >
          <div className="w-1 h-16 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
        </div>

        <Card className="min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0"
          style={{ flex: rightFlex }}
        >
          <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
          <span className="font-medium text-sm">Explore</span>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch checked={showToolbox} onCheckedChange={(checked) => setShowToolbox(Boolean(checked))} size="sm" />
              Data
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch checked={showControls} onCheckedChange={(checked) => setShowControls(Boolean(checked))} size="sm" />
              Controls
            </label>
          </div>
          </div>
          <CardContent className="flex-1 min-h-0 p-0 relative">
          {selectedServerId && selectedBankId ? (
            <div className="absolute inset-0">
              {showControls && (
                <GraphControls
                  cy={cyRef.current}
                  nodes={graph.nodes}
                  edges={graph.edges}
                  layout={graphLayout}
                  setLayout={setGraphLayout}
                  layoutAnimate={graphLayoutAnimate}
                  setLayoutAnimate={setGraphLayoutAnimate}
                  showEdgeLabels={showEdgeLabels}
                  setShowEdgeLabels={setShowEdgeLabels}
                  nodeFilters={nodeFilters}
                  toggleNodeFilter={toggleNodeFilter}
                  edgeFilters={edgeFilters}
                  toggleEdgeFilter={toggleEdgeFilter}
                  hideMode
                  sessionName="explore"
                />
              )}
              <InteractiveGraph
                graph={graph}
                layoutName={graphLayout}
                layoutAnimate={graphLayoutAnimate}
                showEdgeLabels={showEdgeLabels}
                edgeFilters={edgeFilters}
                nodeFilters={nodeFilters}
                filterMode="hidden"
                errorNodeIds={errorNodeIds}
                onNodeClick={handleNodeClick}
                preserveLayoutOnUpdate
                placementSourceNodeId={placementSourceNodeId ?? undefined}
                previewGraph={previewGraph}
                highlightedEdgeId={hoveredEdgeId}
                onEdgeHover={handleEdgeHover}
                highlightedNodeId={hoveredEntityId || hoveredNodeId}
                onNodeHover={handleNodeHover}
                onCyReady={(cy) => { cyRef.current = cy; }}
              />
                {showToolbox && (
                  <ExploreToolbox
                    nodeId={toolboxNodeId}
                    graph={graph}
                    discovery={toolboxNodeId ? discoveries.get(toolboxNodeId) : undefined}
                    errorMessage={toolboxNodeId ? discoveryErrors.get(toolboxNodeId) : undefined}
                    isDiscovering={toolboxNodeId ? discovering.has(toolboxNodeId) : false}
                    activeTab={toolboxTab}
                    onTabChange={setToolboxTab}
                    entities={toolboxNodes}
                    onClickEntity={handleClickEntity}
                    onHoverEntity={handleHoverEntity}
                    canvasNodeIds={canvasNodeIds}
                    searchValue={entitySearch}
                    onSearchChange={setEntitySearch}
                    prebuiltDimensions={toolboxNodeId ? prebuiltDimensionStatuses.get(toolboxNodeId) : undefined}
                    onApply={handleApplyEdges}
                    onClose={() => setShowToolbox(false)}
                    onHoverTarget={handleHoverToolboxTarget}
                  />
                )}
              </div>
            ) : (
              <p className="p-6 text-white/70">Select a Hindsight server and bank to get started.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
