'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Grip, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { colorForType } from '@/components/research-canvas';
import type { GraphCanvas, GraphEdge, GraphNode } from '@/components/research-canvas';
import type { DiscoverStepResponse } from '@/lib/api/client';

export interface TargetSelection {
  edgeType: string;
  targetId: string;
  direction: 'inbound' | 'outbound';
  active: boolean;
}

export interface PrebuiltDimensionStatus {
  dimension: string;
  label?: string;
  loaded: boolean;
  hasData: boolean;
  nodeCount?: number;
  error?: string;
}

export interface ExploreToolboxProps {
  nodeId: string | null;
  graph: GraphCanvas;
  discovery?: DiscoverStepResponse;
  errorMessage?: string;
  isDiscovering?: boolean;
  /** Current tab the toolbox should show. */
  activeTab: 'node' | 'entities';
  /** Called when the user switches tabs manually. */
  onTabChange?: (tab: 'node' | 'entities') => void;
  /** Full nodes list shown in the Nodes tab. */
  entities: GraphNode[];
  /** Called when a node row in the Nodes tab is clicked. */
  onClickEntity?: (entity: GraphNode) => void;
  /** Called when a node row in the Nodes tab is hovered. */
  onHoverEntity?: (entity: GraphNode | null) => void;
  /** IDs of nodes currently on the canvas; used to dim/brighten node rows. */
  canvasNodeIds?: Set<string>;
  /** Current search value for filtering entities in the Entities tab. */
  searchValue?: string;
  /** Called when the search input changes. */
  onSearchChange?: (value: string) => void;
  /** Current search value for filtering edge targets in the Edges tab. */
  edgesSearchValue?: string;
  /** Called when the edge search input changes. */
  onEdgesSearchChange?: (value: string) => void;
  /** Status of each prebuilt dimension loaded for the current node. */
  prebuiltDimensions?: PrebuiltDimensionStatus[];
  onApply: (nodeId: string, selections: TargetSelection[]) => void;
  onClose: () => void;
  /** Called when the user hovers over or leaves a target row.
   *  direction is only provided when the row is in an Edges list. */
  onHoverTarget?: (payload: { targetId: string | null; direction?: 'inbound' | 'outbound' }) => void;
}

const DIMENSION_LABELS: Record<string, string> = {
  summary: 'Summary',
  interface: 'Interfaces',
  'interface-found': 'Interfaces Found',
};

function dimensionLabel(status: PrebuiltDimensionStatus): string {
  if (status.label) return status.label;
  return DIMENSION_LABELS[status.dimension] || status.dimension;
}

function groupTargets(
  nodeId: string | null,
  graph: GraphCanvas,
  discovery?: DiscoverStepResponse,
): {
  inbound: Array<{ target: GraphNode; edges: GraphEdge[]; active: boolean }>;
  outbound: Array<{ target: GraphNode; edges: GraphEdge[]; active: boolean }>;
} {
  const discoveryGraph = discovery?.canvas?.graph;
  if (!discoveryGraph || !nodeId) return { inbound: [], outbound: [] };

  const graphNodeIds = new Set(graph.nodes.map((n) => n.id));
  const graphEdgeKeys = new Set(graph.edges.map((e) => `${e.from}|${e.to}|${e.type || e.label || ''}`));
  const discoveryNodeById = new Map((discoveryGraph.nodes || []).map((n) => [n.id, n]));

  const byDirection = {
    inbound: new Map<string, GraphEdge[]>(),
    outbound: new Map<string, GraphEdge[]>(),
  };
  for (const edge of discoveryGraph.edges || []) {
    if (edge.from === nodeId) {
      const list = byDirection.outbound.get(edge.to) || [];
      list.push(edge);
      byDirection.outbound.set(edge.to, list);
    } else if (edge.to === nodeId) {
      const list = byDirection.inbound.get(edge.from) || [];
      list.push(edge);
      byDirection.inbound.set(edge.from, list);
    }
  }

  const sortTargets = (map: Map<string, GraphEdge[]>) =>
    Array.from(map.entries())
      .map(([neighborId, edges]) => ({
        target: discoveryNodeById.get(neighborId) || ({ id: neighborId, name: neighborId } as GraphNode),
        edges,
        active: edges.length > 0 && edges.every((e) => graphEdgeKeys.has(`${e.from}|${e.to}|${e.type || e.label || ''}`)),
      }))
      .sort((a, b) => {
        // Targets whose edges are all active float to the top.
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return (a.target.name || a.target.label || a.target.id).localeCompare(b.target.name || b.target.label || b.target.id);
      });

  return {
    inbound: sortTargets(byDirection.inbound),
    outbound: sortTargets(byDirection.outbound),
  };
}

