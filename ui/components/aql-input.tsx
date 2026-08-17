'use client';

import React, {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from 'react';
import { cn } from '@/lib/utils';
import {
  formatEntityToken,
  formatEdgeToken,
  parseReferences,
} from '@architxt/aql';
import {
  renderAqlToHtml,
  tokenizeAql,
  type AqlReferenceResolver,
} from './aql-tokens';
import {
  type DirectiveAutocompleteItem,
  findDirectiveTrigger,
  getDirectiveAutocompleteItems,
} from '@/app/research/directive-autocomplete';

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

type EntityAutocompleteItem = {
  kind: 'entity';
  id: string;
  label: string;
  type: string | null | undefined;
  render: string;
  sublabel: string;
  token: string;
  icon: React.ReactElement;
};

type EdgeAutocompleteItem = {
  kind: 'edge';
  id: string;
  label: string;
  render: string;
  sublabel: string;
  token: string;
  icon: React.ReactElement;
};

type AutocompleteItem = EntityAutocompleteItem | EdgeAutocompleteItem | DirectiveAutocompleteItem;

export interface AqlInputProps {
  /** Optional id for label association. */
  id?: string;
  /** Raw AQL query value. */
  value: string;
  /** Called when the query value or caret position changes. */
  onChange: (value: string, cursor: number) => void;
  /** Called when the user presses Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  /** Disables editing. */
  disabled?: boolean;
  /** Placeholder text shown when the query is empty and not focused. */
  placeholder?: string;
  /** Entities available for [[...]] autocomplete. */
  availableEntities?: EntityLike[];
  /** Edges available for [[...]] autocomplete. */
  availableEdges?: EdgeLike[];
  /** If false, edge references are not offered in autocomplete. Default true. */
  includeEdges?: boolean;
  /** Optional reference resolver for labels and chip colors. */
  resolveReference?: AqlReferenceResolver;
  /** Additional CSS class for the editor container. */
  className?: string;
  /** Inline styles for the editor container. */
  style?: React.CSSProperties;
}

function defaultReferenceResolver(
  entities: EntityLike[],
  edges: EdgeLike[],
  colorForType?: (type?: string | null) => string,
): AqlReferenceResolver {
  return (reference) => {
    if (reference.kind === 'entity') {
      const entity = entities.find((e) => e.id === reference.id);
      const label = entity?.label || reference.label || reference.id || reference.raw;
      const color = colorForType ? colorForType(reference.type || entity?.type) : undefined;
      return { label, color };
    }
    const from = reference.from || '';
    const to = reference.to || '';
    const edgeLabel = reference.edgeLabel || 'edge';
    const edge = edges.find(
      (e) => e.from === from && e.to === to && (e.label || e.type || '') === edgeLabel,
    );
    const sourceLabel = entities.find((e) => e.id === from)?.label || from;
    const targetLabel = entities.find((e) => e.id === to)?.label || to;
    const rel = edge?.label || edge?.type || edgeLabel;
    const color = colorForType ? colorForType(rel) : undefined;
    return { label: `${sourceLabel} — ${rel} → ${targetLabel}`, color };
  };
}

interface EntityTriggerBounds {
  filter: string;
  start: number;
  end: number;
}

function findOpenEntityTriggerBounds(query: string, offset: number): EntityTriggerBounds | null {
  // Strip out reference tokens so we only inspect the plain text before the cursor.
  const refs = parseReferences(query);
  let cursor = 0;
  let plainBefore = '';
  for (const ref of refs) {
    const idx = query.indexOf(ref.raw, cursor);
    if (idx === -1) continue;
    if (idx >= offset) break;
    if (cursor < idx) {
      const slice = query.slice(cursor, Math.min(idx, offset));
      plainBefore += slice;
      cursor += slice.length;
      if (cursor >= offset) break;
    }
    cursor = idx + ref.raw.length;
  }
  if (cursor < offset) {
    plainBefore += query.slice(cursor, offset);
  }
  const entityMatch = plainBefore.match(/\[\[([^\]]*)$/);
  if (!entityMatch) return null;
  return {
    filter: entityMatch[1],
    start: offset - entityMatch[0].length,
    end: offset,
  };
}

function findOpenEntityTrigger(query: string, offset: number): string | null {
  return findOpenEntityTriggerBounds(query, offset)?.filter ?? null;
}

/**
 * Reusable AQL query input.
 *
 * Uses a transparent <textarea> over a colored background layer so the whole
 * query behaves like plain text for selection/cursor movement, while directives
 * and references are still syntax-highlighted.
 */
export function AqlInput({
  id,
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  availableEntities = [],
  availableEdges = [],
  includeEdges = true,
  resolveReference,
  className,
  style,
}: AqlInputProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [autocompleteKind, setAutocompleteKind] = useState<'entity' | 'directive'>('entity');
  const [autocompletePos, setAutocompletePos] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const lastHandledKeyRef = useRef<string | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const [internalCursor, setInternalCursor] = useState(0);
  const cursorRef = useRef(0);
  const autocompleteRafRef = useRef<number | null>(null);

  const updateCursor = useCallback((offset: number) => {
    cursorRef.current = offset;
    setInternalCursor(offset);
  }, []);

  const effectiveResolver = useMemo(() => {
    return resolveReference || defaultReferenceResolver(availableEntities, availableEdges);
  }, [resolveReference, availableEntities, availableEdges]);

  // Colored HTML shown in the background layer.
  const coloredHtml = useMemo(() => {
    return renderAqlToHtml(value, effectiveResolver);
  }, [value, effectiveResolver]);

  // Restore pending caret position after controlled value updates.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || pendingCaretRef.current === null) return;
    const pos = Math.min(pendingCaretRef.current, value.length);
    el.selectionStart = pos;
    el.selectionEnd = pos;
    pendingCaretRef.current = null;
  }, [value]);

  const getCaretOffset = useCallback(() => {
    const el = editorRef.current;
    if (!el) return 0;
    return Math.min(el.selectionStart ?? 0, value.length);
  }, [value.length]);

  /**
   * Compute the pixel position of the caret inside the textarea content area.
   * Uses a hidden mirror <div> with identical styling and a marker span.
   */
  const getCaretCoordinates = useCallback(
    (explicitOffset?: number, explicitValue?: string): { top: number; left: number } => {
      const el = editorRef.current;
      const mirror = mirrorRef.current;
      if (!el || !mirror) return { top: 0, left: 0 };

      const currentValue = explicitValue ?? value;
      const offset = explicitOffset ?? getCaretOffset();
      const textBefore = currentValue.slice(0, offset);
      const lastNewline = textBefore.lastIndexOf('\n');
      const linePrefix = textBefore.slice(lastNewline + 1);

      const escape = (s: string) =>
        s
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/ /g, '&nbsp;')
          .replace(/\n/g, '<br>');

      // Match the textarea content box width so wrapping is identical.
      const computed = window.getComputedStyle(el);
      const padLeft = parseFloat(computed.paddingLeft) || 0;
      const padRight = parseFloat(computed.paddingRight) || 0;
      mirror.style.width = `${el.clientWidth - padLeft - padRight}px`;
      mirror.style.fontFamily = computed.fontFamily;
      mirror.style.fontSize = computed.fontSize;
      mirror.style.fontWeight = computed.fontWeight;
      mirror.style.lineHeight = computed.lineHeight;
      mirror.style.letterSpacing = computed.letterSpacing;
      mirror.style.whiteSpace = 'pre-wrap';
      mirror.style.wordWrap = 'break-word';
      mirror.style.overflowWrap = 'break-word';

      mirror.innerHTML = `${escape(linePrefix)}<span id="aql-caret-marker">\u200b</span>`;
      const marker = mirror.querySelector('#aql-caret-marker');
      if (!marker) return { top: 0, left: 0 };

      const markerRect = marker.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      return {
        top: markerRect.top - elRect.top + el.scrollTop,
        left: markerRect.left - elRect.left + el.scrollLeft,
      };
    },
    [getCaretOffset, value],
  );

  const updateAutocompleteState = useCallback(
    (nextValue?: string, nextOffset?: number) => {
      const el = editorRef.current;
      if (!el) return;

      const lastKey = lastHandledKeyRef.current;
      lastHandledKeyRef.current = null;
      if (
        lastKey === 'ArrowUp' ||
        lastKey === 'ArrowDown' ||
        lastKey === 'ArrowLeft' ||
        lastKey === 'ArrowRight' ||
        lastKey === 'Home' ||
        lastKey === 'End' ||
        lastKey === 'PageUp' ||
        lastKey === 'PageDown' ||
        lastKey === 'Escape' ||
        lastKey === 'Enter' ||
        lastKey === 'Tab'
      ) {
        return;
      }

      const offset = nextOffset ?? getCaretOffset();
      const currentValue = nextValue ?? value;
      updateCursor(offset);
      onChange(currentValue, offset);

      const entityFilter = findOpenEntityTrigger(currentValue, offset);
      if (entityFilter != null) {
        setShowAutocomplete(true);
        setAutocompleteKind('entity');
        setAutocompleteFilter(entityFilter);
        setAutocompletePos(getCaretCoordinates(offset, currentValue));
        setSelectedIndex(0);
        return;
      }

      const directiveTrigger = findDirectiveTrigger(currentValue, offset);
      if (directiveTrigger != null) {
        setShowAutocomplete(true);
        setAutocompleteKind('directive');
        setAutocompleteFilter(directiveTrigger.filter);
        setAutocompletePos(getCaretCoordinates(offset, currentValue));
        setSelectedIndex(0);
        return;
      }

      setShowAutocomplete(false);
    },
    [value, onChange, getCaretOffset, getCaretCoordinates, updateCursor],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      const offset = e.target.selectionStart ?? 0;
      updateCursor(offset);
      onChange(next, offset);
      if (autocompleteRafRef.current != null) {
        cancelAnimationFrame(autocompleteRafRef.current);
      }
      autocompleteRafRef.current = requestAnimationFrame(() => {
        autocompleteRafRef.current = null;
        updateAutocompleteState(next, offset);
      });
    },
    [onChange, updateCursor, updateAutocompleteState],
  );

  const insertAtCursor = useCallback(
    (rawToken: string) => {
      if (disabled) return;
      const el = editorRef.current;
      if (!el) return;

      // Read the live DOM value so we do not slice against a stale prop.
      const liveValue = el.value;
      const offset = el.selectionStart ?? 0;
      const bounds = findOpenEntityTriggerBounds(liveValue, offset);
      if (!bounds) return;

      const before = liveValue.slice(0, bounds.start);
      const after = liveValue.slice(bounds.end);
      const next = before + rawToken + after;
      const pos = before.length + rawToken.length;

      if (autocompleteRafRef.current != null) {
        cancelAnimationFrame(autocompleteRafRef.current);
        autocompleteRafRef.current = null;
      }
      // Apply the change to the DOM immediately so the controlled textarea does
      // not reset the caret to the end when React re-renders.
      el.value = next;
      el.selectionStart = pos;
      el.selectionEnd = pos;
      onChange(next, pos);
      pendingCaretRef.current = pos;
      updateCursor(pos);
      setShowAutocomplete(false);
    },
    [onChange, disabled, updateCursor],
  );

  const insertDirectiveAtCursor = useCallback(
    (item: DirectiveAutocompleteItem) => {
      if (disabled) return;
      const el = editorRef.current;
      if (!el) return;

      const liveValue = el.value;
      const offset = el.selectionStart ?? 0;
      const trigger = findDirectiveTrigger(liveValue, offset);
      if (!trigger) return;

      const before = liveValue.slice(0, trigger.replaceStart);
      const after = liveValue.slice(trigger.replaceEnd);
      const insert = item.insert;
      const next = before + insert + after;
      const pos = before.length + item.cursorOffset;

      if (autocompleteRafRef.current != null) {
        cancelAnimationFrame(autocompleteRafRef.current);
        autocompleteRafRef.current = null;
      }
      el.value = next;
      el.selectionStart = pos;
      el.selectionEnd = pos;
      onChange(next, pos);
      pendingCaretRef.current = pos;
      updateCursor(pos);
      setShowAutocomplete(false);
    },
    [onChange, disabled, updateCursor],
  );

  /**
   * Remove the token adjacent to the caret in the given direction.
   * For a directive like #table or #end, delete the whole directive token.
   * For a reference like [[...]], delete the whole reference.
   */
  const removeAdjacentToken = useCallback(
    (direction: -1 | 1) => {
      const offset = getCaretOffset();
      const tokens = tokenizeAql(value);

      for (const token of tokens) {
        if (token.kind === 'directive' && token.index !== undefined) {
          const raw = token.value ? `#${token.keyword} ${token.value}` : `#${token.keyword}`;
          const idx = token.index;
          if (direction === -1 && offset === idx + raw.length) {
            const next = (value.slice(0, idx) + value.slice(idx + raw.length)).replace(/[ \t]+/g, ' ');
            const newPos = Math.min(idx, next.length);
            onChange(next, newPos);
            pendingCaretRef.current = newPos;
            return;
          }
          if (direction === 1 && offset === idx) {
            const next = (value.slice(0, idx) + value.slice(idx + raw.length)).replace(/[ \t]+/g, ' ');
            const newPos = Math.min(idx, next.length);
            onChange(next, newPos);
            pendingCaretRef.current = newPos;
            return;
          }
        } else if (token.kind === 'reference' && token.reference && token.index !== undefined) {
          const raw = token.reference.raw;
          const idx = token.index;
          if (direction === -1 && offset === idx + raw.length) {
            const next = (value.slice(0, idx) + value.slice(idx + raw.length)).replace(/\s+/g, ' ').trim();
            const newPos = Math.min(idx, next.length);
            onChange(next, newPos);
            pendingCaretRef.current = newPos;
            return;
          }
          if (direction === 1 && offset === idx) {
            const next = (value.slice(0, idx) + value.slice(idx + raw.length)).replace(/\s+/g, ' ').trim();
            const newPos = Math.min(idx, next.length);
            onChange(next, newPos);
            pendingCaretRef.current = newPos;
            return;
          }
        }
      }
    },
    [value, onChange, getCaretOffset],
  );

  const directiveAutocompleteItems = useMemo(() => {
    if (!showAutocomplete || autocompleteKind !== 'directive') return [];
    const cursorOffset = internalCursor;
    const trigger = findDirectiveTrigger(value, cursorOffset);
    if (!trigger) return [];
    return getDirectiveAutocompleteItems(value, cursorOffset, trigger.filter, trigger.isTypeLine);
  }, [showAutocomplete, autocompleteKind, value, internalCursor]);

  const autocompleteItems = useMemo((): AutocompleteItem[] => {
    if (!showAutocomplete) return [];
    if (autocompleteKind === 'directive') return directiveAutocompleteItems;

    const rawTerm = autocompleteFilter.toLowerCase().trim();
    const termTokens = (term: string) => term.split(/[^a-z0-9]+/).filter(Boolean);
    const matchesTokens = (hay: string, term: string) => {
      const tokens = termTokens(term);
      if (tokens.length === 0) return true;
      const words = hay.split(/[^a-z0-9]+/).filter(Boolean);
      return tokens.every((t) => words.some((word) => word.startsWith(t)));
    };

    const entityItems = availableEntities
      .filter((e) => {
        if (!rawTerm) return true;
        const hay = `${e.type || ''} ${e.label || ''} ${e.id || ''}`.toLowerCase();
        const typeMatch = rawTerm.match(/^([a-z0-9_-]+):(.*)$/);
        if (typeMatch) {
          const [, requestedType, rest] = typeMatch;
          const typeOk = requestedType === (e.type || '').toLowerCase();
          if (!typeOk) return false;
          if (!rest.trim()) return true;
          return matchesTokens(hay, rest.trim());
        }
        return matchesTokens(hay, rawTerm);
      })
      .map((e) => {
        const qualified = e.type && !e.id.startsWith(`${e.type}:`) ? `${e.type}:${e.id}` : e.id;
        return {
          kind: 'entity' as const,
          id: e.id,
          label: e.label || e.id,
          type: e.type,
          render: e.label || e.id,
          sublabel: qualified,
          token: formatEntityToken(e.label || e.id, e.id, e.type),
          icon: (
            <span
              className="w-3 h-3 shrink-0"
              style={{
                borderLeftColor:
                  effectiveResolver({
                    kind: 'entity',
                    id: e.id,
                    raw: e.id,
                    label: e.label || e.id,
                    type: e.type,
                  })?.color || '#64748b',
                borderLeftWidth: 3,
                backgroundColor: 'transparent',
              }}
            />
          ),
        };
      })
      .sort((a, b) => {
        const tokens = termTokens(rawTerm);
        const firstToken = tokens[0] || rawTerm;
        const score = (label: string, type: string, id: string) => {
          if (label.startsWith(firstToken)) return 4;
          if (tokens.length > 1 && tokens.every((t) => label.includes(t))) return 3;
          if (type.startsWith(firstToken)) return 2;
          if (id.startsWith(firstToken)) return 1;
          return 0;
        };
        const aScore = score(a.label.toLowerCase(), (a.type || '').toLowerCase(), a.id.toLowerCase());
        const bScore = score(b.label.toLowerCase(), (b.type || '').toLowerCase(), b.id.toLowerCase());
        if (bScore !== aScore) return bScore - aScore;
        return a.label.localeCompare(b.label);
      });

    const entityLabelMap = new Map(availableEntities.map((e) => [e.id, e.label || e.id]));
    const edgeItems = includeEdges
      ? availableEdges
          .filter((e) => {
            if (!rawTerm) return true;
            const sourceLabel = entityLabelMap.get(e.from) || e.from;
            const targetLabel = entityLabelMap.get(e.to) || e.to;
            const rel = e.label || e.type || '';
            const hay = `${sourceLabel} ${e.from} ${targetLabel} ${e.to} ${rel}`.toLowerCase();
            return matchesTokens(hay, rawTerm);
          })
          .map((e) => {
            const l = e.label || e.type || 'edge';
            const sourceLabel = entityLabelMap.get(e.from) || e.from;
            const targetLabel = entityLabelMap.get(e.to) || e.to;
            return {
              kind: 'edge' as const,
              id: `${e.from}|${e.to}|${l}`,
              label: l,
              render: `${sourceLabel} — ${l} → ${targetLabel}`,
              sublabel: `${e.from} → ${e.to}`,
              token: formatEdgeToken(e.from, e.to, l),
              icon: (
                <span
                  className="w-3 h-3 shrink-0"
                  style={{
                    borderLeftColor:
                      effectiveResolver({
                        kind: 'edge',
                        from: e.from,
                        to: e.to,
                        raw: formatEdgeToken(e.from, e.to, l),
                        edgeLabel: l,
                      })?.color || '#64748b',
                    borderLeftWidth: 3,
                    backgroundColor: 'transparent',
                  }}
                />
              ),
            };
          })
          .sort((a, b) => {
            const tokens = termTokens(rawTerm);
            const firstToken = tokens[0] || rawTerm;
            const aRel = a.label.toLowerCase();
            const bRel = b.label.toLowerCase();
            const aScore = aRel.startsWith(firstToken)
              ? 2
              : tokens.length > 1 && tokens.every((t) => aRel.includes(t))
                ? 1
                : 0;
            const bScore = bRel.startsWith(firstToken)
              ? 2
              : tokens.length > 1 && tokens.every((t) => bRel.includes(t))
                ? 1
                : 0;
            if (bScore !== aScore) return bScore - aScore;
            return a.label.localeCompare(b.label);
          })
      : [];

    const requestedTypeOnly = rawTerm.match(/^([a-z0-9_-]+)$/)?.[1];
    const typeMatchCount = requestedTypeOnly
      ? entityItems.filter((e) => (e.type || '').toLowerCase() === requestedTypeOnly).length
      : 0;
    const topEntities = typeMatchCount > 0
      ? entityItems.filter((e) => (e.type || '').toLowerCase() === requestedTypeOnly)
      : entityItems;

    return [...topEntities, ...edgeItems].slice(0, 8);
  }, [
    showAutocomplete,
    autocompleteKind,
    autocompleteFilter,
    availableEntities,
    availableEdges,
    includeEdges,
    directiveAutocompleteItems,
    effectiveResolver,
  ]);

  useEffect(() => {
    if (!showAutocomplete) return;
    const handleDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setShowAutocomplete(false);
      }
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [showAutocomplete]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = editorRef.current;
      if (!el) return;

      if (isComposingRef.current) return;

      if (showAutocomplete && autocompleteItems.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          lastHandledKeyRef.current = 'ArrowDown';
          setSelectedIndex((i) => (i + 1) % autocompleteItems.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          lastHandledKeyRef.current = 'ArrowUp';
          setSelectedIndex((i) => (i - 1 + autocompleteItems.length) % autocompleteItems.length);
          return;
        }
        if (e.key === 'Tab' || e.key === 'Enter') {
          e.preventDefault();
          lastHandledKeyRef.current = e.key;
          const item = autocompleteItems[selectedIndex];
          if ('token' in item) {
            insertAtCursor(item.token);
          } else {
            insertDirectiveAtCursor(item as DirectiveAutocompleteItem);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          lastHandledKeyRef.current = 'Escape';
          const liveValue = el.value;
          const offset = el.selectionStart ?? 0;
          const bounds = findOpenEntityTriggerBounds(liveValue, offset);
          if (bounds) {
            const next = liveValue.slice(0, bounds.start) + liveValue.slice(bounds.end);
            onChange(next, bounds.start);
            pendingCaretRef.current = bounds.start;
            updateCursor(bounds.start);
          }
          setShowAutocomplete(false);
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        onSubmit?.();
        return;
      }

      // Mark caret-navigation keys so autocomplete does not re-open after moving the cursor.
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Home' ||
        e.key === 'End' ||
        e.key === 'PageUp' ||
        e.key === 'PageDown'
      ) {
        lastHandledKeyRef.current = e.key;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        const offset = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        if (offset === end) {
          const direction = e.key === 'Backspace' ? -1 : 1;
          removeAdjacentToken(direction);
          if (pendingCaretRef.current !== null) {
            e.preventDefault();
          }
        }
      }
    },
    [
      showAutocomplete,
      autocompleteItems,
      selectedIndex,
      value,
      onChange,
      onSubmit,
      insertAtCursor,
      insertDirectiveAtCursor,
      removeAdjacentToken,
    ],
  );

  const syncScroll = useCallback(() => {
    const el = editorRef.current;
    const highlight = highlightRef.current;
    if (!el || !highlight) return;
    highlight.scrollTop = el.scrollTop;
    highlight.scrollLeft = el.scrollLeft;
  }, []);

  return (
    <div ref={wrapperRef} id={id} className={cn('flex flex-col flex-1 min-h-0 relative', className)} style={style}>
      <div className="relative flex-1 min-h-0 w-full">
        {/* Hidden mirror for caret coordinate measurement. */}
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className="absolute top-0 left-0 invisible pointer-events-none whitespace-pre-wrap"
          style={{
            fontFamily: 'inherit',
            fontSize: 'inherit',
            fontWeight: 'inherit',
            lineHeight: 'inherit',
            letterSpacing: 'inherit',
            padding: 0,
            border: 0,
            overflow: 'hidden',
            wordWrap: 'break-word',
            whiteSpace: 'pre-wrap',
          }}
        />

        {/* Colored background layer */}
        <div
          ref={highlightRef}
          aria-hidden="true"
          className="absolute inset-0 px-2 py-1.5 text-xs overflow-hidden pointer-events-none whitespace-pre-wrap select-none"
          dangerouslySetInnerHTML={{ __html: coloredHtml || '<br>' }}
        />

        {/* Placeholder shown behind the transparent textarea */}
        {!disabled && value.trim() === '' && placeholder && (
          <div className="absolute inset-0 px-2 py-1.5 text-xs text-white/40 pointer-events-none overflow-hidden whitespace-pre-wrap select-none">
            {placeholder}
          </div>
        )}

        {/* Transparent textarea for input */}
        <textarea
          ref={editorRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={() => updateAutocompleteState()}
          onClick={() => updateAutocompleteState()}
          onScroll={syncScroll}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            updateAutocompleteState();
          }}
          disabled={disabled}
          spellCheck={false}
          className={cn(
            'absolute inset-0 w-full h-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 resize-none overflow-y-auto whitespace-pre-wrap',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
          style={{ color: 'transparent', caretColor: 'white' }}
          aria-label="Query"
          role="textbox"
          aria-disabled={disabled}
          tabIndex={disabled ? -1 : 0}
        />
      </div>

      {showAutocomplete && autocompleteItems.length > 0 && (
        <div
          className="absolute z-20 rounded border border-white/10 bg-[oklch(0.23_0_0)] shadow-lg max-h-40 overflow-y-auto min-w-[180px]"
          style={{
            top: autocompletePos.top + 18,
            left: autocompletePos.left,
          }}
        >
          {autocompleteItems.map((item, idx) => (
            <button
              key={`${item.kind}:${item.id}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if ('token' in item) {
                  insertAtCursor(item.token);
                } else {
                  insertDirectiveAtCursor(item);
                }
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs ${
                idx === selectedIndex ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/5'
              }`}
            >
              {'icon' in item && item.icon}
              <div className="min-w-0 flex flex-col">
                <span className="truncate">{'render' in item ? item.render : item.label}</span>
                {'sublabel' in item && item.sublabel && (
                  <span className="truncate text-[10px] text-white/40 font-mono">{item.sublabel}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
