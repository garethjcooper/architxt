'use client';

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { StreamLanguage, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import {
  autocompletion,
  insertCompletionText,
  startCompletion,
  type Completion,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { Tag, tagHighlighter } from '@lezer/highlight';
import { cn } from '@/lib/utils';
import {
  formatEntityToken,
  formatEdgeToken,
  MERMAID_DIAGRAM_TYPES,
  BLOCK_DIRECTIVES,
  SUB_DIRECTIVE_KEYS,
  ALLOWED_KEYS_BY_BLOCK,
  parseAql,
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
const tDirectiveSub = Tag.define();
const tReference = Tag.define();

const aqlHighlightStyle = tagHighlighter([
  { tag: tDirective, class: 'aql-directive' },
  { tag: tDirectiveSub, class: 'aql-directive-sub' },
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
          case 'table':
          case 'graph':
          case 'narrative':
          case 'end':
            return 'directive';
          case 'diagram-name':
          case 'diagram-type':
          case 'table-name':
          case 'graph-name':
          case 'narrative-name':
            return 'directive-sub';
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
      'directive-sub': tDirectiveSub,
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
  '.aql-directive': { color: 'var(--color-aql-directive)', fontWeight: 500 },
  '.aql-directive-sub': { color: 'var(--color-aql-directive-sub)', fontWeight: 500 },
  '.aql-reference': { color: 'var(--syntax-number)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-panel)',
    border: '1px solid var(--border-strong)',
    borderRadius: '6px',
    boxShadow: '0 4px 6px -1px var(--overlay-strong)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    padding: '4px 0',
  },
  '.cm-tooltip-autocomplete ul li': {
    padding: '4px 10px',
    color: 'var(--syntax-text)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    backgroundColor: 'var(--accent-primary-bg)',
    color: 'var(--accent-primary-fg)',
  },
  '.cm-completionIcon': {
    color: 'var(--syntax-punctuation)',
  },
  '.cm-diagnostic': {
    color: 'var(--syntax-text)',
  },
  '.cm-diagnosticText': {
    color: 'var(--syntax-text)',
  },
  '.cm-diagnostic-error': {
    color: 'var(--destructive-fg)',
  },
  '.cm-lintRange': {
    backgroundImage: 'none',
  },
  '.cm-lintRange-error': {
    backgroundColor: 'var(--destructive-bg)',
    borderBottom: '1px dashed var(--destructive-fg)',
  },
  '.cm-lintRange-warning': {
    backgroundColor: 'var(--badge-caution-bg)',
    borderBottom: '1px dashed var(--badge-caution-fg)',
  },
  '.cm-lintMarker': {
    color: 'var(--destructive-fg)',
  },
  '.cm-panel.cm-lintPanel': {
    backgroundColor: 'var(--surface-panel)',
    borderTop: '1px solid var(--border-strong)',
  },
  '.cm-lintPanel .cm-diagnostic': {
    padding: '4px 8px',
    borderBottom: '1px solid var(--border-default)',
  },
});

const aqlLinter = linter((view) => {
  const diagnostics: Diagnostic[] = [];
  const result = parseAql(view.state.doc.toString());
  const errors = result.errors ?? [];
  const text = view.state.doc.toString();
  const lines = text.split('\n');

  for (const err of errors) {
    const lineIndex = Math.max(0, (err.line ?? 1) - 1);
    const lineText = lines[lineIndex] ?? '';
    const from = view.state.doc.line(lineIndex + 1).from;
    const to = from + lineText.length;
    diagnostics.push({
      from,
      to,
      severity: 'error',
      message: err.message,
    });
  }

  // Extra structural diagnostics the parser doesn't surface per-line.
  for (const block of result.blocks ?? []) {
    if (block.kind === 'diagram') {
      if (!block.name) {
        const lineIdx = (block.startLine ?? 1) - 1;
        const from = view.state.doc.line(lineIdx + 1).from;
        diagnostics.push({
          from,
          to: from + (lines[lineIdx]?.length ?? 0),
          severity: 'warning',
          message: 'Diagram is missing a #diagram-name',
        });
      }
      if (!block.type) {
        const lineIdx = (block.startLine ?? 1) - 1;
        const from = view.state.doc.line(lineIdx + 1).from;
        diagnostics.push({
          from,
          to: from + (lines[lineIdx]?.length ?? 0),
          severity: 'warning',
          message: 'Diagram is missing a #diagram-type',
        });
      }
    }
    if (block.kind === 'table' && !block.name) {
      const lineIdx = (block.startLine ?? 1) - 1;
      const from = view.state.doc.line(lineIdx + 1).from;
      diagnostics.push({
        from,
        to: from + (lines[lineIdx]?.length ?? 0),
        severity: 'warning',
        message: 'Table is missing a #table-name',
      });
    }
    if (block.kind === 'graph' && !block.name) {
      const lineIdx = (block.startLine ?? 1) - 1;
      const from = view.state.doc.line(lineIdx + 1).from;
      diagnostics.push({
        from,
        to: from + (lines[lineIdx]?.length ?? 0),
        severity: 'warning',
        message: 'Graph is missing a #graph-name',
      });
    }
    if (block.kind === 'narrative' && !block.name) {
      const lineIdx = (block.startLine ?? 1) - 1;
      const from = view.state.doc.line(lineIdx + 1).from;
      diagnostics.push({
        from,
        to: from + (lines[lineIdx]?.length ?? 0),
        severity: 'warning',
        message: 'Narrative is missing a #narrative-name',
      });
    }
  }

  return diagnostics;
});

function getCurrentBlockKind(state: EditorState): string | null {
  const text = state.doc.toString();
  let currentBlock: string | null = null;
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf('\n', i);
    const lineEnd = nl === -1 ? text.length : nl;
    const line = text.slice(i, lineEnd);
    const blockMatch = line.match(/^#(diagram|table|graph|narrative)\b/);
    if (blockMatch) {
      currentBlock = blockMatch[1];
    } else if (/^#end\b/.test(line)) {
      currentBlock = null;
    }
    i = lineEnd + 1;
  }
  return currentBlock;
}

const DIRECTIVE_KEYWORDS = [
  'diagram',
  'table',
  'graph',
  'narrative',
  'diagram-name',
  'diagram-type',
  'table-name',
  'graph-name',
  'narrative-name',
  'end',
];

function buildDirectiveCompletions(filter: string, state: EditorState): Completion[] {
  const term = filter.toLowerCase();
  const blockKind = getCurrentBlockKind(state);
  const allowed = new Set<string>(['end']);
  if (blockKind) {
    const blockAllowed = ALLOWED_KEYS_BY_BLOCK[blockKind as keyof typeof ALLOWED_KEYS_BY_BLOCK];
    if (blockAllowed) {
      blockAllowed.forEach((k) => allowed.add(k));
    }
  } else {
    BLOCK_DIRECTIVES.forEach((k) => allowed.add(k));
  }
  const keywords = DIRECTIVE_KEYWORDS.filter((kw) => allowed.has(kw));

  // If the user has typed an exact block-directive prefix, exclude longer
  // sub-directives that merely happen to start with the same text so that
  // #table does not jump to #table-name.
  const typedExactBlock = BLOCK_DIRECTIVES.includes(term);
  const filteredKeywords = keywords.filter((kw) => {
    if (!kw.startsWith(term)) return false;
    if (typedExactBlock) return BLOCK_DIRECTIVES.includes(kw) || kw === term;
    return true;
  });

  return filteredKeywords.map((kw) => {
    let apply: Completion['apply'];
    let boost = 0;
    if (kw === 'diagram') {
      apply = (view, _completion, from, to) => {
        const text = '#diagram\n#diagram-name \n#diagram-type \n#end';
        const cursor = from + '#diagram\n#diagram-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'table') {
      apply = (view, _completion, from, to) => {
        const text = '#table\n#table-name \n#end';
        const cursor = from + '#table\n#table-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'graph') {
      apply = (view, _completion, from, to) => {
        const text = '#graph\n#graph-name \n#end';
        const cursor = from + '#graph\n#graph-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'narrative') {
      apply = (view, _completion, from, to) => {
        const text = '#narrative\n#narrative-name \n#end';
        const cursor = from + '#narrative\n#narrative-name '.length;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: cursor, head: cursor },
        });
      };
      boost = 99;
    } else if (kw === 'end') {
      apply = '#end';
    } else if (kw === 'diagram-name' || kw === 'diagram-type' || kw === 'table-name' || kw === 'graph-name' || kw === 'narrative-name') {
      apply = `#${kw} `;
    } else {
      apply = `#${kw}`;
    }
    return { label: `#${kw}`, apply, type: 'keyword', boost };
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
    const insertText = formatEntityToken(e.label || e.id, e.id, e.type);
    options.push({
      label: e.label || e.id,
      detail: qualified,
      apply: (view, _completion, from, to) => {
        view.dispatch(insertCompletionText(view.state, insertText, from, to));
      },
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
      const insertText = formatEdgeToken(edge.from, edge.to, rel);
      options.push({
        label: `${sourceLabel} — ${rel} → ${targetLabel}`,
        detail: `${edge.from} → ${edge.to}`,
        apply: (view, _completion, from, to) => {
          view.dispatch(insertCompletionText(view.state, insertText, from, to));
        },
        type: 'enum',
      });
    }
  }

  if (options.length === 0) {
    options.push({
      label: 'No matching entities or edges',
      apply: () => {},
      type: 'text',
    });
  } else {
    options.sort((a, b) => a.label.length - b.label.length);
  }

  return options;
}

const completionInputHandler = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '[' && text !== '#') return false;
  // For '[', only trigger when the user is typing [[ (previous char is [).
  if (text === '[') {
    const prev = view.state.doc.sliceString(Math.max(0, from - 1), from);
    if (prev !== '[') return false;
  }

  Promise.resolve().then(() => startCompletion(view));
  return false;
});

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
      const options = buildDirectiveCompletions(dirMatch[1], state);
      if (options.length === 0) return null;
      return {
        from: line.from + beforeCursor.indexOf('#'),
        to: pos,
        options,
      };
    }

    // entity/edge reference completion — open on [[ trigger
    const allBefore = state.doc.toString().slice(0, pos);
    const openIdx = allBefore.lastIndexOf('[[');
    const closeIdx = allBefore.indexOf(']]', openIdx);
    if (openIdx >= 0 && (closeIdx === -1 || closeIdx >= pos)) {
      const filter = allBefore.slice(openIdx + 2, pos);
      return {
        from: openIdx,
        to: pos,
        filter: false,
        options: buildEntityCompletions(
          propsRef.current.entities,
          propsRef.current.edges,
          propsRef.current.includeEdges,
          filter,
        ).slice(0, 50),
      };
    }

    return null;
  };
}

