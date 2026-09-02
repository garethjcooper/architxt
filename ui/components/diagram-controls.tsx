'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Panzoom from '@panzoom/panzoom';
import type { PanzoomObject } from '@panzoom/panzoom';
import { ZoomIn, ZoomOut, Maximize, GripHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface DiagramControlsProps {
  /** The element that contains the SVG and will be panned/zoomed. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** When true, the diagram is scaled to fit and centered in its container. */
  fitToPage?: boolean;
  /** Called when the user toggles fit-to-page from the control box. */
  onFitToPageChange?: (fit: boolean) => void;
  /** Optional className for the floating panel. */
  className?: string;
}

export function DiagramControls({
  targetRef,
  fitToPage = false,
  onFitToPageChange,
  className,
}: DiagramControlsProps) {
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [scale, setScale] = useState(1);
  const [isReady, setIsReady] = useState(false);

  const resetTargetStyles = useCallback((target: HTMLElement) => {
    target.style.transform = '';
    target.style.transformOrigin = '';
    target.style.cursor = '';
  }, []);

  const getSvgSize = useCallback((svg: SVGSVGElement) => {
    const viewBox = svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return { width: viewBox.width, height: viewBox.height };
    }
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
    const width = parseFloat(svg.getAttribute('width') || '0');
    const height = parseFloat(svg.getAttribute('height') || '0');
    if (width > 0 && height > 0) {
      return { width, height };
    }
    return { width: svg.clientWidth || 1, height: svg.clientHeight || 1 };
  }, []);

  const applyFit = useCallback(() => {
    const target = targetRef.current;
    const panzoom = panzoomRef.current;
    if (!target || !panzoom) return;

    const svg = target.querySelector('svg');
    if (!svg) return;

    const containerRect = target.getBoundingClientRect();
    const { width: svgWidth, height: svgHeight } = getSvgSize(svg);

    const scale = Math.min(
      containerRect.width / svgWidth,
      containerRect.height / svgHeight,
    );

    const x = (containerRect.width - svgWidth * scale) / 2;
    const y = (containerRect.height - svgHeight * scale) / 2;

    panzoom.zoom(scale, { animate: true });
    panzoom.pan(x, y, { animate: true });
  }, [getSvgSize, targetRef]);

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

    const panzoom = Panzoom(target, {
      maxScale: 5,
      minScale: 0.1,
      cursor: 'grab',
      startScale: 1,
      startX: 0,
      startY: 0,
      step: 0.1,
      disablePan: false,
      panOnlyWhenZoomed: false,
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

    if (fitToPage) {
      // Defer fit so the DOM layout is stable.
      requestAnimationFrame(() => applyFit());
    }

    return cleanup;
  }, [applyFit, fitToPage, resetTargetStyles, targetRef]);

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

  // Re-apply fit when fitToPage becomes true after initialisation.
  useEffect(() => {
    if (!fitToPage || !panzoomRef.current) return;
    applyFit();
  }, [fitToPage, applyFit]);

  const handleZoomIn = useCallback(() => {
    panzoomRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    panzoomRef.current?.zoomOut();
  }, []);

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
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          onFitToPageChange?.(true);
        }}
        disabled={!isReady}
        title="Fit to page"
      >
        <Maximize className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => {
          onFitToPageChange?.(false);
          panzoomRef.current?.reset();
          setScale(1);
        }}
        disabled={!isReady}
        title="Actual size"
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
