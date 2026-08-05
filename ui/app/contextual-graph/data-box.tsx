'use client';

import { useEffect, useRef, useState } from 'react';
import { Grip, X, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode, GraphEdge } from '@/lib/api/client';

export type DataBoxTab = 'data' | 'patch-config';

interface ModelRef {
  role?: string;
  ext_id?: string;
  attached_at?: string;
  fetched_at?: string;
  content_hash?: string;
}

interface ContextualGraphDataBoxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: GraphNode | null;
  edge: GraphEdge | null;
  activeTab: DataBoxTab;
  onTabChange: (tab: DataBoxTab) => void;
}

const STORAGE_KEY = 'contextual-graph-data-box-state';

const DEFAULT_WIDTH = 416; // 26rem
const DEFAULT_HEIGHT = 280;
const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;

const ROLE_LABELS: Record<string, string> = {
  sys_entity_summary: 'Summary',
  sys_entity_capabilities: 'Capabilities',
  sys_edge_context: 'Edge context',
  sys_discovery_context: 'Discovery context',
};

function formatDate(value?: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleString();
}

function renderValue(value: unknown): React.ReactNode {
  if (value === undefined || value === null) return <span className="text-[11px] text-white/40 italic">null</span>;
  if (typeof value === 'string') {
    return value.trim().length === 0
      ? <span className="text-[11px] text-white/40 italic">empty</span>
      : <p className="text-[11px] whitespace-pre-wrap text-white/80">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-[11px] font-mono text-white/80">{String(value)}</span>;
  }
  return (
    <pre className="text-[11px] text-white/70 bg-black/20 rounded p-1.5 overflow-x-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function inferColumns(rows: Array<Record<string, any> | any[]>): string[] {
  if (rows.length === 0) return [];
  const first = rows[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) return Object.keys(first);
  if (Array.isArray(first)) return first.map((_, i) => `col ${i + 1}`);
  return [];
}

function TableView({ rows, columns }: { rows: Array<Record<string, any> | any[]>; columns?: string[] }) {
  const cols = columns && columns.length > 0 ? columns : inferColumns(rows);
  if (cols.length === 0) return <span className="text-white/40 italic">No columns.</span>;
  return (
    <div className="overflow-x-auto rounded border border-white/5 bg-black/10">
      <table className="w-full text-[11px] text-left">
        <thead>
          <tr className="border-b border-white/10 bg-black/20">
            {cols.map((col) => (
              <th key={col} className="px-2 py-1 text-white/60 font-medium whitespace-nowrap">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-white/5 last:border-0">
              {cols.map((col, j) => {
                const value = Array.isArray(row) ? row[j] : row?.[col];
                return (
                  <td key={`${col}-${j}`} className="px-2 py-1 text-white/80 align-top">
                    {typeof value === 'string' ? value : renderValue(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelRefSection({ ref, index, item }: { ref: ModelRef; index: number; item: GraphNode | GraphEdge }) {
  const [expanded, setExpanded] = useState(true);
  const role = ref.role || 'model';
  const label = ROLE_LABELS[role] || role;
  const properties = item.properties || {};

  let body: React.ReactNode = null;
  if (role === 'sys_entity_summary') {
    body = renderValue(properties.summary);
  } else if (role === 'sys_entity_capabilities') {
    const capabilities = Array.isArray(properties.capabilities) ? properties.capabilities : [];
    body =
      capabilities.length === 0 ? (
        <span className="text-white/40 italic">No capabilities stored.</span>
      ) : (
        <TableView rows={capabilities} />
      );
  } else if (role === 'sys_edge_context') {
    const hasContent = properties.detail || properties.evidence || properties.label;
    body = hasContent ? (
      <div className="space-y-2">
        {properties.label && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">label</div>
            {renderValue(properties.label)}
          </div>
        )}
        {properties.detail && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">detail</div>
            {renderValue(properties.detail)}
          </div>
        )}
        {properties.evidence && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">evidence</div>
            {renderValue(properties.evidence)}
          </div>
        )}
      </div>
    ) : (
      <span className="text-white/40 italic">No edge context stored.</span>
    );
  } else if (role === 'sys_discovery_context') {
    body = (
      <span className="text-white/50 italic">
        Discovery context is attached to this seed. Discovered nodes and edges carry this model ref in their own provenance.
      </span>
    );
  }

  return (
    <div className="rounded border border-white/5 bg-black/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-white/50" /> : <ChevronRight className="w-3 h-3 text-white/50" />}
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-black/20 text-white/60">
          {label}
        </span>
        {ref.ext_id && (
          <span className="text-[11px] font-mono text-white/50 truncate" title={ref.ext_id}>
            {ref.ext_id}
          </span>
        )}
      </button>
      {expanded && <div className="px-2.5 pb-2.5 pt-1">{body}</div>}
    </div>
  );
}

export function ContextualGraphDataBox({
  open,
  onOpenChange,
  node,
  edge,
  activeTab,
  onTabChange,
}: ContextualGraphDataBoxProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [boxState, setBoxState] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          typeof parsed?.x === 'number' &&
          typeof parsed?.y === 'number' &&
          typeof parsed?.width === 'number' &&
          typeof parsed?.height === 'number'
        ) {
          return parsed;
        }
      }
    } catch {
      // ignore corrupt storage
    }
    return null;
  });
  const latestBoxStateRef = useRef(boxState);
  const [dragState, setDragState] = useState<{
    dragging: boolean;
    startMouse: { x: number; y: number };
    startPos: { x: number; y: number };
  } | null>(null);
  const [resizeState, setResizeState] = useState<{
    resizing: boolean;
    startMouse: { x: number; y: number };
    startSize: { width: number; height: number };
  } | null>(null);

  const position = boxState ? { x: boxState.x, y: boxState.y } : null;
  const size = boxState ? { width: boxState.width, height: boxState.height } : { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };

  const item = (node || edge) as (GraphNode | GraphEdge) | null;

  useEffect(() => {
    latestBoxStateRef.current = boxState;
  }, [boxState]);

  useEffect(() => {
    return () => {
      const state = latestBoxStateRef.current;
      if (!state) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // storage may be unavailable
      }
    };
  }, []);

  const clampPosition = (x: number, y: number, width: number, height: number): { x: number; y: number } => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return { x, y };
    const parentRect = parent.getBoundingClientRect();
    const maxX = Math.max(0, parentRect.width - width);
    const maxY = Math.max(0, parentRect.height - height);
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  };

  const clampSize = (width: number, height: number): { width: number; height: number } => {
    const panel = panelRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) {
      return {
        width: Math.max(MIN_WIDTH, width),
        height: Math.max(MIN_HEIGHT, height),
      };
    }
    const parentRect = parent.getBoundingClientRect();
    return {
      width: Math.min(Math.max(MIN_WIDTH, width), parentRect.width),
      height: Math.min(Math.max(MIN_HEIGHT, height), parentRect.height),
    };
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
    setBoxState((prev) => (prev ? { ...prev, x: startPos.x, y: startPos.y } : { x: startPos.x, y: startPos.y, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }));
    setDragState({ dragging: true, startMouse: { x: e.clientX, y: e.clientY }, startPos });
  };

  const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setResizeState({
      resizing: true,
      startMouse: { x: e.clientX, y: e.clientY },
      startSize: { width: size.width, height: size.height },
    });
  };

  useEffect(() => {
    if (!dragState?.dragging) return;
    const handleMove = (e: MouseEvent) => {
      const nextPos = clampPosition(
        dragState.startPos.x + (e.clientX - dragState.startMouse.x),
        dragState.startPos.y + (e.clientY - dragState.startMouse.y),
        size.width,
        size.height
      );
      setBoxState((prev) => (prev ? { ...prev, x: nextPos.x, y: nextPos.y } : { x: nextPos.x, y: nextPos.y, width: size.width, height: size.height }));
    };
    const handleUp = () => setDragState(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });
    return () => window.removeEventListener('mousemove', handleMove);
  }, [dragState, size.width, size.height]);

  useEffect(() => {
    if (!resizeState?.resizing) return;
    const handleMove = (e: MouseEvent) => {
      const nextSize = clampSize(
        resizeState.startSize.width + (e.clientX - resizeState.startMouse.x),
        resizeState.startSize.height + (e.clientY - resizeState.startMouse.y)
      );
      setBoxState((prev) => (prev ? { ...prev, ...nextSize } : { x: position?.x ?? 16, y: position?.y ?? 16, ...nextSize }));
    };
    const handleUp = () => setResizeState(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });
    return () => window.removeEventListener('mousemove', handleMove);
  }, [resizeState, position?.x, position?.y]);

  const modelRefs: ModelRef[] = item?.modelRefs || (item as any)?.properties?.provenance?.model_refs || [];

  const nodeTimestamps = node
    ? {
        created_at: node.properties?.created_at,
        updated_at: node.properties?.updated_at,
      }
    : null;
  const edgeTimestamps = edge
    ? {
        created_at: edge.properties?.created_at,
        updated_at: edge.properties?.updated_at,
      }
    : null;
  const timestamps = nodeTimestamps || edgeTimestamps;

  const title = node
    ? (node.label || node.name || node.id)
    : edge
      ? (edge.detail || edge.label || edge.type || edge.id)
      : 'No selection';
  const subtitle = node
    ? node.id
    : edge
      ? `${edge.from} → ${edge.to}`
      : 'Select a node or edge on the canvas';

  const rawProperties = item?.properties || {};
  const hasStoredData =
    rawProperties.summary ||
    (Array.isArray(rawProperties.capabilities) && rawProperties.capabilities.length > 0) ||
    rawProperties.detail ||
    rawProperties.evidence ||
    rawProperties.label;

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute z-20 rounded-xl border border-white/10 bg-[oklch(0.18_0_0)]/95 backdrop-blur-sm shadow-2xl overflow-hidden flex flex-col',
        dragState?.dragging ? 'cursor-grabbing select-none' : 'cursor-default',
        resizeState?.resizing ? 'pointer-events-none' : ''
      )}
      style={
        position
          ? { left: position.x, top: position.y, width: size.width, height: size.height, right: 'auto', bottom: 'auto' }
          : { left: 16, top: 16, width: size.width, height: size.height, right: 'auto', bottom: 'auto' }
      }
    >
      <div
        className="relative h-6 px-2 border-b border-white/5 bg-black/20 flex items-center cursor-grab active:cursor-grabbing shrink-0"
        onMouseDown={handleHeaderMouseDown}
      >
        <Grip className="w-3.5 h-3.5 text-white/20 mx-auto" />
        <div className="absolute right-1 top-0.5 flex items-center gap-1">
          <div className="flex items-center gap-1 mr-1">
            <button
              type="button"
              onClick={() => onTabChange('data')}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap',
                activeTab === 'data'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
              )}
            >
              Data
            </button>
            <button
              type="button"
              onClick={() => onTabChange('patch-config')}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap',
                activeTab === 'patch-config'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
              )}
            >
              Patch Config
            </button>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
            aria-label="Close data box"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="px-2.5 py-1.5 border-b border-white/5 bg-black/20 shrink-0">
        <div className="text-[11px] text-white/90 truncate" title={title}>{title}</div>
        <div className="text-[10px] text-white/40 truncate" title={subtitle}>{subtitle}</div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {!item && (
          <div className="text-[11px] text-white/50 italic">Select a node or edge to view details.</div>
        )}

        {activeTab === 'data' && item && (
          <div className="space-y-2">
            {!hasStoredData && modelRefs.length === 0 ? (
              <div className="text-[11px] text-white/50 italic">No mental-model data stored on this graph element.</div>
            ) : (
              <>
                {modelRefs.map((ref, i) => (
                  <ModelRefSection key={`${ref.ext_id ?? ref.role ?? 'ref'}-${i}`} ref={ref} index={i} item={item} />
                ))}
                {!modelRefs.length && hasStoredData && (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium">Stored data</div>
                    {rawProperties.summary && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-white/40">summary</div>
                        {renderValue(rawProperties.summary)}
                      </div>
                    )}
                    {Array.isArray(rawProperties.capabilities) && rawProperties.capabilities.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-white/40">capabilities</div>
                        <TableView rows={rawProperties.capabilities} />
                      </div>
                    )}
                    {(rawProperties.detail || rawProperties.evidence || rawProperties.label) && (
                      <div className="space-y-2">
                        {rawProperties.label && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-white/40">label</div>
                            {renderValue(rawProperties.label)}
                          </div>
                        )}
                        {rawProperties.detail && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-white/40">detail</div>
                            {renderValue(rawProperties.detail)}
                          </div>
                        )}
                        {rawProperties.evidence && (
                          <div>
                            <div className="text-[10px] uppercase tracking-wider text-white/40">evidence</div>
                            {renderValue(rawProperties.evidence)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'patch-config' && item && (
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium">Model refs</div>
            {modelRefs.length === 0 ? (
              <div className="text-[11px] text-white/50 italic">No mental-model refs attached.</div>
            ) : (
              <div className="space-y-1">
                {modelRefs.map((ref, i) => (
                  <div
                    key={`${ref.ext_id ?? ref.role ?? 'ref'}-${i}`}
                    className="rounded border border-white/5 bg-black/10 px-2 py-1.5 text-[11px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-black/20 text-white/60">
                        {ref.role || 'model'}
                      </span>
                      {ref.ext_id && (
                        <span className="font-mono text-white/70 truncate" title={ref.ext_id}>{ref.ext_id}</span>
                      )}
                    </div>
                    <div className="mt-1.5 space-y-0.5 text-[10px] text-white/40">
                      {ref.attached_at && <div>attached {formatDate(ref.attached_at)}</div>}
                      {ref.fetched_at && <div>fetched {formatDate(ref.fetched_at)}</div>}
                      {ref.content_hash && <div className="font-mono truncate" title={ref.content_hash}>hash {ref.content_hash}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {timestamps && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium">Graph row</div>
                <div className="rounded border border-white/5 bg-black/10 px-2 py-1.5 text-[11px] text-white/60 space-y-1">
                  {timestamps.created_at && (
                    <div>created <span className="text-white/80">{formatDate(timestamps.created_at)}</span></div>
                  )}
                  {timestamps.updated_at && (
                    <div>updated <span className="text-white/80">{formatDate(timestamps.updated_at)}</span></div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div
        onMouseDown={handleResizeMouseDown}
        className={cn(
          'absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize z-30',
          'hover:before:opacity-100 before:opacity-60',
          'before:absolute before:bottom-1 before:right-1 before:w-1.5 before:h-1.5',
          'before:border-b-2 before:border-r-2 before:border-white/40 before:rounded-br-sm',
          'before:transition-opacity'
        )}
        aria-label="Resize data box"
      />
    </div>
  );
}