function AqlEditorComponent(props: AqlEditorProps) {
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
  const lastValueRef = useRef(value);
  const lastNotifiedValueRef = useRef(value);
  useEffect(() => {
    lastValueRef.current = value;
    lastNotifiedValueRef.current = value;
  }, [value]);

  const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<{ value: string; cursor: number } | null>(null);

  // Keep the change callback stable so CodeMirror doesn't rebind on every
  // keystroke. We still suppress duplicate notifications with value/cursor refs.
  const handleChange = useCallback(
    (newValue: string, viewUpdate: ViewUpdate) => {
      const cursor = viewUpdate.state.selection.main.head;
      const valueChanged = newValue !== lastValueRef.current;
      const cursorChanged = cursor !== lastCursorRef.current;
      if (valueChanged || cursorChanged) {
        lastValueRef.current = newValue;
        if (cursorChanged) {
          lastCursorRef.current = cursor;
        }
        // Notify parent whenever the document value changes, but not for
        // pure cursor/selection movements. Debounce the notification slightly
        // so rapid typing doesn't trigger a parent re-render on every keystroke,
        // which can make CodeMirror's external-value sync compete with the user.
        if (valueChanged) {
          pendingValueRef.current = { value: newValue, cursor };
          if (notifyTimeoutRef.current) {
            clearTimeout(notifyTimeoutRef.current);
          }
          // Debounce must outlast @uiw/react-codemirror's internal 200 ms
          // typing latch. If we notify the parent earlier, the parent value
          // prop updates while CodeMirror is still latched and gets queued as
          // a stale external overwrite, which truncates text and resets cursor.
          notifyTimeoutRef.current = setTimeout(() => {
            notifyTimeoutRef.current = null;
            const pending = pendingValueRef.current;
            pendingValueRef.current = null;
            if (pending != null && pending.value !== lastNotifiedValueRef.current) {
              onChange(pending.value, pending.cursor);
              lastNotifiedValueRef.current = pending.value;
            }
          }, 250);
        }
      }
    },
    [onChange],
  );

  useEffect(() => {
    return () => {
      if (notifyTimeoutRef.current) {
        clearTimeout(notifyTimeoutRef.current);
      }
    };
  }, []);

  // Keep the submit callback in a ref so the keymap extension never has to be
  // recreated when the parent passes a new function reference (e.g. a closure
  // that changes on every keystroke). This prevents expensive CodeMirror
  // reconfiguration and keeps typing responsive.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const extensions = useMemo(
    () => [
      aqlLanguage,
      aqlTheme,
      syntaxHighlighting(aqlHighlightStyle),
      autocompletion({ override: [aqlCompletions(propsRef)] }),
      aqlLinter,
      completionInputHandler,
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            onSubmitRef.current?.();
            return true;
          },
        },
      ]),
    ],
    [],
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

// Memoize so parent re-renders (e.g. polling trail/session updates) do not
// reach CodeMirror and queue stale external-value updates while the user is
// typing. The controlled value race in @uiw/react-codemirror's 200 ms typing
// latch can otherwise overwrite the editor with a stale `value` prop and reset
// the cursor to position 0.
export const AqlEditor = React.memo(AqlEditorComponent);
