import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import {
  useResearchSession,
  type ResearchQueryOptions,
} from '@/app/research-shared/use-research-session';
import { researchApi, type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';

const logger = createLogger('useWorkspaceSession');

const WORKSPACE_ITEM_TYPES = new Set(['reflect']);

export interface UseWorkspaceSessionOptions {
  serverId: number | null;
  bankId: string | null;
  lastSessionId?: number | null;
}

export function useWorkspaceSession({ serverId, bankId, lastSessionId }: UseWorkspaceSessionOptions) {
  const [autoCreating, setAutoCreating] = useState(false);
  const research = useResearchSession({
    serverId: serverId?.toString() ?? '',
    bankId: bankId ?? '',
    viewMode: 'step',
    initialSessionId: lastSessionId,
  });

  const {
    sessions,
    sessionsLoading,
    activeSessionId,
    trail,
    trailLoading,
    fetchSessions,
    fetchTrail,
    setActiveSessionId,
    query,
    setQuery,
    queryOptions,
    setQueryOptions,
    loading,
    error,
    result,
    activeStepId,
    runningStepId: researchRunningStepId,
    handleSubmit,
    setQueryMode,
  } = research;

  // Workspace is always in Reflect mode; pin the underlying research hook so
  // submissions use the existing working discover/poll path.
  useEffect(() => {
    setQueryMode('reflect');
  }, [setQueryMode]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  const workspaceItems = useMemo(
    () => trail.filter((step) => WORKSPACE_ITEM_TYPES.has(step.action_type || 'discover')),
    [trail]
  );

  const curatedPages = useMemo(
    () => trail.filter((step) => step.action_type === 'curated_page'),
    [trail]
  );

  const runningStepId = useMemo(() => {
    const running = workspaceItems.find((s) => s.status === 'running');
    return running?.id ?? researchRunningStepId ?? null;
  }, [workspaceItems, researchRunningStepId]);

  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const refresh = useCallback(async () => {
    if (!serverId || !bankId) return;
    const loaded = await fetchSessions(serverId, bankId);
    if (loaded.length === 0) {
      setAutoCreating(true);
      try {
        const created = await researchApi.createSession({
          server_id: serverId,
          bank_id: bankId,
          viewpoint_ids: [],
          title: 'Workspace session',
        });
        const refreshed = await fetchSessions(serverId, bankId);
        const next = refreshed.find((s) => s.id === created.session_id) || refreshed[0] || null;
        if (next) {
          setActiveSessionId(next.id);
          await fetchTrail(next.id);
        }
      } catch (err) {
        logger.error('Failed to create workspace session', err);
        toast.error('Failed to create workspace session');
      } finally {
        setAutoCreating(false);
      }
      return;
    }
    const currentId = activeSessionIdRef.current;
    const next = loaded.find((s) => s.id === currentId) ?? loaded[0] ?? null;
    if (next == null) return;
    if (next.id !== activeSessionId) {
      setActiveSessionId(next.id);
    }
    await fetchTrail(next.id);
  }, [serverId, bankId, fetchSessions, fetchTrail, activeSessionId, setActiveSessionId]);

  // Load/refresh when server/bank changes.
  useEffect(() => {
    if (!serverId || !bankId) return;
    void refresh();
  }, [serverId, bankId, refresh]);

  return {
    ...research,
    activeSession,
    workspaceItems,
    curatedPages,
    runningStepId,
    refresh,
    autoCreating,
    sessionsLoading: sessionsLoading || autoCreating,
    trailLoading,
  };
}

export type { ResearchSession, ResearchStepSummary, ResearchQueryOptions };
