'use client';

import { useEffect, useRef, useState } from 'react';
import { Grip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode, GraphEdge } from '@/components/research-canvas';

export type DataBoxTab = 'node' | 'edge';

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

  if (!open) return null;

  const title = node ? (node.label || node.name || node.id) : edge ? (edge.label || edge.type || edge.id) : 'No selection';
  const subtitle = node ? node.id : edge ? `${edge.from} → ${edge.to}` : 'Select a node or edge on the canvas';

  return (
    <div
      ref={panelRef}
      className={cn(
        'absolute z-20 w-[24rem] rounded-xl border border-white/10 bg-[oklch(0.18_0_0)]/95 backdrop-blur-sm shadow-2xl overflow-hidden',
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
              onClick={() => onTabChange('node')}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap',
                activeTab === 'node'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
              )}
            >
              Node
            </button>
            <button
              type="button"
              onClick={() => onTabChange('edge')}
              className={cn(
                'text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap',
                activeTab === 'edge'
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
              )}
            >
              Edge
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

      <div className="max-h-[min(360px,55vh)] overflow-y-auto p-3">
        <div className="text-[11px] text-white/50 italic">
          {activeTab === 'node' && (node ? 'Node details will appear here.' : 'Select a node to view details.')}
          {activeTab === 'edge' && (edge ? 'Edge details will appear here.' : 'Select an edge to view details.')}
        </div>
      </div>
    </div>
  );
}
