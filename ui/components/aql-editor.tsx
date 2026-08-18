'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
import { StreamLanguage, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, startCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import { Tag, tagHighlighter } from '@lezer/highlight';
import { cn } from '@/lib/utils';
import {
  formatEntityToken,
  formatEdgeToken,
  MERMAID_DIAGRAM_TYPES,
} from '@architxt/aql';

export interface EntityLike {
  id: string;
  entity_id?: string | null;
  name?: string | null;
  label?: string | null;
  type?: string | null;
}

export interface EdgeLike {
  from: string;
  to: string;
  label?: string | null;
  type?: string | null;
}

export interface AqlEditorProps {
  id?: string;
  value: string;
  onChange: (value: string, cursor: number) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  placeholder?: string;
  availableEntities?: EntityLike[];
  availableEdges?: EdgeLike[];
  includeEdges?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const tDirective = Tag.define();
const tDirectiveDiagram = Tag.define();
const tDirectiveTable = Tag.define();
const tDirectiveGraph = Tag.define();
const tDirectiveNarrative = Tag.define();
const tDirectiveDiagramName = Tag.define();
const tDirectiveDiagramType = Tag.define();
const tDirectiveTableName = Tag.define();
const tDirectiveEnd = Tag.define();
const tReference = Tag.define();

const aqlHighlightStyle = tagHighlighter([
  { tag: tDirective, class: 'aql-directive' },
  { tag: tDirectiveDiagram, class: 'aql-directive-diagram' },
  { tag: tDirectiveTable, class: 'aql-directive-table' },
  { tag: tDirectiveGraph, class: 'aql-directive-graph' },
  { tag: tDirectiveNarrative, class: 'aql-directive-narrative' },
  { tag: tDirectiveDiagramName, class: 'aql-directive-diagram-name' },
  { tag: tDirectiveDiagramType, class: 'aql-directive-diagram-type' },
  { tag: tDirectiveTableName, class: 'aql-directive-table-name' },
  { tag: tDirectiveEnd, class: 'aql-directive-end' },
  { tag: tReference, class: 'aql-reference' },
]);

const aqlLanguage = new LanguageSupport(
  StreamLanguage.define({
    token(stream) {
      stream.eatSpace();
      if (stream.eat('#')) {
        const start = stream.pos;
        stream.eatWhile(/[^\s]/);
        const word = stream.string.slice(start, stream.pos).toLowerCase();
        switch (word) {
          case 'diagram':
            return 'directive-diagram';
          case 'table':
            return 'directive-table';
          case 'graph':
            return 'directive-graph';
          case 'narrative':
            return 'directive-narrative';
          case 'diagram-name':
            return 'directive-diagram-name';
          case 'diagram-type':
            return 'directive-diagram-type';
          case 'table-name':
            return 'directive-table-name';
          case 'end':
            return 'directive-end';
          default:
            return 'directive';
        }
      }
      if (stream.match('[[')) {
        stream.eatWhile(/[^\]]/);
        stream.eat(']');
        stream.eat(']');
        return 'reference';
      }
      stream.next();
      return null;
    },
    tokenTable: {
      directive: tDirective,
      'directive-diagram': tDirectiveDiagram,
      'directive-table': tDirectiveTable,
      'directive-graph': tDirectiveGraph,
      'directive-narrative': tDirectiveNarrative,
      'directive-diagram-name': tDirectiveDiagramName,
      'directive-diagram-type': tDirectiveDiagramType,
      'directive-table-name': tDirectiveTableName,
      'directive-end': tDirectiveEnd,
      reference: tReference,
    },
  }),
);

const aqlTheme = EditorView.theme({
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
  '.aql-directive': { color: '#9ca3af', fontWeight: 500 },
  '.aql-directive-diagram': { color: '#a855f7', fontWeight: 500 },
  '.aql-directive-table': { color: '#06b6d4', fontWeight: 500 },
  '.aql-directive-graph': { color: '#f97316', fontWeight: 500 },
  '.aql-directive-narrative': { color: '#22c55e', fontWeight: 500 },
  '.aql-directive-diagram-name': { color: '#3b82f6', fontWeight: 500 },
  '.aql-directive-diagram-type': { color: '#eab308', fontWeight: 500 },
  '.aql-directive-table-name': { color: '#06b6d4', fontWeight: 500 },
  '.aql-directive-end': { color: '#ef4444', fontWeight: 500 },
  '.aql-reference': { color: '#fbbf24' },
  '.cm-tooltip': {
    backgroundColor: '#1e293b',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '6px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    padding: '4px 0',
  },
  '.cm-tooltip-autocomplete ul li': {
    padding: '4px 10px',
    color: '#e5e7eb',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'rgba(52, 211, 153, 0.2)',
    color: '#34d399',
  },
  '.cm-completionIcon': {
    color: '#94a3b8',
  },
});

const DIRECTIVE_KEYWORDS = ['diagram', 'table', 'graph', 'narrative', 'diagram-name', 'diagram-type', 'table-name', 'end'];

function buildDirectiveCompletions(filter: string): Completion[] {
  const term = filter.toLowerCase();
  return DIRECTIVE_KEYWORDS.filter((kw) => kw.startsWith(term)).map((kw) => {
    let apply: Completion['apply'];
    if (kw === 'diagram') {
      apply = (view, _completion, from, to) => {
        const text = '#diagram\n#diagram-name \n#diagram-type \n#end';
        const cursor = from + '#diagram\n#diagram-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
    } else if (kw === 'table') {
      apply = (view, _completion, from, to) => {
        const text = '#table\n#table-name \n#end';
        const cursor = from + '#table\n#table-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
    } else if (kw === 'end') {
      apply = '#end';
    } else if (kw === 'diagram-name' || kw === 'diagram-type' || kw === 'table-name') {
      apply = `#${kw} `;
    } else {
      apply = `#${kw}`;
    }
    return { label: `#${kw}`, apply, type: 'keyword' };
  });
}

function buildTypeCompletions(filter: string): Completion[] {
  const term = filter.toLowerCase();
  return MERMAID_DIAGRAM_TYPES.filter(
    (t) => t.toLowerCase().startsWith(term) || t.toLowerCase().includes(term),
  ).map((t) => ({ label: t, apply: t, type: 'type' }));
}

function buildEntityCompletions(
  entities: EntityLike[],
  edges: EdgeLike[],
  includeEdges: boolean,
  filter: string,
): Completion[] {
  const rawTerm = filter.toLowerCase().trim();
  const termTokens = rawTerm.split(/[^a-z0-9]+/).filter(Boolean);
  const matchesTokens = (hay: string) => {
    if (termTokens.length === 0) return true;
    const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
    return termTokens.every((t) => words.some((w) => w.startsWith(t)));
  };

  const options: Completion[] = [];
  for (const e of entities) {
    const hay = `${e.type || ''} ${e.label || ''} ${e.id || ''}`.toLowerCase();
    if (!matchesTokens(hay)) continue;
    const qualified = e.type && !e.id.startsWith(`${e.type}:`) ? `${e.type}:${e.id}` : e.id;
    options.push({
      label: e.label || e.id,
      detail: qualified,
      apply: formatEntityToken(e.label || e.id, e.id, e.type),
      type: 'property',
    });
  }

  if (includeEdges) {
    const entityLabelMap = new Map(entities.map((e) => [e.id, e.label || e.id]));
    for (const edge of edges) {
      const sourceLabel = entityLabelMap.get(edge.from) || edge.from;
      const targetLabel = entityLabelMap.get(edge.to) || edge.to;
      const rel = edge.label || edge.type || 'edge';
      const hay = `${sourceLabel} ${edge.from} ${targetLabel} ${edge.to} ${rel}`.toLowerCase();
      if (!matchesTokens(hay)) continue;
      options.push({
        label: `${sourceLabel} — ${rel} → ${targetLabel}`,
        detail: `${edge.from} → ${edge.to}`,
        apply: formatEdgeToken(edge.from, edge.to, rel),
        type: 'enum',
      });
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 8);
}

const completionTriggerPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate) {
      const userEvent = update.transactions.some((tr) => tr.isUserEvent('input.type'));
      if (!userEvent) return;
      const pos = update.state.selection.main.head;
      const before = update.state.doc.toString().slice(Math.max(0, pos - 2), pos);
      if (before === '[[' || before.slice(-1) === '#') {
        setTimeout(() => startCompletion(update.view), 0);
      }
    }
  },
);

function aqlCompletions(
  propsRef: React.MutableRefObject<{
    entities: EntityLike[];
    edges: EdgeLike[];
    includeEdges: boolean;
  }>,
): CompletionSource {
  return (context) => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const beforeCursor = line.text.slice(0, pos - line.from);

    // #diagram-type value completion
    const diagramTypeMatch = beforeCursor.match(/^#diagram-type\s+(.*)$/i);
    if (diagramTypeMatch) {
      const filter = diagramTypeMatch[1];
      return {
        from: line.from + '#diagram-type '.length,
        to: pos,
        options: buildTypeCompletions(filter),
      };
    }

    // directive keyword completion
    const dirMatch = beforeCursor.match(/^#([a-zA-Z0-9_-]*)$/);
    if (dirMatch) {
      const options = buildDirectiveCompletions(dirMatch[1]);
      if (options.length === 0) return null;
      return {
        from: line.from + beforeCursor.indexOf('#'),
        to: pos,
        options,
      };
    }

    // entity/edge reference completion
    const allBefore = state.doc.toString().slice(0, pos);
    const openIdx = allBefore.lastIndexOf('[[');
    const closeIdx = allBefore.indexOf(']]', openIdx);
    if (openIdx >= 0 && (closeIdx === -1 || closeIdx >= pos)) {
      const filter = allBefore.slice(openIdx + 2, pos);
      return {
        from: openIdx,
        to: pos,
        options: buildEntityCompletions(
          propsRef.current.entities,
          propsRef.current.edges,
          propsRef.current.includeEdges,
          filter,
        ),
      };
    }

    return null;
  };
}

export function AqlEditor(props: AqlEditorProps) {
  const {
    id,
    value,
    onChange,
    onSubmit,
    disabled = false,
    placeholder,
    availableEntities = [],
    availableEdges = [],
    includeEdges = true,
    className,
    style,
  } = props;

  const propsRef = useRef({ entities: availableEntities, edges: availableEdges, includeEdges });
  useEffect(() => {
    propsRef.current = { entities: availableEntities, edges: availableEdges, includeEdges };
  }, [availableEntities, availableEdges, includeEdges]);

  const lastCursorRef = useRef(0);

  const handleChange = useCallback(
    (newValue: string, viewUpdate: ViewUpdate) => {
      const cursor = viewUpdate.state.selection.main.head;
      if (newValue !== value || cursor !== lastCursorRef.current) {
        lastCursorRef.current = cursor;
        onChange(newValue, cursor);
      }
    },
    [value, onChange],
  );

  const extensions = useMemo(
    () => [
      aqlLanguage,
      aqlTheme,
      syntaxHighlighting(aqlHighlightStyle),
      autocompletion({ override: [aqlCompletions(propsRef)] }),
      completionTriggerPlugin,
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            onSubmit?.();
            return true;
          },
        },
      ]),
    ],
    [onSubmit],
  );

  return (
    <div id={id} className={cn('flex flex-col flex-1 min-h-0 relative', className)} style={style}>
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        editable={!disabled}
        placeholder={placeholder}
        theme="none"
        height="100%"
        className="flex-1 min-h-0"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLineGutter: false,
          highlightActiveLine: false,
          closeBrackets: false,
        }}
      />
    </div>
  );
}
