'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { InteractiveGraph, type GraphLayout, colorForType } from '@/components/research-canvas';
import { CardControls } from '@/app/explore/card-controls';
import { serversApi, contextualGraphApi, type GraphNode, type GraphEdge, type GraphCanvas } from '@/lib/api/client';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const logger = createLogger('ContextualGraphPage');

type BackendNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};

type BackendEdge = {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
  properties: Record<string, any>;
};

function backendNodeToGraphNode(node: BackendNode): GraphNode {
  const inferredType = node.labels[0] ?? (typeof node.id === 'string' && node.id.includes(':') ? node.id.split(':')[0] : 'entity');
  return {
    id: node.id,
    type: inferredType,
    label: node.properties.label ?? node.properties.name ?? node.id,
    name: node.properties.name ?? node.properties.label ?? node.id,
    provenance: node.properties.provenance ?? 'known',
    source: node.properties.generated_by === 'contextual_graph' ? 'mental_model' : 'hindsight',
    mental_model_applied: !!node.properties.model_refs && Array.isArray(node.properties.model_refs) && node.properties.model_refs.length > 0,
  };
}

function backendEdgeToGraphEdge(edge: BackendEdge): GraphEdge {
  return {
    id: edge.id,
    from: edge.source_id,
    to: edge.target_id,
    type: edge.type ?? undefined,
    label: edge.properties.label ?? edge.type ?? undefined,
    detail: edge.properties.detail,
    weight: typeof edge.properties.weight === 'number' ? edge.properties.weight : 1,
    provenance: edge.properties.provenance ?? 'known',
    source: edge.properties.generated_by === 'contextual_graph' ? 'mental_model' : 'hindsight',
  };
}

