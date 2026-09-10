'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { AqlTokenList, tokenizeAql, directiveColor } from './aql-tokens';
import type { Reference } from '@architxt/aql';

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

/**
 * Read-only AQL renderer.
 *
 * Uses the shared `@architxt/aql` renderer so the UI and server agree on the
 * grammar. References (entity/edge) are rendered as chips; directives are
 * rendered as colored pills; plain text is escaped and preserved.
 */
export function AqlView({ query, className, compact, resolveReference }: AqlViewProps) {
  const tokens = React.useMemo(() => tokenizeAql(query), [query]);

  return (
    <div
      className={cn(
        'font-mono text-sm leading-relaxed text-syntax-text',
        compact && 'truncate whitespace-nowrap',
        className,
      )}
    >
      {tokens.length === 0 ? (
        <span className="text-syntax-comment">Empty query</span>
      ) : (
        <AqlTokenList tokens={tokens} resolveReference={resolveReference} />
      )}
    </div>
  );
}

export { directiveColor };
