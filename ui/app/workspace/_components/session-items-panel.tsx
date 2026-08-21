'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus } from 'lucide-react';
import { researchApi, type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { Panel, PanelHeader, PanelContent } from './panel-layout';
import { QueryTrail } from '@/app/research/query-trail';

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
  onReuseStep?: (step: ResearchStepSummary) => void;
  onRerunStep?: (stepId: number) => Promise<unknown>;
  onInspectStep?: (step: ResearchStepSummary) => void;
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
  onReuseStep,
  onRerunStep,
  onInspectStep,
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
      const result = await researchApi.createSessionPage(activeSessionId, title);
      toast.success('Page created');
      setCreatingPage(false);
      setNewPageTitle('');
      await loadItems(activeSessionId);
      const step = items.find((s) => s.id === result.id);
      if (step) {
        onEditPage(step);
      } else {
        try {
          const full = await researchApi.getStep(result.id);
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

  const runningStepId = useMemo(() => {
    const running = items.find((s) => s.status === 'running');
    return running?.id ?? null;
  }, [items]);

  return (
    <Panel className="flex-1 min-h-0">
      <PanelHeader title="Session items" count={items.length} />
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

            <QueryTrail
              trail={items}
              selectedStepIds={new Set()}
              activeStepId={activeStepId ?? null}
              runningStepId={runningStepId}
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

            {!creatingPage && items.length === 0 && !loadingItems && (
              <div className="text-white/40 text-xs px-3 py-2">
                No workspace items yet. Create a page or run Reflect.
              </div>
            )}
            {loadingItems && items.length === 0 && (
              <div className="text-white/40 text-xs px-3 py-2">Loading session items…</div>
            )}
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
