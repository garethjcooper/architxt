'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror, { ExternalChange } from '@uiw/react-codemirror';
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view';
import { acceptCompletion, autocompletion, insertCompletionText, startCompletion, type Completion, type CompletionSource } from '@codemirror/autocomplete';
import { insertNewline } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { cn } from '@/lib/utils';
import { parseAql } from '@architxt/aql';
import {
  buildEntityCompletions,
  completionInputHandler,
  type EntityLike,
  type EdgeLike,
} from '@/components/aql-editor-completions';

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  placeholder?: string;
  availableEntities?: EntityLike[];
  availableEdges?: EdgeLike[];
  currentAql?: string | null;
  className?: string;
}

interface BlockRef {
  kind: string;
  name: string | undefined;
}

function getBlockRefs(aql: string | null | undefined): BlockRef[] {
  if (!aql) return [];
  try {
    const { blocks } = parseAql(aql);
    return blocks.map((b) => ({ kind: b.kind, name: b.name }));
  } catch {
    return [];
  }
}

function buildBlockReferenceCompletions(refs: BlockRef[], filter: string): Completion[] {
  const term = filter.toLowerCase();
  const filtered = refs.filter(
    (r) => (r.name?.toLowerCase().includes(term) ?? false) ||
             (r.kind?.toLowerCase().startsWith(term) ?? false) ||
             term === '',
  );
  if (filtered.length === 0) {
    return [
      {
        label: 'No blocks in current AQL',
        apply: () => {},
        type: 'text',
      },
    ];
  }
  return filtered.map((r) => ({
    label: `#${r.kind}${r.name ? `: ${r.name}` : ''}`,
    detail: `${r.kind} block`,
    apply: (view, _completion, from, to) => {
      const token = `##${r.kind}${r.name ? `-${r.name}` : ''}`;
      view.dispatch(insertCompletionText(view.state, token, from, to));
    },
    type: 'keyword',
  }));
}

function chatCompletions(
  propsRef: React.MutableRefObject<{
    entities: EntityLike[];
    edges: EdgeLike[];
    blockRefs: BlockRef[];
  }>,
): CompletionSource {
  return (context) => {
    const { state, pos } = context;
    const allBefore = state.doc.toString().slice(0, pos);

    // ## references existing blocks in the current chat AQL.
    const hashOpenIdx = allBefore.lastIndexOf('##');
    if (hashOpenIdx >= 0) {
      const newlineAfter = allBefore.indexOf('\n', hashOpenIdx);
      if (newlineAfter === -1 || newlineAfter >= pos) {
        const filter = allBefore.slice(hashOpenIdx + 2, pos);
        return {
          from: hashOpenIdx,
          to: pos,
          filter: false,
          options: buildBlockReferenceCompletions(propsRef.current.blockRefs, filter).slice(0, 20),
        };
      }
    }

    // [[ entity/edge reference completion — same logic as the AQL editor.
    const openIdx = allBefore.lastIndexOf('[[');
    if (openIdx >= 0) {
      const closeRefIdx = allBefore.indexOf(']]', openIdx);
      if (closeRefIdx === -1 || closeRefIdx >= pos) {
        const filter = allBefore.slice(openIdx + 2, pos);
        return {
          from: openIdx,
          to: pos,
          filter: false,
          options: buildEntityCompletions(
            propsRef.current.entities,
            propsRef.current.edges,
            true,
            filter,
          ).slice(0, 50),
        };
      }
    }

    return null;
  };
}

const chatInputTheme = EditorView.theme({
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
  '.cm-placeholder': {
    color: 'var(--syntax-comment)',
  },
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
});

function ChatInputComponent(props: ChatInputProps) {
  const {
    value,
    onChange,
    onSubmit,
    disabled = false,
    placeholder,
    availableEntities = [],
    availableEdges = [],
    currentAql,
    className,
  } = props;

  const blockRefs = useMemo(() => getBlockRefs(currentAql), [currentAql]);

  const propsRef = useRef({ entities: availableEntities, edges: availableEdges, blockRefs });
  useEffect(() => {
    propsRef.current = { entities: availableEntities, edges: availableEdges, blockRefs };
  }, [availableEntities, availableEdges, blockRefs]);

  // CONTROLLED/UNCONTROLLED BOUNDARY
  // The editor's own document is the source of truth while the user is typing.
  // We render CodeMirror with a local value state so parent re-renders never pass
  // a stale controlled value back while @uiw/react-codemirror's 200 ms typing
  // latch is active, which is what truncates text and resets the cursor.
  // Parent-initiated changes (e.g. send clears input) are detected by comparing
  // detected by comparing the value prop to the local value and applied
  // imperatively to the CodeMirror view.
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

  const lastNotifiedValueRef = useRef(value);
  useEffect(() => {
    lastNotifiedValueRef.current = value;
  }, [value]);

  const notifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (newValue: string, _viewUpdate: ViewUpdate) => {
      const valueChanged = newValue !== localValueRef.current;
      if (!valueChanged) return;

      // Keep local value in sync with the document so parent re-renders never
      // feed a stale value back into CodeMirror while the typing latch is open.
      localValueRef.current = newValue;
      setLocalValue(newValue);

      if (notifyTimeoutRef.current) {
        clearTimeout(notifyTimeoutRef.current);
      }
      notifyTimeoutRef.current = setTimeout(() => {
        notifyTimeoutRef.current = null;
        if (newValue !== lastNotifiedValueRef.current) {
          onChange(newValue);
          lastNotifiedValueRef.current = newValue;
        }
      }, 120);
    },
    [onChange],
  );

  useEffect(() => {
    return () => {
      if (notifyTimeoutRef.current) clearTimeout(notifyTimeoutRef.current);
    };
  }, []);

  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const extensions = useMemo(
    () => [
      chatInputTheme,
      autocompletion({ override: [chatCompletions(propsRef)] }),
      completionInputHandler({ directive: true, entity: true }),
      Prec.high(
        keymap.of([
          {
            key: 'Enter',
            run: (view) => {
              // If autocomplete is open, let Enter accept the selected item.
              if (acceptCompletion(view)) return true;
              onSubmitRef.current?.();
              return true;
            },
          },
          {
            key: 'Alt-Enter',
            run: insertNewline,
          },
          {
            key: 'Shift-Enter',
            run: insertNewline,
          },
        ]),
      ),
    ],
    [],
  );

  return (
    <div className={cn('relative min-h-0 w-full overflow-hidden', className)}>
      <CodeMirror
        value={localValue}
        onChange={handleChange}
        onCreateEditor={(view) => { viewRef.current = view; }}
        extensions={extensions}
        editable={!disabled}
        placeholder={placeholder}
        theme="none"
        height="100%"
        className="h-full w-full"
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

export const ChatInput = React.memo(ChatInputComponent);
