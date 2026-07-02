import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Sparkles } from 'lucide-react';
import {
  formatEntityToken,
  formatEdgeToken,
  parseQueryTokens,
  getAutocompleteFilter,
  renderQueryHtml as renderQueryHtmlExported,
  type EntityLike,
  type EdgeLike,
  type QueryToken,
} from './query-tokens';
import { colorForType } from '@/components/research-canvas';
import { type ResearchQueryOptions } from './use-research-session';

export type Server = {
  id: number;
  name: string;
  base_url?: string;
};

export type Bank = {
  bank_id: string;
  name: string;
  description?: string;
};

export interface QueryFormProps {
  query: string;
  setQuery: (q: string) => void;
  cursor: number;
  setCursor: (c: number) => void;
  loading: boolean;
  isRunning?: boolean;
  availableEntities: EntityLike[];
  availableEdges: EdgeLike[];
  onSubmit: (e: React.FormEvent) => void;
  queryMode: 'prebuilt' | 'recall' | 'reflect' | 'synthesize';
  dimensions: string[];
  setDimensions: (d: string[]) => void;
  availableDimensions: Array<{ value: string; label: string }>;
  queryOptions: ResearchQueryOptions;
  setQueryOptions: (opts: ResearchQueryOptions | ((prev: ResearchQueryOptions) => ResearchQueryOptions)) => void;
}

const QUERY_PLACEHOLDERS: Record<QueryFormProps['queryMode'], string> = {
  prebuilt: 'Use entity focused dimensions for faster data retrieval. Type [[ to show list of existing known entities. Double click an entity to add to this query.',
  recall: 'Returns facts for the given query in a table format. Type [[ to show list of existing known entities. Double click an entity or edge to add to this query.',
  reflect: 'Returns a generated narrative for the given query. Type [[ to show list of existing known entities. Double click an entity or edge to add to this query.',
  synthesize: 'Returns a narrative based on existing query steps. Select one or more steps to run the query against. Type [[ to show list of existing known entities. Double click an entity or edge to add to this query.',
};

function tokenLabel(token: QueryToken, entities: EntityLike[], edges: EdgeLike[]): string {
  if (token.kind === 'entity') {
    const entity = entities.find((e) => e.id === token.id);
    return entity?.label || token.label || token.id;
  }
  const parts = token.id.split('|');
  const [source, target, label] = parts;
  const edge = edges.find(
    (e) => e.source === source && e.target === target && (e.label || e.relationship_type || '') === label,
  );
  const s = edge?.source || source;
  const t = edge?.target || target;
  const l = edge?.label || edge?.relationship_type || label || 'edge';
  return `${s} — ${l} → ${t}`;
}

/** Escape text so it can be safely injected into the contenteditable innerHTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/** Render the query string as inline HTML: styled chips for tokens, escaped text otherwise. */
function renderQueryHtml(
  query: string,
  entities: EntityLike[],
  edges: EdgeLike[],
): string {
  return renderQueryHtmlExported(query, entities, edges);
}

/** Serialize a contenteditable element back to a plain text string, preserving [[...]] tokens. */
function serializeEditable(el: HTMLElement): string {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const raw = element.getAttribute('data-token-raw');
      if (raw) {
        text += decodeURIComponent(raw);
      } else if (element.tagName === 'BR') {
        text += '\n';
      } else if (element.tagName === 'DIV') {
        // Chrome inserts <div> on line breaks inside contenteditable.
        text += '\n' + serializeEditable(element);
      } else {
        text += element.textContent || '';
      }
    }
  }
  return text;
}

/** Sum text/token lengths from the start of the container up to (but not including) the target node. */
function getTextLengthBeforeNode(container: Node, target: Node): number {
  let length = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT, null);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === target) return length;
    if (node.nodeType === Node.TEXT_NODE) {
      length += node.textContent?.length || 0;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const raw = el.getAttribute('data-token-raw');
      if (raw) {
        length += decodeURIComponent(raw).length;
      } else if (el.tagName === 'BR') {
        length += 1;
      } else {
        length += el.textContent?.length || 0;
      }
    }
  }
  return length;
}

