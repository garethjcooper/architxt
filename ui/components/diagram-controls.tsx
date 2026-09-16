'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Panzoom from '@panzoom/panzoom';
import type { PanzoomObject } from '@panzoom/panzoom';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface DiagramControlsProps {
  /** The visible viewport that clips the transformed canvas. */
  viewportRef: React.RefObject<HTMLElement | null>;
  /** The element that contains the SVG and receives pan/zoom transforms. */
  canvasRef: React.RefObject<HTMLElement | null>;
  /** When true, the diagram is scaled to fit and centered in its container. */
  fitToPage?: boolean;
  /** Called when the user toggles fit-to-page from the control box. */
  onFitToPageChange?: (fit: boolean) => void;
  /** Optional className for the floating panel. */
  className?: string;
}

interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FitValues {
  scale: number;
  x: number;
  y: number;
}

function getVisualBounds(svg: SVGSVGElement): DOMRect {
  // Measure the actual rendered bounds of the SVG content, including any
  // labels/edges that overflow the declared viewBox. We temporarily release
  // width/height constraints so the SVG renders at its natural size, then
  // read its bounding client rect relative to the canvas.
  const prevWidth = svg.style.width;
  const prevHeight = svg.style.height;
  const prevMaxWidth = svg.style.maxWidth;
  const prevMaxHeight = svg.style.maxHeight;
  const prevPosition = svg.style.position;
  const prevDisplay = svg.style.display;

  svg.style.width = 'auto';
  svg.style.height = 'auto';
  svg.style.maxWidth = 'none';
  svg.style.maxHeight = 'none';
  svg.style.position = 'absolute';
  svg.style.display = 'block';

  const rect = svg.getBoundingClientRect();

  svg.style.width = prevWidth;
  svg.style.height = prevHeight;
  svg.style.maxWidth = prevMaxWidth;
  svg.style.maxHeight = prevMaxHeight;
  svg.style.position = prevPosition;
  svg.style.display = prevDisplay;

  return rect;
}

function computeFit(
  viewport: HTMLElement,
  canvas: HTMLElement,
  svg: SVGSVGElement,
): FitValues | null {
  const viewportRect = viewport.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const vBounds = getVisualBounds(svg);

  const bw = vBounds.width;
  const bh = vBounds.height;
  if (bw <= 0 || bh <= 0 || viewportRect.width <= 0 || viewportRect.height <= 0) return null;

  // Leave a small margin so the diagram doesn't touch the viewport edge.
  const margin = 8;
  const availableWidth = Math.max(1, viewportRect.width - margin * 2);
  const availableHeight = Math.max(1, viewportRect.height - margin * 2);
  // Never zoom in beyond 100% for fit-to-page; only shrink diagrams that
  // are larger than the viewport.
  const scale = Math.min(1, availableWidth / bw, availableHeight / bh);

  // Compute pan so the visual content is centered in the viewport.
  // Panzoom applies transform as scale(s) translate(x, y) with origin 0 0,
  // where x/y are in pre-scale canvas pixels.
  const contentX = vBounds.x - canvasRect.x;
  const contentY = vBounds.y - canvasRect.y;
  const contentCenterX = contentX + bw / 2;
  const contentCenterY = contentY + bh / 2;

  const viewportCenterX = viewportRect.x + viewportRect.width / 2;
  const viewportCenterY = viewportRect.y + viewportRect.height / 2;

  const x = (viewportCenterX - canvasRect.x) / scale - contentCenterX;
  const y = (viewportCenterY - canvasRect.y) / scale - contentCenterY;

  return { scale, x, y };
}

