import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';
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
  editingStepId?: number | null;
  runningStepId?: number | null;
  onSelectStep: (step: ResearchStepSummary) => void;
  onEditPage: (step: ResearchStepSummary) => void;
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
  editingStepId,
  runningStepId,
  onSelectStep,
  onEditPage,
  onReuseStep,
  onRerunStep,
  onInspectStep,
  onRefresh,
}: SessionItemsPanelProps) {
  const [creatingPage, setCreatingPage] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');

  const handleStartCreatePage = () => {
    setCreatingPage(true);
    setNewPageTitle('');
  };

  const handleCancelCreatePage = () => {
    setCreatingPage(false);
    setNewPageTitle('');
  };

  const handleConfirmCreatePage = async () => {
    const title = newPageTitle.trim();
    const sessionId = session?.id;
    if (!title || !sessionId) {
      handleCancelCreatePage();
      return;
    }
    try {
      const result = await researchApi.createSessionPage(sessionId, title);
      toast.success('Page created');
      setCreatingPage(false);
      setNewPageTitle('');
      await onRefresh?.();
      const step = items.find((s) => s.id === result.id);
      if (step) {
        onEditPage(step);
      } else {
        try {
          const full = await researchApi.getStep(result.id);
          onEditPage(full);
        } catch (err) {
          logger.error('Failed to fetch new page details', err);
        }
      }
    } catch (err) {
      logger.error('Failed to create page', err);
      toast.error('Failed to create page');
    }
  };

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
      if (step.action_type === 'curated_page') {
        onEditPage(step);
      } else {
        onSelectStep(step);
      }
    },
    [items, onEditPage, onSelectStep]
  );

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader title="Session items" count={items.length} />
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between shrink-0">
            <span className="text-xs text-white/60 truncate" title={session?.title || ''}>
              {session?.title || (loading ? 'Loading…' : 'No session')}
            </span>
            {!creatingPage && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-7 text-xs"
                onClick={handleStartCreatePage}
                disabled={!session?.id || loading}
              >
                <Plus className="w-3 h-3" />
                New page
              </Button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1">
            {creatingPage && (
              <div className="flex items-center gap-1.5">
                <Input
                  autoFocus
                  value={newPageTitle}
                  onChange={(e) => setNewPageTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleConfirmCreatePage();
                    if (e.key === 'Escape') handleCancelCreatePage();
                  }}
                  onBlur={handleConfirmCreatePage}
                  placeholder="Page name"
                  className="h-7 text-xs bg-black/20 border-white/10"
                />
              </div>
            )}

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

            {!creatingPage && items.length === 0 && !loading && (
              <div className="text-white/40 text-xs px-3 py-2">
                No workspace items yet. Create a page or run Reflect.
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
