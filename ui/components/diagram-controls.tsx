'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Panzoom from '@panzoom/panzoom';
import type { PanzoomObject } from '@panzoom/panzoom';
import { ZoomIn, ZoomOut, Maximize, Move, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface DiagramControlsProps {
  /** The container whose first SVG child will be panned/zoomed. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Optional className for the floating panel. */
  className?: string;
}

export function DiagramControls({ containerRef, className }: DiagramControlsProps) {
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const [panning, setPanning] = useState(false);
  const [scale, setScale] = useState(1);
  const [isReady, setIsReady] = useState(false);

  const init = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) {
      setIsReady(false);
      return;
    }
    if (panzoomRef.current?.destroy) {
      panzoomRef.current.destroy();
    }
    // Ensure the SVG can be transformed by Panzoom; it expects display:block
    // and a wrapper that reports dimensions.
    const svgEl = svg as unknown as HTMLElement;
    svgEl.style.display = 'block';
    svgEl.style.width = '100%';
    svgEl.style.height = '100%';

    const panzoom = Panzoom(svgEl, {
      maxScale: 5,
      minScale: 0.2,
      contain: 'outside',
      cursor: 'grab',
      startScale: 1,
      startX: 0,
      startY: 0,
      step: 0.1,
      panOnlyWhenZoomed: false,
    });

    panzoomRef.current = panzoom;
    setIsReady(true);
    setScale(1);

    const updateScale = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.scale != null) setScale(detail.scale);
    };
    svg.parentElement?.addEventListener('panzoomzoom', updateScale);
    svg.parentElement?.addEventListener('panzoompan', updateScale);

    return () => {
      svg.parentElement?.removeEventListener('panzoomzoom', updateScale);
      svg.parentElement?.removeEventListener('panzoompan', updateScale);
      panzoom.destroy();
    };
  }, [containerRef]);

  // Re-init whenever the container gains/loses an SVG (e.g. after render).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    init();

    const observer = new MutationObserver(() => {
      const svg = container.querySelector('svg');
      if (svg && !panzoomRef.current) {
        init();
      } else if (!svg && panzoomRef.current) {
        panzoomRef.current.destroy();
        panzoomRef.current = null;
        setIsReady(false);
      }
    });

    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [containerRef, init]);

  const handleZoomIn = useCallback(() => {
    panzoomRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    panzoomRef.current?.zoomOut();
  }, []);

  const handleReset = useCallback(() => {
    panzoomRef.current?.reset();
    setScale(1);
  }, []);

  const togglePanning = useCallback(() => {
    const next = !panning;
    setPanning(next);
    if (panzoomRef.current?.setOptions) {
      panzoomRef.current.setOptions({ disablePan: !next });
    }
  }, [panning]);

  return (
    <div
      className={cn(
        'absolute top-3 right-3 z-10 flex flex-col gap-1.5 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/85 backdrop-blur-sm px-2 py-2 shadow-lg',
        className,
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleZoomIn}
        disabled={!isReady}
        title="Zoom in"
      >
        <ZoomIn className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleZoomOut}
        disabled={!isReady}
        title="Zoom out"
      >
        <ZoomOut className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant={panning ? 'secondary' : 'ghost'}
        size="icon-xs"
        onClick={togglePanning}
        disabled={!isReady}
        title={panning ? 'Panning enabled' : 'Enable pan'}
      >
        <Move className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleReset}
        disabled={!isReady}
        title="Fit / reset"
      >
        <Maximize className="h-3 w-3" />
      </Button>
      {isReady && (
        <div className="pt-1 border-t border-white/10 flex items-center justify-center gap-1 text-[9px] text-white/50">
          <GripHorizontal className="h-3 w-3" />
          <span>{Math.round(scale * 100)}%</span>
        </div>
      )}
    </div>
  );
}
