'use client';

import React from 'react';
import {
  renderAqlTokens,
  parseReferences,
  type Reference,
} from '@architxt/aql';

const BLOCK_COLORS: Record<string, string> = {
  diagram: '#a855f7',
  table: '#06b6d4',
  graph: '#f97316',
  narrative: '#22c55e',
};

const SUB_COLORS: Record<string, string> = {
  name: '#3b82f6',
  type: '#eab308',
  end: '#ef4444',
};

export function directiveColor(keyword: string): string {
  return BLOCK_COLORS[keyword] || SUB_COLORS[keyword] || '#9ca3af';
}

export interface AqlReferenceResolver {
  (ref: Reference): { label: string; color?: string } | null;
}

export interface AqlToken {
  kind: 'text' | 'directive' | 'reference';
  text?: string;
  keyword?: string;
  value?: string;
  reference?: Reference & { index: number };
  /** For #end tokens, the keyword of the matching block opener. */
  matchingKeyword?: string;
  /** Absolute character index in the raw AQL string. */
  index?: number;
}

function ReferenceToken({
  reference,
  resolver,
}: {
  reference: Reference;
  resolver?: AqlReferenceResolver;
}) {
  const resolved = resolver?.(reference) || { label: reference.label || reference.raw };
  const color = resolved.color || '#fbbf24';
  const label = resolved.label || reference.label || reference.id || reference.raw;
  const id = reference.id || reference.raw;
  const display = id && id !== label ? `[[${label} (${id})]]` : `[[${label}]]`;

  return (
    <span
      className="aql-token aql-reference whitespace-pre-wrap"
      style={{ color }}
      data-token-raw={reference.raw}
      title={reference.raw}
    >
      {display}
    </span>
  );
}

function DirectiveToken({
  keyword,
  value,
  matchingKeyword,
  resolver,
}: {
  keyword: string;
  value?: string;
  matchingKeyword?: string;
  resolver?: AqlReferenceResolver;
}) {
  let color = directiveColor(matchingKeyword || keyword);
  if (keyword === 'name' && value) {
    const refs = parseReferences(value);
    if (refs.length > 0) {
      const resolved = resolver?.(refs[0]);
      if (resolved?.color) color = resolved.color;
    }
  }
  const raw = value ? `#${keyword} ${value}` : `#${keyword}`;
  return (
    <span
      className="aql-token aql-directive whitespace-pre-wrap"
      style={{ color }}
      data-token-raw={raw}
      title={raw}
    >
      #{keyword}
      {value ? <span style={{ color: '#e5e7eb', fontWeight: 500 }}> {value}</span> : null}
    </span>
  );
}

function splitTextByReferences(
  text: string,
  refs: Array<Reference & { index: number }>,
  textOffsetInQuery: number,
): AqlToken[] {
  const inside = refs
    .map((r) => ({ ref: r, idx: r.index }))
    .filter((item) => item.idx >= textOffsetInQuery && item.idx < textOffsetInQuery + text.length);
  inside.sort((a, b) => a.idx - b.idx);

  const out: AqlToken[] = [];
  let cursor = 0;
  for (const { ref, idx } of inside) {
    const localStart = idx - textOffsetInQuery;
    const localEnd = localStart + ref.raw.length;
    if (localStart > cursor) {
      out.push({ kind: 'text', text: text.slice(cursor, localStart) });
    }
    out.push({ kind: 'reference', reference: ref, index: idx });
    cursor = Math.max(cursor, localEnd);
  }
  if (cursor < text.length) {
    out.push({ kind: 'text', text: text.slice(cursor) });
  }
  return out;
}

/**
 * Tokenize an AQL query into a flat list of display tokens.
 * References are located by absolute index so duplicate occurrences remain distinct.
 */
