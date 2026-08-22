import { useCallback } from 'react';
import { researchApi, type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { Panel, PanelHeader, PanelContent } from './panel-layout';
import { QueryTrail } from '@/app/research/query-trail';

const logger = createLogger('SessionItemsPanel');

export interface SessionItemsPanelProps {
  session?: ResearchSession | null;
  items: ResearchStepSummary[];
  loading?: boolean;
  activeStepId?: number | null;
  runningStepId?: number | null;
  onSelectStep: (step: ResearchStepSummary) => void;
  onReuseStep?: (step: ResearchStepSummary) => void;
  onRerunStep?: (stepId: number) => Promise<unknown>;
  onInspectStep?: (step: ResearchStepSummary) => void;
  onRefresh?: () => void | Promise<void>;
}

export function SessionItemsPanel({
  session,
  items,
  loading = false,
  activeStepId,
  runningStepId,
  onSelectStep,
  onReuseStep,
  onRerunStep,
  onInspectStep,
  onRefresh,
}: SessionItemsPanelProps) {
  const handleDeleteStep = async (stepId: number) => {
    try {
      await researchApi.deleteStep(stepId);
      toast.success('Item deleted');
      await onRefresh?.();
    } catch (err) {
      logger.error('Failed to delete step', err);
      toast.error('Failed to delete item');
    }
  };

  const handleActivateStep = useCallback(
    (stepId: number) => {
      const step = items.find((s) => s.id === stepId);
      if (!step) return;
      onSelectStep(step);
    },
    [items, onSelectStep]
  );

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader title="Session items" count={items.length} />
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1">
            <QueryTrail
              trail={items}
              selectedStepIds={new Set()}
              activeStepId={activeStepId ?? null}
              runningStepId={runningStepId ?? null}
              viewMode="step"
              onToggleStep={() => {}}
              onSelectAll={() => {}}
              onClearSelection={() => {}}
              onActivateStep={handleActivateStep}
              onRequestDelete={handleDeleteStep}
              onRerunStep={onRerunStep}
              onUseDetails={(stepId) => {
                const step = items.find((s) => s.id === stepId);
                if (step) onReuseStep?.(step);
              }}
              onInspectStep={onInspectStep ? (stepId) => {
                const step = items.find((s) => s.id === stepId);
                if (step) onInspectStep(step);
              } : undefined}
            />

            {items.length === 0 && !loading && (
              <div className="text-white/40 text-xs px-3 py-2">
                No workspace items yet. Run Reflect to add results.
              </div>
            )}
            {loading && items.length === 0 && (
              <div className="text-white/40 text-xs px-3 py-2">Loading session items…</div>
            )}
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
