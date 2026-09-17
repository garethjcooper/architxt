'use client';

import { useEffect, useState } from 'react';
import { EnvelopeViewer } from '@/components/envelope-viewer';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import { CuratedPageEditor, type CuratedPageEnvelope } from './curated-page-editor';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';
import { EnvelopeControls } from '@/components/envelope-controls';

export interface WorkspaceResultPanelProps {
  result: DiscoverStepResponse | ResearchStepSummary | null;
  isRunning?: boolean;
  error?: string | null;
  title?: string;
  count?: number;
  /** Optional server id for evidence resolution. */
  serverId?: number;
  /** Optional bank id for evidence resolution. */
  bankId?: string;
  /** Optional key namespace passed through to NarrativeViewer. */
  keyPrefix?: string;
  /** Name used for downloaded file names. */
  sessionName?: string;
  /** When a curated page tab is active, editing happens here. */
  activeCuratedPage?: ResearchStepSummary | null;
  /** Server baseline for the active curated page, used to compute dirty state. */
  activeCuratedPageBaseline?: CuratedPageEnvelope;
  curatedPages?: ResearchStepSummary[];
  onSaveCuratedPage?: (stepId: number, envelope: CuratedPageEnvelope) => Promise<void>;
  /** Called when the active curated page dirty state changes. */
  onCuratedPageDirtyChange?: (dirty: boolean) => void;
  /** Increment to trigger saving the active curated page. */
  saveCuratedPageTrigger?: number;
  /** Called with the working envelope and deletion state for the active curated page on every change. */
  onCuratedPageChange?: (payload: {
    envelope: CuratedPageEnvelope;
    dirty: boolean;
    deletedBlockIds: string[];
    deletedStructuredKeys: string[];
    deletedNarrativeIds: string[];
  }) => void;
  /** Deletion sets to restore when the active curated page editor is remounted. */
  activeCuratedPageDeletions?: { deletedBlockIds: string[]; deletedStructuredKeys: string[]; deletedNarrativeIds: string[] };
  onCopyToCuratedPage?: (event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => void;
  /** Called from inside a curated page editor to copy a section via the target picker. */
  onRequestCopySection?: (event: EnvelopeCopyEvent) => void;
  /** Optional tabs or navigation rendered between the header and the content. */
  tabs?: React.ReactNode;
  /** Optional override for the header bar title. Defaults to title. */
  headerTitle?: string;
}

export function WorkspaceResultPanel({
  result,
  isRunning,
  error,
  title = 'Workspace',
  count,
  serverId,
  bankId,
  keyPrefix,
  sessionName,
  activeCuratedPage,
  activeCuratedPageBaseline,
  curatedPages = [],
  onSaveCuratedPage,
  onCuratedPageDirtyChange,
  saveCuratedPageTrigger,
  onCuratedPageChange,
  activeCuratedPageDeletions,
  onCopyToCuratedPage,
  onRequestCopySection,
  tabs,
  headerTitle,
}: WorkspaceResultPanelProps) {
  const showControls = true;
  const [showIndex, setShowIndex] = useState(true);
  const [plain, setPlain] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(13 * 16);

  // Hydration-safe: restore the saved sidebar width after mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('narrative-sidebar-width');
      if (saved) {
        setSidebarWidth(Math.max(10 * 16, Number(saved)));
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem('narrative-sidebar-width', String(sidebarWidth));
    } catch {
      // ignore storage errors
    }
  }, [sidebarWidth]);

  if (error) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {showControls && (
          <EnvelopeControls
            title={title}
            headerTitle={headerTitle}
            count={count}
            showIndex={showIndex}
            onShowIndexChange={setShowIndex}
            plain={plain}
            onPlainChange={setPlain}
            onCopyText={() => {}}
            onSaveMd={() => {}}
          />
        )}
        {tabs}
        <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-destructive-fg/90 whitespace-pre-wrap p-4">
          {error}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {showControls && (
          <EnvelopeControls
            title={title}
            headerTitle={headerTitle}
            count={count}
            showIndex={showIndex}
            onShowIndexChange={setShowIndex}
            plain={plain}
            onPlainChange={setPlain}
            onCopyText={() => {}}
            onSaveMd={() => {}}
          />
        )}
        {tabs}
        <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-foreground-subtle">
          {isRunning ? 'Running query…' : 'Select a step or model to view its content.'}
        </div>
      </div>
    );
  }

  // When a curated page is active, show the editor instead of the read-only envelope.
  if (activeCuratedPage && onSaveCuratedPage) {
    return (
      <CuratedPageEditor
        key={activeCuratedPage.id}
        page={activeCuratedPage}
        baseline={activeCuratedPageBaseline}
        onSave={onSaveCuratedPage}
        tabs={tabs}
        headerTitle={headerTitle}
        serverId={serverId}
        bankId={bankId}
        onDirtyChange={onCuratedPageDirtyChange}
        saveTrigger={saveCuratedPageTrigger}
        onChange={onCuratedPageChange}
        initialDeletedBlockIds={activeCuratedPageDeletions?.deletedBlockIds}
        initialDeletedStructuredKeys={activeCuratedPageDeletions?.deletedStructuredKeys}
        initialDeletedNarrativeIds={activeCuratedPageDeletions?.deletedNarrativeIds}
        showIndex={showIndex}
        onShowIndexChange={setShowIndex}
        plain={plain}
        onPlainChange={setPlain}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        onRequestCopySection={onRequestCopySection}
      />
    );
  }

  return (
    <div className="relative h-full">
      {isRunning && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-full border border-border-default bg-accent-primary-bg backdrop-blur-sm px-2.5 py-1 text-[10px] text-accent-primary-fg/80 shadow-sm">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-primary-fg animate-pulse" />
          Running query…
        </div>
      )}
      <EnvelopeViewer
        envelope={result}
        title={title}
        headerTitle={headerTitle}
        count={count}
        keyPrefix={keyPrefix}
        className="h-full"
        showIndex={showIndex}
        onShowIndexChange={setShowIndex}
        plain={plain}
        onPlainChange={setPlain}
        showControls
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        serverId={serverId}
        bankId={bankId}
        sessionName={sessionName}
        onAddToPage={onCopyToCuratedPage}
        tabs={tabs}
      />
    </div>
  );
}