/** Get the caret offset in the underlying query string (raw token lengths, not visible text). */
function getCaretOffset(el: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;

  // If the caret is inside a token chip, report the position at the token boundary based on direction.
  let container: Node | null = range.startContainer;
  while (container && container !== el) {
    if (container.nodeType === Node.ELEMENT_NODE) {
      const tokenRaw = (container as HTMLElement).getAttribute('data-token-raw');
      if (tokenRaw) {
        const beforeToken = getTextLengthBeforeNode(el, container);
        const tokenLength = decodeURIComponent(tokenRaw).length;
        return beforeToken + (range.startOffset === 0 ? 0 : tokenLength);
      }
    }
    container = container.parentNode;
  }

  // Caret is in a text node. Walk the tree up to the caret node.
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT, null);
  let node: Node | null;
  let length = 0;
  while ((node = walker.nextNode())) {
    if (node === range.startContainer) {
      return length + Math.min(range.startOffset, node.textContent?.length || 0);
    }
    if (node.nodeType === Node.TEXT_NODE) {
      length += node.textContent?.length || 0;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const raw = element.getAttribute('data-token-raw');
      if (raw) {
        length += decodeURIComponent(raw).length;
      } else if (element.tagName === 'BR') {
        length += 1;
      } else {
        length += element.textContent?.length || 0;
      }
    }
  }

  return length;
}

/** Place the caret at the given query-string offset inside the editor. */
function setCaretOffset(el: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;
  let remaining = offset;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT, null);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    let length = 0;
    if (node.nodeType === Node.TEXT_NODE) {
      length = node.textContent?.length || 0;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elNode = node as HTMLElement;
      const raw = elNode.getAttribute('data-token-raw');
      if (raw) {
        length = decodeURIComponent(raw).length;
      } else if (elNode.tagName === 'BR') {
        length = 1;
      } else {
        length = elNode.textContent?.length || 0;
      }
    }

    if (remaining <= length) {
      const range = document.createRange();
      if (node.nodeType === Node.TEXT_NODE) {
        range.setStart(node, Math.max(0, Math.min(remaining, node.textContent?.length || 0)));
      } else if ((node as HTMLElement).getAttribute('data-token-raw')) {
        // For token chips, place the caret before or after the chip element, never inside.
        if (remaining === 0) {
          range.setStartBefore(node);
        } else {
          range.setStartAfter(node);
        }
      } else {
        range.setStart(node, 0);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
  }

  // Place at the end if offset exceeded.
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Focus the editor and place the caret at the given offset atomically. */
function restoreCaret(el: HTMLElement, offset: number): void {
  el.focus({ preventScroll: true });
  setCaretOffset(el, Math.min(offset, serializeEditable(el).length));
}

/** Compute the pixel position of the caret inside the editor by placing a
 *  temporary marker at the current selection. This mirrors the rendered layout
 *  (including chip widths) instead of reconstructing text in a hidden div. */
function getCaretCoordinates(el: HTMLElement): { top: number; left: number } {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return { top: 0, left: 0 };

  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);

  const marker = document.createElement('span');
  marker.style.position = 'absolute';
  marker.style.visibility = 'hidden';
  marker.style.pointerEvents = 'none';
  marker.textContent = '\u200b';
  range.insertNode(marker);

  const editorRect = el.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  marker.parentNode?.removeChild(marker);

  return {
    top: markerRect.top - editorRect.top + el.scrollTop,
    left: markerRect.left - editorRect.left + el.scrollLeft,
  };
}

