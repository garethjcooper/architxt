'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { StreamLanguage, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { Tag, tagHighlighter } from '@lezer/highlight';
import type { GraphNode, GraphEdge } from '@/lib/api/client';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { DiagramControls } from '@/components/diagram-controls';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ResizeHandle } from '@/app/workspace/_components/panel-layout';
import { graphToMermaid } from '@/lib/graph/mermaid-flowchart';
import { cn } from '@/lib/utils';

export interface GraphViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  graph: { name?: string | null; nodes: GraphNode[]; edges: GraphEdge[] };
  title?: string;
}

type Renderer = 'dagre' | 'elk';

const tKeyword = Tag.define();
const tEdge = Tag.define();
const tString = Tag.define();
const tComment = Tag.define();

const mermaidHighlightStyle = tagHighlighter([
  { tag: tKeyword, class: 'mmd-keyword' },
  { tag: tEdge, class: 'mmd-edge' },
  { tag: tString, class: 'mmd-string' },
  { tag: tComment, class: 'mmd-comment' },
]);

const mermaidLanguage = new LanguageSupport(
  StreamLanguage.define({
    token(stream) {
      stream.eatSpace();
      if (stream.eat('%')) {
        if (stream.eat('%')) {
          stream.skipToEnd();
          return 'comment';
        }
        stream.next();
        return null;
      }
      if (stream.eat('"')) {
        while (!stream.eol() && stream.next() !== '"') { /* skip */ }
        return 'string';
      }
      if (stream.match('-->') || stream.match('-.->') || stream.match('==>') || stream.match('--')) {
        return 'edge';
      }
      const keywords = [
        'graph', 'flowchart', 'subgraph', 'end', 'direction', 'TB', 'TD',
        'BT', 'RL', 'LR', 'classDef', 'class', 'click', 'call', 'style',
        'linkStyle', 'node', 'link', 'classDiagram', 'stateDiagram', 'erDiagram',
        'gantt', 'pie', 'mindmap', 'timeline', 'quadrantChart', 'xychart',
        'sankey', 'block', 'beta', 'requirementDiagram', 'gitGraph',
      ];
      if (stream.match(/[a-zA-Z][a-zA-Z0-9_-]*/)) {
        if (keywords.includes(stream.current())) return 'keyword';
        return null;
      }
      stream.next();
      return null;
    },
    tokenTable: {
      keyword: tKeyword,
      edge: tEdge,
      string: tString,
      comment: tComment,
    },
  }),
);

const mermaidTheme = EditorView.theme({
  '&': {
    height: '100%',
    width: '100%',
    fontSize: '12px',
    lineHeight: '1.5',
    backgroundColor: 'transparent',
    color: '#e5e7eb',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    width: '100%',
    minWidth: '0',
    padding: '6px 8px',
    caretColor: 'white',
  },
  '.cm-line': {
    whiteSpace: 'pre-wrap',
  },
  '.cm-cursor': {
    borderLeftColor: 'white',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-placeholder': {
    color: 'rgba(255, 255, 255, 0.4)',
  },
  '.mmd-keyword': { color: '#93c5fd', fontWeight: 500 },
  '.mmd-edge': { color: '#f472b6' },
  '.mmd-string': { color: '#a7f3d0' },
  '.mmd-comment': { color: '#6b7280' },
});

