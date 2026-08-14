import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  researchApi,
  type DiscoverStepResponse,
  type ResearchSession,
  type ResearchStepSummary,
  type PrebuiltResponse,
  type GraphNode,
  type GraphEdge,
  ApiError,
} from '@/lib/api/client';
import { parseQueryTokens, buildSelectionPayload } from './query-tokens';
import { parseSectionDirectives } from './section-directives';
import { transformPrebuiltToDiscoverResponse } from './prebuilt';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';

const logger = createLogger('useResearchSession');

function isGraphObject(g: unknown): g is { nodes?: unknown[]; edges?: unknown[] } {
  return !!g && typeof g === 'object' && !Array.isArray(g);
}

function normalizeGraphShape(graph: unknown): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const sources: { nodes?: unknown[]; edges?: unknown[] }[] = [];
  if (Array.isArray(graph)) {
    for (const g of graph) {
      if (isGraphObject(g)) sources.push(g);
    }
  } else if (isGraphObject(graph)) {
    sources.push(graph);
  }
  return {
    nodes: sources.flatMap((g) => (Array.isArray(g.nodes) ? (g.nodes as GraphNode[]) : [])),
    edges: sources.flatMap((g) => (Array.isArray(g.edges) ? (g.edges as GraphEdge[]) : [])),
  };
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_MS = 10 * 60 * 1000;

export interface UseResearchSessionOptions {
  serverId: string;
  bankId: string;
  viewMode: 'step' | 'session';
  onViewModeChange?: (mode: 'step' | 'session') => void;
  availableTemplateRoles?: Array<{ value: string; label: string }>;
}

export interface ResearchQueryOptions {
  prebuilt?: {
    selectedEntities?: string[];
  };
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
  models?: {
    selections?: Array<{ kind: string; id: string; ext_id?: string; name?: string }>;
  };
  templates?: {
    selectedEntities?: string[];
    selections?: Array<{ kind: 'template' | 'derived_model'; ext_id: string; name?: string }>;
  };
}

const VALID_QUERY_MODES = new Set<'prebuilt' | 'recall' | 'reflect' | 'synthesize' | 'models' | 'templates'>(['prebuilt', 'recall', 'reflect', 'synthesize', 'models', 'templates']);

function buildDiscoverOptions(
  queryMode: 'prebuilt' | 'recall' | 'reflect' | 'synthesize' | 'models' | 'templates',
  queryOptions?: ResearchQueryOptions,
): Partial<Parameters<typeof researchApi.discover>[0]> {
  if (queryMode === 'recall') {
    const opts = queryOptions?.recall;
    if (!opts) return {};
    return {
      ...(Array.isArray(opts.types) && opts.types.length && { types: opts.types }),
      ...(typeof opts.preferObservations === 'boolean' && { prefer_observations: opts.preferObservations }),
      ...(typeof opts.includeSourceFacts === 'boolean' && { include_source_facts: opts.includeSourceFacts }),
      ...(typeof opts.includeSourceFacts === 'boolean' && opts.includeSourceFacts && { include: { source_facts: {} } }),
      ...(opts.budget && { budget: opts.budget }),
      ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
    };
  }

  if (queryMode === 'reflect') {
    const opts = queryOptions?.reflect;
    if (!opts) return {};
    return {
      ...(typeof opts.includeSourceFacts === 'boolean' && { include_source_facts: opts.includeSourceFacts }),
      ...(typeof opts.includeSourceFacts === 'boolean' && opts.includeSourceFacts && { include: { facts: {} } }),
      ...(opts.budget && { budget: opts.budget }),
      ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
      ...(opts.factTypes?.length && { fact_types: opts.factTypes }),
      ...(typeof opts.excludeMentalModels === 'boolean' && { exclude_mental_models: opts.excludeMentalModels }),
    };
  }

  if (queryMode === 'synthesize') {
    const opts = queryOptions?.synthesize;
    if (!opts) return {};
    return {
      ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
    };
  }

  if (queryMode === 'models' || queryMode === 'templates') {
    const key = queryMode;
    const opts = queryOptions?.[key];
    if (!opts?.selections?.length) return {};
    return {
      selections: opts.selections,
    };
  }

  return {};
}