export function DiagramControls({
  viewportRef,
  canvasRef,
  fitToPage = false,
  onFitToPageChange,
  className,
}: DiagramControlsProps) {
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const currentSvgRef = useRef<SVGSVGElement | null>(null);
  const fitToPageRef = useRef(fitToPage);
  const [scale, setScale] = useState(1);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    fitToPageRef.current = fitToPage;
  }, [fitToPage]);

  const getSvgBounds = useCallback((svg: SVGSVGElement): SvgBounds => {
    try {
      const bbox = svg.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
      }
    } catch {
      // getBBox() can throw for SVGs not attached to the render tree.
    }

    const viewBox = svg.viewBox.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return {
        x: viewBox.x,
        y: viewBox.y,
        width: viewBox.width,
        height: viewBox.height,
      };
    }

    const width = parseFloat(svg.getAttribute('width') || '0');
    const height = parseFloat(svg.getAttribute('height') || '0');
    if (width > 0 && height > 0) {
      return { x: 0, y: 0, width, height };
    }

    return { x: 0, y: 0, width: svg.clientWidth || 1, height: svg.clientHeight || 1 };
  }, []);

  const applyFit = useCallback(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const panzoom = panzoomRef.current;
    if (!viewport || !canvas || !panzoom) return;

    const svg = canvas.querySelector('svg');
    if (!svg) return;

    const fit = computeFit(viewport, canvas, svg as SVGSVGElement);
    if (!fit) return;

    panzoom.zoom(fit.scale, { animate: false, force: true });
    panzoom.pan(fit.x, fit.y, { animate: false, force: true });
    setScale(fit.scale);
  }, [viewportRef, canvasRef]);

  // A single debounced initializer. We do not create a new panzoom instance for
  // every DOM mutation; we only re-init when the SVG element actually changes.
  const initTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const init = useCallback(() => {
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
    }
    initTimerRef.current = setTimeout(() => {
      initTimerRef.current = null;
      const canvas = canvasRef.current;
      const viewport = viewportRef.current;
      if (!canvas || !viewport) return;

      const svg = canvas.querySelector('svg');
      if (!svg) {
        if (panzoomRef.current) {
          panzoomRef.current.destroy();
          panzoomRef.current = null;
          currentSvgRef.current = null;
          setIsReady(false);
        }
        return;
      }

      // If the same SVG is already wired up, just re-fit (e.g. after resize).
      if (svg === currentSvgRef.current && panzoomRef.current) {
        if (fitToPageRef.current) applyFit();
        return;
      }

      // Tear down any previous instance before creating a new one.
      cleanupRef.current?.();
      cleanupRef.current = null;
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
      currentSvgRef.current = svg;

      // Reset styles so the new panzoom starts from a known transform.
      canvas.style.transform = '';
      canvas.style.transformOrigin = '';
      canvas.style.cursor = '';
      viewport.style.overflow = '';

      // Remove any constraints that would clip content before the transform.
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.style.width = '100%';
      svg.style.height = '100%';
      svg.style.maxWidth = 'none';
      svg.style.maxHeight = 'none';
      // Allow edges/labels outside the declared viewBox to be visible.
      svg.style.overflow = 'visible';

      // Compute fit *before* creating Panzoom so we can seed it with the correct
      // startScale/startX/startY. Panzoom's constructor schedules a deferred
      // `pan(startX, startY)`; if we don't seed these values, that deferred call
      // will overwrite any immediate `pan()` we apply after construction.
      const start = fitToPageRef.current ? computeFit(viewport, canvas, svg as SVGSVGElement) : null;

      const panzoom = Panzoom(canvas, {
        maxScale: 5,
        minScale: 0.1,
        cursor: 'grab',
        origin: '0 0',
        startScale: start?.scale ?? 1,
        startX: start?.x ?? 0,
        startY: start?.y ?? 0,
        step: 0.1,
        disablePan: false,
        panOnlyWhenZoomed: false,
      });

      panzoomRef.current = panzoom;
      setIsReady(true);
      setScale(start?.scale ?? 1);

      const updateScale = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (detail?.scale != null) setScale(detail.scale);
      };
      canvas.addEventListener('panzoomzoom', updateScale);
      canvas.addEventListener('panzoompan', updateScale);

      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        panzoom.zoomWithWheel(event);
      };
      canvas.addEventListener('wheel', handleWheel, { passive: false });

      cleanupRef.current = () => {
        canvas.removeEventListener('panzoomzoom', updateScale);
        canvas.removeEventListener('panzoompan', updateScale);
        canvas.removeEventListener('wheel', handleWheel);
        panzoom.destroy();
      };

      // For non-fit mode we rely on the seeded defaults; for fit mode the seeded
      // values already match, but apply once more after the deferred init runs
      // to ensure consistency and to pick up the correct scale display.
      if (fitToPageRef.current) {
        applyFit();
      }
    }, 50);
  }, [applyFit, getSvgBounds, viewportRef, canvasRef]);

  // Wire up panzoom when the canvas mounts and whenever Mermaid replaces the SVG.
  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;

    init();

    const observer = new MutationObserver(() => {
      init();
    });
    observer.observe(canvas, { childList: true, subtree: true });

    const resizeObserver = new ResizeObserver(() => {
      if (fitToPageRef.current && panzoomRef.current) {
        applyFit();
      }
    });
    resizeObserver.observe(viewport);

    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
      cleanupRef.current?.();
      cleanupRef.current = null;
      panzoomRef.current?.destroy();
      panzoomRef.current = null;
      currentSvgRef.current = null;
      setIsReady(false);
    };
  }, [init, viewportRef, canvasRef, applyFit]);

  // Handle toggling fit-to-page on/off after init.
  useEffect(() => {
    if (!panzoomRef.current || !currentSvgRef.current) return;
    if (fitToPage) {
      applyFit();
    } else {
      // Reset to natural size / position.
      panzoomRef.current.zoom(1, { animate: false, force: true });
      panzoomRef.current.pan(0, 0, { animate: false, force: true });
      setScale(1);
    }
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
        'absolute top-3 right-3 z-10 flex flex-col gap-1.5 rounded-md border border-border-default bg-surface-overlay/85 backdrop-blur-sm px-2 py-2 shadow-lg',
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
        onClick={() => onFitToPageChange?.(!fitToPage)}
        disabled={!isReady}
        title={fitToPage ? 'Fit to page is on' : 'Fit to page is off'}
        className={cn(
          fitToPage && 'bg-accent-primary-bg border-accent-primary-bd text-accent-primary-fg hover:bg-accent-primary-bg hover:text-accent-primary-fg',
        )}
      >
        <Maximize className="h-3 w-3" />
      </Button>
      <div className="text-[10px] font-medium text-center text-foreground-muted tabular-nums">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
