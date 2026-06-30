'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Trash2 } from 'lucide-react';
import type { ResearchStepSummary } from '@/lib/api/client';

export interface QueryTrailProps {
  trail: ResearchStepSummary[];
  selectedStepIds: Set<number>;
  activeStepId: number | null;
  deletingStepId: number | null;
  viewMode?: 'step' | 'session';
  onToggleStep: (stepId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onActivateStep: (stepId: number) => void;
  onRequestDelete: (stepId: number) => void;
  onInspectStep?: (stepId: number) => void;
}

export function QueryTrail(props: QueryTrailProps) {
  const {
    trail,
    selectedStepIds,
    activeStepId,
    deletingStepId,
    viewMode,
    onToggleStep,
    onSelectAll,
    onClearSelection,
    onActivateStep,
    onRequestDelete,
    onInspectStep,
  } = props;

  const isMerge = viewMode === 'session';

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="overflow-y-auto px-3 py-2 space-y-1 min-h-0 flex-1">
        {trail.length > 0 ? (
          trail.map((step, idx) => {
            const isActive = activeStepId === step.id;
            const isSelected = selectedStepIds.has(step.id);
            const isSynthesize = step.action_type === 'synthesize';
            return (
              <div
                key={step.id}
                className={`w-full flex items-center gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors ${
                  isActive
                    ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-200'
                    : isSynthesize
                      ? 'bg-violet-900/20 border-violet-500/20 text-violet-100 hover:bg-violet-900/30'
                      : 'bg-black/20 border-white/5 text-white/90 hover:bg-white/5'
                }`}
              >
                {isMerge && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleStep(step.id)}
                    className="shrink-0"
                    aria-label={`Include step ${idx + 1} in merge`}
                  />
                )}
                <button
                  type="button"
                  onClick={() => (isMerge ? onToggleStep(step.id) : onActivateStep(step.id))}
                  onDoubleClick={() => onInspectStep?.(step.id)}
                  className="flex-1 text-left min-w-0 flex flex-col gap-0.5"
                  title={step.intent_text || 'Untitled query'}
                >
                  <div className="flex items-center justify-between text-xs text-white/90">
                    <span className="truncate">
                      #{idx + 1} · {step.calls?.[0]?.mode || step.action_type || 'discover'}
                      {step.status === 'running' && (
                        <span className="ml-1.5 text-amber-300 animate-pulse">● running</span>
                      )}
                      {step.status === 'failed' && (
                        <span className="ml-1.5 text-red-400">● failed</span>
                      )}
                    </span>
                    <span className="text-[10px] text-white/40 whitespace-nowrap">
                      {step.created_at
                        ? new Date(step.created_at).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : ''}
                    </span>
                  </div>
                  <div className="text-[10px] text-white/50 font-mono truncate">
                    {step.intent_text || 'Untitled query'}
                  </div>
                </button>
                <button
                  type="button"
                  disabled={deletingStepId === step.id}
                  onClick={() => onRequestDelete(step.id)}
                  className="shrink-0 p-1 rounded text-white/30 hover:text-red-400 hover:bg-red-900/20 disabled:opacity-50"
                  aria-label={`Delete query ${idx + 1}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        ) : (
          <p className="text-xs text-white/40">No queries yet.</p>
        )}
      </div>
    </div>
  );
}
