'use client';

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { StreamLanguage, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { Tag, tagHighlighter } from '@lezer/highlight';
import type { GraphNode, GraphEdge } from '@/lib/api/client';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import { DiagramControls } from '@/components/diagram-controls';
import { Markdown } from '@/components/markdown';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ResizeHandle } from '@/app/workspace/_components/panel-layout';
import { graphToMermaid } from '@/lib/graph/mermaid-flowchart';
import { escapeMarkdownCell } from '@/lib/envelope-markdown';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import { Copy, FileJson, FileSpreadsheet } from 'lucide-react';
import { CopyDiagramMenu } from '@/components/copy-diagram-menu';
import { tableToCsv, tableToJson, copyText } from '@/lib/clipboard-utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
export interface GraphViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  graph: { name?: string | null; nodes: GraphNode[]; edges: GraphEdge[] };
  title?: string;
  /** Called when Apply is pressed with the selected structured items. */
  onApply?: (events: EnvelopeCopyEvent[]) => void;
  /** When true, renders a read-only view with no add-to-page controls. */
  readOnly?: boolean;
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

interface PaneRatios {
  source: number;
  tables: number;
  json: number;
}

export function GraphViewModal({ open, onOpenChange, graph, title, onApply, readOnly = false }: GraphViewModalProps) {
  const [sourceWidth, setSourceWidth] = useState(35);
  const [ratios, setRatios] = useState<PaneRatios>({ source: 0.5, tables: 0.25, json: 0.25 });
  const [hResizing, setHResizing] = useState<null | 'upper' | 'lower'>(null);
  const [fitToPage, setFitToPage] = useState(false);
  const [includeDiagram, setIncludeDiagram] = useState(false);
  const [includeTables, setIncludeTables] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rightColumnRef = useRef<HTMLDivElement | null>(null);
  const hResizeStartRef = useRef({ y: 0, ratios: ratios, height: 0 });

  const defaultDiagramName = title || graph.name || 'Graph diagram';
  const defaultNodeTableName = `${title || graph.name || 'Graph'} nodes`;
  const defaultEdgeTableName = `${title || graph.name || 'Graph'} edges`;

  const [diagramName, setDiagramName] = useState(defaultDiagramName);
  const [nodeTableName, setNodeTableName] = useState(defaultNodeTableName);
  const [edgeTableName, setEdgeTableName] = useState(defaultEdgeTableName);

  const generatedSource = useMemo(() => {
    if (!graph.nodes.length && !graph.edges.length) return '';
    return graphToMermaid(graph, { showEdgeLabels: true });
  }, [graph]);

  const graphJson = useMemo(() => JSON.stringify(graph, null, 2), [graph]);

  const nodeColumns = ['id', 'type', 'label', 'name'];
  const nodeRows = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.type || '',
        label: n.label || '',
        name: n.name || '',
      })),
    [graph.nodes],
  );
  const edgeColumns = ['from_name', 'to_name', 'from', 'to', 'type', 'label', 'detail', 'properties', 'evidence'];
  const edgeRows = useMemo(
    () =>
      graph.edges.map((e) => {
        const src = graph.nodes.find((n) => n.id === e.from)!;
        const tgt = graph.nodes.find((n) => n.id === e.to)!;
        return {
          from_name: src?.name || '',
          to_name: tgt?.name || '',
          from: e.from,
          to: e.to,
          type: e.type || '',
          label: e.label || '',
          detail: e.detail || '',
          properties: e.properties ? JSON.stringify(e.properties) : '',
          evidence: Array.isArray(e.evidence) ? e.evidence.join(', ') : '',
        };
      }),
    [graph.edges, graph.nodes],
  );

  const markdownTables = useMemo(() => {
    const nodeHeader = ['id', 'type', 'label', 'name'];
    const nodeRows = graph.nodes.map((n) =>
      nodeHeader.map((key) => escapeMarkdownCell(n[key as keyof GraphNode])).join(' | ')
    );
    const nodeTable = [
      `| ${nodeHeader.join(' | ')} |`,
      `| ${nodeHeader.map(() => '---').join(' | ')} |`,
      ...nodeRows.map((row) => `| ${row} |`),
    ].join('\n');

    const edgeHeader = ['from_name', 'to_name', 'from', 'to', 'type', 'label', 'detail', 'properties', 'evidence'];
    const edgeRows = graph.edges.map((e) => {
      const src = graph.nodes.find((n) => n.id === e.from)!;
      const tgt = graph.nodes.find((n) => n.id === e.to)!;
      return edgeHeader
        .map((key) => {
          if (key === 'from_name') return escapeMarkdownCell(src.name);
          if (key === 'to_name') return escapeMarkdownCell(tgt.name);
          if (key === 'from') return escapeMarkdownCell(src.id);
          if (key === 'to') return escapeMarkdownCell(tgt.id);
          if (key === 'properties') return escapeMarkdownCell(e.properties ? JSON.stringify(e.properties) : '');
          if (key === 'evidence') return escapeMarkdownCell(Array.isArray(e.evidence) ? e.evidence.join(', ') : '');
          return escapeMarkdownCell(e[key as keyof GraphEdge]);
        })
        .join(' | ');
    });
    const edgeTable = [
      `| ${edgeHeader.join(' | ')} |`,
      `| ${edgeHeader.map(() => '---').join(' | ')} |`,
      ...edgeRows.map((row) => `| ${row} |`),
    ].join('\n');

    return `### Nodes (${graph.nodes.length})\n\n${nodeTable}\n\n### Edges (${graph.edges.length})\n\n${edgeTable}`;
  }, [graph]);

  // Reset selections and default names whenever the graph changes so we don't drift.
  const graphKey = useMemo(() => JSON.stringify({ name: graph.name, nodeIds: graph.nodes.map((n) => n.id).sort(), edgeIds: graph.edges.map((e) => e.id).sort() }), [graph]);
  useEffect(() => {
    setIncludeDiagram(false);
    setIncludeTables(false);
    setDiagramName(defaultDiagramName);
    setNodeTableName(defaultNodeTableName);
    setEdgeTableName(defaultEdgeTableName);
  }, [graphKey]);

  const source = generatedSource;
  const isEmpty = !graph.nodes.length && !graph.edges.length;

  const extensions = useMemo(
    () => [mermaidLanguage, mermaidTheme, syntaxHighlighting(mermaidHighlightStyle)],
    [],
  );

  // Column resize: preview vs right-hand stack.
  const startColResize = useCallback((e: React.MouseEvent) => {
    const container = rightColumnRef.current?.parentElement;
    if (!container) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sourceWidth;
    const rect = container.getBoundingClientRect();

    const onMove = (moveEvent: MouseEvent) => {
      const deltaPct = ((moveEvent.clientX - startX) / rect.width) * 100;
      setSourceWidth(Math.min(80, Math.max(20, startWidth - deltaPct)));
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [sourceWidth]);

  // Horizontal resizers: adjust ratios of adjacent panes in the right-hand stack.
  const startUpperResize = useCallback((e: React.MouseEvent) => {
    const container = rightColumnRef.current;
    if (!container) return;
    e.preventDefault();
    hResizeStartRef.current = {
      y: e.clientY,
      ratios: { ...ratios },
      height: container.getBoundingClientRect().height,
    };
    setHResizing('upper');
  }, [ratios]);

  const startLowerResize = useCallback((e: React.MouseEvent) => {
    const container = rightColumnRef.current;
    if (!container) return;
    e.preventDefault();
    hResizeStartRef.current = {
      y: e.clientY,
      ratios: { ...ratios },
      height: container.getBoundingClientRect().height,
    };
    setHResizing('lower');
  }, [ratios]);

  const handleHResizeMove = useCallback((e: MouseEvent) => {
    if (!hResizing) return;
    const { y, ratios: startRatios, height } = hResizeStartRef.current;
    if (height <= 0) return;
    const delta = (e.clientY - y) / height;
    const MIN = 0.08;

    if (hResizing === 'upper') {
      // Moving down grows the tables pane and shrinks the source pane.
      const nextTables = Math.max(MIN, Math.min(1 - MIN, startRatios.tables - delta));
      const nextSource = Math.max(MIN, 1 - nextTables - startRatios.json);
      const nextJson = Math.max(MIN, 1 - nextSource - nextTables);
      setRatios({ source: nextSource, tables: nextTables, json: nextJson });
    } else {
      // Moving down grows the JSON pane and shrinks the tables pane.
      const nextJson = Math.max(MIN, Math.min(1 - MIN, startRatios.json - delta));
      const nextTables = Math.max(MIN, 1 - startRatios.source - nextJson);
      const nextSource = Math.max(MIN, 1 - nextTables - nextJson);
      setRatios({ source: nextSource, tables: nextTables, json: nextJson });
    }
  }, [hResizing]);

  const handleHResizeEnd = useCallback(() => {
    setHResizing(null);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => handleHResizeMove(e);
    const onUp = () => handleHResizeEnd();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [handleHResizeMove, handleHResizeEnd]);

  const effectiveRenderer = useMemo(() => {
    const init = source.match(/%%\{init:[\s\S]*?'defaultRenderer':\s*'(dagre|elk)'/);
    return init ? (init[1] as Renderer) : 'dagre';
  }, [source]);

  const toggleButtonClass = (active: boolean) =>
    cn(
      'px-2 py-1 rounded text-[10px] border transition-colors',
      active
        ? 'bg-emerald-600/30 border-emerald-500/50 text-emerald-200'
        : 'bg-black/20 border-white/10 text-white/60 hover:text-white/90 hover:bg-white/5',
    );

  const handleApply = useCallback(() => {
    const events: EnvelopeCopyEvent[] = [];
    if (includeDiagram && source.trim()) {
      const type = source.trim().match(/^\s*classDiagram\b/i)
        ? 'classDiagram'
        : source.trim().match(/^\s*stateDiagram\b/i)
        ? 'stateDiagram'
        : 'flowchart';
      events.push({
        type: 'diagrams',
        payload: JSON.stringify([{ name: diagramName, type, content: source }], null, 2),
        label: diagramName,
      });
    }
    if (includeTables && (graph.nodes.length > 0 || graph.edges.length > 0)) {
      const nodeRows = graph.nodes.map((n) => ({
        id: n.id,
        type: n.type || '',
        label: n.label || '',
        name: n.name || '',
      }));
      const edgeRows = graph.edges.map((e) => {
        const src = graph.nodes.find((n) => n.id === e.from)!;
        const tgt = graph.nodes.find((n) => n.id === e.to)!;
        return {
          from_name: src.name,
          to_name: tgt.name,
          from: src.id,
          to: tgt.id,
          type: e.type || '',
          label: e.label || '',
          detail: e.detail || '',
          properties: e.properties || null,
          evidence: e.evidence || [],
        };
      });
      const tables: Array<{ name: string; columns: string[]; rows: Record<string, any>[] }> = [];
      if (nodeRows.length > 0) {
        tables.push({ name: nodeTableName, columns: ['id', 'type', 'label', 'name'], rows: nodeRows });
      }
      if (edgeRows.length > 0) {
        tables.push({ name: edgeTableName, columns: ['from_name', 'to_name', 'from', 'to', 'type', 'label', 'detail', 'properties', 'evidence'], rows: edgeRows });
      }
      if (tables.length > 0) {
        events.push({
          type: 'tables',
          payload: JSON.stringify(tables, null, 2),
          label: title || graph.name || 'Graph tables',
        });
      }
    }
    onApply?.(events);
    onOpenChange(false);
  }, [includeDiagram, includeTables, source, graph, diagramName, nodeTableName, edgeTableName, onApply, onOpenChange]);

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
              <div className="flex flex-col overflow-hidden" style={{ flex: ratios.source }}>
                <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                  <span>Mermaid source</span>
                  <div className="flex items-center gap-2">
                    <CopyDiagramMenu source={source} />
                    {!readOnly && (
                      <>
                        {includeDiagram && (
                          <input
                            type="text"
                            value={diagramName}
                            onChange={(e) => setDiagramName(e.target.value)}
                            className="px-2 py-1 rounded bg-black/30 border border-white/10 text-[11px] text-white/80 focus:outline-none focus:border-emerald-500/50 w-48"
                            placeholder="Diagram name"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setIncludeDiagram((v) => !v)}
                          className={toggleButtonClass(includeDiagram)}
                        >
                          {includeDiagram ? 'Add diagram' : 'Add to page'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <CodeMirror
                    value={source}
                    editable={false}
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
              <ResizeHandle direction="horizontal" onMouseDown={startUpperResize} title="Drag to resize tables panel" />
              <div
                className="min-h-0 flex flex-col rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden"
                style={{ flex: ratios.tables }}
              >
                <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                  <span>Node/edge tables</span>
                  <div className="flex items-center gap-2">
                    {!readOnly && (
                      <>
                        {includeTables && (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={nodeTableName}
                              onChange={(e) => setNodeTableName(e.target.value)}
                              className="px-2 py-1 rounded bg-black/30 border border-white/10 text-[11px] text-white/80 focus:outline-none focus:border-emerald-500/50 w-28"
                              placeholder="Nodes name"
                            />
                            <input
                              type="text"
                              value={edgeTableName}
                              onChange={(e) => setEdgeTableName(e.target.value)}
                              className="px-2 py-1 rounded bg-black/30 border border-white/10 text-[11px] text-white/80 focus:outline-none focus:border-emerald-500/50 w-28"
                              placeholder="Edges name"
                            />
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setIncludeTables((v) => !v)}
                          className={toggleButtonClass(includeTables)}
                        >
                          {includeTables ? 'Add tables' : 'Add to page'}
                        </button>
                      </>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <button
                          type="button"
                          className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                          title="Copy tables"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="bg-[oklch(0.18_0_0)] border-white/10">
                        <DropdownMenuItem
                          onClick={() =>
                            copyText(
                              JSON.stringify({ nodes: nodeRows, edges: edgeRows }, null, 2),
                              'Tables JSON',
                            )
                          }
                          className="text-xs text-white/80 focus:bg-white/10 focus:text-white cursor-pointer"
                        >
                          <FileJson className="h-3.5 w-3.5 mr-2" />
                          Copy as JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            copyText(
                              `${tableToCsv(nodeRows, nodeColumns)}\n\n${tableToCsv(edgeRows, edgeColumns)}`,
                              'Tables CSV',
                            )
                          }
                          className="text-xs text-white/80 focus:bg-white/10 focus:text-white cursor-pointer"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 mr-2" />
                          Copy as CSV
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-3">
                  <Markdown className="text-[12px]">{markdownTables}</Markdown>
                </div>
              </div>
              <ResizeHandle direction="horizontal" onMouseDown={startLowerResize} title="Drag to resize JSON panel" />
              <div
                className="min-h-0 flex flex-col rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden"
                style={{ flex: ratios.json }}
              >
                <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0">
                  <span>Graph JSON</span>
                  <button
                    type="button"
                    onClick={() => copyText(graphJson, 'Graph JSON')}
                    className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
                    title="Copy graph JSON"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto custom-scrollbar p-3">
                  <Markdown className="text-[11px]">{`\`\`\`json\n${graphJson}\n\`\`\``}</Markdown>
                </div>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              disabled={!includeDiagram && !includeTables}
            >
              Apply
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
