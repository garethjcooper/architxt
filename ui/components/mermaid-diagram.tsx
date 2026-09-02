'use client';

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

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

let lastRenderer: 'dagre' | 'elk' | undefined;

function initializeMermaid(renderer?: 'dagre' | 'elk') {
  const config: any = {
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'strict',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    suppressErrorRendering: true,
  };
  if (renderer) {
    config.flowchart = { defaultRenderer: renderer };
  }
  mermaid.initialize(config);
  lastRenderer = renderer;
}

function maybeInitializeMermaid(renderer?: 'dagre' | 'elk') {
  if (lastRenderer !== renderer) {
    initializeMermaid(renderer);
  }
}

/**
 * Render a Mermaid diagram from raw source in a dark-themed container.
 * Errors are displayed inline so malformed model output is easy to spot.
 */
export function MermaidDiagram({ content, className = '', name, type, defaultRenderer }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    maybeInitializeMermaid(defaultRenderer);
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
        const { svg: rendered } = await mermaid.render(id, source);
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
    <div className={`rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden ${className}`}>
      {(name || type) && (
        <div className="px-3 py-2 border-b border-white/10 bg-emerald-900/10 flex items-center justify-between gap-2">
          {name && <span className="text-sm font-medium text-emerald-300 truncate">{name}</span>}
          {type && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 bg-black/30 text-white/60 whitespace-nowrap">
              {type}
            </span>
          )}
        </div>
      )}
      <div className="p-3 overflow-x-auto">
        {error ? (
          <div className="text-xs text-red-300/90 font-mono whitespace-pre-wrap">{error}</div>
        ) : svg ? (
          <div ref={containerRef} dangerouslySetInnerHTML={{ __html: svg }} className="mermaid-diagram" />
        ) : (
          <div className="text-xs text-white/40">Rendering diagram…</div>
        )}
      </div>
    </div>
  );
}
