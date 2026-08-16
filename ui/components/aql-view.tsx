'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import {
  renderAqlTokens,
  parseReferences,
  type Reference,
} from '@architxt/aql';

export interface AqlViewProps {
  /** Raw AQL query string. */
  query: string;
  /** Optional CSS class for the container. */
  className?: string;
  /** Whether to render as a single-line truncated preview. Default false. */
  compact?: boolean;
  /** Optional resolver for reference labels/colors. */
  resolveReference?: (ref: Reference) => { label: string; color?: string } | null;
}

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

function directiveColor(keyword: string): string {
  return BLOCK_COLORS[keyword] || SUB_COLORS[keyword] || '#9ca3af';
}

function ReferenceToken({
  reference,
  resolver,
}: {
  reference: Reference;
  resolver?: AqlViewProps['resolveReference'];
}) {
  const resolved = resolver?.(reference) || { label: reference.label || reference.raw };
  const color = resolved.color || '#fbbf24';
  const isEntity = reference.kind === 'entity';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border mx-0.5 align-middle whitespace-nowrap select-none',
      )}
      style={{
        backgroundColor: `${color}20`,
        borderColor: `${color}40`,
        color,
      }}
      title={reference.raw}
    >
      {isEntity ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0"
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      ) : null}
      <span>{resolved.label}</span>
    </span>
  );
}

function DirectiveToken({ keyword, value }: { keyword: string; value?: string }) {
  const color = directiveColor(keyword);
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border mx-0.5 align-middle whitespace-nowrap select-none"
      style={{
        backgroundColor: `${color}20`,
        borderColor: `${color}40`,
        color,
      }}
      title={`#${keyword}${value ? ` ${value}` : ''}`}
    >
      <span>#{keyword}</span>
      {value ? <span className="text-white/80 font-medium">{value}</span> : null}
    </span>
  );
}

type AqlViewToken =
  | { kind: 'text'; text: string }
  | { kind: 'directive'; keyword: string; value?: string }
  | { kind: 'reference'; reference: Reference };

function splitTextByReferences(text: string, refs: Array<Reference & { index?: number }>, textOffsetInQuery: number): AqlViewToken[] {
  // Collect references that fall inside this text span.
  const inside = refs
    .map((r) => ({ ref: r, idx: r.index ?? -1 }))
    .filter((item): item is { ref: Reference; idx: number } => item.idx >= textOffsetInQuery && item.idx < textOffsetInQuery + text.length);
  inside.sort((a, b) => a.idx - b.idx);

  const out: AqlViewToken[] = [];
  let cursor = 0;
  for (const { ref, idx } of inside) {
    const localStart = idx - textOffsetInQuery;
    const localEnd = localStart + ref.raw.length;
    if (localStart > cursor) {
      out.push({ kind: 'text', text: text.slice(cursor, localStart) });
    }
    out.push({ kind: 'reference', reference: ref });
    cursor = Math.max(cursor, localEnd);
  }
  if (cursor < text.length) {
    out.push({ kind: 'text', text: text.slice(cursor) });
  }
  return out;
}

/**
 * Render an AQL query as nicely-styled inline tokens.
 *
 * Uses the shared `@architxt/aql` renderer so the UI and server agree on the
 * grammar. References (entity/edge) are rendered as chips; directives are
 * rendered as colored pills; plain text is escaped and preserved.
 */
export function AqlView({ query, className, compact, resolveReference }: AqlViewProps) {
  const tokens = React.useMemo(() => {
    const rendered = renderAqlTokens(query);
    const refs = parseReferences(query).map((r) => ({
      ...r,
      index: query.indexOf(r.raw),
    }));

    const out: AqlViewToken[] = [];
    let cursor = 0;
    for (const token of rendered) {
      if (token.kind === 'directive') {
        out.push({ kind: 'directive', keyword: token.keyword!, value: token.value });
      } else if (token.kind === 'text') {
        out.push(...splitTextByReferences(token.text, refs, cursor));
        cursor += token.text.length;
      }
    }
    return out;
  }, [query]);

  return (
    <div
      className={cn(
        'font-mono text-sm leading-relaxed text-white/80',
        compact && 'truncate whitespace-nowrap',
        className,
      )}
    >
      {tokens.length === 0 ? (
        <span className="text-white/40">Empty query</span>
      ) : (
        tokens.map((token, i) => {
          switch (token.kind) {
            case 'directive':
              return <DirectiveToken key={i} keyword={token.keyword} value={token.value} />;
            case 'reference':
              return <ReferenceToken key={i} reference={token.reference} resolver={resolveReference} />;
            case 'text':
              return (
                <span key={i} className="text-white/80 whitespace-pre-wrap">
                  {token.text}
                </span>
              );
            default:
              return null;
          }
        })
      )}
    </div>
  );
}