export function tokenizeAql(query: string): AqlToken[] {
  const rendered = renderAqlTokens(query);

  // Compute reference indices correctly, handling duplicate occurrences.
  const refOccurrences = new Map<string, number>();
  const refs: Array<Reference & { index: number }> = [];
  for (const r of parseReferences(query)) {
    const start = refOccurrences.get(r.raw) ?? 0;
    const idx = query.indexOf(r.raw, start);
    refOccurrences.set(r.raw, idx + r.raw.length);
    refs.push({ ...r, index: idx });
  }

  const out: AqlToken[] = [];
  let cursor = 0;
  const blockStack: string[] = [];
  for (const token of rendered) {
    if (token.kind === 'directive') {
      const keyword = token.keyword!;
      const raw = token.value ? `#${keyword} ${token.value}` : `#${keyword}`;
      if (keyword === 'end') {
        const matchingKeyword = blockStack.pop();
        out.push({ kind: 'directive', keyword, value: token.value, matchingKeyword, index: cursor });
      } else {
        if (BLOCK_COLORS[keyword]) {
          blockStack.push(keyword);
        }
        out.push({ kind: 'directive', keyword, value: token.value, index: cursor });
      }
      cursor += raw.length;
    } else if (token.kind === 'text') {
      out.push(...splitTextByReferences(token.text, refs, cursor));
      cursor += token.text.length;
    }
  }
  return out;
}

/** Render tokens as a React fragment (read-only). */
export function AqlTokenList({
  tokens,
  resolveReference,
  className,
}: {
  tokens: AqlToken[];
  resolveReference?: AqlReferenceResolver;
  className?: string;
}) {
  return (
    <span className={className}>
      {tokens.map((token, i) => {
        switch (token.kind) {
          case 'directive':
            return (
              <DirectiveToken
                key={i}
                keyword={token.keyword!}
                value={token.value}
                matchingKeyword={token.matchingKeyword}
                resolver={resolveReference}
              />
            );
          case 'reference':
            return <ReferenceToken key={i} reference={token.reference!} resolver={resolveReference} />;
          case 'text':
            return (
              <span key={i} className="text-white/80 whitespace-pre-wrap">
                {token.text}
              </span>
            );
          default:
            return null;
        }
      })}
    </span>
  );
}

/**
 * Render an AQL query to an HTML string suitable for a contenteditable element.
 * Each token chip carries data-token-raw so serializeEditable can recover the
 * original AQL text.
 */
export function renderAqlToHtml(
  query: string,
  resolveReference?: AqlReferenceResolver,
): string {
  const tokens = tokenizeAql(query);
  if (tokens.length === 0) return '<br>';

  let html = '';
  for (const token of tokens) {
    switch (token.kind) {
      case 'directive': {
        const color = directiveColor(token.matchingKeyword || token.keyword!);
        const raw = token.value ? `#${token.keyword} ${token.value}` : `#${token.keyword}`;
        const valueSpan = token.value
          ? ` <span style="color:#e5e7eb;font-weight:500">${escapeHtml(token.value)}</span>`
          : '';
        html += `<span contenteditable="false" class="aql-token aql-directive whitespace-pre-wrap" style="color:${color}" data-token-raw="${encodeURIComponent(raw)}" title="${escapeHtml(raw)}">${escapeHtml(`#${token.keyword}`)}${valueSpan}</span>`;
        break;
      }
      case 'reference': {
        const ref = token.reference!;
        const resolved = resolveReference?.(ref) || { label: ref.label || ref.raw };
        const color = resolved.color || '#fbbf24';
        const label = escapeHtml(resolved.label || ref.label || ref.id || ref.raw);
        const id = escapeHtml(ref.id || ref.raw);
        const display = id && id !== label ? `[[${label} (${id})]]` : `[[${label}]]`;
        html += `<span contenteditable="false" class="aql-token aql-reference whitespace-pre-wrap" style="color:${color}" data-token-raw="${encodeURIComponent(ref.raw)}" title="${escapeHtml(ref.raw)}">${display}</span>`;
        break;
      }
      case 'text': {
        html += escapeHtml(token.text || '');
        break;
      }
    }
  }
  return html || '<br>';
}

