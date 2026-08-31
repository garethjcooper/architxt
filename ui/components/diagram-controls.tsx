'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Panzoom from '@panzoom/panzoom';
import type { PanzoomObject } from '@panzoom/panzoom';
import { ZoomIn, ZoomOut, Maximize, Move, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface DiagramControlsProps {
  /** The element that contains the SVG and will be panned/zoomed. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** When true, CSS auto-fits the SVG and Panzoom is disabled. */
  fitToPage?: boolean;
  /** Called when the user toggles fit-to-page from the control box. */
  onFitToPageChange?: (fit: boolean) => void;
  /** Optional className for the floating panel. */
  className?: string;
}

export function DiagramControls({
  targetRef,
  fitToPage = true,
  onFitToPageChange,
  className,
}: DiagramControlsProps) {
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [panning, setPanning] = useState(false);
  const [scale, setScale] = useState(1);
  const [isReady, setIsReady] = useState(false);

  const resetTargetStyles = useCallback((target: HTMLElement) => {
    target.style.transform = '';
    target.style.transformOrigin = '';
    target.style.cursor = '';
  }, []);

  const init = useCallback(() => {
    const target = targetRef.current;
    if (!target) return;

    const svg = target.querySelector('svg');
    if (!svg) {
      setIsReady(false);
      return;
    }

    // Clean up previous instance and listeners before creating a new one.
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (panzoomRef.current?.destroy) {
      panzoomRef.current.destroy();
      panzoomRef.current = null;
    }
    resetTargetStyles(target);

    if (fitToPage) {
      // Fit-to-page: CSS handles sizing, no Panzoom transforms.
      setIsReady(true);
      setScale(1);
      return;
    }

    const panzoom = Panzoom(target, {
      maxScale: 5,
      minScale: 0.2,
      cursor: 'grab',
      startScale: 1,
      startX: 0,
      startY: 0,
      step: 0.1,
      panOnlyWhenZoomed: false,
      disablePan: !panning,
    });

    panzoomRef.current = panzoom;
    setIsReady(true);
    setScale(1);

    const updateScale = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.scale != null) setScale(detail.scale);
    };
    target.addEventListener('panzoomzoom', updateScale);
    target.addEventListener('panzoompan', updateScale);

    const cleanup = () => {
      target.removeEventListener('panzoomzoom', updateScale);
      target.removeEventListener('panzoompan', updateScale);
      panzoom.destroy();
    };
    cleanupRef.current = cleanup;
    return cleanup;
  }, [fitToPage, panning, resetTargetStyles, targetRef]);

  // Initialize Panzoom when the target or mode changes, and re-initialize
  // whenever Mermaid replaces the SVG inside the target.
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    init();

    const observer = new MutationObserver(() => {
      const svg = target.querySelector('svg');
      if (svg) {
        init();
      } else if (panzoomRef.current) {
        panzoomRef.current.destroy();
        panzoomRef.current = null;
        setIsReady(false);
      }
    });

    observer.observe(target, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (panzoomRef.current?.destroy) {
        panzoomRef.current.destroy();
        panzoomRef.current = null;
      }
    };
  }, [fitToPage, init, targetRef]);

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
        disabled={!isReady || fitToPage}
        title="Zoom in"
      >
        <ZoomIn className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={handleZoomOut}
        disabled={!isReady || fitToPage}
        title="Zoom out"
      >
        <ZoomOut className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant={fitToPage ? 'secondary' : 'ghost'}
        size="icon-xs"
        onClick={() => {
          if (fitToPage) {
            setScale(1);
            setPanning(false);
          }
          onFitToPageChange?.(!fitToPage);
        }}
        disabled={!isReady}
        title={fitToPage ? 'Fit to page' : 'Actual size'}
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
        disabled={!isReady || fitToPage}
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
