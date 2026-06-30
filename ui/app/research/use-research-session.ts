import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  researchApi,
  type DiscoverStepResponse,
  type ResearchSession,
  type ResearchStepSummary,
  type PrebuiltResponse,
  ApiError,
} from '@/lib/api/client';
import { parseQueryTokens, buildSelectionPayload } from './query-tokens';
import { transformPrebuiltToDiscoverResponse } from './prebuilt';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';

const logger = createLogger('useResearchSession');

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 10 * 60 * 1000;

export interface UseResearchSessionOptions {
  serverId: string;
  bankId: string;
  query: string;
  setQuery: (q: string) => void;
  queryMode: 'prebuilt' | 'recall' | 'reflect' | 'synthesize';
  dimensions: string[];
  viewMode: 'step' | 'session';
  onViewModeChange?: (mode: 'step' | 'session') => void;
  queryOptions?: ResearchQueryOptions;
}

export interface ResearchQueryOptions {
  recall?: {
    types?: string[];
    preferObservations?: boolean;
    includeSourceFacts?: boolean;
    budget?: 'low' | 'mid' | 'high';
    maxTokens?: number;
  };
  reflect?: {
    includeSourceFacts?: boolean;
    budget?: 'low' | 'mid' | 'high';
    maxTokens?: number;
    factTypes?: string[];
    excludeMentalModels?: boolean;
  };
  synthesize?: {
    maxTokens?: number;
  };
}

function buildDiscoverOptions(
  queryMode: 'prebuilt' | 'recall' | 'reflect' | 'synthesize',
  queryOptions?: ResearchQueryOptions,
): Partial<Parameters<typeof researchApi.discover>[0]> {
  if (queryMode === 'recall') {
    const opts = queryOptions?.recall;
    if (!opts) return {};
    return {
      ...(opts.types?.length && { types: opts.types }),
      ...(typeof opts.preferObservations === 'boolean' && { prefer_observations: opts.preferObservations }),
      ...(typeof opts.includeSourceFacts === 'boolean' && opts.includeSourceFacts && { include: { source_facts: {} } }),
      ...(opts.budget && { budget: opts.budget }),
      ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
    };
  }

  if (queryMode === 'reflect') {
    const opts = queryOptions?.reflect;
    if (!opts) return {};
    return {
      ...(typeof opts.includeSourceFacts === 'boolean' && opts.includeSourceFacts && { include: { facts: {} } }),
      ...(opts.budget && { budget: opts.budget }),
      ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
      ...(opts.factTypes?.length && { fact_types: opts.factTypes }),
      ...(typeof opts.excludeMentalModels === 'boolean' && { exclude_mental_models: opts.excludeMentalModels }),
    };
  }

  return {};
}

