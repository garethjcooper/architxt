'use client';

/**
 * Query token helpers.
 *
 * Mirrors the entity-detection tag format so users see one consistent chip
 * language across the app:
 *   [[Label (Type:ID)]]           e.g. [[ICMS (Company:COM-002)]]
 *   [[src — label → target]]      e.g. [[ICMS — depends-on → Billing]]
 *
 * These tokens are rendered as inline chips inside the query input and parsed
 * into structured selections before submission. Intent is conveyed by the query
 * text itself; the old >>Verb<< markers have been removed.
 */

export type TokenKind = 'entity' | 'edge';

export interface QueryToken {
  kind: 'entity' | 'edge';
  raw: string;
  id: string;
  label: string;
  type?: string | null;
  index: number;
}

export interface EntityLike {
  id: string;
  label?: string | null;
  type?: string | null;
}

export interface EdgeLike {
  source: string;
  target: string;
  label?: string | null;
  relationship_type?: string | null;
}

export function formatEntityToken(label: string, id: string, type?: string | null): string {
  const qualified = type ? `${type}:${id}` : id;
  return `[[${label} (${qualified})]]`;
}

export function formatEdgeToken(source: string, target: string, label: string): string {
  return `[[${source} — ${label} → ${target}]]`;
}

// [[Label (Type:ID)]] — captures label and qualified id separately.
const ENTITY_TOKEN_RE = /\[\[[^\[\]]+?\s*\([^\)]+?\)\]\]/g;

// [[src — label → target]] — minimal edge syntax for the query area.
const EDGE_TOKEN_RE = /\[\[[^\[\]—]+?\s*—\s*[^\[\]—→]+?\s*→\s*[^\[\]]+?\]\]/g;

function parseQualifiedId(rawId: string): { type: string | null; id: string } {
  const colonIdx = rawId.indexOf(':');
  if (colonIdx > 0) {
    return { type: rawId.slice(0, colonIdx), id: rawId.slice(colonIdx + 1) };
  }
  return { type: null, id: rawId };
}

