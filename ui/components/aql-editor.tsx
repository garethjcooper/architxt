'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { ExternalChange } from '@uiw/react-codemirror';
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
import { parseAql } from '@architxt/aql';
import {
  buildDirectiveCompletions,
  buildEntityCompletions,
  buildTypeCompletions,
  completionInputHandler,
  getCurrentBlockKind,
  BLOCK_DIRECTIVES,
  SUB_DIRECTIVE_KEYS,
  ALLOWED_KEYS_BY_BLOCK,
  type EntityLike,
  type EdgeLike,
} from './aql-editor-completions';

export type { EntityLike, EdgeLike } from './aql-editor-completions';

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

  // CONTROLLED/UNCONTROLLED BOUNDARY
  // The editor's own document is the source of truth while the user is typing.
  // We render CodeMirror with a local value state so parent re-renders never pass
  // a stale controlled value back while @uiw/react-codemirror's 200 ms typing
  // latch is active, which is what truncates text and resets the cursor.
  // Parent-initiated changes are detected by comparing the value prop to the local
  // value and applied imperatively to the CodeMirror view.
  const viewRef = useRef<EditorView | null>(null);
  const [localValue, setLocalValue] = useState(value);
  const localValueRef = useRef(value);
  useLayoutEffect(() => {
    if (value !== localValueRef.current) {
      localValueRef.current = value;
      setLocalValue(value);
      const view = viewRef.current;
      if (view && value !== view.state.doc.toString()) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: value },
          annotations: [ExternalChange.of(true)],
        });
      }
    }
  }, [value]);

  const lastCursorRef = useRef(0);
  const lastNotifiedValueRef = useRef(value);
  useEffect(() => {
    lastNotifiedValueRef.current = value;
  }, [value]);

  const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValueRef = useRef<{ value: string; cursor: number } | null>(null);

  const handleChange = useCallback(
    (newValue: string, viewUpdate: ViewUpdate) => {
      const cursor = viewUpdate.state.selection.main.head;
      const valueChanged = newValue !== localValueRef.current;
      const cursorChanged = cursor !== lastCursorRef.current;
      if (!valueChanged && !cursorChanged) return;

      // Keep local value in sync with the document so parent re-renders never
      // feed a stale value back into CodeMirror while the typing latch is open.
      if (valueChanged) {
        localValueRef.current = newValue;
        setLocalValue(newValue);
      }
      if (cursorChanged) {
        lastCursorRef.current = cursor;
      }

      // Notify parent on value changes only, debounced to avoid spam.
      if (valueChanged) {
        pendingValueRef.current = { value: newValue, cursor };
        if (notifyTimeoutRef.current) {
          clearTimeout(notifyTimeoutRef.current);
        }
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
      completionInputHandler({ directive: true, entity: true }),
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
        value={localValue}
        onChange={handleChange}
        onCreateEditor={(view) => { viewRef.current = view; }}
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