export function GraphViewModal({ open, onOpenChange, graph, title }: GraphViewModalProps) {
  const [sourceWidth, setSourceWidth] = useState(35);
  const [jsonHeight, setJsonHeight] = useState(30);
  const [fitToPage, setFitToPage] = useState(true);
  const [manualSource, setManualSource] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rightColumnRef = useRef<HTMLDivElement | null>(null);
  const colDraggingRef = useRef(false);
  const jsonDraggingRef = useRef(false);

  const generatedSource = useMemo(() => {
    if (!graph.nodes.length && !graph.edges.length) return '';
    return graphToMermaid(graph, { showEdgeLabels: true });
  }, [graph]);

  const graphJson = useMemo(() => JSON.stringify(graph, null, 2), [graph]);

  // Reset manual edits whenever the graph changes so we don't drift.
  useEffect(() => {
    setManualSource(null);
  }, [graph]);

  const source = manualSource ?? generatedSource;
  const isEmpty = !graph.nodes.length && !graph.edges.length;

  const extensions = useMemo(
    () => [mermaidLanguage, mermaidTheme, syntaxHighlighting(mermaidHighlightStyle)],
    [],
  );

  const startColResize = useCallback((e: React.MouseEvent) => {
    const container = rightColumnRef.current?.parentElement;
    if (!container) return;
    e.preventDefault();
    colDraggingRef.current = true;

    const onMove = (moveEvent: MouseEvent) => {
      if (!colDraggingRef.current) return;
      const rect = container.getBoundingClientRect();
      const pct = Math.min(80, Math.max(20, ((rect.right - moveEvent.clientX) / rect.width) * 100));
      setSourceWidth(pct);
    };

    const onUp = () => {
      colDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const startJsonResize = useCallback((e: React.MouseEvent) => {
    const container = rightColumnRef.current;
    if (!container) return;
    e.preventDefault();
    jsonDraggingRef.current = true;

    const onMove = (moveEvent: MouseEvent) => {
      if (!jsonDraggingRef.current) return;
      const rect = container.getBoundingClientRect();
      const pct = Math.min(70, Math.max(10, ((rect.bottom - moveEvent.clientY) / rect.height) * 100));
      setJsonHeight(pct);
    };

    const onUp = () => {
      jsonDraggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const effectiveRenderer = useMemo(() => {
    const init = source.match(/%%\{init:[\s\S]*?'defaultRenderer':\s*'(dagre|elk)'/);
    return init ? (init[1] as Renderer) : 'dagre';
  }, [source]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col" showCloseButton>
        <DialogHeader className="shrink-0">
          <DialogTitle>{title || graph.name || 'Graph view'}</DialogTitle>
        </DialogHeader>
        {isEmpty ? (
          <div className="flex-1 min-h-0 rounded-md border border-white/10 bg-[oklch(0.18_0_0)] flex items-center justify-center text-sm text-white/40">
            No graph data available.
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
              <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                <span>Preview</span>
                <span className="text-[10px] text-white/40">{graph.nodes.length} nodes · {graph.edges.length} edges · {effectiveRenderer}</span>
              </div>
              <div className="flex-1 min-h-0 p-2 overflow-hidden relative">
                <div
                  ref={containerRef}
                  className={cn(
                    'absolute inset-2 overflow-hidden origin-top-left',
                    fitToPage && 'flex items-center justify-center'
                  )}
                >
                  <MermaidDiagram
                    content={source}
                    defaultRenderer={effectiveRenderer}
                    className="h-full border-0"
                  />
                </div>
                <DiagramControls
                  targetRef={containerRef as React.RefObject<HTMLElement | null>}
                  fitToPage={fitToPage}
                  onFitToPageChange={setFitToPage}
                  className="top-2 right-2"
                />
              </div>
            </div>
            <ResizeHandle direction="vertical" onMouseDown={startColResize} title="Drag to resize panels" />
            <div
              ref={rightColumnRef}
              className="min-h-0 flex flex-col rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden"
              style={{ flexBasis: `${sourceWidth}%`, minWidth: '16rem', maxWidth: '80%' }}
            >
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                  <span>Mermaid source</span>
                </div>
                <div className="flex-1 min-h-0">
                  <CodeMirror
                    value={source}
                    onChange={(v) => setManualSource(v)}
                    extensions={extensions}
                    theme="none"
                    height="100%"
                    className="h-full"
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                      highlightActiveLineGutter: false,
                      highlightActiveLine: false,
                      closeBrackets: false,
                    }}
                  />
                </div>
              </div>
              <ResizeHandle direction="horizontal" onMouseDown={startJsonResize} title="Drag to resize JSON panel" />
              <div
                className="min-h-0 flex flex-col rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden"
                style={{ flexBasis: `${jsonHeight}%`, minWidth: '16rem', maxWidth: '80%' }}
              >
                <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                  <span>Graph JSON</span>
                </div>
                <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-3">
                  <pre className="text-[11px] leading-relaxed font-mono text-white/80 whitespace-pre-wrap">{graphJson}</pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