export function ExploreToolbox({ nodeId, graph, discovery, errorMessage, isDiscovering, activeTab, onTabChange, entities, onClickEntity, onHoverEntity, canvasNodeIds, searchValue, onSearchChange, edgesSearchValue, onEdgesSearchChange, prebuiltDimensions, onApply, onClose, onHoverTarget }: ExploreToolboxProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem('explore-toolbox-position');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
          return parsed;
        }
      }
    } catch {
      // ignore corrupt storage
    }
    return null;
  });
  const latestPositionRef = useRef(position);
  const [dragState, setDragState] = useState<{
    dragging: boolean;
    startMouse: { x: number; y: number };
    startPos: { x: number; y: number };
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [preview, setPreview] = useState<{
    title?: string;
    summary?: string;
    inbound?: string[];
    outbound?: string[];
  } | null>(null);

  useEffect(() => {
    latestPositionRef.current = position;
  }, [position]);

  useEffect(() => {
    return () => {
      const pos = latestPositionRef.current;
      if (!pos) return;
      try {
        window.localStorage.setItem('explore-toolbox-position', JSON.stringify(pos));
      } catch {
        // storage may be unavailable
      }
    };
  }, []);

  const { inbound, outbound } = useMemo(() => groupTargets(nodeId, graph, discovery), [nodeId, graph, discovery]);

  const inboundEdgesById = useMemo(() => {
    const map = new Map<string, GraphEdge[]>();
    for (const t of inbound) map.set(t.target.id, t.edges);
    return map;
  }, [inbound]);

  const outboundEdgesById = useMemo(() => {
    const map = new Map<string, GraphEdge[]>();
    for (const t of outbound) map.set(t.target.id, t.edges);
    return map;
  }, [outbound]);

  const sourceNode = useMemo(() => graph.nodes.find((n) => n.id === nodeId), [graph, nodeId]);
  const sourceLabel = sourceNode?.label || nodeId || 'No node selected';
  const sourceId = sourceNode?.id;

  const allInboundActive = inbound.length > 0 && inbound.every((t) => t.active);
  const allOutboundActive = outbound.length > 0 && outbound.every((t) => t.active);

  const renderTabBadge = (key: 'node' | 'entities', label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        onTabChange?.(key);
        if (key === 'node') {
          onEdgesSearchChange?.('');
        } else {
          onSearchChange?.('');
        }
      }}
      className={cn(
        'text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap',
        activeTab === key
          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
          : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
      )}
    >
      {label}
    </button>
  );

  const renderEntityList = () => {
    return (
    <div className="flex flex-col w-full">
      {entities.length === 0 ? (
        <div className="px-3 py-3 text-[11px] text-white/40">No entities available.</div>
      ) : (
        <div className="max-h-[min(360px,55vh)] overflow-y-auto p-1.5 space-y-1">
          {entities.map((entity) => {
            const targetType = entity.type || (typeof entity.id === 'string' && entity.id.includes(':') ? entity.id.split(':')[0] : undefined);
            const typeLine = targetType && !entity.id.startsWith(`${targetType}:`)
              ? `${targetType}:${entity.id}`
              : entity.id;
            const qualified = entity.id.includes(':') ? entity.id : targetType ? `${targetType}:${entity.id}` : entity.id;
            const onCanvas = canvasNodeIds?.has(qualified) ?? false;
            const summaryText = (entity as any).summaryText || '';
            const inboundLabels = (inboundEdgesById.get(entity.id) || [])
              .map((e) => e.detail || e.label || e.type || `→ ${e.from}`)
              .filter(Boolean);
            const outboundLabels = (outboundEdgesById.get(entity.id) || [])
              .map((e) => e.detail || e.label || e.type || `→ ${e.to}`)
              .filter(Boolean);
            return (
              <button
                key={entity.id}
                type="button"
                onClick={() => onClickEntity?.(entity)}
                onMouseEnter={() => {
                  onHoverEntity?.(entity);
                  setPreview({
                    title: entity.name || entity.label || entity.id,
                    summary: onCanvas ? (summaryText || 'No summary available.') : (summaryText || 'Not loaded'),
                    inbound: inboundLabels.length > 0 ? inboundLabels : undefined,
                    outbound: outboundLabels.length > 0 ? outboundLabels : undefined,
                  });
                }}
                onMouseLeave={() => {
                  onHoverEntity?.(null);
                }}
                className={cn(
                  'w-full flex items-center gap-2 rounded border border-white/5 px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors',
                  onCanvas
                    ? 'bg-black/10 hover:bg-white/5 text-white/90'
                    : 'bg-black/[0.02] text-white/[0.18] hover:text-white/50 hover:bg-black/[0.04]'
                )}
                style={{
                  borderLeftColor: onCanvas
                    ? colorForType(targetType)
                    : `color-mix(in srgb, ${colorForType(targetType)} 25%, transparent)`,
                  borderLeftWidth: 3,
                }}
              >
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <div className={cn('text-xs truncate', onCanvas ? 'text-white/90' : 'text-white/[0.22]')}>{entity.name || entity.label || entity.id}</div>
                  <div className={cn('text-[10px] truncate', onCanvas ? 'text-white/40' : 'text-white/[0.15]')}>{typeLine}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
    );
  };

  const clampPosition = (x: number, y: number): { x: number; y: number } => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return { x, y };
    const parentRect = parent.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const maxX = Math.max(0, parentRect.width - panelRect.width);
    const maxY = Math.max(0, parentRect.height - panelRect.height);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  };

  const toggleAll = (
    direction: 'inbound' | 'outbound',
    targets: Array<{ target: GraphNode; edges: GraphEdge[]; active: boolean }>,
    nextActive: boolean,
  ) => {
    if (!nodeId) return;
    onApply(
      nodeId,
      targets.map((t) => ({ edgeType: 'related', targetId: t.target.id, direction, active: nextActive })),
    );
  };

  const toggleTarget = (direction: 'inbound' | 'outbound', targetId: string, active: boolean) => {
    if (!nodeId) return;
    onApply(nodeId, [{ edgeType: 'related', targetId, direction, active: !active }]);
  };

  const handleHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const startPos = { x: panelRect.left - parentRect.left, y: panelRect.top - parentRect.top };
    setPosition(startPos);
    setDragState({
      dragging: true,
      startMouse: { x: e.clientX, y: e.clientY },
      startPos,
    });
  };

  const renderTargetList = (
    direction: 'inbound' | 'outbound',
    title: string,
    targets: Array<{ target: GraphNode; edges: GraphEdge[]; active: boolean }>,
    allActive: boolean,
    emptyMessage: string,
  ) => {
    const q = (edgesSearchValue || '').trim().toLowerCase();
    const filteredTargets = q
      ? targets.filter((t) => {
          const label = (t.target.name || '').toLowerCase();
          const id = (t.target.id || '').toLowerCase();
          const type = (t.target.type || '').toLowerCase();
          const edgeLabels = t.edges
            .map((e) => (e.detail || e.label || e.type || '').toLowerCase())
            .join(' ');
          return label.includes(q) || id.includes(q) || type.includes(q) || edgeLabels.includes(q);
        })
      : targets;
    const activeCount = filteredTargets.filter((t) => t.active).length;
    return (
      <div className="flex flex-col w-1/2 min-w-0 border-r border-white/5 last:border-r-0">
        <div className="px-2.5 py-1 border-b border-white/5 bg-black/20 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-white/50 font-medium">{title}</span>
          {filteredTargets.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => toggleAll(direction, filteredTargets, !allActive)}
                className="text-[10px] text-emerald-300/70 hover:text-emerald-300 transition-colors"
              >
                {allActive ? 'none' : 'all'}
              </button>
              <span className="text-[10px] text-white/30">{activeCount}/{filteredTargets.length}</span>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
          {filteredTargets.length === 0 && (
            <div className="text-[11px] text-white/40 px-2 py-3">{q ? 'No matching targets' : emptyMessage}</div>
          )}
          {filteredTargets.map((t) => {
            const targetType =
              t.target.type ||
              (typeof t.target.id === 'string' && t.target.id.includes(':')
                ? t.target.id.split(':')[0]
                : undefined);
            const typeLine = targetType && !t.target.id.startsWith(`${targetType}:`)
              ? `${targetType}:${t.target.id}`
              : t.target.id;
            const previewInbound = t.edges
              .filter((e) => e.to === nodeId)
              .map((e) => e.detail || e.label || e.type || `← ${e.from}`)
              .filter(Boolean);
            const previewOutbound = t.edges
              .filter((e) => e.from === nodeId)
              .map((e) => e.detail || e.label || e.type || `→ ${e.to}`)
              .filter(Boolean);
            return (
              <button
                key={t.target.id}
                type="button"
                onClick={() => toggleTarget(direction, t.target.id, t.active)}
                onMouseEnter={() => {
                  onHoverTarget?.({ targetId: t.target.id, direction });
                  setPreview({
                    title: t.target.name || t.target.label || t.target.id,
                    inbound: previewInbound.length > 0 ? previewInbound : undefined,
                    outbound: previewOutbound.length > 0 ? previewOutbound : undefined,
                  });
                }}
                onMouseLeave={() => {
                  onHoverTarget?.({ targetId: null, direction });
                }}
                className={cn(
                  'w-full flex items-center gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors',
                  t.active
                    ? 'border-white/5 bg-black/20 hover:bg-white/5'
                    : 'border-white/5 bg-black/[0.02] text-white/[0.18] hover:text-white/50 hover:bg-black/[0.04]'
                )}
                style={{
                  borderLeftColor: t.active
                    ? colorForType(targetType)
                    : `color-mix(in srgb, ${colorForType(targetType)} 25%, transparent)`,
                  borderLeftWidth: 3,
                }}
                title={typeLine}
              >
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <div className={cn('text-xs truncate', t.active ? 'text-white/90' : 'text-white/[0.22]')}>{t.target.name || t.target.label || t.target.id}</div>
                  <div className={cn('text-[10px] truncate', t.active ? 'text-white/40' : 'text-white/[0.15]')}>{typeLine}</div>
                </div>
                {t.edges.length > 1 && (
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded border border-white/10 shrink-0',
                    t.active ? 'bg-white/5 text-white/50' : 'bg-white/[0.03] text-white/25'
                  )}>
                    {t.edges.length} edges
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  useEffect(() => {
    if (!dragState?.dragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition(
        clampPosition(
          dragState.startPos.x + (e.clientX - dragState.startMouse.x),
          dragState.startPos.y + (e.clientY - dragState.startMouse.y),
        ),
      );
    };
    const handleUp = () => setDragState(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMove);
    };
  }, [dragState]);

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute z-20 w-[36rem] rounded-xl border border-white/10 bg-[oklch(0.18_0_0)]/95 backdrop-blur-sm shadow-2xl overflow-hidden',
        dragState?.dragging ? 'cursor-grabbing select-none' : 'cursor-default'
      )}
      style={
        position
          ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
          : { left: 16, top: 16 }
      }
    >
      <div
        className="relative h-6 px-2 border-b border-white/5 bg-black/20 flex items-center cursor-grab active:cursor-grabbing"
        onMouseDown={handleHeaderMouseDown}
      >
        <Grip className="w-3.5 h-3.5 text-white/20 mx-auto" />
        <div className="absolute right-1 top-0.5 flex items-center gap-1">
          <div className="flex items-center gap-1 mr-1">
            {renderTabBadge('entities', 'Entities')}
            {renderTabBadge('node', 'Edges')}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
            aria-label="Close toolbox"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="px-2.5 py-1.5 border-b border-white/5 bg-black/20">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-white/90 truncate" title={sourceLabel}>{sourceLabel}</div>
            {sourceId && (
              <div className="text-[10px] text-white/40 truncate" title={sourceId}>{sourceId}</div>
            )}
          </div>
          {activeTab === 'entities' && (
            <div className="relative w-[45%] max-w-[12rem] shrink-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
              <Input
                type="search"
                placeholder="Search entities..."
                value={searchValue}
                onChange={(e) => onSearchChange?.(e.target.value)}
                className="h-7 pl-7 pr-2 bg-black/20 border-white/10 text-white/80 placeholder:text-white/30 text-xs"
              />
            </div>
          )}
          {activeTab === 'node' && (
            <div className="relative w-[45%] max-w-[12rem] shrink-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
              <Input
                type="search"
                placeholder="Search edges..."
                value={edgesSearchValue}
                onChange={(e) => onEdgesSearchChange?.(e.target.value)}
                className="h-7 pl-7 pr-2 bg-black/20 border-white/10 text-white/80 placeholder:text-white/30 text-xs"
              />
            </div>
          )}
        </div>
      </div>

      {prebuiltDimensions && prebuiltDimensions.length > 0 && (
        <div className="px-2.5 py-1 border-b border-white/5 bg-black/20 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {prebuiltDimensions.map((dim) => {
              const isInterface = dim.dimension.startsWith('interface');
              const label = dimensionLabel(dim);
              return (
                <Tooltip key={dim.dimension}>
                  <TooltipTrigger>
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 cursor-default',
                        dim.error
                          ? 'bg-red-500/15 border-red-500/30 text-red-300'
                          : dim.loaded && dim.hasData
                            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                            : dim.loaded
                              ? 'bg-orange-500/15 border-orange-500/30 text-orange-300'
                              : 'bg-white/5 border-white/10 text-white/50'
                      )}
                    >
                      {label}
                      {isInterface && dim.nodeCount !== undefined && (
                        <span className="text-[9px] px-1 py-0 rounded bg-black/30 text-white/70">{dim.nodeCount}</span>
                      )}
                      {!dim.loaded && dim.error && (
                        <AlertTriangle className="w-3 h-3" />
                      )}
                    </div>
                  </TooltipTrigger>
                  {dim.error && (
                    <TooltipContent side="bottom" sideOffset={4} className="max-w-xs text-xs bg-black/90 border border-white/10 text-white/90 p-2">
                      {dim.error}
                    </TooltipContent>
                  )}
                </Tooltip>
              );
            })}
          </div>
          <label className="shrink-0 inline-flex items-center gap-1.5 text-[10px] text-white/60 cursor-pointer select-none">
            <Switch checked={showPreview} onCheckedChange={(checked) => setShowPreview(Boolean(checked))} size="sm" />
            Preview
          </label>
        </div>
      )}

      {errorMessage && !prebuiltDimensions && (
        <div className="px-2.5 py-1.5 border-b border-red-500/20 bg-red-500/10 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
          <div className="text-[10px] text-red-200/80 leading-tight">{errorMessage}</div>
        </div>
      )}

      {activeTab === 'entities' ? (
        renderEntityList()
      ) : (
        <div className="flex max-h-[min(360px,55vh)]">
          {renderTargetList('inbound', 'Inbound', inbound, allInboundActive, isDiscovering ? 'Loading…' : nodeId ? 'No inbound edges' : 'Click a node')}
          {renderTargetList('outbound', 'Outbound', outbound, allOutboundActive, isDiscovering ? 'Loading…' : nodeId ? 'No outbound edges' : 'Click a node')}
        </div>
      )}

      {showPreview && (
        <div className="shrink-0 border-t border-white/5 bg-black/20 px-2.5 py-1.5 h-48 flex flex-col">
          <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium mb-1">Preview{preview?.title ? ` – ${preview.title}` : ''}</div>
          <div className="flex-1 overflow-y-auto text-[11px] text-white/80 leading-snug break-words space-y-1.5">
            {!preview ? (
              <span className="text-white/30 italic">Hover an item to see details.</span>
            ) : (
              <>
                {preview.summary !== undefined && (
                  <div className={preview.summary === 'Not loaded' ? 'text-white/40 italic' : ''}>{preview.summary}</div>
                )}
                {preview.inbound && preview.inbound.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Inbound</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {preview.inbound.map((label, i) => (
                        <li key={i}>{label}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.outbound && preview.outbound.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">Outbound</div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {preview.outbound.map((label, i) => (
                        <li key={i}>{label}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.summary === undefined && !preview.inbound?.length && !preview.outbound?.length && (
                  <span className="text-white/30 italic">No details available.</span>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
