'use client';

import { useMemo, useState } from 'react';
import { NarrativeViewer } from './narrative-viewer';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
import { EnvelopeControls } from './envelope-controls';
import { toast } from 'sonner';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';

export interface EnvelopeCopyEvent {
  type: 'narrative' | 'graph' | 'tables' | 'diagrams';
  /** Markdown for narrative sections; JSON stringified payloads for structured types. */
  payload: string;
  /** Human-readable label for the copied chunk. */
  label?: string;
}

export interface EnvelopeViewerProps {
  /** Envelope to render. */
  envelope: ResearchStepSummary | DiscoverStepResponse | null;
  /** Human-readable title used for the section index and downloads. */
  title?: string;
  /** Optional count badge shown in the header. */
  count?: number;
  /** Called when a copy action is requested. When omitted, the viewer copies/downloads directly. */
  onCopy?: (event: EnvelopeCopyEvent) => void;
  /** Optional callback to add a section to a curated page. Receives the section markdown. */
  onAddToPage?: (sectionMarkdown: string, sectionTitle?: string) => void;
  /** Optional label for the add-to-page action. */
  addToPageLabel?: string;
  /** Optional key namespace passed through to NarrativeViewer. */
  keyPrefix?: string;
  /** Optional extra className for the outer container. */
  className?: string;
  /** Whether the left-hand section index sidebar is shown. */
  showIndex?: boolean;
  /** Whether the floating data-controls panel is available. */
  showControls?: boolean;
  /** Initial rendering mode for the narrative. */
  defaultViewMode?: 'plain' | 'markdown';
  /** Name used for downloaded file names. */
  sessionName?: string;
}

function sanitizeFilenameBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9\\-_]/g, '_').slice(0, 50);
}

function downloadMarkdown(markdown: string, sessionName: string) {
  const date = new Date().toISOString().split('T')[0];
  const sanitized = sanitizeFilenameBase(sessionName);
  const filename = `${sanitized}-${date}.md`;
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Downloaded as ${filename}`);
}

export function EnvelopeViewer({
  envelope,
  title = 'Preview',
  count,
  onCopy,
  keyPrefix,
  className = '',
  showIndex = false,
  showControls = false,
  defaultViewMode = 'markdown',
  sessionName,
  onAddToPage,
  addToPageLabel,
}: EnvelopeViewerProps) {
  const markdown = useMemo(() => buildEnvelopeMarkdown(envelope ?? null), [envelope]);
  const [showIndexState, setShowIndexState] = useState(showIndex);
  const [plain, setPlain] = useState(defaultViewMode === 'plain');

  const viewMode = plain ? 'plain' : 'markdown';
  const effectiveSessionName = sessionName ?? title;

  const handleCopy = () => {
    if (!markdown) return;
    if (onCopy) {
      onCopy({ type: 'narrative', payload: markdown, label: effectiveSessionName });
      return;
    }
    navigator.clipboard.writeText(markdown).then(() => toast.success('Copied to clipboard'));
  };

  const handleSave = () => {
    if (!markdown) return;
    if (onCopy) {
      onCopy({ type: 'narrative', payload: markdown, label: effectiveSessionName });
      return;
    }
    downloadMarkdown(markdown, effectiveSessionName);
  };

  const handleCopySection = onCopy
    ? (sectionMarkdown: string, sectionTitle?: string) =>
        onCopy({ type: 'narrative', payload: sectionMarkdown, label: sectionTitle || effectiveSessionName })
    : undefined;

  return (
    <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${className}`}>
      {showControls && (
        <EnvelopeControls
          title={title}
          count={count}
          showIndex={showIndexState}
          onShowIndexChange={setShowIndexState}
          plain={plain}
          onPlainChange={setPlain}
          onCopyText={handleCopy}
          onSaveMd={handleSave}
        />
      )}
      <div className="flex-1 min-h-0 overflow-hidden p-2 relative">
        <NarrativeViewer
          content={markdown}
          title="Sections"
          viewMode={viewMode}
          showIndex={showIndexState}
          onCopySection={handleCopySection}
          onAddToPage={onAddToPage ? (sectionMarkdown, sectionTitle) => onAddToPage(sectionMarkdown, sectionTitle) : undefined}
          addToPageLabel={addToPageLabel}
          keyPrefix={keyPrefix}
          className="h-full"
        />
      </div>
    </div>
  );
}