function buildQueryOptionsFromParameters(
  actionType: string,
  parameters: Record<string, any> | null,
): ResearchQueryOptions {
  const opts: ResearchQueryOptions = {};
  if (!parameters) return opts;

  if (actionType === 'recall') {
    opts.recall = {
      ...(Array.isArray(parameters.types) && { types: parameters.types }),
      ...(typeof parameters.prefer_observations === 'boolean' && { preferObservations: parameters.prefer_observations }),
      ...(typeof parameters.include_source_facts === 'boolean'
        ? { includeSourceFacts: parameters.include_source_facts }
        : parameters.include?.source_facts != null
          ? { includeSourceFacts: true }
          : {}),
      ...(['low', 'mid', 'high'].includes(parameters.budget) && { budget: parameters.budget }),
      ...(typeof parameters.max_tokens === 'number' && { maxTokens: parameters.max_tokens }),
    };
  } else if (actionType === 'reflect') {
    const reflectBudget = ['low', 'mid', 'high'].includes(parameters.budget)
      ? (parameters.budget as 'low' | 'mid' | 'high')
      : undefined;
    opts.reflect = {
      ...(typeof parameters.include_source_facts === 'boolean'
        ? { includeSourceFacts: parameters.include_source_facts }
        : parameters.include?.facts != null
          ? { includeSourceFacts: true }
          : {}),
      ...(reflectBudget && { budget: reflectBudget }),
      ...(typeof parameters.max_tokens === 'number' && { maxTokens: parameters.max_tokens }),
      ...(Array.isArray(parameters.fact_types) && { factTypes: parameters.fact_types }),
      ...(typeof parameters.exclude_mental_models === 'boolean' && { excludeMentalModels: parameters.exclude_mental_models }),
    };
  } else if (actionType === 'synthesize') {
    opts.synthesize = {
      ...(typeof parameters.max_tokens === 'number' && { maxTokens: parameters.max_tokens }),
    };
  } else if (actionType === 'models') {
    opts.models = {
      ...(Array.isArray(parameters.selections) && { selections: parameters.selections }),
    };
  } else if (actionType === 'templates') {
    opts.templates = {
      ...(Array.isArray(parameters.selections) && { selections: parameters.selections }),
    };
  }

  return opts;
}

const DEFAULT_QUERY_OPTIONS: ResearchQueryOptions = {
  recall: {
    types: ['world', 'observation'],
    preferObservations: false,
    includeSourceFacts: false,
    budget: 'mid',
    maxTokens: 4096,
  },
  reflect: {
    includeSourceFacts: false,
    budget: 'low',
    maxTokens: 4096,
    factTypes: ['world', 'observation'],
    excludeMentalModels: false,
  },
  synthesize: {
    maxTokens: 4096,
  },
  templates: {
    selectedEntities: [],
    selections: [],
  },
};