export function QueryForm(props: QueryFormProps) {
  const {
    query,
    setQuery,
    cursor,
    setCursor,
    loading,
    isRunning,
    availableEntities,
    availableEdges,
    onSubmit,
    queryMode,
    dimensions,
    setDimensions,
    availableDimensions,
    queryOptions,
    setQueryOptions,
  } = props;

  const editorRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [autocompleteKind, setAutocompleteKind] = useState<'entity'>('entity');
  const [autocompletePos, setAutocompletePos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const lastHandledKeyRef = useRef<string | null>(null);
  const lastHtmlRef = useRef<string | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);


  const tokens = useMemo(() => parseQueryTokens(query), [query]);
  const entityMap = useMemo(() => {
    const map = new Map<string, EntityLike>();
    for (const e of availableEntities) {
      map.set(e.id, e);
    }
    return map;
  }, [availableEntities]);

  const updateAutocompleteState = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;

    const lastKey = lastHandledKeyRef.current;
    lastHandledKeyRef.current = null;
    if (
      lastKey === 'ArrowUp' ||
      lastKey === 'ArrowDown' ||
      lastKey === 'Escape' ||
      lastKey === 'Enter' ||
      lastKey === 'Tab'
    ) {
      return;
    }

    const offset = getCaretOffset(el);
    if (offset < 0) return;
    setCursor(offset);
    const liveText = serializeEditable(el);
    const filterResult = getAutocompleteFilter(liveText, offset);
    if (filterResult != null) {
      setShowAutocomplete(true);
      setAutocompleteFilter(filterResult.filter);
      setAutocompletePos(getCaretCoordinates(el));
      setSelectedIndex(0);
    } else {
      setShowAutocomplete(false);
    }
  }, [setCursor]);

  const insertAtCursor = useCallback(
    (rawToken: string) => {
      if (isRunning) return;
      const el = editorRef.current;
      if (!el) return;

      const offset = getCaretOffset(el);
      const textBefore = query.slice(0, offset);
      const openIdx = textBefore.lastIndexOf('[[');
      const before = openIdx >= 0 ? query.slice(0, openIdx) : query.slice(0, offset);
      const after = query.slice(offset);
      const next = before + rawToken + after;
      const pos = before.length + rawToken.length;
      setQuery(next);
      setCursor(pos);
      setShowAutocomplete(false);
      pendingCaretRef.current = pos;
    },
    [query, setQuery, setCursor, isRunning],
  );

  const allTokenRaws = useMemo(() => {
    return parseQueryTokens(query).map((t: { raw: string }) => t.raw);
  }, [query]);

  const removeToken = useCallback(
    (raw: string) => {
      const idx = query.indexOf(raw);
      if (idx === -1) return;
      const next = query.slice(0, idx) + query.slice(idx + raw.length);
      const cleaned = next.replace(/\s+/g, ' ').trim();
      const newPos = Math.min(idx, cleaned.length);
      setQuery(cleaned);
      setCursor(newPos);
      pendingCaretRef.current = newPos;
    },
    [query, setQuery, setCursor],
  );

  // Keep the editor HTML in sync with the external query state. During typing
  // handleInput updates lastHtmlRef so the DOM is not rewritten on every keystroke,
  // which is what causes the caret to jump.
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = renderQueryHtml(query, availableEntities, availableEdges);
    if (html === lastHtmlRef.current) return;

    const active = document.activeElement === el;
    const shouldRestoreCaret = pendingCaretRef.current !== null;
    const offset = pendingCaretRef.current ?? (active ? getCaretOffset(el) : Math.min(cursor, query.length));
    pendingCaretRef.current = null;

    el.innerHTML = html;
    lastHtmlRef.current = html;

    if (shouldRestoreCaret) {
      restoreCaret(el, Math.min(offset, query.length));
    } else if (active) {
      setCaretOffset(el, Math.min(offset, query.length));
    }
  }, [query, availableEntities, availableEdges]);

  // Sync cursor position to parent when the user clicks or keys around.
  const syncCursor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const offset = getCaretOffset(el);
    setCursor(offset);
  }, [setCursor]);

  const handleInput = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = serializeEditable(el);
    const offset = getCaretOffset(el);
    if (next !== query) {
      setQuery(next);
      setCursor(offset);
      // Mark the DOM as already representing the new query so the sync effect
      // does not clobber the selection by rewriting innerHTML.
      lastHtmlRef.current = renderQueryHtml(next, availableEntities, availableEdges);
    }
    // Re-evaluate autocomplete on every input change, not just keyup, so typing
    // '[[' after a chip opens the popup immediately.
    updateAutocompleteState();
  }, [query, setQuery, setCursor, availableEntities, availableEdges, updateAutocompleteState]);

  const autocompleteItems = useMemo(() => {
    if (!showAutocomplete) return [];
    const rawTerm = autocompleteFilter.toLowerCase().trim();
    const entityLabelMap = new Map(availableEntities.map((e) => [e.id, e.label || e.id]));

    // Split the user's filter into tokens so spaces/dashes don't break matching.
    // e.g. "bill db" matches items containing words starting with both "bill" and "db".
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
        // Support "type:foo" style filtering by entity type.
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
      .map((e) => ({
        kind: 'entity' as const,
        id: e.id,
        label: e.label || e.id,
        type: e.type,
        render: e.label || e.id,
        sublabel: e.type ? `${e.type}:${e.id}` : e.id,
        token: formatEntityToken(e.label || e.id, e.id, e.type),
        icon: (
          <span
            className="w-3 h-3 shrink-0"
            style={{ borderLeftColor: colorForType(e.type || undefined), borderLeftWidth: 3, backgroundColor: 'transparent' }}
          />
        ),
      }))
      .sort((a, b) => {
        const tokens = termTokens(rawTerm);
        const firstToken = tokens[0] || rawTerm;
        const aLabel = a.label.toLowerCase();
        const bLabel = b.label.toLowerCase();
        const aType = (a.type || '').toLowerCase();
        const bType = (b.type || '').toLowerCase();
        const aId = a.id.toLowerCase();
        const bId = b.id.toLowerCase();
        const score = (label: string, type: string, id: string) => {
          if (label.startsWith(firstToken)) return 4;
          if (tokens.length > 1 && tokens.every((t) => label.includes(t))) return 3;
          if (type.startsWith(firstToken)) return 2;
          if (id.startsWith(firstToken)) return 1;
          return 0;
        };
        const aScore = score(aLabel, aType, aId);
        const bScore = score(bLabel, bType, bId);
        if (bScore !== aScore) return bScore - aScore;
        return a.label.localeCompare(b.label);
      });

    const edgeItems = availableEdges
      .filter((e) => {
        if (!rawTerm) return true;
        const sourceLabel = entityLabelMap.get(e.source) || e.source;
        const targetLabel = entityLabelMap.get(e.target) || e.target;
        const rel = e.label || e.relationship_type || '';
        const hay = `${sourceLabel} ${e.source} ${targetLabel} ${e.target} ${rel}`.toLowerCase();
        return matchesTokens(hay, rawTerm);
      })
      .map((e) => {
        const l = e.label || e.relationship_type || 'edge';
        const sourceLabel = entityLabelMap.get(e.source) || e.source;
        const targetLabel = entityLabelMap.get(e.target) || e.target;
        return {
          kind: 'edge' as const,
          id: `${e.source}|${e.target}|${l}`,
          label: l,
          render: `${sourceLabel} — ${l} → ${targetLabel}`,
          sublabel: `${e.source} → ${e.target}`,
          token: formatEdgeToken(e.source, e.target, l),
          icon: <span className="w-3 h-3 shrink-0" style={{ borderLeftColor: colorForType(l), borderLeftWidth: 3, backgroundColor: 'transparent' }} />,
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
      });

    // If the user types something that clearly looks like a type prefix (e.g. "a-com"),
    // prefer showing all matching entities of that type first.
    const requestedTypeOnly = rawTerm.match(/^([a-z0-9_-]+)$/)?.[1];
    const typeMatchCount = requestedTypeOnly
      ? entityItems.filter((e) => (e.type || '').toLowerCase() === requestedTypeOnly).length
      : 0;
    const topEntities = typeMatchCount > 0
      ? entityItems.filter((e) => (e.type || '').toLowerCase() === requestedTypeOnly)
      : entityItems;

    return [...topEntities, ...(queryMode === 'prebuilt' ? [] : edgeItems)].slice(0, 8);
  }, [showAutocomplete, autocompleteFilter, availableEntities, availableEdges, queryMode]);

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

  // Paste plain text only.
  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = editorRef.current;
      if (!el) return;

      // Let composition events (IME) finish before acting.
      if (isComposingRef.current) return;

      // Autocomplete shortcuts take precedence over the plain Enter/newline guard.
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
          insertAtCursor(item.token);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          lastHandledKeyRef.current = 'Escape';
          const offset = getCaretOffset(el);
          const textBefore = query.slice(0, offset);
          const openIdx = textBefore.lastIndexOf('[[');
          if (openIdx >= 0) {
            const next = query.slice(0, openIdx) + query.slice(offset);
            setQuery(next);
            setCursor(openIdx);
            pendingCaretRef.current = openIdx;
          }
          setShowAutocomplete(false);
          return;
        }
      }

      // Plain Enter inside the editor should not create a newline; the wrapping form
      // onSubmit runs the query.
      if (e.key === 'Enter') {
        e.preventDefault();
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (range.collapsed) {
            const direction = e.key === 'Backspace' ? -1 : 1;
            // Detect if the caret is immediately adjacent to a token chip and delete the whole token.
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
      query,
      insertAtCursor,
      removeToken,
    ],
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col h-full p-2 gap-2 overflow-hidden">
      <div className="flex flex-1 min-h-0 gap-2">
        <div ref={wrapperRef} className="flex flex-col flex-1 min-h-0 relative">
          <div
            ref={editorRef}
            contentEditable={!isRunning}
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
            className={`flex-1 min-h-0 w-full bg-black/20 border border-white/10 rounded px-2 py-1.5 text-xs text-white overflow-y-auto outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 whitespace-pre-wrap ${
              isRunning ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            style={{ minHeight: '3rem' }}
            aria-label="Query"
            role="textbox"
            aria-disabled={isRunning}
            tabIndex={isRunning ? -1 : 0}
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
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertAtCursor(item.token)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs ${
                    idx === selectedIndex ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/5'
                  }`}
                >
                {item.icon}
                <div className="min-w-0 flex flex-col">
                  <span className="truncate">{item.render}</span>
                  {'sublabel' in item && item.sublabel && (
                    <span className="truncate text-[10px] text-white/40 font-mono">{item.sublabel}</span>
                  )}
                </div>
                </button>
              ))}
            </div>
          )}

          {!isRunning && query.trim() === '' && (
            <div className="absolute inset-0 px-2 py-1.5 text-xs text-white/40 pointer-events-none overflow-hidden">
              {QUERY_PLACEHOLDERS[queryMode]}
            </div>
          )}
        </div>

        {queryMode === 'prebuilt' && availableDimensions.length > 0 && (
          <div className={`w-36 shrink-0 flex flex-col min-h-0 border-l border-white/10 pl-2 ${isRunning ? 'opacity-50' : ''}`}>
            <div className="text-[10px] text-white/70 font-medium mb-1">Dimensions</div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
              {availableDimensions.map(({ value, label }) => {
                const selected = dimensions.includes(value);
                return (
                  <label
                    key={value}
                    className={`flex items-center gap-2 text-[10px] text-white/80 ${isRunning ? 'cursor-not-allowed' : 'hover:text-white cursor-pointer'}`}
                  >
                    <Checkbox
                      disabled={isRunning}
                      checked={selected}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setDimensions([...dimensions, value]);
                        } else {
                          setDimensions(dimensions.filter((x) => x !== value));
                        }
                      }}
                    />
                    <span>{label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {(queryMode === 'recall' || queryMode === 'reflect' || queryMode === 'synthesize') && (
          <div className={`w-36 shrink-0 flex flex-col min-h-0 border-l border-white/10 pl-2 ${isRunning ? 'opacity-50' : ''}`}>
            <div className="text-[10px] text-white/70 font-medium mb-1">Options</div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {queryMode === 'recall' && (
                <RecallOptions options={queryOptions.recall} onChange={(recall) => setQueryOptions((prev) => ({ ...prev, recall }))} disabled={isRunning} />
              )}
              {queryMode === 'reflect' && (
                <ReflectOptions options={queryOptions.reflect} onChange={(reflect) => setQueryOptions((prev) => ({ ...prev, reflect }))} disabled={isRunning} />
              )}
              {queryMode === 'synthesize' && (
                <SynthesizeOptions options={queryOptions.synthesize} onChange={(synthesize) => setQueryOptions((prev) => ({ ...prev, synthesize }))} disabled={isRunning} />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 shrink-0">
        <Button
          type="submit"
          disabled={isRunning || loading || !query.trim()}
          className="flex-1"
          size="sm"
        >
          {isRunning ? 'Running…' : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              {queryMode === 'synthesize' ? 'Synthesize' : 'Run Query'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

/** Find a token chip adjacent to the current collapsed caret position.
 *  direction: -1 for backspace (left), +1 for delete (right). */
function findAdjacentToken(
  el: HTMLElement,
  range: Range,
  direction: -1 | 1,
): { raw: string; position: number } | null {
  let node: Node | null = range.startContainer;
  let offset = range.startOffset;

  // Walk up to find if the caret is inside a chip.
  let chip: HTMLElement | null = null;
  while (node && node !== el) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const raw = (node as HTMLElement).getAttribute('data-token-raw');
      if (raw) {
        chip = node as HTMLElement;
        break;
      }
    }
    node = node.parentNode;
  }

  if (chip) {
    const raw = decodeURIComponent(chip.getAttribute('data-token-raw') || '');
    const position = getTextLengthBeforeNode(el, chip) + (direction === 1 ? 0 : raw.length);
    return { raw, position };
  }

  // Caret is in a text node. Look at the sibling in the deletion direction.
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text;
    if (direction === -1 && offset === 0) {
      const prev = textNode.previousSibling;
      if (prev && prev.nodeType === Node.ELEMENT_NODE) {
        const raw = (prev as HTMLElement).getAttribute('data-token-raw');
        if (raw) {
          const decoded = decodeURIComponent(raw);
          return { raw: decoded, position: getTextLengthBeforeNode(el, prev) + decoded.length };
        }
      }
    } else if (direction === 1 && offset >= (textNode.textContent?.length || 0)) {
      const next = textNode.nextSibling;
      if (next && next.nodeType === Node.ELEMENT_NODE) {
        const raw = (next as HTMLElement).getAttribute('data-token-raw');
        if (raw) {
          return { raw: decodeURIComponent(raw), position: getTextLengthBeforeNode(el, next) };
        }
      }
    }
  }

  return null;
}

const FACT_TYPES = ['world', 'experience', 'observation'];
const BUDGET_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
] as const;

type Budget = 'low' | 'mid' | 'high';

function BudgetSelect({
  value,
  onChange,
  disabled,
}: {
  value?: Budget;
  onChange: (value: Budget) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/60">Budget</span>
      <select
        disabled={disabled}
        value={value || 'mid'}
        onChange={(e) => onChange(e.target.value as Budget)}
        className="bg-black/20 border border-white/10 rounded text-[10px] text-white px-1.5 py-1 outline-none focus:border-emerald-500 disabled:opacity-50"
      >
        {BUDGET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MaxTokensInput({
  value,
  onChange,
  disabled,
}: {
  value?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/60">Max tokens</span>
      <input
        type="number"
        min={1}
        max={128000}
        step={1}
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          onChange(Number.isNaN(parsed) ? 0 : parsed);
        }}
        className="bg-black/20 border border-white/10 rounded text-[10px] text-white px-1.5 py-1 outline-none focus:border-emerald-500 disabled:opacity-50"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-1.5 text-[10px] text-white/80 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <Switch disabled={disabled} checked={!!checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function RecallOptions({
  options,
  onChange,
  disabled,
}: {
  options?: ResearchQueryOptions['recall'];
  onChange: (options: ResearchQueryOptions['recall']) => void;
  disabled?: boolean;
}) {
  const opts = options || {};
  const types = opts.types || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-white/60">Fact types</span>
        <div className="space-y-1">
          {FACT_TYPES.map((t) => (
            <label key={t} className={`flex items-center gap-1.5 text-[10px] text-white/80 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
              <Checkbox
                disabled={disabled}
                checked={types.includes(t)}
                onCheckedChange={(checked) => {
                  const next = checked ? [...types, t] : types.filter((x) => x !== t);
                  onChange({ ...opts, types: next });
                }}
              />
              <span className="capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>
      <BudgetSelect value={opts.budget} onChange={(budget) => onChange({ ...opts, budget })} disabled={disabled} />
      <MaxTokensInput value={opts.maxTokens} onChange={(maxTokens) => onChange({ ...opts, maxTokens })} disabled={disabled} />
      <Toggle label="Include source facts" checked={opts.includeSourceFacts} onChange={(checked) => onChange({ ...opts, includeSourceFacts: checked })} disabled={disabled} />
      <Toggle label="Prefer observations" checked={opts.preferObservations} onChange={(checked) => onChange({ ...opts, preferObservations: checked })} disabled={disabled} />
    </div>
  );
}

function ReflectOptions({
  options,
  onChange,
  disabled,
}: {
  options?: ResearchQueryOptions['reflect'];
  onChange: (options: ResearchQueryOptions['reflect']) => void;
  disabled?: boolean;
}) {
  const opts = options || {};
  const factTypes = opts.factTypes || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-white/60">Fact types</span>
        <div className="space-y-1">
          {FACT_TYPES.map((t) => (
            <label key={t} className={`flex items-center gap-1.5 text-[10px] text-white/80 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
              <Checkbox
                disabled={disabled}
                checked={factTypes.includes(t)}
                onCheckedChange={(checked) => {
                  const next = checked ? [...factTypes, t] : factTypes.filter((x) => x !== t);
                  onChange({ ...opts, factTypes: next });
                }}
              />
              <span className="capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>
      <BudgetSelect value={opts.budget} onChange={(budget) => onChange({ ...opts, budget })} disabled={disabled} />
      <MaxTokensInput value={opts.maxTokens} onChange={(maxTokens) => onChange({ ...opts, maxTokens })} disabled={disabled} />
      <Toggle label="Include source facts" checked={opts.includeSourceFacts} onChange={(checked) => onChange({ ...opts, includeSourceFacts: checked })} disabled={disabled} />
      <Toggle label="Exclude mental models" checked={opts.excludeMentalModels} onChange={(checked) => onChange({ ...opts, excludeMentalModels: checked })} disabled={disabled} />
    </div>
  );
}

function SynthesizeOptions({
  options,
  onChange,
  disabled,
}: {
  options?: ResearchQueryOptions['synthesize'];
  onChange: (options: ResearchQueryOptions['synthesize']) => void;
  disabled?: boolean;
}) {
  const opts = options || {};
  return (
    <div className="space-y-2">
      <MaxTokensInput value={opts.maxTokens} onChange={(maxTokens) => onChange({ ...opts, maxTokens })} disabled={disabled} />
    </div>
  );
}