function normalizeGraphCanvas(nodes: BackendNode[], edges: BackendEdge[]): GraphCanvas {
  return { nodes: nodes.map(backendNodeToGraphNode), edges: edges.map(backendEdgeToGraphEdge) };
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

function buildEntityCompiledMarkdown(entities: GraphNode[]): string {
  return entities
    .map((entity) => {
      const label = entity.label || entity.name || entity.id;
      const typeLine = entity.type && !entity.id.startsWith(`${entity.type}:`)
        ? `${entity.type}:${entity.id}`
        : entity.id;
      const summary = entitySummaryText(entity);
      return `# ${escapeMdCell(label)} (${escapeMdCell(typeLine)})\n\n${escapeMdCell(summary)}`;
    })
    .join('\n\n');
}

function buildEdgeMarkdownTable(edges: GraphEdge[], nodeById: Map<string, GraphNode>): string {
  const rows = ['| Source | Target | Label | Source ID | Target ID |', '| --- | --- | --- | --- | --- |'];
  for (const e of edges) {
    const source = nodeById.get(e.from);
    const target = nodeById.get(e.to);
    rows.push(
      `| ${source?.name || source?.label || e.from} | ${target?.name || target?.label || e.to} | ${e.detail || e.label || e.type || ''} | ${e.from} | ${e.to} |`
    );
  }
  return rows.join('\n');
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
}

interface GraphNodeWithSummary extends GraphNode {
  summaryText?: string;
}

function entitySummaryText(entity: GraphNode): string {
  const withSummary = entity as GraphNodeWithSummary;
  if (withSummary.summaryText) return withSummary.summaryText;
  const raw = (entity as any).properties?.summary || (entity as any).properties?.description;
  if (typeof raw === 'string' && raw.trim().length > 0) return stripMarkdown(raw);
  return 'No summary available.';
}

export default function ContextualGraphPage() {
  const [servers, setServers] = useState<Array<{ id: number; name?: string; base_url?: string }>>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graph, setGraph] = useState<GraphCanvas>({ nodes: [], edges: [] });
  const [layout, setLayout] = useState<GraphLayout>('cose');
  const [layoutAnimate, setLayoutAnimate] = useState(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [autoScrollEntities, setAutoScrollEntities] = useState(true);
  const [autoScrollEdges, setAutoScrollEdges] = useState(true);
  const [leftFlex, setLeftFlex] = useState(1.0);
  const rightFlex = 5 - leftFlex;
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const isHorizontalDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startLeftFlexRef = useRef(1.0);
  const containerWidthRef = useRef(0);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const entityListRef = useRef<HTMLDivElement>(null);
  const edgeListRef = useRef<HTMLDivElement>(null);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  useEffect(() => {
    async function loadServers() {
      try {
        setLoadingServers(true);
        const data = await serversApi.list();
        setServers(data.map((s) => ({ id: s.id, name: s.name || s.base_url })));
      } catch (err) {
        logger.error('Failed to load servers', { error: err });
        toast.error('Failed to load servers');
      } finally {
        setLoadingServers(false);
      }
    }
    loadServers();
  }, []);

  useEffect(() => {
    if (!serverId) {
      setBanks([]);
      return;
    }
    async function loadBanks() {
      try {
        setLoadingBanks(true);
        const data = await serversApi.listBanks(serverId);
        setBanks(data.map((b) => ({ bank_id: b.bank_id, name: b.name || b.bank_id })));
      } catch (err) {
        logger.error('Failed to load banks', { error: err, serverId });
        toast.error('Failed to load banks');
      } finally {
        setLoadingBanks(false);
      }
    }
    loadBanks();
  }, [serverId]);

  const loadGraph = useCallback(async () => {
    if (!serverId || !bankId) return;
    try {
      setGraphLoading(true);
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
      ]);
      const normalized = normalizeGraphCanvas(nodesData, edgesData);
      setGraph(normalized);
    } catch (err: any) {
      logger.error('Failed to load contextual graph', { error: err, serverId, bankId });
      toast.error(`Failed to load graph: ${err.message || err}`);
      setGraph({ nodes: [], edges: [] });
    } finally {
      setGraphLoading(false);
    }
  }, [serverId, bankId]);

  useEffect(() => {
    if (serverId && bankId) {
      loadGraph();
    } else {
      setGraph({ nodes: [], edges: [] });
    }
  }, [serverId, bankId, loadGraph]);

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  const sortedNodes = useMemo(() => {
    return [...graph.nodes].sort((a, b) => (a.label || a.name || a.id).localeCompare(b.label || b.name || b.id));
  }, [graph.nodes]);

  const edgeViews = useMemo(() => {
    return graph.edges
      .map((e) => ({ edge: e, sourceNode: nodeById.get(e.from), targetNode: nodeById.get(e.to) }))
      .filter((v) => v.sourceNode && v.targetNode)
      .sort((a, b) => {
        const aKey = `${a.edge.from}|${a.edge.to}`;
        const bKey = `${b.edge.from}|${b.edge.to}`;
        return aKey.localeCompare(bKey);
      });
  }, [graph.edges, nodeById]);

  const nodeFilters = useMemo(() => new Set(graph.nodes.map((n) => n.type).filter((t): t is string => Boolean(t))), [graph.nodes]);
  const edgeFilters = useMemo(() => new Set(graph.edges.map((e) => e.type).filter((t): t is string => Boolean(t))), [graph.edges]);

  const selectOnCanvas = useCallback((id: string) => {
    setSelectedIds([id]);
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    const el = cy.getElementById(id);
    if (el.length === 0) return;
    cy.elements().unselect();
    el.select();
    cy.fit(el, 80);
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    selectOnCanvas(nodeId);
  }, [selectOnCanvas]);

  const handleSelectEdge = useCallback((edge: GraphEdge) => {
    selectOnCanvas(edge.id);
  }, [selectOnCanvas]);

  const handleNodeHover = useCallback((nodeId: string | null) => {
    setHoveredNodeId(nodeId);
  }, []);

  const handleEdgeHover = useCallback((edgeId: string | null) => {
    setHoveredEdgeId(edgeId);
  }, []);

  useEffect(() => {
    if (!hoveredNodeId || !entityListRef.current || !autoScrollEntities) return;
    const row = entityListRef.current.querySelector(`[data-node-id="${CSS.escape(hoveredNodeId)}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoveredNodeId, autoScrollEntities]);

  useEffect(() => {
    if (!hoveredEdgeId || !edgeListRef.current || !autoScrollEdges) return;
    const row = edgeListRef.current.querySelector(`[data-edge-id="${CSS.escape(hoveredEdgeId)}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoveredEdgeId, autoScrollEdges]);

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

  useEffect(() => {
    const move = (e: MouseEvent) => handleHorizontalResizeMove(e);
    const up = () => handleHorizontalResizeEnd();
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleHorizontalResizeMove, handleHorizontalResizeEnd]);

  return (
    <PageShell
      title="Contextual Graph"
      subtitle="Explore the graph enriched with contextual mental-model patches."
      count={graph.nodes.length}
      countLabel="node"
      loading={graphLoading}
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 shrink-0">
          <ServerBankSelectors
            servers={servers}
            selectedServerId={selectedServerId}
            setSelectedServerId={setSelectedServerId}
            banks={banks}
            selectedBankId={selectedBankId}
            setSelectedBankId={setSelectedBankId}
            loadingBanks={loadingBanks}
            disabled={loadingServers}
          />
          <div className="flex items-center gap-3 text-sm text-white/60">
            <span>{graph.edges.length} edge{graph.edges.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex mt-2 gap-2">
          {/* Left: entity list */}
          <div ref={leftPaneRef} className="min-w-0 flex flex-col" style={{ flex: leftFlex }}>
            <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col" style={{ flex: 1.5 }}>
              <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
                <span className="font-medium text-sm truncate">Entities</span>
                <div className="flex items-center gap-2">
                  <CardControls
                    scroll={autoScrollEntities}
                    onScrollChange={(checked) => setAutoScrollEntities(Boolean(checked))}
                    onCopy={() => {
                      if (sortedNodes.length === 0) {
                        toast.info('No entities to copy');
                        return;
                      }
                      navigator.clipboard.writeText(buildEntityCompiledMarkdown(sortedNodes)).then(() => toast.success('Entities copied to clipboard'));
                    }}
                    onSaveMd={() => {
                      if (sortedNodes.length === 0) {
                        toast.info('No entities to save');
                        return;
                      }
                      const filename = `contextual-graph-entities-${bankId || 'unknown'}.md`;
                      const blob = new Blob([buildEntityCompiledMarkdown(sortedNodes)], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = filename;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast.success(`Entities saved as ${filename}`);
                    }}
                  />
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                    {sortedNodes.length}
                  </span>
                </div>
              </div>
              <div ref={entityListRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                {graphLoading ? (
                  <div className="p-3 space-y-2">
                    <Skeleton className="h-10 w-full bg-white/10" />
                    <Skeleton className="h-10 w-full bg-white/10" />
                    <Skeleton className="h-10 w-full bg-white/10" />
                  </div>
                ) : sortedNodes.length === 0 ? (
                  <div className="text-[11px] text-white/40 px-2 py-3">No entities loaded.</div>
                ) : (
                  sortedNodes.map((entity) => {
                    const active = hoveredNodeId === entity.id;
                    const type = entity.type || (typeof entity.id === 'string' && entity.id.includes(':') ? entity.id.split(':')[0] : 'entity');
                    const typeLine = type && !entity.id.startsWith(`${type}:`) ? `${type}:${entity.id}` : entity.id;
                    const summary = entitySummaryText(entity);
                    return (
                      <div
                        key={entity.id}
                        role="button"
                        tabIndex={0}
                        data-node-id={entity.id}
                        onClick={() => handleNodeClick(entity.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleNodeClick(entity.id);
                          }
                        }}
                        onMouseEnter={() => handleNodeHover(entity.id)}
                        onMouseLeave={() => handleNodeHover(null)}
                        className={cn(
                          'w-full flex flex-col gap-1 rounded border bg-black/10 px-2 py-1.5 text-left transition-colors cursor-pointer',
                          active ? 'border-emerald-500/30 bg-emerald-900/30' : 'border-white/5 hover:bg-white/5'
                        )}
                        style={{ borderLeftColor: colorForType(type), borderLeftWidth: 3 }}
                      >
                        <div className="min-w-0 flex flex-col gap-0.5">
                          <div className="text-xs text-white/90 truncate">{entity.label || entity.name || entity.id}</div>
                          <div className="text-[10px] text-white/40 truncate">{typeLine}</div>
                        </div>
                        <Tooltip>
                          <TooltipTrigger>
                            <div className="text-[11px] text-white/70 leading-snug line-clamp-4 whitespace-normal break-words text-left w-full">
                              {summary}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" sideOffset={8} className="max-w-xs text-xs bg-black/90 border border-white/10 text-white/90 p-2">
                            {summary}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col mt-2" style={{ flex: 1 }}>
              <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
                <span className="font-medium text-sm">Edges</span>
                <div className="flex items-center gap-2">
                  <CardControls
                    scroll={autoScrollEdges}
                    onScrollChange={(checked) => setAutoScrollEdges(Boolean(checked))}
                    onCopy={() => {
                      if (edgeViews.length === 0) {
                        toast.info('No edges to copy');
                        return;
                      }
                      navigator.clipboard.writeText(buildEdgeMarkdownTable(graph.edges, nodeById)).then(() => toast.success('Edges copied to clipboard'));
                    }}
                    onSaveMd={() => {
                      if (edgeViews.length === 0) {
                        toast.info('No edges to save');
                        return;
                      }
                      const filename = `contextual-graph-edges-${bankId || 'unknown'}.md`;
                      const blob = new Blob([buildEdgeMarkdownTable(graph.edges, nodeById)], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = filename;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast.success(`Edges saved as ${filename}`);
                    }}
                  />
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                    {edgeViews.length}
                  </span>
                </div>
              </div>
              <div ref={edgeListRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                {edgeViews.length === 0 && (
                  <div className="text-[11px] text-white/40 px-2 py-3">No edges loaded.</div>
                )}
                {edgeViews.map(({ edge, sourceNode, targetNode }) => {
                  const active = hoveredEdgeId === edge.id;
                  const edgeColor = colorForType(edge.type || undefined);
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      data-edge-id={edge.id}
                      onClick={() => handleSelectEdge(edge)}
                      onMouseEnter={() => handleEdgeHover(edge.id)}
                      onMouseLeave={() => handleEdgeHover(null)}
                      className={cn(
                        'w-full text-left rounded border px-2 py-1.5 transition-colors',
                        active ? 'bg-emerald-900/30 border-emerald-500/30' : 'bg-black/10 border-white/5 hover:bg-white/5'
                      )}
                      style={{ borderLeftColor: edgeColor, borderLeftWidth: 3 }}
                    >
                      <div className="text-xs text-white/90 whitespace-normal break-words leading-snug">{edge.detail || edge.label || edge.type || 'Edge'}</div>
                      <div className="text-[10px] text-white/40 truncate">
                        {sourceNode?.name || sourceNode?.label || edge.from} → {targetNode?.name || targetNode?.label || edge.to}
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

          {/* Right: graph canvas */}
          <Card className="min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0" style={{ flex: rightFlex }}>
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
              <span className="font-medium text-sm">Graph</span>
            </div>
            <CardContent className="flex-1 min-h-0 p-0 relative">
              {serverId && bankId ? (
                <div className="absolute inset-0">
                  <InteractiveGraph
                    graph={graph}
                    selectedIds={selectedIds}
                    layoutName={layout}
                    layoutAnimate={layoutAnimate}
                    nodeFilters={nodeFilters}
                    edgeFilters={edgeFilters}
                    filterMode="active"
                    showEdgeLabels={showEdgeLabels}
                    preserveLayoutOnUpdate
                    onNodeClick={handleNodeClick}
                    onNodeHover={handleNodeHover}
                    onEdgeHover={handleEdgeHover}
                    highlightedNodeId={hoveredNodeId}
                    highlightedEdgeId={hoveredEdgeId}
                    onCyReady={(cy) => { cyRef.current = cy; }}
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
                  Select a server and bank to load the contextual graph.
                </div>
              )}
              {graphLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-sm text-white/80">
                  Loading graph…
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
