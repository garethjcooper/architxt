'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { StreamLanguage, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { Tag, tagHighlighter } from '@lezer/highlight';
import mermaid from 'mermaid';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { DiagramControls } from '@/components/diagram-controls';
import { ResizeHandle } from '@/app/workspace/_components/panel-layout';
import { CopyDiagramMenu } from '@/components/copy-diagram-menu';
import { maybeInitializeMermaid, ensureMermaidInitialized } from '@/lib/mermaid-init';

export interface MermaidEditorProps {
  /** Raw Mermaid source (without fence markers). */
  content: string;
  /** Called whenever the user edits the source. */
  onChange: (content: string) => void;
  /** Called when the rendered diagram enters or leaves an error state. */
  onErrorChange?: (error: string | null) => void;
  /** Optional CSS class for the outer container. */
  className?: string;
  /** Optional diagram name shown as a heading above the render. */
  name?: string;
  /** Optional type label shown as a badge. */
  type?: string;
  /** When true, the source editor is read-only and cannot be edited. */
  readOnly?: boolean;
}

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
    color: 'var(--syntax-text)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    width: '100%',
    minWidth: '0',
    padding: '6px 8px',
    caretColor: 'var(--focus-ring)',
  },
  '.cm-line': {
    whiteSpace: 'pre-wrap',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--focus-ring)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--accent-primary-bg)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--surface-subtle)',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-placeholder': {
    color: 'var(--syntax-comment)',
  },
  '.mmd-keyword': { color: 'var(--syntax-keyword)', fontWeight: 500 },
  '.mmd-edge': { color: 'var(--syntax-function)' },
  '.mmd-string': { color: 'var(--syntax-string)' },
  '.mmd-comment': { color: 'var(--syntax-comment)' },
});

function PreviewPane({
  content,
  name,
  type,
  fitToPage,
  onFitToPageChange,
  onRender,
  onErrorChange,
}: {
  content: string;
  name?: string;
  type?: string;
  fitToPage: boolean;
  onFitToPageChange: (fit: boolean) => void;
  onRender?: (error: string | null) => void;
  onErrorChange?: (error: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRender = useCallback(
    (error: string | null) => {
      onRender?.(error);
      onErrorChange?.(error);
    },
    [onErrorChange, onRender],
  );

  useEffect(() => {
    ensureMermaidInitialized();
    let cancelled = false;
    const render = async () => {
      const source = content.trim();
      if (!source) {
        setSvg(null);
        setError('No diagram source provided.');
        handleRender('No diagram source provided.');
        return;
      }
      try {
        const id = `mermaid-editor-${Math.random().toString(36).slice(2, 11)}`;
        const { svg: rendered } = await mermaid.render(id, source);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
          handleRender(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          handleRender(message);
        }
      }
    };
    render();
    return () => { cancelled = true; };
  }, [content, handleRender]);

  return (
    <div className="flex flex-col h-full rounded-md border border-border-default bg-surface-overlay overflow-hidden">
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <div
          ref={containerRef}
          className={cn(
            'absolute inset-0 p-3 overflow-hidden origin-top-left',
            fitToPage && 'flex items-center justify-center',
          )}
        >
          {error ? (
            <div className="absolute inset-0 flex items-end justify-start p-4 pointer-events-none">
              <div className="max-w-full rounded-md border border-destructive-bd bg-destructive-bg backdrop-blur-sm px-3 py-2 text-xs text-destructive-fg font-mono whitespace-pre-wrap shadow-lg">
                {error}
              </div>
            </div>
          ) : null}
          {svg ? (
            <div
              dangerouslySetInnerHTML={{ __html: svg }}
              className={cn(
                'mermaid-diagram',
                fitToPage && 'w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-full [&>svg]:!transform-none',
              )}
            />
          ) : !error ? (
            <div className="text-xs text-foreground-placeholder">Rendering diagram…</div>
          ) : null}
        </div>
        {!error && svg && <DiagramControls targetRef={containerRef} fitToPage={fitToPage} onFitToPageChange={onFitToPageChange} />}
      </div>
    </div>
  );
}

export function MermaidEditor({ content, onChange, onErrorChange, className, name, type, readOnly = false }: MermaidEditorProps) {
  const [fitToPage, setFitToPage] = useState(true);
  const [lastError, setLastError] = useState<string | null>(null);
  const [sourceWidth, setSourceWidth] = useState(35);
  const lastValueRef = useRef(content);
  const draggingRef = useRef(false);

  useEffect(() => {
    lastValueRef.current = content;
  }, [content]);

  const handleChange = useCallback(
    (newValue: string) => {
      if (readOnly) return;
      lastValueRef.current = newValue;
      onChange(newValue);
    },
    [onChange, readOnly],
  );

  const extensions = useMemo(
    () => [mermaidLanguage, mermaidTheme, syntaxHighlighting(mermaidHighlightStyle)],
    [],
  );

  const startResize = useCallback((e: React.MouseEvent) => {
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    e.preventDefault();
    draggingRef.current = true;

    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const rect = container.getBoundingClientRect();
      const pct = Math.min(80, Math.max(20, ((rect.right - moveEvent.clientX) / rect.width) * 100));
      setSourceWidth(pct);
    };

    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div className={cn('flex flex-col h-full gap-3', className)}>
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col rounded-md border border-border-default bg-surface-overlay overflow-hidden">
          <div className="px-3 py-2 border-b border-border-default text-xs font-medium text-foreground-muted flex items-center justify-between shrink-0">
            <span>Preview</span>
            <div className="flex items-center gap-2">
              {lastError && <span className="text-destructive-fg/80 text-[10px]">Parse error</span>}
            </div>
          </div>
          <div className="flex-1 min-h-0 p-2 overflow-hidden">
            <PreviewPane
              content={content}
              name={name}
              type={type}
              fitToPage={fitToPage}
              onFitToPageChange={setFitToPage}
              onRender={setLastError}
              onErrorChange={onErrorChange}
            />
          </div>
        </div>
        <ResizeHandle direction="vertical" onMouseDown={startResize} title="Drag to resize panels" />
        <div
          className="min-h-0 flex flex-col rounded-md border border-border-default bg-surface-overlay overflow-hidden"
          style={{ flexBasis: `${sourceWidth}%`, minWidth: '16rem', maxWidth: '80%' }}
        >
          <div className="px-3 py-2 border-b border-border-default text-xs font-medium text-foreground-muted flex items-center justify-between shrink-0">
            <span>{readOnly ? 'Diagram source (read-only)' : 'Diagram source'}</span>
            <CopyDiagramMenu source={content} />
          </div>
          <div className="flex-1 min-h-0">
            <CodeMirror
              value={content}
              onChange={handleChange}
              extensions={extensions}
              theme="none"
              height="100%"
              className="h-full"
              editable={!readOnly}
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
      </div>
    </div>
  );
}
