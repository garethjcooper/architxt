'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { MoreHorizontal, Plus, FileText, Sparkles, Trash2, Pencil } from 'lucide-react';
import { researchApi, type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { Panel, PanelHeader, PanelContent } from './panel-layout';

const logger = createLogger('SessionItemsPanel');

const WORKSPACE_ITEM_TYPES = new Set(['reflect', 'curated_page']);

export interface SessionItemsPanelProps {
  serverId: number;
  bankId: string;
  activeStepId?: number | null;
  editingStepId?: number | null;
  refreshSignal?: number;
  onSelectStep: (step: ResearchStepSummary) => void;
  onEditPage: (step: ResearchStepSummary) => void;
  onActiveSessionChange?: (session: ResearchSession | null) => void;
}

function formatStepDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function isWorkspaceItem(step: ResearchStepSummary): boolean {
  return WORKSPACE_ITEM_TYPES.has(step.action_type || 'discover');
}

export function SessionItemsPanel({
  serverId,
  bankId,
  activeStepId,
  editingStepId,
  refreshSignal,
  onSelectStep,
  onEditPage,
  onActiveSessionChange,
}: SessionItemsPanelProps) {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [items, setItems] = useState<ResearchStepSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [creatingPage, setCreatingPage] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  useEffect(() => {
    onActiveSessionChange?.(activeSession);
  }, [activeSession, onActiveSessionChange]);

  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await researchApi.listSessions(serverId, bankId);
      const list = Array.isArray(data) ? data : [];
      setSessions(list);
      return list;
    } catch (err) {
      logger.error('Failed to load sessions', err);
      toast.error('Failed to load sessions');
      return [];
    } finally {
      setLoadingSessions(false);
    }
  }, [serverId, bankId]);

  const ensureActiveSession = useCallback(
    async (list: ResearchSession[]) => {
      if (list.length === 0) {
        try {
          const created = await researchApi.createSession({
            server_id: serverId,
            bank_id: bankId,
            viewpoint_ids: [],
            title: 'Workspace session',
          });
          const refreshed = await loadSessions();
          const next = refreshed.find((s) => s.id === created.session_id) || refreshed[0] || null;
          if (next) {
            setActiveSessionId(next.id);
          }
          return next;
        } catch (err) {
          logger.error('Failed to create workspace session', err);
          toast.error('Failed to create workspace session');
          return null;
        }
      }
      const latest = list[0];
      setActiveSessionId(latest.id);
      return latest;
    },
    [serverId, bankId, loadSessions]
  );

  const loadItems = useCallback(async (sessionId: number) => {
    setLoadingItems(true);
    try {
      const steps = await researchApi.getSessionSteps(sessionId);
      const normalized = Array.isArray(steps) ? steps : [];
      setItems(normalized.filter(isWorkspaceItem));
    } catch (err) {
      logger.error('Failed to load session items', err);
      toast.error('Failed to load session items');
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setActiveSessionId(null);
    setItems([]);
    loadSessions().then((list) => {
      if (cancelled) return;
      ensureActiveSession(list).then((session) => {
        if (cancelled || !session) return;
        void loadItems(session.id);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [loadSessions, ensureActiveSession, loadItems, refreshSignal]);

  // Poll for running items so Reflect outputs update as the agent completes.
  useEffect(() => {
    if (!activeSessionId) return;
    const hasRunning = items.some((s) => s.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(() => {
      void loadItems(activeSessionId);
    }, 2000);
    return () => clearInterval(interval);
  }, [activeSessionId, items, loadItems]);

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
    if (!title || !activeSessionId) {
      handleCancelCreatePage();
      return;
    }
    try {
      const page = await researchApi.createSessionPage(activeSessionId, title);
      toast.success('Page created');
      setCreatingPage(false);
      setNewPageTitle('');
      await loadItems(activeSessionId);
      const step = items.find((s) => s.id === page.id);
      if (step) {
        onEditPage(step);
      } else {
        try {
          const full = await researchApi.getStep(page.id);
          if (isWorkspaceItem(full)) {
            onEditPage(full);
          }
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
    if (!activeSessionId) return;
    try {
      await researchApi.deleteStep(stepId);
      toast.success('Item deleted');
      await loadItems(activeSessionId);
    } catch (err) {
      logger.error('Failed to delete step', err);
      toast.error('Failed to delete item');
    }
  };

  const workspaceItems = useMemo(() => items, [items]);

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader title="Session items" count={workspaceItems.length} />
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between shrink-0">
            <span className="text-xs text-white/60 truncate" title={activeSession?.title || ''}>
              {activeSession?.title || (loadingSessions ? 'Loading…' : 'No session')}
            </span>
            {!creatingPage && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 h-7 text-xs"
                onClick={handleStartCreatePage}
                disabled={!activeSessionId || loadingItems}
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

            {workspaceItems.map((step) => {
              const isPage = step.action_type === 'curated_page';
              const isSelected = activeStepId === step.id;
              const isEditing = editingStepId === step.id;
              return (
                <div
                  key={step.id}
                  className={[
                    'group w-full flex items-center justify-between gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors text-xs cursor-pointer hover:text-white',
                    isSelected || isEditing
                      ? 'bg-emerald-500/20 text-emerald-100 border-emerald-500/30'
                      : 'text-white/90 border-white/5 bg-black/20',
                  ].join(' ')}
                  onClick={() => (isPage ? onEditPage(step) : onSelectStep(step))}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 h-full">
                    {isPage ? (
                      <FileText className="w-3.5 h-3.5 shrink-0 text-emerald-300" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate" title={step.intent_text || 'Untitled'}>
                        {step.intent_text || 'Untitled'}
                      </span>
                      <span className="text-[10px] text-white/40">
                        {formatStepDate(step.created_at)} · {isPage ? 'page' : 'reflect'}
                      </span>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <span
                        className="shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Item actions"
                        role="button"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 bg-[oklch(0.18_0_0)] border-white/10 text-white/90">
                      {isPage && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditPage(step);
                          }}
                        >
                          <Pencil className="h-3 w-3 mr-2" /> Edit
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-rose-400 focus:text-rose-400 focus:bg-rose-950/30"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteStep(step.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}

            {!creatingPage && workspaceItems.length === 0 && !loadingItems && (
              <div className="text-white/40 text-xs px-3 py-2">
                No workspace items yet. Create a page or run Reflect.
              </div>
            )}
            {loadingItems && workspaceItems.length === 0 && (
              <div className="text-white/40 text-xs px-3 py-2">Loading session items…</div>
            )}
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
