'use client';

import { useEffect, useRef, useState } from 'react';
import { Grip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode, GraphEdge } from '@/components/research-canvas';

export type DataBoxTab = 'data' | 'patch-config';

interface ModelRef {
  role?: string;
  ext_id?: string;
  attached_at?: string;
}

interface ContextualGraphDataBoxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: GraphNode | null;
  edge: GraphEdge | null;
  activeTab: DataBoxTab;
  onTabChange: (tab: DataBoxTab) => void;
}

const STORAGE_KEY = 'contextual-graph-data-box-position';

export function ContextualGraphDataBox({
  open,
  onOpenChange,
  node,
  edge,
  activeTab,
  onTabChange,
}: ContextualGraphDataBoxProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
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

  const item = (node || edge) as (GraphNode | GraphEdge) | null;

  useEffect(() => {
    latestPositionRef.current = position;
  }, [position]);

  useEffect(() => {
    return () => {
      const pos = latestPositionRef.current;
      if (!pos) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
      } catch {
        // storage may be unavailable
      }
    };
  }, []);

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
    setDragState({ dragging: true, startMouse: { x: e.clientX, y: e.clientY }, startPos });
  };

  useEffect(() => {
    if (!dragState?.dragging) return;
    const handleMove = (e: MouseEvent) => {
      setPosition(
        clampPosition(
          dragState.startPos.x + (e.clientX - dragState.startMouse.x),
          dragState.startPos.y + (e.clientY - dragState.startMouse.y)
        )
      );
    };
    const handleUp = () => setDragState(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });
    return () => window.removeEventListener('mousemove', handleMove);
  }, [dragState]);

  const modelRefs: ModelRef[] = (item?.modelRefs && Array.isArray(item.modelRefs))
    ? item.modelRefs
    : (item as any)?.properties?.provenance?.model_refs ?? [];

  const nodeTimestamps = node
    ? {
        created_at: (node as any).created_at,
        updated_at: (node as any).updated_at,
      }
    : null;
  const edgeTimestamps = edge
    ? {
        created_at: (edge as any).created_at,
        updated_at: (edge as any).updated_at,
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

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute z-20 w-[26rem] rounded-xl border border-white/10 bg-[oklch(0.18_0_0)]/95 backdrop-blur-sm shadow-2xl overflow-hidden',
        dragState?.dragging ? 'cursor-grabbing select-none' : 'cursor-default'
      )}
      style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : { left: 16, top: 16 }}
    >
      <div
        className="relative h-6 px-2 border-b border-white/5 bg-black/20 flex items-center cursor-grab active:cursor-grabbing"
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

      <div className="px-2.5 py-1.5 border-b border-white/5 bg-black/20">
        <div className="text-xs text-white/90 truncate" title={title}>{title}</div>
        <div className="text-[10px] text-white/40 truncate" title={subtitle}>{subtitle}</div>
      </div>

      <div className="max-h-[min(360px,55vh)] overflow-y-auto p-3 space-y-3">
        {!item && (
          <div className="text-[11px] text-white/50 italic">Select a node or edge to view details.</div>
        )}

        {activeTab === 'data' && item && (
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium">Mental model output</div>
            <div className="text-[11px] text-white/50 italic">
              Retrieved mental-model content will appear here.
            </div>
            {modelRefs.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium">Attached models</div>
                <div className="space-y-1">
                  {modelRefs.map((ref, i) => (
                    <div
                      key={`${ref.ext_id ?? i}-${i}`}
                      className="rounded border border-white/5 bg-black/10 px-2 py-1 text-[11px] text-white/70"
                    >
                      <span className="text-white/50">{ref.role || 'model'}</span>
                      {ref.ext_id && <span className="ml-1.5 font-mono text-white/60">{ref.ext_id}</span>}
                    </div>
                  ))}
                </div>
              </div>
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
                    key={`${ref.ext_id ?? i}-${i}`}
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
                    {ref.attached_at && (
                      <div className="text-[10px] text-white/40 mt-1">
                        attached {new Date(ref.attached_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {timestamps && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-white/40 font-medium">Graph row</div>
                <div className="rounded border border-white/5 bg-black/10 px-2 py-1.5 text-[11px] text-white/60 space-y-1">
                  {timestamps.created_at && (
                    <div>created <span className="text-white/80">{new Date(timestamps.created_at).toLocaleString()}</span></div>
                  )}
                  {timestamps.updated_at && (
                    <div>updated <span className="text-white/80">{new Date(timestamps.updated_at).toLocaleString()}</span></div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