export function useResearchSession({
  serverId,
  bankId,
  query,
  setQuery,
  queryMode,
  dimensions,
  viewMode,
  onViewModeChange,
  queryOptions,
}: UseResearchSessionOptions) {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [trail, setTrail] = useState<ResearchStepSummary[]>([]);
  const [trailLoading, setTrailLoading] = useState(false);
  const [selectedStepIds, setSelectedStepIds] = useState<Set<number>>(new Set());
  const [activeStepId, setActiveStepId] = useState<number | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [stepToDelete, setStepToDelete] = useState<number | null>(null);
  const [deletingStepId, setDeletingStepId] = useState<number | null>(null);
  const [runningStepId, setRunningStepId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DiscoverStepResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasSeededSelectionRef = useRef(false);

  // Focus entities are derived from selected step canvases so the hook can
  // compute them internally without a circular dependency on useResearchGraph.
  const focusEntityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const step of trail.filter((s) => selectedStepIds.has(s.id))) {
      for (const n of step.canvas?.graph?.nodes || []) {
        if (n.source === 'canonical' || n.source === 'alias') ids.add(n.id);
      }
    }
    return ids;
  }, [trail, selectedStepIds]);

  const fetchSessions = useCallback(async (bid: string) => {
    setSessionsLoading(true);
    try {
      const data = await researchApi.listSessions(bid);
      setSessions(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to fetch sessions', err);
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!bankId) {
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
    fetchSessions(bankId);
  }, [bankId, fetchSessions]);

  const fetchTrail = useCallback(async (sessionId: number) => {
    setTrailLoading(true);
    try {
      const steps = await researchApi.getSessionSteps(sessionId);
      const normalized = Array.isArray(steps) ? steps : [];
      setTrail((prev) => {
        const nextJson = JSON.stringify(normalized);
        const prevJson = JSON.stringify(prev);
        return nextJson === prevJson ? prev : normalized;
      });
      return normalized;
    } catch (err) {
      logger.error('Failed to fetch trail', err);
      return [];
    } finally {
      setTrailLoading(false);
    }
  }, []);

  // Auto-select the most recent session when sessions load and none is active.
  useEffect(() => {
    if (activeSessionId !== null || sessions.length === 0) return;
    const latest = sessions[0];
    if (latest) {
      setActiveSessionId(latest.id);
      void fetchTrail(latest.id);
    }
  }, [sessions, activeSessionId, fetchTrail]);

  // In session/merge mode, seed the selection with all steps when a trail first
  // loads and nothing is selected, so the merged narrative appears immediately.
  useEffect(() => {
    if (viewMode !== 'session') {
      hasSeededSelectionRef.current = false;
      return;
    }
    if (trail.length > 0 && selectedStepIds.size === 0 && !hasSeededSelectionRef.current) {
      setSelectedStepIds(new Set(trail.map((s) => s.id)));
      hasSeededSelectionRef.current = true;
    }
  }, [viewMode, trail, selectedStepIds]);

  // Clear stale active step when it no longer belongs to the active trail/session.
  useEffect(() => {
    if (activeStepId === null) return;
    const belongsToTrail = trail.some((s) => s.id === activeStepId);
    const belongsToSession = sessions.some((s) => s.id === activeSessionId);
    if (!belongsToTrail || !belongsToSession) {
      setActiveStepId(null);
    }
  }, [trail, activeStepId, sessions, activeSessionId]);

  const pollForStepCompletion = useCallback(async (sessionId: number, stepId: number): Promise<ResearchStepSummary | null> => {
    setRunningStepId(stepId);
    const start = Date.now();
    try {
      while (Date.now() - start < MAX_POLL_MS) {
        const steps = await fetchTrail(sessionId);
        const step = steps.find((s) => s.id === stepId);
        if (!step) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          continue;
        }
        if (step.status === 'completed') {
          if (viewMode === 'step') {
            setSelectedStepIds(new Set([stepId]));
            setActiveStepId(stepId);
          } else {
            setSelectedStepIds((prev) => new Set([...prev, stepId]));
          }
          if (step.canvas && step.synthesis) {
            const queryDepth =
              step.action_type === 'prebuilt' ||
              step.action_type === 'recall' ||
              step.action_type === 'reflect' ||
              step.action_type === 'synthesize'
                ? step.action_type
                : undefined;
            setResult({
              step_id: step.id,
              session_id: step.session_id,
              status: 'completed',
              bank_id: bankId,
              viewpoint_ids: step.viewpoint_ids || [],
              query_depth: queryDepth,
              action_type: step.action_type,
              parameters: step.parameters,
              synthesis: step.synthesis,
              canvas: step.canvas,
              tool_calls_used: step.tool_calls_used,
              error_message: null,
            });
          }
          return step;
        }
        if (step.status === 'failed') {
          setError(step.error_message || 'Research step failed');
          toast.error(`Research failed: ${step.error_message || 'Unknown error'}`);
          return step;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      setError('Timed out waiting for research step to complete');
      toast.error('Research step timed out');
      return null;
    } finally {
      setRunningStepId((prev) => (prev === stepId ? null : prev));
    }
  }, [bankId, fetchTrail, viewMode]);

  const handleCreateSession = useCallback(async (title: string) => {
    try {
      const created = await researchApi.createSession({
        bank_id: bankId,
        viewpoint_ids: [],
        title,
      });
      const sessionId = created.session_id;
      setActiveSessionId(sessionId);
      setCreatingSession(false);
      await fetchSessions(bankId);
      return sessionId;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to create session', err);
      toast.error(`Failed to create session: ${message}`);
      throw err;
    }
  }, [bankId, fetchSessions]);

  const handleRenameSession = useCallback(async (sessionId: number, title: string) => {
    try {
      await researchApi.updateSession(sessionId, { title });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title } : s)),
      );
      toast.success('Session renamed');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to rename session', err);
      toast.error(`Failed to rename session: ${message}`);
    }
  }, []);

  const handleDeleteSession = useCallback(async (sessionId: number) => {
    try {
      await researchApi.deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setTrail([]);
        setSelectedStepIds(new Set());
        setResult(null);
      }
      toast.success('Session deleted');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to delete session', err);
      toast.error(`Failed to delete session: ${message}`);
    }
  }, [activeSessionId]);

  const handleSelectSession = useCallback(async (session: ResearchSession) => {
    setActiveSessionId(session.id);
    setResult(null);
    await fetchTrail(session.id);
  }, [fetchTrail]);

  const toggleStepSelection = useCallback((stepId: number) => {
    setSelectedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const selectAllSteps = useCallback(() => {
    setSelectedStepIds(new Set(trail.map((s) => s.id)));
  }, [trail]);

  const clearStepSelection = useCallback(() => {
    setSelectedStepIds(new Set());
  }, []);

  const handleLoadStep = useCallback(async (stepId: number) => {
    try {
      setLoading(true);
      setError(null);
      const step = await researchApi.getStep(stepId);
      if (!step.canvas || !step.synthesis) {
        toast.error('Step has no rendered data');
        return;
      }
      setResult({
        step_id: step.id,
        session_id: step.session_id,
        status: step.status || 'completed',
        bank_id: bankId,
        viewpoint_ids: step.viewpoint_ids || [],
        query_depth:
          step.action_type === 'prebuilt' ||
          step.action_type === 'recall' ||
          step.action_type === 'reflect' ||
          step.action_type === 'synthesize'
            ? step.action_type
            : undefined,
        action_type: step.action_type,
        parameters: step.parameters,
        synthesis: step.synthesis,
        canvas: step.canvas,
        tool_calls_used: step.tool_calls_used,
        error_message: step.error_message || null,
      });
      setActiveStepId(step.id);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to load step', err);
      toast.error(`Failed to load step: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [bankId]);

  const handleDeleteStep = useCallback(async (stepId: number) => {
    setDeletingStepId(stepId);
    try {
      const response = await researchApi.deleteStep(stepId);
      setSelectedStepIds((prev) => {
        const next = new Set(prev);
        next.delete(stepId);
        return next;
      });
      if (activeStepId === stepId) {
        setActiveStepId(null);
        setResult(null);
      }
      const refreshed = await fetchTrail(response.session_id);
      if (refreshed.length > 0) {
        setSelectedStepIds(new Set(refreshed.map((s) => s.id)));
      }
      toast.success('Query deleted');
      setStepToDelete(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to delete step', err);
      toast.error(`Failed to delete query: ${message}`);
    } finally {
      setDeletingStepId(null);
    }
  }, [activeStepId, fetchTrail]);

  const handleSynthesize = useCallback(async (sourceStepIds: number[], intentText: string) => {
    if (!serverId || !bankId || !activeSessionId) {
      toast.error('Select a server, bank, and session first');
      return;
    }
    if (sourceStepIds.length === 0) {
      toast.error('Select at least one trail step to synthesize');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await researchApi.synthesize({
        server_id: parseInt(serverId, 10),
        bank_id: bankId,
        session_id: activeSessionId,
        source_step_ids: sourceStepIds,
        intent_text: intentText.trim(),
        ...(queryOptions?.synthesize?.maxTokens != null && { max_tokens: queryOptions.synthesize.maxTokens }),
      });
      setActiveSessionId(response.session_id);
      onViewModeChange?.('step');
      setActiveStepId(response.step_id);
      setSelectedStepIds((prev) => new Set([...prev, response.step_id]));
      await pollForStepCompletion(response.session_id, response.step_id);
      logger.info('Research synthesize step completed', {
        session_id: response.session_id,
        step_id: response.step_id,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Research synthesize failed', err);
      setError(message);
      toast.error(`Synthesis failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [serverId, bankId, activeSessionId, pollForStepCompletion, onViewModeChange, setActiveStepId, setSelectedStepIds]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    if (!query.trim()) {
      toast.error('Enter a query');
      return;
    }

    if (queryMode === 'synthesize') {
      const sourceStepIds = selectedStepIds.size > 0
        ? Array.from(selectedStepIds)
        : activeStepId != null
          ? [activeStepId]
          : [];
      await handleSynthesize(sourceStepIds, query);
      return;
    }

    const tokens = parseQueryTokens(query);
    const entityIds = tokens
      .filter((t) => t.kind === 'entity')
      .map((t) => (t.type ? `${t.type}:${t.id}` : t.id));

    if (queryMode === 'prebuilt') {
      if (dimensions.length === 0) {
        toast.error('Select at least one dimension');
        return;
      }
      if (entityIds.length === 0) {
        toast.error('Include at least one entity token for prebuilt research');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const prebuilt = await researchApi.prebuilt({
          server_id: parseInt(serverId, 10),
          bank_id: bankId,
          entities: entityIds,
          dimensions,
          session_id: activeSessionId ?? undefined,
        });
        if (!prebuilt.success) {
          throw new Error(prebuilt.error || 'Prebuilt research failed');
        }
        setResult(transformPrebuiltToDiscoverResponse(prebuilt, bankId));
        if (prebuilt.session_id) {
          setActiveSessionId(prebuilt.session_id);
          if (viewMode === 'step') {
            setActiveStepId(prebuilt.step_id ?? null);
            setSelectedStepIds(prebuilt.step_id ? new Set([prebuilt.step_id]) : new Set());
          }
          await fetchSessions(bankId);
          await fetchTrail(prebuilt.session_id);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err);
        logger.error('Prebuilt research failed', err);
        setError(message);
        toast.error(`Prebuilt research failed: ${message}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    let sessionId = activeSessionId;
    if (!sessionId) {
      const title = query.trim().slice(0, 80) || 'Untitled session';
      try {
        const created = await researchApi.createSession({
          bank_id: bankId,
          viewpoint_ids: [],
          title,
        });
        sessionId = created.session_id;
        setActiveSessionId(sessionId);
        await fetchSessions(bankId);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err);
        logger.error('Failed to auto-create session', err);
        toast.error(`Failed to create session: ${message}`);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const response = await researchApi.discover({
        server_id: parseInt(serverId, 10),
        session_id: sessionId,
        bank_id: bankId,
        viewpoint_ids: [],
        intent_text: query.trim(),
        query_depth: queryMode,
        selections: buildSelectionPayload(tokens),
        ...buildDiscoverOptions(queryMode, queryOptions),
      });
      // The route returns 202 immediately. Do not treat it as the final result;
      // polling will set result once the step completes.
      setActiveSessionId(response.session_id);
      setActiveStepId(response.step_id);
      await pollForStepCompletion(response.session_id, response.step_id);
      logger.info('Research discover step completed', {
        session_id: response.session_id,
        step_id: response.step_id,
        calls: response.calls?.length,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Research discover failed', err);
      setError(message);
      toast.error(`Research failed: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [serverId, bankId, query, queryMode, dimensions, activeSessionId, queryOptions, fetchSessions, pollForStepCompletion, viewMode, selectedStepIds, activeStepId, handleSynthesize]);

  return {
    sessions,
    sessionsLoading,
    activeSessionId,
    trail,
    trailLoading,
    selectedStepIds,
    setSelectedStepIds,
    activeStepId,
    setActiveStepId,
    creatingSession,
    setCreatingSession,
    stepToDelete,
    setStepToDelete,
    deletingStepId,
    runningStepId,
    loading,
    result,
    setResult,
    error,
    setError,
    fetchSessions,
    handleCreateSession,
    handleRenameSession,
    handleDeleteSession,
    handleSelectSession,
    toggleStepSelection,
    selectAllSteps,
    clearStepSelection,
    handleLoadStep,
    handleDeleteStep,
    handleSubmit,
    handleSynthesize,
  };
}
