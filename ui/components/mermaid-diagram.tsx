'use client';

import { useEffect, useRef, useState } from 'react';
import { Switch } from '@/components/ui/switch';
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
  const detectedType = type || (() => {
    const match = content.match(
      /^\s*(?:%%(?:\{[\s\S]*?\})?%%\s*)*(flowchart(?:-v2)?|graph(?:\s+(?:TB|TD|BT|RL|LR))?|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|requirementDiagram|gantt|pie|mindmap|timeline|quadrantChart|xychart|sankey|block-beta|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|packet(?:-beta)?|kanban|architecture(?:-beta)?|user[-_]?(?:journey|Journey))\b/mi,
    );
    return match?.[1] ?? 'diagram';
  })();
  const displayName = name || detectedType;
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

  // Persist fit-to-width preference and keep the wrapper class in sync.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('mermaid-fit-to-width', String(fitToWidth));
    } catch {
      // ignore storage errors
    }
  }, [fitToWidth]);

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
          // Embed a scoped style rule inside the SVG so fit-to-width survives React
          // re-renders and remounts that would otherwise drop inline styles set by a
          // useEffect. The wrapper div toggles the `mermaid-fit` class to enable it.
          const styled = rendered.replace(
            /(<svg[^>]*>)([\s\S]*)/i,
            '$1\u003cstyle>.mermaid-fit svg{width:100% !important;height:auto !important;max-width:100% !important;}</style>$2',
          );
          setSvg(styled);
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
      <div className="px-3 py-2 border-b border-border-default bg-accent-primary-bg flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {<span className="text-sm font-medium text-accent-primary-fg truncate">{displayName}</span>}
          {detectedType && displayName !== detectedType && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border-default bg-surface-inset text-foreground-subtle whitespace-nowrap">
              {detectedType}
            </span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint cursor-pointer shrink-0">
          <Switch
            checked={fitToWidth}
            onCheckedChange={setFitToWidth}
            size="sm"
            aria-label="Fit diagram to page width"
          />
          <span>Fit</span>
        </label>
      </div>
      <div className="p-3 overflow-x-auto">
        {error ? (
          <div className="text-xs text-destructive-fg/90 font-mono whitespace-pre-wrap">{error}</div>
        ) : svg ? (
          <div dangerouslySetInnerHTML={{ __html: svg }} className={`mermaid-diagram ${fitToWidth ? 'mermaid-fit' : ''}`} />
        ) : (
          <div className="text-xs text-foreground-placeholder">Rendering diagram…</div>
        )}
      </div>
    </div>
  );
}
