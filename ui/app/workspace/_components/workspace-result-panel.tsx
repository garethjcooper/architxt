'use client';
import { EnvelopeControls } from '@/components/envelope-controls';
import { EnvelopeViewer } from '@/components/envelope-viewer';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import { CuratedPageEditor, type CuratedPageEnvelope } from './curated-page-editor';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';

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
  onCopyToCuratedPage?: (event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => void;
  /** Optional tabs or navigation rendered between the header and the content. */
  tabs?: React.ReactNode;
  /** Optional override for the header bar title. Defaults to title. */
  headerTitle?: string;
  /** Optional extra items rendered in the header row before the Controls toggle. */
  extraHeaderItems?: React.ReactNode;
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
  onCopyToCuratedPage,
  tabs,
  headerTitle,
  extraHeaderItems,
}: WorkspaceResultPanelProps) {
  if (error) {
    return (
      <div className="flex flex-col h-full">
        <EnvelopeControls
          title={title}
          headerTitle={headerTitle}
          showIndex={false}
          onShowIndexChange={() => {}}
          plain={false}
          onPlainChange={() => {}}
          onCopyText={() => {}}
          onSaveMd={() => {}}
          extraHeaderItems={extraHeaderItems}
          showControlsToggle={false}
        />
        {tabs}
        <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-red-300/90 whitespace-pre-wrap p-4">
          {error}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col h-full">
        <EnvelopeControls
          title={title}
          headerTitle={headerTitle}
          showIndex={false}
          onShowIndexChange={() => {}}
          plain={false}
          onPlainChange={() => {}}
          onCopyText={() => {}}
          onSaveMd={() => {}}
          extraHeaderItems={extraHeaderItems}
          showControlsToggle={false}
        />
        {tabs}
        <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-white/40">
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
        extraHeaderItems={extraHeaderItems}
      />
    );
  }

  return (
    <div className="relative h-full">
      {isRunning && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-full border border-white/10 bg-emerald-900/40 backdrop-blur-sm px-2.5 py-1 text-[10px] text-emerald-200/80 shadow-sm">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
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
        extraHeaderItems={extraHeaderItems}
      />
    </div>
  );
}