/** Escape text so it can be safely injected into innerHTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/** Serialize a contenteditable element back to a plain text string, preserving token data-token-raw values. */
export function serializeEditable(el: HTMLElement): string {
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

/** Length contribution of a single DOM node in the serialized query. */
export function nodeQueryLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length || 0;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const el = node as HTMLElement;
  const raw = el.getAttribute('data-token-raw');
  if (raw) return decodeURIComponent(raw).length;
  if (el.tagName === 'BR') return 1;
  if (el.tagName === 'DIV') return 1 + childrenQueryLength(el);
  return childrenQueryLength(el);
}

/** Length contribution of all children. */
export function childrenQueryLength(container: Node): number {
  let len = 0;
  for (const child of container.childNodes) {
    len += nodeQueryLength(child);
  }
  return len;
}

/** Sum lengths from the start of container up to (but not including) target node. */
export function getTextLengthBeforeNode(container: Node, target: Node): number {
  let length = 0;
  for (const child of container.childNodes) {
    if (child === target) return length;
    if (child.contains(target)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const el = child as HTMLElement;
        const raw = el.getAttribute('data-token-raw');
        if (raw) {
          return length + decodeURIComponent(raw).length;
        }
        if (el.tagName === 'BR') return length + 1;
        if (el.tagName === 'DIV') length += 1;
      }
      return length + getTextLengthBeforeNode(child, target);
    }
    length += nodeQueryLength(child);
  }
  return length;
}

/** Get the caret offset in the underlying query string. */
export function getCaretOffset(el: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return 0;

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

  return (
    getTextLengthBeforeNode(el, range.startContainer) +
    Math.min(range.startOffset, range.startContainer.textContent?.length || 0)
  );
}

/** Place the caret at the given query-string offset inside the editor. */
export function setCaretOffset(el: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (!selection) return;

  function find(parent: Node, remaining: number): { node: Node; offset: number } | null {
    for (const child of parent.childNodes) {
      const len = nodeQueryLength(child);
      if (remaining <= len) {
        if (child.nodeType === Node.TEXT_NODE) {
          return { node: child, offset: Math.min(remaining, child.textContent?.length || 0) };
        }
        const childEl = child as HTMLElement;
        const raw = childEl.getAttribute('data-token-raw');
        if (raw) {
          return { node: child, offset: remaining === 0 ? 0 : 1 };
        }
        if (childEl.tagName === 'BR') {
          return { node: child, offset: 0 };
        }
        if (childEl.tagName === 'DIV') {
          if (remaining === 0) return { node: child, offset: 0 };
          const inner = find(child, remaining - 1);
          if (inner) return inner;
          return { node: child, offset: 0 };
        }
        const inner = find(child, remaining);
        if (inner) return inner;
        return { node: child, offset: 0 };
      }
      remaining -= len;
    }
    return null;
  }

  const found = find(el, offset);
  const range = document.createRange();
  if (found) {
    if (found.node.nodeType === Node.TEXT_NODE) {
      range.setStart(found.node, found.offset);
    } else if ((found.node as HTMLElement).getAttribute('data-token-raw')) {
      if (found.offset === 0) range.setStartBefore(found.node);
      else range.setStartAfter(found.node);
    } else {
      range.setStart(found.node, Math.min(found.offset, found.node.childNodes.length));
    }
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Focus the editor and place the caret at the given offset atomically. */
export function restoreCaret(el: HTMLElement, offset: number): void {
  el.focus({ preventScroll: true });
  setCaretOffset(el, Math.min(offset, serializeEditable(el).length));
}

/** Compute pixel coordinates of the caret inside the editor using a temporary marker. */
export function getCaretCoordinates(el: HTMLElement): { top: number; left: number } {
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

/** Find a token chip adjacent to the current collapsed caret position.
 *  direction: -1 for backspace (left), +1 for delete (right). */
export function findAdjacentToken(
  el: HTMLElement,
  range: Range,
  direction: -1 | 1,
): { raw: string; position: number } | null {
  let node: Node | null = range.startContainer;

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

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text;
    const offset = range.startOffset;
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
