'use client';

import { useState } from 'react';
import { MoreHorizontal, ChevronDown, ChevronUp, Trash2, Info, ClipboardList, RefreshCw, ExternalLink } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AqlView } from '@/components/aql-view';
import { researchApi, type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { Panel, PanelHeader, PanelContent } from './panel-layout';

const logger = createLogger('SessionItemsPanel');

export interface SessionItemsPanelProps {
  session?: ResearchSession | null;
  items: ResearchStepSummary[];
  loading?: boolean;
  activeStepId?: number | null;
  runningStepId?: number | null;
  onSelectStep: (step: ResearchStepSummary, openInNewTab?: boolean) => void;
  onReuseStep?: (step: ResearchStepSummary) => void;
  onRerunStep?: (stepId: number) => Promise<unknown>;
  onInspectStep?: (step: ResearchStepSummary) => void;
  onRefresh?: () => void | Promise<void>;
}

function formatCreatedAt(value?: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function firstLinePreview(query: string): string {
  const lines = query.split('\n');
  for (const line of lines) {
    if (line.trim().length > 0) return line;
  }
  return query;
}

function queryRemainder(query: string): string {
  const lines = query.split('\n');
  let foundFirstNonEmpty = false;
  let startIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!foundFirstNonEmpty && lines[i].trim().length > 0) {
      foundFirstNonEmpty = true;
      startIndex = i + 1;
    }
  }
  return lines.slice(startIndex).join('\n');
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
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const toggleExpanded = (stepId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
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

  const anyRunning = runningStepId != null;

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader title="Session items" count={items.length} />
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-1">
            {items.map((step) => {
              const isActive = activeStepId === step.id;
              const isExpanded = expandedIds.has(step.id);
              const isRunning = step.status === 'running' || runningStepId === step.id;
              const createdAt = formatCreatedAt(step.created_at);
              const query = step.raw_query || step.intent_text || '';
              const previewQuery = firstLinePreview(query);
              const remainder = queryRemainder(query);
              const canExpand = remainder.trim().length > 0;

              return (
                <div
                  key={step.id}
                  className={`rounded border overflow-hidden transition-colors ${
                    isActive
                      ? 'bg-emerald-900/30 border-emerald-500/30'
                      : 'bg-black/20 border-white/5 hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2 px-2 py-1.5 min-h-[2.8125rem]">
                    <button
                      type="button"
                      onClick={() => onSelectStep(step)}
                      className="flex-1 text-left min-w-0 flex flex-col gap-0.5"
                      title={query || 'Untitled query'}
                    >
                      <div className="flex items-center justify-between text-xs text-white/90">
                        <span className="truncate flex items-center gap-2 min-w-0">
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/30 border-emerald-500/30 text-emerald-300`}
                            >
                            reflect
                            </span>
                          {createdAt && (
                            <span className="text-[10px] text-white/40 whitespace-nowrap">{createdAt}</span>
                          )}
                          {step.status === 'running' && (
                            <span className="text-amber-300 animate-pulse">● running</span>
                          )}
                          {step.status === 'failed' && (
                            <span className="text-red-400">● failed</span>
                          )}
                        </span>
                      </div>
                      <div className="text-[10px] text-white/50 font-mono truncate">
                        <AqlView query={previewQuery} compact className="text-[10px] leading-tight" />
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectStep(step, true)}
                      className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10"
                      title="Open in new tab"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleExpanded(step.id)}
                      className={`shrink-0 h-6 w-6 inline-flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 ${
                        !canExpand ? 'invisible' : ''
                      }`}
                      title={isExpanded ? 'Collapse query' : 'Expand query'}
                      disabled={!canExpand}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>

                    <DropdownMenu>
                      <DropdownMenuTrigger>
                        <span
                          className="shrink-0 h-6 w-6 inline-flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Query actions"
                          role="button"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-36 bg-[oklch(0.18_0_0)] border-white/10 text-white/90"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectStep(step, true);
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-2" /> Open in new tab
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onReuseStep?.(step);
                          }}
                          disabled={isRunning}
                        >
                          <ClipboardList className="h-3 w-3 mr-2" /> Re-use
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onRerunStep?.(step.id);
                          }}
                          disabled={isRunning || anyRunning}
                        >
                          <RefreshCw className="h-3 w-3 mr-2" /> Re-run
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onInspectStep?.(step);
                          }}
                        >
                          <Info className="h-3 w-3 mr-2" /> Provenance
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-rose-400 focus:text-rose-400 focus:bg-rose-950/30"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteStep(step.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  {isExpanded && canExpand && (
                    <div className="px-2 pb-2 border-t border-white/5">
                      <div className="pt-2 text-[10px] text-white/50 font-mono">
                        <AqlView
                          query={remainder}
                          className="text-[10px] leading-tight whitespace-pre-wrap"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

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
