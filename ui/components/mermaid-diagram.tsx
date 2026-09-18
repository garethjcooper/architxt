'use client';

import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Maximize2 } from 'lucide-react';
import { ensureMermaidInitialized, renderMermaid } from '@/lib/mermaid-init';

export interface MermaidDiagramProps {
  /** Raw Mermaid source (without fence markers). */
  content: string;
  /** Optional CSS class for the outer container. */
  className?: string;
  /** Optional diagram name shown as a heading above the render. */
  name?: string;
  /** Optional type label shown as a badge. */
  type?: string;
  /** Optional flowchart renderer override. Changing this re-initializes Mermaid. */
  defaultRenderer?: 'dagre' | 'elk';
}

/**
 * Render a Mermaid diagram from raw source, following the app color mode.
 * Errors are displayed inline so malformed model output is easy to spot.
 */
export function MermaidDiagram({ content, className = '', name, type, defaultRenderer }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgWrapperRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fitToWidth, setFitToWidth] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem('mermaid-fit-to-width') !== 'false';
    } catch {
      return true;
    }
  });

  // Persist fit-to-width preference and apply it to the rendered SVG.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('mermaid-fit-to-width', String(fitToWidth));
    } catch {
      // ignore storage errors
    }
    const wrapper = svgWrapperRef.current;
    if (!wrapper) return;
    // Constrain the wrapper so Mermaid’s intermediate divs cannot expand the
    // scroll width beyond the card body.
    wrapper.style.width = '100%';
    wrapper.style.maxWidth = '100%';
    wrapper.style.display = 'block';
    wrapper.style.overflow = 'hidden';

    const svgEls = wrapper.querySelectorAll('svg');
    svgEls.forEach((svgEl) => {
      if (fitToWidth) {
        svgEl.style.setProperty('width', '100%', 'important');
        svgEl.style.setProperty('height', 'auto', 'important');
        svgEl.style.setProperty('max-width', '100%', 'important');
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
      } else {
        svgEl.style.removeProperty('width');
        svgEl.style.removeProperty('height');
        svgEl.style.removeProperty('max-width');
      }
    });
  }, [fitToWidth, svg]);

  useEffect(() => {
    ensureMermaidInitialized(defaultRenderer);
    let cancelled = false;

    const render = async () => {
      const source = content.trim();
      if (!source) {
        setSvg(null);
        setError('No diagram source provided.');
        return;
      }

      try {
        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;
        const { svg: rendered } = await renderMermaid(id, source, defaultRenderer);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    render();
    return () => { cancelled = true; };
  }, [content, defaultRenderer]);

  return (
    <div className={`rounded-md border border-border-default bg-surface-overlay overflow-hidden ${className}`}>
      {(name || type) && (
        <div className="px-3 py-2 border-b border-border-default bg-accent-primary-bg flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {name && <span className="text-sm font-medium text-accent-primary-fg truncate">{name}</span>}
            {type && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-border-default bg-surface-inset text-foreground-subtle whitespace-nowrap">
                {type}
              </span>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-accent-primary-fg/80 cursor-pointer shrink-0">
            <Maximize2 className="h-3 w-3" />
            <span>Fit</span>
            <Switch
              checked={fitToWidth}
              onCheckedChange={setFitToWidth}
              size="sm"
              aria-label="Fit diagram to page width"
            />
          </label>
        </div>
      )}
      <div className={`p-3 ${fitToWidth ? 'overflow-hidden' : 'overflow-x-auto'}`}>
        {error ? (
          <div className="text-xs text-destructive-fg/90 font-mono whitespace-pre-wrap">{error}</div>
        ) : svg ? (
          <div ref={svgWrapperRef} dangerouslySetInnerHTML={{ __html: svg }} className="mermaid-diagram" />
        ) : (
          <div className="text-xs text-foreground-placeholder">Rendering diagram…</div>
        )}
      </div>
    </div>
  );
}
