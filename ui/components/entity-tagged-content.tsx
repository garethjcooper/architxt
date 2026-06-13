'use client';

import { useMemo, useRef, useEffect } from 'react';
import { renderEntityTaggedContent } from './entity-scan-panel';
import { getCachedFormat } from '@/lib/entity-tag-format';

interface EntityTaggedContentProps {
  content: string;
  highlightRange?: { start: number; end: number } | null;
}

/** Render content with entity tags shown as styled badges.
 *  highlightRange: optional raw {start, end} to highlight — used when
 *  clicking a scan match to focus that specific text in the pane. */
export function EntityTaggedContent({
  content,
  highlightRange = null,
}: EntityTaggedContentProps) {
  const segments = useMemo(() => renderEntityTaggedContent(content), [content]);
  const ref = useRef<HTMLDivElement>(null);

  // Auto-scroll to highlight on change
  useEffect(() => {
    if (!highlightRange || !ref.current) return;
    const el = ref.current.querySelector('[data-highlight-match]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightRange]);

  if (!content) {
    return <p className="text-white/30 italic">No content available</p>;
  }

  // Check active format to know whether to show name chip
  let showNameChip = true;
  try {
    showNameChip = getCachedFormat().activeKey === 'v1-dual';
  } catch {
    // cache not loaded yet — default to showing name
  }

  // Helper: split a text segment by a highlight range, returning parts
  const renderTextWithHighlight = (
    text: string,
    segStart: number,
    segEnd: number,
    key: string
  ) => {
    if (!highlightRange) {
      return (
        <span key={key} data-text-start={segStart} data-text-end={segEnd} className="text-white/80">
          {text}
        </span>
      );
    }

    const hStart = Math.max(highlightRange.start, segStart);
    const hEnd = Math.min(highlightRange.end, segEnd);

    if (hStart >= hEnd) {
      // No overlap
      return (
        <span key={key} data-text-start={segStart} data-text-end={segEnd} className="text-white/80">
          {text}
        </span>
      );
    }

    // Split into before, highlight, after (all relative to this segment)
    const beforeLen = hStart - segStart;
    const highlightLen = hEnd - hStart;
    const afterLen = segEnd - hEnd;

    const before = beforeLen > 0 ? text.slice(0, beforeLen) : null;
    const highlighted = text.slice(beforeLen, beforeLen + highlightLen);
    const after = afterLen > 0 ? text.slice(beforeLen + highlightLen) : null;

    return (
      <span key={key} data-text-start={segStart} data-text-end={segEnd} className="text-white/80">
        {before != null && <span>{before}</span>}
        <span
          data-highlight-match
          className="bg-yellow-400/30 text-yellow-200 rounded px-0.5 transition-all"
        >
          {highlighted}
        </span>
        {after != null && <span>{after}</span>}
      </span>
    );
  };

  return (
    <div ref={ref} className="whitespace-pre-wrap">
      {segments.map((seg, i) => {
        if (seg.type === 'entity') {
          const isHighlighted =
            highlightRange != null &&
            seg.start != null &&
            seg.end != null &&
            seg.start < highlightRange.end &&
            seg.end > highlightRange.start;

          return (
            <span
              key={i}
              data-tag-start={seg.start}
              data-highlight-match={isHighlighted ? '' : undefined}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-sans bg-purple-500/20 text-purple-300 border border-purple-500/30 mx-0.5 transition-all ${
                isHighlighted ? 'ring-2 ring-yellow-400/60 bg-yellow-400/20' : ''
              }`}
              title={seg.id ? `id: ${seg.id}` : undefined}
            >
              <span>{seg.content}</span>
              {showNameChip && seg.name && (
                <span className="text-[9px] text-purple-400/60">name:{seg.name}</span>
              )}
              {seg.id && (
                <span className="text-[9px] text-purple-400/60">id:{seg.id}</span>
              )}
            </span>
          );
        }

        // Text segment
        return renderTextWithHighlight(
          seg.content,
          seg.start ?? 0,
          seg.end ?? seg.content.length,
          `text-${i}`
        );
      })}
    </div>
  );
}
