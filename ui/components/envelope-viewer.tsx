'use client';

import { useMemo } from 'react';
import { NarrativeViewer } from './narrative-viewer';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';

export interface EnvelopeCopyEvent {
  type: 'narrative' | 'graph' | 'tables' | 'diagrams';
  /** Markdown for narrative sections; JSON stringified payloads for structured types. */
  payload: string;
  /** Human-readable label for the copied chunk. */
  label?: string;
}

export interface EnvelopeViewerProps {
  envelope: ResearchStepSummary | DiscoverStepResponse | null;
  title?: string;
  onCopy?: (event: EnvelopeCopyEvent) => void;
  keyPrefix?: string;
  className?: string;
}

export function EnvelopeViewer({ envelope, title = 'Preview', onCopy, keyPrefix, className = '' }: EnvelopeViewerProps) {
  const markdown = useMemo(() => buildEnvelopeMarkdown(envelope ?? null), [envelope]);

  const handleCopy = (md: string, sectionTitle?: string) => {
    const label =
      sectionTitle ||
      (envelope && 'intent_text' in envelope && typeof (envelope as ResearchStepSummary).intent_text === 'string'
        ? (envelope as ResearchStepSummary).intent_text
        : undefined);
    onCopy?.({ type: 'narrative', payload: md, label: label || title });
  };

  return (
    <NarrativeViewer
      content={markdown}
      title={title}
      viewMode="markdown"
      showIndex={false}
      onCopySection={onCopy ? handleCopy : undefined}
      keyPrefix={keyPrefix}
      className={className}
    />
  );
}
