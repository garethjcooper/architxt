'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import {
  entitiesApi,
  serversApi,
  mentalModelsApi,
  researchApi,
  type Server,
  type Entity,
  type GraphNode,
  type GraphEdge,
  type ResearchStepSummary,
} from '@/lib/api/client';
import { InteractiveGraph, type GraphLayout } from '@/components/research-canvas';
import { QueryForm } from './query-form';
import { QueryInspectDialog } from './query-inspect-dialog';
import { ServerBankSelectors, type SelectorServer, type SelectorBank } from './server-bank-selectors';
import { formatEntityToken, formatEdgeToken } from './query-tokens';
import { QueryTrail } from './query-trail';
import { CompositeEntities, type EntityTab } from './composite-entities';
import { CompositeEdges, type EdgeTab } from './composite-edges';
import { SessionList } from './session-list';
import { ResearchSession } from '@/lib/api/client';
import {
  useResearchSession,
  type ResearchQueryOptions,
} from './use-research-session';
import { useResearchGraph, resolveNodeType, canonicalEntityId } from './use-research-graph';
import { ResearchResultPanel } from './research-result-panel';

const logger = createLogger('ResearchPage');

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
};

export default function ResearchPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [banks, setBanks] = useState<Array<{ bank_id: string; name: string; description?: string }>>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');

  const [queryCursor, setQueryCursor] = useState(0);
  const queryCursorRef = useRef(queryCursor);

  useEffect(() => {
    queryCursorRef.current = queryCursor;
  }, [queryCursor]);

  const [allEntities, setAllEntities] = useState<Entity[]>([]);
  const [bankTags, setBankTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [globalGraph, setGlobalGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [globalGraphLoading, setGlobalGraphLoading] = useState(false);

  const [entityTab, setEntityTab] = useState<EntityTab>('entities');
  const [edgeTab, setEdgeTab] = useState<EdgeTab>('found');
  const [viewMode, setViewMode] = useState<'step' | 'session'>('step');
  const [availableDimensions, setAvailableDimensions] = useState<Array<{ value: string; label: string }>>([
    { value: 'interface', label: 'Interface' },
  ]);
  const resultView: 'narrative' = 'narrative';
  const [canvasView, setCanvasView] = useState<'graph' | 'components'>('graph');
  const [viewLayouts, setViewLayouts] = useState<Record<'graph' | 'components', GraphLayout>>({
    graph: 'avsdf',
    components: 'dagre',
  });
  const [viewEdgeFilters, setViewEdgeFilters] = useState<Record<'graph' | 'components', Set<string>>>({
    graph: new Set(),
    components: new Set(),
  });
  const [viewNodeFilters, setViewNodeFilters] = useState<Record<'graph' | 'components', Set<string>>>({
    graph: new Set(),
    components: new Set(),
  });
  const [graphLayoutAnimate, setGraphLayoutAnimate] = useState(true);
  const [viewShowEdgeLabels, setViewShowEdgeLabels] = useState<Record<'graph' | 'components', boolean>>({
    graph: false,
    components: false,
  });
  const [narrativeWidths, setNarrativeWidths] = useState<Record<'graph' | 'components', number>>({
    graph: 40,
    components: 40,
  });
  const [viewNarrativePlain, setViewNarrativePlain] = useState<Record<'graph' | 'components', boolean>>({
    graph: false,
    components: false,
  });
  const graphLayout = viewLayouts[canvasView];
  const graphEdgeFilters = viewEdgeFilters[canvasView];
  const graphNodeFilters = viewNodeFilters[canvasView];
  const showEdgeLabels = viewShowEdgeLabels[canvasView];
  const narrativeWidth = narrativeWidths[canvasView];
  const showNarrativePlain = viewNarrativePlain[canvasView];
  const setShowEdgeLabels = useCallback((value: boolean) => {
    setViewShowEdgeLabels((prev) => ({ ...prev, [canvasView]: value }));
  }, [canvasView]);
  const setShowNarrativePlain = useCallback((value: boolean) => {
    setViewNarrativePlain((prev) => ({ ...prev, [canvasView]: value }));
  }, [canvasView]);
  const setGraphLayout = useCallback((layout: GraphLayout) => {
    setViewLayouts((prev) => ({ ...prev, [canvasView]: layout }));
  }, [canvasView]);
  const toggleGraphEdgeFilter = useCallback((type: string) => {
    setViewEdgeFilters((prev) => {
      const next = new Set(prev[canvasView]);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, [canvasView]: next };
    });
  }, [canvasView]);
  const toggleGraphNodeFilter = useCallback((type: string) => {
    setViewNodeFilters((prev) => {
      const next = new Set(prev[canvasView]);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { ...prev, [canvasView]: next };
    });
  }, [canvasView]);
  const [stepToInspect, setStepToInspect] = useState<ResearchStepSummary | null>(null);

  const {
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
    selectedDimensions,
    setSelectedDimensions,
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
  } = useResearchSession({
    serverId: selectedServerId,
    bankId: selectedBankId,
    viewMode,
    onViewModeChange: setViewMode,
    availableDimensions,
  });

  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const activeSession = useMemo(() => sessions.find((s) => s.id === activeSessionId), [sessions, activeSessionId]);
  const activeSessionName = activeSession?.title || 'narrative';

  const {
    graphNodes,
    graphEdges,
    entities,
    entityInScopeCount,
    entityTotalCount,
    edges,
    edgeInScopeCount,
    edgeTotalCount,
    globalEntities,
    globalCooccurrenceEdges,
    selectedStepEdges,
  } = useResearchGraph(trail, selectedStepIds, globalGraph, result, viewMode, activeStepId);

  const visibleEntities = entityTab === 'entities'
    ? entities
    : entityTab === 'global'
      ? globalEntities
      : [];

  const visibleEdges = edgeTab === 'global' ? globalCooccurrenceEdges : edges;

  // Edge filters now highlight/dim rather than remove edges, so we pass the
  // full edge set to the diagrams along with the active filter set.

  useEffect(() => {
    const allTypes = Array.from(new Set(graphEdges.map((e) => e.relationship_type).filter((t): t is string => Boolean(t)))).sort();
    setViewEdgeFilters((prev) => {
      let changed = false;
      const next: Record<'graph' | 'components', Set<string>> = { ...prev };
      for (const view of ['graph', 'components'] as const) {
        const current = new Set(prev[view]);
        for (const type of allTypes) {
          if (!current.has(type)) {
            current.add(type);
            changed = true;
          }
        }
        next[view] = current;
      }
      return changed ? next : prev;
    });
  }, [graphEdges]);

  useEffect(() => {
    const allTypes = Array.from(new Set(graphNodes.map((n) => n.type).filter((t): t is string => Boolean(t) && t !== 'system'))).sort();
    setViewNodeFilters((prev) => {
      let changed = false;
      const next: Record<'graph' | 'components', Set<string>> = { ...prev };
      for (const view of ['graph', 'components'] as const) {
        const current = new Set(prev[view]);
        for (const type of allTypes) {
          if (!current.has(type)) {
            current.add(type);
            changed = true;
          }
        }
        next[view] = current;
      }
      return changed ? next : prev;
    });
  }, [graphNodes]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graphNodes) map.set(n.id, n);
    return map;
  }, [graphNodes]);

  const switchToMerge = useCallback(() => {
    let nextSelected = new Set(selectedStepIds);
    if (nextSelected.size === 0 && activeStepId != null) {
      nextSelected = new Set([activeStepId]);
    }
    if (nextSelected.size === 0 && trail.length > 0) {
      nextSelected = new Set([trail[0].id]);
    }
    setActiveStepId(null);
    setSelectedStepIds(nextSelected);
    setViewMode('session');
  }, [selectedStepIds, activeStepId, trail, setActiveStepId, setSelectedStepIds, setViewMode]);

  const switchToStep = useCallback((stepId?: number) => {
    let target = stepId ?? activeStepId ?? null;
    if (!target && selectedStepIds.size > 0) {
      target = trail.find((s) => selectedStepIds.has(s.id))?.id ?? null;
    }
    if (!target && trail.length > 0) {
      target = trail[0].id;
    }
    if (target) {
      setActiveStepId(target);
      setSelectedStepIds(new Set());
      setViewMode('step');
      void handleLoadStep(target);
    }
  }, [activeStepId, selectedStepIds, trail, setActiveStepId, setSelectedStepIds, setViewMode, handleLoadStep]);

  const handleActivateStep = useCallback(async (stepId: number) => {
    setSelectedStepIds(new Set());
    await handleLoadStep(stepId);
  }, [handleLoadStep, setSelectedStepIds]);

  const handleInsertToken = useCallback((token: string) => {
    if (queryMode === 'prebuilt' && /\[\[[^\[\]—]+?\s*—\s*[^\[\]—→]+?\s*→\s*[^\[\]]+?\]\]/.test(token)) {
      toast.info('Edges cannot be added to prebuilt queries');
      return;
    }
    const before = queryRef.current.slice(0, queryCursorRef.current);
    const after = queryRef.current.slice(queryCursorRef.current);
    const prefix = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
    const next = (before + prefix + token + after).replace(/\s+/g, ' ').trim();
    const pos = next.length - after.length;
    setQuery(next);
    setQueryCursor(pos);
  }, [queryMode]);

  const handleGraphAddToQuery = useCallback(
    (selection: { kind: string; ids: string[]; source?: string }) => {
      if (selection.ids.length !== 1) return;
      const id = selection.ids[0];
      if (selection.kind === 'graph' || selection.kind === 'diagram') {
        const node = nodeMap.get(id);
        if (!node) return;
        handleInsertToken(formatEntityToken(node.label || node.id, node.id, node.type));
      } else if (selection.kind === 'edge') {
        if (queryMode === 'prebuilt') {
          toast.info('Edges cannot be added to prebuilt queries');
          return;
        }
        const edge = graphEdges.find((e) => e.id === id);
        if (!edge) return;
        handleInsertToken(formatEdgeToken(edge.source, edge.target, edge.label || edge.relationship_type || 'edge'));
      }
    },
    [nodeMap, graphEdges, handleInsertToken, queryMode],
  );

  useEffect(() => {
    entitiesApi.list()
      .then((data) => setAllEntities(Array.isArray(data) ? data : []))
      .catch((err) => logger.error('Failed to load all entities for autocomplete', err));
  }, []);

  useEffect(() => {
    fetchServers();
    // Dimensions come from the local mental-model configuration, not any
    // selected bank/server, so load them once at page startup.
    mentalModelsApi.listStandardDimensions()
      .then((data) => {
        const dims = (Array.isArray(data) ? data : []).filter(
          (d) => d.value?.toLowerCase() !== 'none' && d.label?.toLowerCase() !== 'none',
        );
        setAvailableDimensions(dims.length > 0 ? dims : [{ value: 'interface', label: 'Interface' }]);
        setSelectedDimensions((prev: string[]) => prev.filter((d) => dims.some((dim) => dim.value === d)));
      })
      .catch((err) => {
        logger.error('Failed to fetch mental model dimensions', err);
        setAvailableDimensions([{ value: 'interface', label: 'Interface' }]);
      });
  }, []);

  useEffect(() => {
    if (!selectedServerId) {
      setBanks([]);
      setSelectedBankId('');
      return;
    }
    fetchBanks(parseInt(selectedServerId, 10));
  }, [selectedServerId]);

  useEffect(() => {
    if (!selectedServerId || !selectedBankId) {
      setBankTags([]);
      setGlobalGraph(null);
      return;
    }
    const serverId = parseInt(selectedServerId, 10);
    setTagsLoading(true);
    serversApi.listBankTags(serverId, selectedBankId)
      .then((data) => setBankTags(Array.isArray(data?.items) ? data.items : []))
      .catch((err) => {
        logger.error('Failed to fetch bank tags', err);
        setBankTags([]);
      })
      .finally(() => setTagsLoading(false));

    setGlobalGraphLoading(true);
    serversApi.getBankGraph(serverId, selectedBankId)
      .then((data) => {
        const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
        const edges = Array.isArray(data?.edges) ? data.edges : [];
        setGlobalGraph({ nodes, edges });
      })
      .catch((err) => {
        logger.error('Failed to fetch bank graph', err);
        setGlobalGraph(null);
      })
      .finally(() => setGlobalGraphLoading(false));
  }, [selectedServerId, selectedBankId]);

  const fetchServers = async () => {
    try {
      const data = await serversApi.list();
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to fetch servers', err);
      toast.error('Failed to load servers');
    }
  };

  const fetchBanks = async (serverId: number) => {
    try {
      const data = await serversApi.listBanks(serverId);
      setBanks(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to fetch banks', err);
      toast.error('Failed to load banks');
    }
  };

  const [topFlex, setTopFlex] = useState(2);
  const bottomFlex = 5 - topFlex;
  const mainRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startTopFlexRef = useRef(2);
  const containerHeightRef = useRef(0);

  const [isDraggingWidth, setIsDraggingWidth] = useState(false);
  const startXRef = useRef(0);
  const startNarrativeWidthRef = useRef(40);
  const containerWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startTopFlexRef.current = topFlex;
    const container = mainRef.current;
    if (container) {
      containerHeightRef.current = container.getBoundingClientRect().height;
    }
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [topFlex]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      const deltaY = e.clientY - startYRef.current;
      const containerHeight = containerHeightRef.current;
      if (containerHeight > 0) {
        const deltaFlex = (deltaY / containerHeight) * 5;
        const nextTopFlex = Math.min(Math.max(startTopFlexRef.current + deltaFlex, 0.8), 4.2);
        setTopFlex(nextTopFlex);
      }
    }
    if (isDraggingWidth) {
      const deltaX = e.clientX - startXRef.current;
      const containerWidth = containerWidthRef.current;
      if (containerWidth > 0) {
        const deltaPct = (deltaX / containerWidth) * 100;
        const nextWidth = Math.min(Math.max(startNarrativeWidthRef.current + deltaPct, 20), 70);
        setNarrativeWidths((prev) => ({ ...prev, [canvasView]: nextWidth }));
      }
    }
  }, [isDraggingWidth, canvasView]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    setIsDraggingWidth(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const isRunning = loading || runningStepId !== null;

  return (
    <PageShell title="Research" loading={false}>
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-white/10">
        <ServerBankSelectors
          servers={servers}
          selectedServerId={selectedServerId}
          setSelectedServerId={setSelectedServerId}
          banks={banks}
          selectedBankId={selectedBankId}
          setSelectedBankId={setSelectedBankId}
          loadingBanks={false}
          disabled={loading}
        />
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] text-white/70 hover:text-white hover:bg-white/10"
          onClick={() => setCreatingSession(true)}
          disabled={!selectedBankId || creatingSession}
          title="New session"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div ref={mainRef} className="flex flex-col h-full overflow-hidden gap-1">
        {/* Top row */}
        <div className="min-h-0 flex flex-row gap-3 overflow-hidden" style={{ flex: topFlex }}>
          <div className="w-[10%] min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col">
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              creating={creatingSession}
              onStartCreate={() => setCreatingSession(true)}
              onCancelCreate={() => setCreatingSession(false)}
              onSelect={handleSelectSession}
              onCreate={handleCreateSession}
              onRename={handleRenameSession}
              onDelete={handleDeleteSession}
              loading={sessionsLoading}
            />
          </div>

          <div className="w-[20%] min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col">
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
              <div className="flex items-center gap-2">
                {viewMode === 'session' && (
                  <Checkbox
                    checked={trail.length > 0 && selectedStepIds.size === trail.length}
                    onCheckedChange={(checked) => {
                      setViewMode('session');
                      if (checked) selectAllSteps();
                      else clearStepSelection();
                    }}
                    className="shrink-0"
                    aria-label="Select all queries"
                  />
                )}
                <span className="font-medium text-sm">Trail</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
                  <Switch
                    checked={viewMode === 'session'}
                    onCheckedChange={(checked) => {
                      if (checked) switchToMerge();
                      else switchToStep();
                    }}
                  />
                  Merge
                </label>
                <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                  {trail.length} ({selectedStepIds.size})
                </span>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <QueryTrail
                trail={trail}
                selectedStepIds={selectedStepIds}
                activeStepId={activeStepId}
                viewMode={viewMode}
                onToggleStep={(stepId) => {
                  if (viewMode === 'step') {
                    switchToStep(stepId);
                  } else {
                    toggleStepSelection(stepId);
                  }
                }}
                onSelectAll={() => {
                  switchToMerge();
                  selectAllSteps();
                }}
                onClearSelection={() => {
                  switchToMerge();
                  clearStepSelection();
                }}
                onActivateStep={(stepId) => {
                  switchToStep(stepId);
                }}
                onRequestDelete={setStepToDelete}
                onRerunStep={handleRerunStep}
                onUseDetails={handleLoadStepDetails}
                runningStepId={runningStepId}
                onInspectStep={(stepId) => {
                  const step = trail.find((s) => s.id === stepId) ?? null;
                  setStepToInspect(step);
                }}
              />
            </div>
          </div>

          <div className="w-[25%] min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col">
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 gap-2 overflow-hidden">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm shrink-0">Query</span>
                <div className="flex items-center gap-1 overflow-x-auto" role="group" aria-label="Query mode">
                  {[
                    { key: 'prebuilt', label: 'Prebuilt' },
                    { key: 'recall', label: 'Recall' },
                    { key: 'reflect', label: 'Reflect' },
                    { key: 'synthesize', label: 'Synthesize' },
                  ].map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      disabled={isRunning}
                      onClick={() => setQueryMode(m.key as typeof queryMode)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                        queryMode === m.key
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                          : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <QueryForm
                query={query}
                setQuery={setQuery}
                cursor={queryCursor}
                setCursor={setQueryCursor}
                loading={loading}
                isRunning={isRunning}
                availableEntities={allEntities.map((e) => {
                  const type = resolveNodeType({ id: e.entity_id, label: e.name, type: e.type_name });
                  return {
                    id: canonicalEntityId(type, e.entity_id),
                    label: e.name,
                    type,
                  };
                })}
                availableEdges={graphEdges}
                onSubmit={handleSubmit}
                queryMode={queryMode}
                dimensions={selectedDimensions}
                setDimensions={setSelectedDimensions}
                availableDimensions={availableDimensions}
                queryOptions={queryOptions}
                setQueryOptions={setQueryOptions}
              />
            </div>
          </div>

          <div className="w-[15%] min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col">
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
              <span className="font-medium text-sm">Entities</span>
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {[
                  { key: 'entities', label: 'All', count: `${entityInScopeCount}/${entityTotalCount}` },
                  { key: 'global', label: 'Global', count: globalEntities.length },
                  { key: 'tags', label: 'Tags', count: bankTags.length },
                ].map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setEntityTab(v.key as EntityTab)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
                      entityTab === v.key
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
                    }`}
                  >
                    {v.label} ({v.count})
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
                <CompositeEntities
                entityTab={entityTab}
                entities={entities}
                globalEntities={globalEntities}
                bankTags={bankTags}
                tagsLoading={tagsLoading}
                onInsertToken={handleInsertToken}
              />
            </div>
          </div>

          <div className="flex-1 min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col">
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
              <span className="font-medium text-sm">Edges</span>
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {[
                  { key: 'found', label: 'All', count: `${edgeInScopeCount}/${edgeTotalCount}` },
                  { key: 'global', label: 'Global', count: globalCooccurrenceEdges.length },
                ].map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => setEdgeTab(v.key as EdgeTab)}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
                      edgeTab === v.key
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                        : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
                    }`}
                  >
                    {v.label} ({v.count})
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <CompositeEdges
                edgeTab={edgeTab}
                edges={visibleEdges}
                globalEdges={globalCooccurrenceEdges}
                nodeMap={nodeMap}
                onInsertToken={handleInsertToken}
              />
            </div>
          </div>
        </div>

        <div
          className="h-2 shrink-0 cursor-row-resize flex items-center justify-center group"
          onMouseDown={handleMouseDown}
          onDoubleClick={() => setTopFlex(2)}
          title="Drag to resize top and bottom panels; double-click to reset"
        >
          <div className="w-16 h-1 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
        </div>

        <ResearchResultPanel
          loading={loading}
          error={error}
          result={result}
          viewMode={viewMode}
          trail={trail}
          selectedStepIds={selectedStepIds}
          resultView={resultView}
          canvasView={canvasView}
          setCanvasView={setCanvasView}
          graphNodes={graphNodes}
          graphEdges={graphEdges}
          allGraphEdges={graphEdges}
          graphLayout={graphLayout}
          setGraphLayout={setGraphLayout}
          graphLayoutAnimate={graphLayoutAnimate}
          setGraphLayoutAnimate={setGraphLayoutAnimate}
          showEdgeLabels={showEdgeLabels}
          setShowEdgeLabels={setShowEdgeLabels}
          edgeFilters={graphEdgeFilters}
          toggleEdgeFilter={toggleGraphEdgeFilter}
          nodeFilters={graphNodeFilters}
          toggleNodeFilter={toggleGraphNodeFilter}
          onGraphAddToQuery={handleGraphAddToQuery}
          bottomFlex={bottomFlex}
          narrativeWidth={narrativeWidth}
          showNarrativePlain={showNarrativePlain}
          setShowNarrativePlain={setShowNarrativePlain}
          onResizeNarrativeStart={(e) => {
            setIsDraggingWidth(true);
            startXRef.current = e.clientX;
            startNarrativeWidthRef.current = narrativeWidth;
            const container = mainRef.current;
            if (container) {
              containerWidthRef.current = container.getBoundingClientRect().width;
            }
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
          onResizeNarrativeReset={() => {
            setNarrativeWidths((prev) => ({ ...prev, [canvasView]: 40 }));
          }}
        />
      </div>

      <ConfirmDialog
        open={stepToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setStepToDelete(null);
        }}
        title="Delete query?"
        description="This removes the query from the session and its contribution to the composite entity set. Any dependent follow-up queries will also be removed. This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={() => {
          if (stepToDelete !== null) {
            void handleDeleteStep(stepToDelete);
          }
        }}
        variant="destructive"
      />
      <QueryInspectDialog
        open={stepToInspect !== null}
        onOpenChange={(open) => {
          if (!open) setStepToInspect(null);
        }}
        step={stepToInspect}
      />
    </PageShell>
  );
}