export function useResearchSession({
  serverId,
  bankId,
  viewMode,
  onViewModeChange,
  availableTemplateRoles = [],
}: UseResearchSessionOptions) {
  const [query, setQuery] = useState('');
  const [queryMode, setQueryMode] = useState<'prebuilt' | 'recall' | 'reflect' | 'synthesize' | 'models' | 'templates'>('prebuilt');
  const [selectedTemplateRoles, setSelectedTemplateRoles] = useState<string[]>([]);
  const [queryOptions, setQueryOptions] = useState<ResearchQueryOptions>({
    recall: { ...DEFAULT_QUERY_OPTIONS.recall },
    reflect: { ...DEFAULT_QUERY_OPTIONS.reflect },
    synthesize: { ...DEFAULT_QUERY_OPTIONS.synthesize },
  });

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
      for (const n of normalizeGraphShape(step.canvas?.graph).nodes) {
        if (n.source === 'canonical' || n.source === 'alias') ids.add(n.id);
      }
    }
    return ids;
  }, [trail, selectedStepIds]);

  const fetchSessions = useCallback(async (sid: number, bid: string): Promise<ResearchSession[]> => {
    setSessionsLoading(true);
    try {
      const data = await researchApi.listSessions(sid, bid);
      const next = Array.isArray(data) ? data : [];
      setSessions(next);
      return next;
    } catch (err) {
      logger.error('Failed to fetch sessions', err);
      setSessions([]);
      return [];
    } finally {
      setSessionsLoading(false);
    }
  }, []);

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
  useEffect(() => {
    if (!bankId) {
      setSessions([]);
      setActiveSessionId(null);
      setTrail([]);
      setSelectedStepIds(new Set());
      setActiveStepId(null);
      setResult(null);
      setError(null);
      hasSeededSelectionRef.current = false;
      return;
    }

    // Reset all derived state from the previous bank so we cannot briefly
    // auto-select a stale session while the new bank's sessions are loading.
    setSessions([]);
    setActiveSessionId(null);
    setTrail([]);
    setSelectedStepIds(new Set());
    setActiveStepId(null);
    setResult(null);
    setError(null);
    hasSeededSelectionRef.current = false;

    void fetchSessions(parseInt(serverId, 10), bankId).then((loaded) => {
      if (loaded.length === 0) return;
      const latest = loaded[0];
      setActiveSessionId(latest.id);
      void fetchTrail(latest.id);
    });
  }, [bankId, fetchSessions, fetchTrail]);



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
          if (step.error_message) {
            toast.warning(`Research completed with warnings: ${step.error_message}`);
          }
          if (viewMode === 'step') {
            setSelectedStepIds(new Set([stepId]));
            setActiveStepId(stepId);
          } else {
            setSelectedStepIds((prev) => new Set([...prev, stepId]));
          }
          if (step.canvas && step.synthesis) {
            setResult({
              step_id: step.id,
              session_id: step.session_id,
              status: 'completed',
              bank_id: bankId,
              viewpoint_ids: step.viewpoint_ids || [],
              query_depth: step.action_type,
              action_type: step.action_type,
              parameters: step.parameters,
              synthesis: step.synthesis,
              canvas: step.canvas,
              tool_calls_used: step.tool_calls_used,
              error_message: step.error_message || null,
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
        server_id: parseInt(serverId, 10),
        bank_id: bankId,
        viewpoint_ids: [],
        title,
      });
      const sessionId = created.session_id;
      setActiveSessionId(sessionId);
      setCreatingSession(false);
      await fetchSessions(parseInt(serverId, 10), bankId);
      return sessionId;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to create session', err);
      toast.error(`Failed to create session: ${message}`);
      throw err;
    }
  }, [bankId, serverId, fetchSessions]);

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
        query_depth: step.action_type,
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

  const handleRerunStep = useCallback(async (stepId: number) => {
    if (!serverId) {
      toast.error('Select a server first');
      return;
    }
    try {
      const response = await researchApi.rerunStep(stepId, {
        server_id: parseInt(serverId, 10),
      });
      setRunningStepId(stepId);
      onViewModeChange?.('step');
      setActiveStepId(stepId);
      setSelectedStepIds(new Set());
      await pollForStepCompletion(response.session_id, stepId);
      logger.info('Research step re-run completed', {
        session_id: response.session_id,
        step_id: stepId,
      });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to re-run step', err);
      toast.error(`Failed to re-run query: ${message}`);
    } finally {
      setRunningStepId((prev) => (prev === stepId ? null : prev));
    }
  }, [serverId, pollForStepCompletion, onViewModeChange]);

  const handleLoadStepDetails = useCallback(async (stepId: number) => {
    try {
      const step = await researchApi.getStep(stepId);
      if (step.action_type === 'synthesize') {
        toast.info('"Use details" is not available for synthesis steps yet');
        return;
      }

      setQuery(step.intent_text || '');

      if (VALID_QUERY_MODES.has(step.action_type as any)) {
        setQueryMode(step.action_type as 'prebuilt' | 'recall' | 'reflect' | 'synthesize' | 'models' | 'templates');
      } else {
        logger.warn('Unsupported action_type for use details', { action_type: step.action_type });
      }

      setQueryOptions((prev) => ({
        ...prev,
        ...buildQueryOptionsFromParameters(step.action_type, step.parameters),
      }));

      if (step.action_type === 'prebuilt' && Array.isArray(step.parameters?.roles)) {
        const validValues = new Set(availableTemplateRoles.map((r) => r.value));
        const restored = step.parameters.roles.filter((r: string) => validValues.has(r));
        setSelectedTemplateRoles(restored);
      } else if (step.action_type === 'models' && step.parameters && Array.isArray(step.parameters.selections)) {
        const modelSelections = step.parameters.selections;
        setQueryOptions((prev) => ({
          ...prev,
          models: {
            selections: modelSelections,
          },
        }));
      } else if (step.action_type === 'templates' && step.parameters && Array.isArray(step.parameters.selections)) {
        const templateSelections = step.parameters.selections;
        setQueryOptions((prev) => ({
          ...prev,
          templates: {
            selections: templateSelections,
          },
        }));
      } else if (step.action_type !== 'prebuilt') {
        setSelectedTemplateRoles([]);
      }

      toast.success('Loaded query details into query card');
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      logger.error('Failed to load step details', err);
      toast.error(`Failed to load query details: ${message}`);
    }
  }, [availableTemplateRoles]);

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
        ...(queryOptions.synthesize?.maxTokens != null
          ? { max_tokens: queryOptions.synthesize.maxTokens }
          : {}),
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
  }, [serverId, bankId, activeSessionId, queryOptions, pollForStepCompletion, onViewModeChange, setActiveStepId, setSelectedStepIds]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    if (queryMode === 'models' || queryMode === 'templates') {
      const selections = queryMode === 'models'
        ? queryOptions.models?.selections || []
        : queryOptions.templates?.selections || [];
      if (selections.length === 0) {
        toast.error(queryMode === 'models' ? 'Select at least one mental model' : 'Select at least one template');
        return;
      }
    } else if (queryMode !== 'prebuilt' && !query.trim()) {
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

    if (queryMode === 'templates') {
      const templateSelections = queryOptions.templates?.selections || [];
      if (templateSelections.length === 0) {
        toast.error('Select at least one template');
        return;
      }
    }

    const tokens = parseQueryTokens(query);
    const entityIds = tokens
      .filter((t) => t.kind === 'entity')
      .map((t) => (t.type ? `${t.type}:${t.id}` : t.id));

    if (queryMode === 'prebuilt') {
      if (selectedTemplateRoles.length === 0) {
        toast.error('Select at least one template role');
        return;
      }
      const selectedEntities = queryOptions.prebuilt?.selectedEntities;
      if (selectedEntities && selectedEntities.length > 0) {
        // Override entityIds with explicitly selected entities
        entityIds.splice(0, entityIds.length, ...selectedEntities);
      }
      if (entityIds.length === 0) {
        toast.error('Include at least one entity for prebuilt research');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const prebuilt = await researchApi.prebuilt({
          server_id: parseInt(serverId, 10),
          bank_id: bankId,
          entities: entityIds,
          roles: selectedTemplateRoles,
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
          await fetchSessions(parseInt(serverId, 10), bankId);
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
      let title: string;
      if (queryMode === 'models') {
        const names = queryOptions.models?.selections?.map((s) => s.name || s.ext_id || `model:${s.id}`) || [];
        title = names.slice(0, 3).join(', ').slice(0, 80) || 'Models query';
      } else if (queryMode === 'templates') {
        const names = queryOptions.templates?.selections?.map((s) => s.name || s.ext_id) || [];
        title = names.slice(0, 3).join(', ').slice(0, 80) || 'Templates query';
      } else {
        title = query.trim().slice(0, 80) || 'Untitled session';
      }
      try {
        const created = await researchApi.createSession({
          server_id: parseInt(serverId, 10),
          bank_id: bankId,
          viewpoint_ids: [],
          title,
        });
        sessionId = created.session_id;
        setActiveSessionId(sessionId);
        await fetchSessions(parseInt(serverId, 10), bankId);
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
      const parsed = parseSectionDirectives(
        queryMode === 'models'
          ? 'Mental models: ' + (queryOptions.models?.selections?.map((s) => s.name || s.ext_id || `model:${s.id}`).join(', ') || '')
          : queryMode === 'templates'
            ? 'Templates: ' + (queryOptions.templates?.selections?.map((s) => s.name || s.ext_id).join(', ') || '')
            : query.trim(),
      );

      const response = await researchApi.discover({
        server_id: parseInt(serverId, 10),
        session_id: sessionId,
        bank_id: bankId,
        viewpoint_ids: [],
        intent_text: parsed.intentText,
        query_depth: queryMode,
        ...buildDiscoverOptions(queryMode, queryOptions),
        ...(parsed.sectionFocus ? { section_focus: parsed.sectionFocus } : {}),
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
  }, [serverId, bankId, query, queryMode, selectedTemplateRoles, activeSessionId, queryOptions, fetchSessions, pollForStepCompletion, viewMode, selectedStepIds, activeStepId, handleSynthesize]);

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
    query,
    setQuery,
    queryMode,
    setQueryMode,
    selectedTemplateRoles,
    setSelectedTemplateRoles,
    queryOptions,
    setQueryOptions,
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
    handleRerunStep,
    handleLoadStepDetails,
    handleSubmit,
    handleSynthesize,
  };
}