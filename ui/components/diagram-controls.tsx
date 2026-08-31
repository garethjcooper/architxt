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
  /** When true, CSS auto-fits the SVG and Panzoom is disabled. */
  fitToPage?: boolean;
  /** Called when the user toggles fit-to-page from the control box. */
  onFitToPageChange?: (fit: boolean) => void;
  /** Optional className for the floating panel. */
  className?: string;
}

export function DiagramControls({ containerRef, fitToPage = true, onFitToPageChange, className }: DiagramControlsProps) {
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

    if (fitToPage) {
      // Fit-to-page mode: CSS handles sizing. Clear any prior Panzoom transform.
      svgEl.style.transform = 'none';
      panzoomRef.current = null;
      setIsReady(true);
      setScale(1);
      return () => {
        svgEl.style.transform = '';
      };
    }

    const panzoom = Panzoom(svgEl, {
      maxScale: 5,
      minScale: 0.2,
      contain: undefined,
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

  // Re-init whenever the container gains/loses an SVG (e.g. after render)
  // or when fit-to-page changes so Panzoom bounds/cursor update cleanly.
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
  }, [containerRef, init, fitToPage]);

  const handleZoomIn = useCallback(() => {
    if (fitToPage) return;
    panzoomRef.current?.zoomIn();
  }, [fitToPage]);

  const handleZoomOut = useCallback(() => {
    if (fitToPage) return;
    panzoomRef.current?.zoomOut();
  }, [fitToPage]);

  const handleReset = useCallback(() => {
    if (fitToPage) return;
    panzoomRef.current?.reset();
    setScale(1);
  }, [fitToPage]);

  const togglePanning = useCallback(() => {
    if (fitToPage) return;
    const next = !panning;
    setPanning(next);
    if (panzoomRef.current?.setOptions) {
      panzoomRef.current.setOptions({ disablePan: !next });
    }
  }, [fitToPage, panning]);

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
        variant={fitToPage ? 'secondary' : 'ghost'}
        size="icon-xs"
        onClick={() => {
          // When leaving fit-to-page, reset scale display and panning state so the
          // next Panzoom instance starts from a clean identity transform.
          if (fitToPage) {
            setScale(1);
            setPanning(false);
          }
          onFitToPageChange?.(!fitToPage);
        }}
        disabled={!isReady}
        title={fitToPage ? 'Fit to page (CSS)' : 'Actual size'}
      >
        <Maximize className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant={panning ? 'secondary' : 'ghost'}
        size="icon-xs"
        onClick={togglePanning}
        disabled={!isReady || fitToPage}
        title={panning ? 'Panning enabled' : fitToPage ? 'Pan disabled in fit mode' : 'Enable pan'}
      >
        <Move className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleReset}
        disabled={!isReady}
        title="Reset zoom"
      >
        <GripHorizontal className="h-3 w-3" />
      </Button>
      {isReady && (
        <div className="pt-1 border-t border-white/10 flex items-center justify-center gap-1 text-[9px] text-white/50">
          <span>{Math.round(scale * 100)}%</span>
        </div>
      )}
    </div>
  );
}
