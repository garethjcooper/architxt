'use client';
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
  sessionName?: string;
  keyPrefix?: string;
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
  }) => void;
  /** Deletion sets to restore when the active curated page editor is remounted. */
  activeCuratedPageDeletions?: { deletedBlockIds: string[]; deletedStructuredKeys: string[] };
  onCopyToCuratedPage?: (event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => void;
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
  sessionName,
  keyPrefix,
  activeCuratedPage,
  activeCuratedPageBaseline,
  curatedPages = [],
  onSaveCuratedPage,
  onCuratedPageDirtyChange,
  saveCuratedPageTrigger,
  onCuratedPageChange,
  activeCuratedPageDeletions,
  onCopyToCuratedPage,
  tabs,
  headerTitle,
}: WorkspaceResultPanelProps) {
  const showControls = true;

  if (error) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        {showControls && (
          <EnvelopeControls
            title={title}
            headerTitle={headerTitle}
            count={count}
            showIndex={false}
            onShowIndexChange={() => {}}
            plain={false}
            onPlainChange={() => {}}
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
            showIndex={false}
            onShowIndexChange={() => {}}
            plain={false}
            onPlainChange={() => {}}
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
        onDirtyChange={onCuratedPageDirtyChange}
        saveTrigger={saveCuratedPageTrigger}
        onChange={onCuratedPageChange}
        initialDeletedBlockIds={activeCuratedPageDeletions?.deletedBlockIds}
        initialDeletedStructuredKeys={activeCuratedPageDeletions?.deletedStructuredKeys}
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
        showIndex
        showControls
        sessionName={sessionName}
        onAddToPage={onCopyToCuratedPage}
        tabs={tabs}
      />
    </div>
  );
}
