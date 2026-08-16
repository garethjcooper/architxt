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
  type Reference as AqlReference,
} from '@architxt/aql';
import {
  renderAqlToHtml,
  serializeEditable,
  getCaretOffset,
  setCaretOffset,
  restoreCaret,
  getCaretCoordinates,
  findAdjacentToken,
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

function tokenLabel(reference: AqlReference, entities: EntityLike[], edges: EdgeLike[]): string {
  if (reference.kind === 'entity') {
    const entity = entities.find((e) => e.id === reference.id);
    return entity?.label || reference.label || reference.id || reference.raw;
  }
  const from = reference.from || '';
  const to = reference.to || '';
  const edgeLabel = reference.edgeLabel || 'edge';
  const edge = edges.find(
    (e) => e.from === from && e.to === to && (e.label || e.type || '') === edgeLabel,
  );
  const s = edge?.from || from;
  const t = edge?.to || to;
  const l = edge?.label || edge?.type || edgeLabel || 'edge';
  return `${s} — ${l} → ${t}`;
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

function findOpenEntityTrigger(query: string, offset: number): string | null {
  const refs = parseReferences(query);
  let cursor = 0;
  let plainBefore = '';
  for (const ref of refs) {
    const idx = query.indexOf(ref.raw);
    if (idx >= offset) break;
    if (cursor < idx) {
      const slice = query.slice(cursor, Math.min(idx, offset));
      plainBefore += slice;
      cursor += slice.length;
      if (cursor >= offset) break;
    }
    cursor += ref.raw.length;
  }
  if (cursor < offset) {
    plainBefore += query.slice(cursor, offset);
  }
  const entityMatch = plainBefore.match(/\[\[([^\]]*)$/);
  return entityMatch ? entityMatch[1] : null;
}

/**
 * Reusable AQL query input.
 *
 * Renders directives and entity/edge references as colored chips using the same
 * tokenization as AqlView, while remaining fully editable. Supports autocomplete
 * for `[[` references and `#` directives.
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
  const editorRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [autocompleteKind, setAutocompleteKind] = useState<'entity' | 'directive'>('entity');
  const [autocompletePos, setAutocompletePos] = useState({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const lastHandledKeyRef = useRef<string | null>(null);
  const lastHtmlRef = useRef<string | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);

  const entityMap = useMemo(() => {
    const map = new Map<string, EntityLike>();
    for (const e of availableEntities) map.set(e.id, e);
    return map;
  }, [availableEntities]);

  const effectiveResolver = useMemo(() => {
    return resolveReference || defaultReferenceResolver(availableEntities, availableEdges);
  }, [resolveReference, availableEntities, availableEdges]);

  const updateAutocompleteState = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    const lastKey = lastHandledKeyRef.current;
    lastHandledKeyRef.current = null;
    if (lastKey === 'ArrowUp' || lastKey === 'ArrowDown' || lastKey === 'Escape' || lastKey === 'Enter' || lastKey === 'Tab') {
      return;
    }

    const offset = getCaretOffset(el);
    if (offset < 0) return;
    onChange(value, offset);
    const liveText = serializeEditable(el);

    const entityFilter = findOpenEntityTrigger(liveText, offset);
    if (entityFilter != null) {
      setShowAutocomplete(true);
      setAutocompleteKind('entity');
      setAutocompleteFilter(entityFilter);
      setAutocompletePos(getCaretCoordinates(el));
      setSelectedIndex(0);
      return;
    }

    const directiveTrigger = findDirectiveTrigger(liveText, offset);
    if (directiveTrigger != null) {
      setShowAutocomplete(true);
      setAutocompleteKind('directive');
      setAutocompleteFilter(directiveTrigger.filter);
      setAutocompletePos(getCaretCoordinates(el));
      setSelectedIndex(0);
      return;
    }

    setShowAutocomplete(false);
  }, [value, onChange]);

  const insertAtCursor = useCallback(
    (rawToken: string) => {
      if (disabled) return;
      const el = editorRef.current;
      if (!el) return;

      const offset = getCaretOffset(el);
      const textBefore = value.slice(0, offset);
      const openIdx = textBefore.lastIndexOf('[[');
      const before = openIdx >= 0 ? value.slice(0, openIdx) : value.slice(0, offset);
      const after = value.slice(offset);
      const next = before + rawToken + after;
      const pos = before.length + rawToken.length;
      onChange(next, pos);
      pendingCaretRef.current = pos;
      setShowAutocomplete(false);
    },
    [value, onChange, disabled],
  );

  const insertDirectiveAtCursor = useCallback(
    (item: DirectiveAutocompleteItem) => {
      if (disabled) return;
      const el = editorRef.current;
      if (!el) return;

      const offset = getCaretOffset(el);
      const trigger = findDirectiveTrigger(value, offset);
      if (!trigger) return;

      const before = value.slice(0, trigger.replaceStart);
      const after = value.slice(trigger.replaceEnd);
      const insert = item.insert;
      const next = before + insert + after;
      const pos = before.length + item.cursorOffset;
      onChange(next, pos);
      pendingCaretRef.current = pos;
      setShowAutocomplete(false);
    },
    [value, onChange, disabled],
  );

  const removeToken = useCallback(
    (raw: string) => {
      const idx = value.indexOf(raw);
      if (idx === -1) return;
      const next = value.slice(0, idx) + value.slice(idx + raw.length);
      const cleaned = raw.trimStart().startsWith('#')
        ? next.replace(/[ \t]+/g, ' ')
        : next.replace(/\s+/g, ' ').trim();
      const newPos = Math.min(idx, cleaned.length);
      onChange(cleaned, newPos);
      pendingCaretRef.current = newPos;
    },
    [value, onChange],
  );

  // Keep the editor HTML in sync with the external value. During typing
  // handleInput updates lastHtmlRef so the DOM is not rewritten on every keystroke,
  // which is what causes the caret to jump.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = renderAqlToHtml(value, effectiveResolver);
    if (html === lastHtmlRef.current) return;

    const active = document.activeElement === el;
    const shouldRestoreCaret = pendingCaretRef.current !== null;
    const offset = pendingCaretRef.current ?? (active ? getCaretOffset(el) : Math.min(0, value.length));
    pendingCaretRef.current = null;

    el.innerHTML = html;
    lastHtmlRef.current = html;

    if (shouldRestoreCaret) {
      restoreCaret(el, Math.min(offset, value.length));
    } else if (active) {
      setCaretOffset(el, Math.min(offset, value.length));
    }
  }, [value, effectiveResolver]);

  const syncCursor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const offset = getCaretOffset(el);
    onChange(value, offset);
  }, [value, onChange]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = serializeEditable(el);
    const offset = getCaretOffset(el);
    if (next !== value) {
      onChange(next, offset);
      lastHtmlRef.current = renderAqlToHtml(next, effectiveResolver);
    } else {
      onChange(value, offset);
    }
    updateAutocompleteState();
  }, [value, onChange, effectiveResolver, updateAutocompleteState]);

  const directiveAutocompleteItems = useMemo(() => {
    if (!showAutocomplete || autocompleteKind !== 'directive') return [];
    const trigger = findDirectiveTrigger(value, 0);
    if (!trigger) return [];
    return getDirectiveAutocompleteItems(value, 0, trigger.filter, trigger.isTypeLine);
  }, [showAutocomplete, autocompleteKind, value]);

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
                borderLeftColor: effectiveResolver({ kind: 'entity', id: e.id, raw: e.id, label: e.label || e.id, type: e.type })?.color || '#64748b',
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
                    borderLeftColor: effectiveResolver({ kind: 'edge', from: e.from, to: e.to, raw: formatEdgeToken(e.from, e.to, l), edgeLabel: l })?.color || '#64748b',
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
            const aScore = aRel.startsWith(firstToken) ? 2 : tokens.length > 1 && tokens.every((t) => aRel.includes(t)) ? 1 : 0;
            const bScore = bRel.startsWith(firstToken) ? 2 : tokens.length > 1 && tokens.every((t) => bRel.includes(t)) ? 1 : 0;
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
  }, [showAutocomplete, autocompleteKind, autocompleteFilter, availableEntities, availableEdges, includeEdges, directiveAutocompleteItems, effectiveResolver]);

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

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
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
          const offset = getCaretOffset(el);
          const textBefore = value.slice(0, offset);
          const openIdx = textBefore.lastIndexOf('[[');
          if (openIdx >= 0) {
            const next = value.slice(0, openIdx) + value.slice(offset);
            onChange(next, openIdx);
            pendingCaretRef.current = openIdx;
          }
          setShowAutocomplete(false);
          return;
        }
      }

      if (e.key === '#') {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (range.collapsed) {
            const node = range.startContainer;
            const text = node.textContent || '';
            const offsetInNode = range.startOffset;
            const textBefore = text.slice(0, offsetInNode);
            if (textBefore.trim() === '') {
              e.preventDefault();
              document.execCommand('insertText', false, '#');
              return;
            }
          }
        }
      }

      if (e.key === 'Enter') {
        if (e.ctrlKey || e.metaKey) {
          onSubmit?.();
          return;
        }
        e.preventDefault();
        document.execCommand('insertLineBreak');
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (range.collapsed) {
            const direction = e.key === 'Backspace' ? -1 : 1;
            const adjacent = findAdjacentToken(el, range, direction);
            if (adjacent) {
              e.preventDefault();
              removeToken(adjacent.raw);
              return;
            }
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
      removeToken,
    ],
  );

  return (
    <div ref={wrapperRef} id={id} className="flex flex-col flex-1 min-h-0 relative" aria-labelledby={id ? undefined : undefined}>
      <div
        ref={editorRef}
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={syncCursor}
        onKeyUp={updateAutocompleteState}
        onPaste={handlePaste}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={() => {
          isComposingRef.current = false;
          handleInput();
          updateAutocompleteState();
        }}
        className={cn(
          'flex-1 min-h-0 w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-white overflow-y-auto outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 whitespace-pre-wrap',
          disabled && 'opacity-50 cursor-not-allowed',
          className,
        )}
        style={style}
        aria-label="Query"
        role="textbox"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
      />

      {showAutocomplete && autocompleteItems.length > 0 && (
        <div
          className="absolute z-20 rounded border border-white/10 bg-[oklch(0.23_0_0)] shadow-lg max-h-40 overflow-y-auto min-w-[180px]"
          style={{
            top: Math.min(autocompletePos.top + 18, (editorRef.current?.clientHeight || 200) - 8),
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

      {!disabled && value.trim() === '' && placeholder && (
        <div className="absolute inset-0 px-2 py-1.5 text-xs text-white/40 pointer-events-none overflow-hidden">
          {placeholder}
        </div>
      )}
    </div>
  );
}