export function parseQueryTokens(query: string): QueryToken[] {
  const tokens: QueryToken[] = [];

  for (const match of query.matchAll(ENTITY_TOKEN_RE)) {
    const inner = match[0].slice(2, -2);
    const parenIdx = inner.lastIndexOf('(');
    const label = parenIdx > 0 ? inner.slice(0, parenIdx).trim() : inner.trim();
    const rawId = parenIdx > 0 ? inner.slice(parenIdx + 1, -1).trim() : inner.trim();
    const { id, type } = parseQualifiedId(rawId);
    tokens.push({
      kind: 'entity',
      raw: match[0],
      id,
      type,
      label,
      index: match.index ?? 0,
    });
  }

  for (const match of query.matchAll(EDGE_TOKEN_RE)) {
    const inner = match[0].slice(2, -2);
    const parts = inner.split(/\s*—\s*|\s*→\s*/);
    if (parts.length >= 3) {
      const source = parts[0].trim();
      const edgeLabel = parts[1].trim();
      const target = parts.slice(2).join(' → ').trim();
      const id = `${source}|${target}|${edgeLabel}`;
      tokens.push({
        kind: 'edge',
        raw: match[0],
        id,
        label: `${source} — ${edgeLabel} → ${target}`,
        index: match.index ?? 0,
      });
    }
  }

  return tokens.sort((a, b) => a.index - b.index);
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
export function renderQueryHtml(
  query: string,
  entities: EntityLike[],
  edges: EdgeLike[],
): string {
  const tokens = parseQueryTokens(query);
  let html = '';
  let lastIndex = 0;

  for (const token of tokens) {
    if (token.index > lastIndex) {
      html += escapeHtml(query.slice(lastIndex, token.index));
      lastIndex = token.index;
    }

    const fullRaw = token.raw;
    let chipText = token.label || fullRaw;
    if (token.kind === 'edge') {
      const [sourceId, targetId, relLabel] = token.id.split('|');
      const sourceLabel = entities.find((e) => e.id === sourceId)?.label || sourceId;
      const targetLabel = entities.find((e) => e.id === targetId)?.label || targetId;
      chipText = `${sourceLabel} — ${relLabel} → ${targetLabel}`;
    }

    const entity = token.kind === 'entity' ? entities.find((e) => e.id === token.id) : undefined;
    const entityType = token.kind === 'entity' ? (token.type || entity?.type || null) : null;
    const chipColor = entityType ? colorForType(entityType) : undefined;
    const iconColor = chipColor || '#fbbf24';
    const chipHtml = token.kind === 'entity' && entityType
      ? `${escapeHtml(token.label || fullRaw)} (${escapeHtml(entityType)}:${escapeHtml(token.id)})`
      : escapeHtml(chipText);

    const iconSvg =
      token.kind === 'entity'
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:${iconColor};flex-shrink:0"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#fbbf24;flex-shrink:0"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`;

    const chipStyle = chipColor
      ? `background-color:${chipColor}20;border-color:${chipColor}40;color:${chipColor}`
      : 'background-color:rgba(251,191,36,0.13);border-color:rgba(251,191,36,0.25);color:#fbbf24';

    html += `<span contenteditable="false" class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border mx-0.5 align-middle whitespace-nowrap select-none" style="${chipStyle}" data-token-raw="${encodeURIComponent(fullRaw)}" title="${escapeHtml(token.label || fullRaw)}">${iconSvg}<span>${chipHtml}</span></span>`;
    lastIndex = token.index + fullRaw.length;
  }

  if (lastIndex < query.length) {
    html += escapeHtml(query.slice(lastIndex));
  }

  return html || '<br>';
}

/** Serialize a contenteditable element back to a plain text string, preserving all tokens. */
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

/**
 * Build the minimal selection payload for the current query.
 *
 * Only selections explicitly present in the query are sent. The old behavior of
 * including every focused graph entity from prior steps is removed because
 * research steps are additive/independent: each query should scope itself, not
 * inherit an accumulated focus set.
 */
export function buildSelectionPayload(
  tokens: QueryToken[],
): Array<{ id: string; kind: TokenKind; label: string; type?: string | null }> {
  return tokens.map((t) => ({
    id: t.id,
    kind: t.kind,
    label: t.label,
    ...(t.kind === 'entity' && t.type ? { type: t.type } : {}),
  }));
}

/** Sum text/token lengths from the start of the container up to (but not including) the target node. */
export function getTextLengthBeforeNode(container: Node, target: Node): number {
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

/** Extract plain text before and after an offset, ignoring all token markup. */
export function getPlainTextBoundsAroundOffset(
  query: string,
  offset: number,
): { textBefore: string; textAfter: string } {
  const tokens = parseQueryTokens(query).sort((a, b) => a.index - b.index);
  let cursor = 0;
  let plainBefore = '';

  for (const token of tokens) {
    if (token.index >= offset) break;
    if (cursor < token.index) {
      const slice = query.slice(cursor, Math.min(token.index, offset));
      plainBefore += slice;
      cursor += slice.length;
      if (cursor >= offset) break;
    }
    cursor += token.raw.length;
  }

  if (cursor < offset) {
    plainBefore += query.slice(cursor, offset);
  }

  let plainAfter = '';
  cursor = offset;
  for (const token of tokens) {
    const tokenEnd = token.index + token.raw.length;
    if (tokenEnd <= offset) continue;
    if (token.index > cursor) {
      plainAfter += query.slice(cursor, token.index);
      cursor = token.index;
    }
    if (token.index <= cursor && tokenEnd > cursor) {
      cursor = tokenEnd;
    }
  }
  plainAfter += query.slice(cursor);

  return { textBefore: plainBefore, textAfter: plainAfter };
}

/** Find an open entity/edge autocomplete trigger preceding the offset. */
export function getAutocompleteFilter(query: string, offset: number): { kind: 'entity'; filter: string } | null {
  const tokens = parseQueryTokens(query).sort((a, b) => a.index - b.index);
  let cursor = 0;
  let plainBefore = '';

  for (const token of tokens) {
    if (token.index >= offset) break;
    if (cursor < token.index) {
      const slice = query.slice(cursor, Math.min(token.index, offset));
      plainBefore += slice;
      cursor += slice.length;
      if (cursor >= offset) break;
    }
    cursor += token.raw.length;
  }

  if (cursor < offset) {
    plainBefore += query.slice(cursor, offset);
  }

  const entityMatch = plainBefore.match(/\[\[([^\]]*)$/);
  if (entityMatch) {
    return { kind: 'entity', filter: entityMatch[1] };
  }

  return null;
}

/** Stub: colorForType is defined in the research-canvas component. The real import
 *  happens in query-form.tsx; this file only references it for the render helper. */
function colorForType(_type?: string | null): string {
  return '#94a3b8';
}
