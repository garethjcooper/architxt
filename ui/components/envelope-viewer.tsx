'use client';

import { useCallback, useMemo, useState } from 'react';
import { NarrativeViewer } from './narrative-viewer';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
import { EnvelopeControls } from './envelope-controls';
import { toast } from 'sonner';
import { downloadMarkdown } from '@/lib/utils';
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
  /** Optional callback to add structured or narrative content to a curated page. */
  onAddToPage?: (event: EnvelopeCopyEvent) => void;
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

  const normalized = useMemo(() => {
    if (!envelope) return null;
    if ('intent_text' in envelope) {
      return envelope as ResearchStepSummary;
    }
    return {
      intent_text: undefined,
      synthesis: envelope.synthesis,
      canvas: envelope.canvas,
    };
  }, [envelope]);

  const structuredItems = useMemo(() => {
    if (!normalized) return undefined;
    const items: NonNullable<React.ComponentPropsWithoutRef<typeof EnvelopeControls>['structuredItems']> = {};
    const graph = normalized.canvas?.graph;
    if (graph && ((graph.nodes?.length ?? 0) > 0 || (graph.edges?.length ?? 0) > 0)) {
      items.graph = {
        payload: JSON.stringify(graph, null, 2),
        label: normalized.intent_text || 'Graph',
      };
    }
    const tables = normalized.canvas?.tables;
    if (tables && tables.length > 0) {
      items.tables = {
        payload: JSON.stringify(tables, null, 2),
        label: normalized.intent_text || 'Tables',
      };
    }
    const diagrams = normalized.canvas?.diagrams;
    if (diagrams && diagrams.length > 0) {
      items.diagrams = {
        payload: JSON.stringify(diagrams, null, 2),
        label: normalized.intent_text || 'Diagrams',
      };
    }
    return Object.keys(items).length > 0 ? items : undefined;
  }, [normalized]);

  const handleCopyStructured = useCallback(
    (type: 'graph' | 'tables' | 'diagrams', payload: string, label?: string) => {
      onCopy?.({ type, payload, label });
    },
    [onCopy]
  );

  const handleAddStructured = useCallback(
    (type: 'graph' | 'tables' | 'diagrams', payload: string, label?: string) => {
      onAddToPage?.({ type, payload, label });
    },
    [onAddToPage]
  );

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

  const handleAddSection = onAddToPage
    ? (sectionMarkdown: string, sectionTitle?: string) =>
        onAddToPage({ type: 'narrative', payload: sectionMarkdown, label: sectionTitle || effectiveSessionName })
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
          structuredItems={structuredItems}
          onCopyStructured={onCopy ? handleCopyStructured : undefined}
          onAddStructured={onAddToPage ? handleAddStructured : undefined}
        />
      )}
      <div className="flex-1 min-h-0 overflow-hidden p-2 relative">
        <NarrativeViewer
          content={markdown}
          title="Sections"
          viewMode={viewMode}
          showIndex={showIndexState}
          onCopySection={handleCopySection}
          onAddToPage={handleAddSection}
          addToPageLabel={addToPageLabel}
          keyPrefix={keyPrefix}
          className="h-full"
        />
      </div>
    </div>
  );
}
