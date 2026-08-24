'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { type EntityLike as AqlEntityLike, type EdgeLike as AqlEdgeLike } from '@/components/aql-editor';
import { serversApi, contextualGraphApi, entityInfoApi, entitiesApi, researchApi, mentalModelsApi, type Server, type Entity, type EntityInfo } from '@/lib/api/client';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import {
  DisplayNode,
  DisplayEdge,
  backendNodeToDisplayNode,
  backendEdgeToDisplayEdge,
} from '@/lib/contextual-graph/display';
import { RefreshCw } from 'lucide-react';
import { canonicalNodeId, resolveNodeType } from '@/app/research/graph-utils';
import {
  isGroundedNodeForWorkspace,
  isGroundedEdgeForWorkspace,
  mentalModelContentToStepSummary,
  type ModelContentCacheEntry,
} from './_components/model-content-utils';
import { Panel, PanelHeader, PanelContent, ResizeHandle } from './_components/panel-layout';
import { EntityScopePanel } from './_components/entity-scope-panel';
import { EntityScopeManagerDialog } from './_components/entity-scope-manager-dialog';
import { ReflectQueryPanel } from './_components/reflect-query-panel';
import { AttachedEntitiesPanel, type ModelItem } from './_components/attached-entities-panel';
import { SessionItemsPanel } from './_components/session-items-panel';
import { type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { QueryInspectDialog } from '@/app/research/query-inspect-dialog';
import { WorkspaceResultPanel } from './_components/workspace-result-panel';

import { useWorkspaceSession } from './_components/use-workspace-session';

const logger = createLogger('WorkspacePage');

export default function WorkspacePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [entities, setEntities] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);

  const [architxtEntities, setArchitxtEntities] = useState<Entity[]>([]);
  const [loadingArchitxtEntities, setLoadingArchitxtEntities] = useState(false);

  const [entityInfoMap, setEntityInfoMap] = useState<Record<string, EntityInfo> | null>(null);
  const [modelContentCache, setModelContentCache] = useState<Record<string, ModelContentCacheEntry>>({});
  const [loadingEntityInfo, setLoadingEntityInfo] = useState(false);
  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(new Set());
  type SelectedView =
    | { kind: 'step'; step: ResearchStepSummary }
    | { kind: 'model'; entityId: string; extId: string; name: string };
  const [selectedView, setSelectedView] = useState<SelectedView | null>(null);
  const selectedStep = useMemo(() => (selectedView?.kind === 'step' ? selectedView.step : null), [selectedView]);
  const selectedModel = useMemo(() => (selectedView?.kind === 'model' ? { entityId: selectedView.entityId, extId: selectedView.extId } : null), [selectedView]);
  const selectedStepHasGraph = useMemo(() => {
    if (!selectedStep?.canvas?.graph) return false;
    return selectedStep.canvas.graph.nodes?.length > 0;
  }, [selectedStep]);
  const [inspectingStep, setInspectingStep] = useState<ResearchStepSummary | null>(null);
  const [scopeManagerOpen, setScopeManagerOpen] = useState(false);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  const workspaceSession = useWorkspaceSession({ serverId, bankId });
  const [activeSession, setActiveSession] = useState<ResearchSession | null>(workspaceSession.activeSession);

  useEffect(() => {
    setActiveSession(workspaceSession.activeSession);
  }, [workspaceSession.activeSession]);

  // Sync workspace query state into the underlying research hook so submissions
  // use the existing working discover/poll path instead of a parallel one.
  const reflectQuery = workspaceSession.query;
  const setReflectQuery = workspaceSession.setQuery;
  const queryOptions = workspaceSession.queryOptions;
  const setQueryOptions = workspaceSession.setQueryOptions;
  const reflectLoading = workspaceSession.loading;
  const reflectError = workspaceSession.error;

  // Local cursor is managed by the AQL editor component.
  const [reflectCursor, setReflectCursor] = useState(0);

  const scopeEntityIds = useMemo(() => {
    return activeSession?.scope_entity_ids ?? [];
  }, [activeSession?.scope_entity_ids]);

  const previewResult = useMemo(() => {
    if (!selectedView) return null;
    if (selectedView.kind === 'step') return selectedView.step;
    const entry = modelContentCache[selectedView.extId];
    if (!entry || entry.loading || entry.error || !entry.content) return null;
    return mentalModelContentToStepSummary(selectedView.name, entry);
  }, [selectedView, modelContentCache]);

  const previewError = useMemo(() => {
    if (selectedView?.kind !== 'model') return reflectError;
    const entry = modelContentCache[selectedView.extId];
    if (!entry) return `Model ${selectedView.extId} is not loaded.`;
    if (entry.loading) return null;
    if (entry.error) return entry.error;
    if (!entry.content) return `Model ${selectedView.extId} has no content.`;
    return null;
  }, [selectedView, modelContentCache, reflectError]);

  // Layout sizing: two vertical columns.
  const mainRowRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState({ left: 0.42, right: 0.58 });

  const [resizing, setResizing] = useState<null | 'col1'>(null);
  const resizeStartRef = useRef({
    x: 0,
    width: 0,
    widths: { left: 0.42, right: 0.58 },
  });

  const handleResizeStart = useCallback(
    (pane: 'col1') => (e: React.MouseEvent) => {
      setResizing(pane);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      resizeStartRef.current = {
        x: e.clientX,
        width: mainRowRef.current?.getBoundingClientRect().width ?? 0,
        widths: { ...columnWidths },
      };
    },
    [columnWidths]
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!resizing) return;
      const { x, width, widths } = resizeStartRef.current;
      if (width <= 0) return;
      const delta = (e.clientX - x) / width;
      const MIN = 0.15;

      if (resizing === 'col1') {
        const nextLeft = Math.max(MIN, Math.min(widths.left + delta, 1 - MIN));
        const nextRight = Math.max(MIN, widths.right - (nextLeft - widths.left));
        setColumnWidths((prev) => ({ ...prev, left: nextLeft, right: nextRight }));
      }
    },
    [resizing]
  );

  const handleResizeEnd = useCallback(() => {
    setResizing(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Layout sizing: scope/query top pane + combined bottom pane in the left column.
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [leftPaneHeights, setLeftPaneHeights] = useState({ top: 0.4, bottom: 0.6 });
  const [hResizing, setHResizing] = useState<null | 'row1'>(null);
  const hResizeStartRef = useRef({
    y: 0,
    height: 0,
    heights: { top: 0.4, bottom: 0.6 },
  });

  // Inner horizontal split within the left-column bottom pane.
  const leftBottomRef = useRef<HTMLDivElement>(null);
  const [innerWidths, setInnerWidths] = useState({ left: 0.5, right: 0.5 });
  const [innerResizing, setInnerResizing] = useState<null | 'innerCol'>(null);
  const innerResizeStartRef = useRef({
    x: 0,
    width: 0,
    widths: { left: 0.5, right: 0.5 },
  });

  const handleInnerResizeStart = useCallback(
    (pane: 'innerCol') => (e: React.MouseEvent) => {
      setInnerResizing(pane);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      innerResizeStartRef.current = {
        x: e.clientX,
        width: leftBottomRef.current?.getBoundingClientRect().width ?? 0,
        widths: { ...innerWidths },
      };
    },
    [innerWidths]
  );

  const handleInnerResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!innerResizing) return;
      const { x, width, widths } = innerResizeStartRef.current;
      if (width <= 0) return;
      const delta = (e.clientX - x) / width;
      const MIN = 0.15;
      const nextLeft = Math.max(MIN, Math.min(widths.left + delta, 1 - MIN));
      const nextRight = Math.max(MIN, widths.right - (nextLeft - widths.left));
      setInnerWidths((prev) => ({ ...prev, left: nextLeft, right: nextRight }));
    },
    [innerResizing]
  );

  const handleInnerResizeEnd = useCallback(() => {
    setInnerResizing(null);
    if (!resizing) {
      document.body.style.cursor = '';
    }
    document.body.style.userSelect = '';
  }, [resizing]);

  const handleHResizeStart = useCallback(
    (pane: 'row1') => (e: React.MouseEvent) => {
      setHResizing(pane);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      hResizeStartRef.current = {
        y: e.clientY,
        height: leftColumnRef.current?.getBoundingClientRect().height ?? 0,
        heights: { ...leftPaneHeights },
      };
    },
    [leftPaneHeights]
  );

  const handleHResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!hResizing) return;
      const { y, height, heights } = hResizeStartRef.current;
      if (height <= 0) return;
      const delta = (e.clientY - y) / height;
      const MIN = 0.12;

      if (hResizing === 'row1') {
        const nextTop = Math.max(MIN, Math.min(heights.top + delta, 1 - MIN));
        const nextBottom = Math.max(MIN, 1 - nextTop);
        setLeftPaneHeights((prev) => ({ ...prev, top: nextTop, bottom: nextBottom }));
      }
    },
    [hResizing]
  );

  const handleHResizeEnd = useCallback(() => {
    setHResizing(null);
    if (!resizing) {
      document.body.style.cursor = '';
    }
    document.body.style.userSelect = '';
  }, [resizing]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      handleResizeMove(e);
      handleHResizeMove(e);
      handleInnerResizeMove(e);
    };
    const up = () => {
      handleResizeEnd();
      handleHResizeEnd();
      handleInnerResizeEnd();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleResizeMove, handleResizeEnd, handleHResizeMove, handleHResizeEnd, handleInnerResizeMove, handleInnerResizeEnd]);

  const handleSelectStep = useCallback((step: ResearchStepSummary) => {
    setSelectedView({ kind: 'step', step });
  }, []);

  const fetchServers = useCallback(async () => {
    try {
      setLoadingServers(true);
      const data = await serversApi.list();
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to load servers', err);
      toast.error('Failed to load servers');
    } finally {
      setLoadingServers(false);
    }
  }, []);

  const fetchBanks = useCallback(async (sid: number) => {
    try {
      setLoadingBanks(true);
      const data = await serversApi.listBanks(sid);
      setBanks(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to load banks', err);
      toast.error('Failed to load banks');
      setBanks([]);
    } finally {
      setLoadingBanks(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!serverId || !bankId) {
      setEntities([]);
      setEdges([]);
      return;
    }
    try {
      setLoadingData(true);
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
      ]);

      const displayNodes = nodesData.map(backendNodeToDisplayNode).filter(isGroundedNodeForWorkspace);
      const displayEdges = edgesData.map(backendEdgeToDisplayEdge).filter(isGroundedEdgeForWorkspace);

      setEntities(displayNodes);
      setEdges(displayEdges);
    } catch (err: any) {
      logger.error('Failed to load workspace data', { error: err, serverId, bankId });
      toast.error(`Failed to load workspace data: ${err.message || err}`);
    } finally {
      setLoadingData(false);
    }
  }, [serverId, bankId]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (!serverId) {
      setBanks([]);
      return;
    }
    fetchBanks(serverId);
  }, [serverId, fetchBanks]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    setLoadingArchitxtEntities(true);
    entitiesApi
      .list()
      .then((data) => {
        if (cancelled) return;
        setArchitxtEntities(Array.isArray(data) ? data : []);
      })
      .catch((err: any) => {
        if (cancelled) return;
        logger.error('Failed to load Architxt entities', err);
        toast.error('Failed to load entities for scope');
      })
      .finally(() => {
        if (!cancelled) setLoadingArchitxtEntities(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const aqlEntities: AqlEntityLike[] = useMemo(() => {
    return architxtEntities.map((entity) => {
      const type = resolveNodeType({ id: entity.entity_id, name: entity.name, type: entity.type_name });
      return {
        id: canonicalNodeId({ id: entity.entity_id, name: entity.name, type: entity.type_name }),
        entity_id: entity.entity_id,
        label: entity.name,
        type,
      };
    });
  }, [architxtEntities]);

  const aqlEdges: AqlEdgeLike[] = useMemo(() => {
    return edges.map((edge) => ({
      from: edge.source_id,
      to: edge.target_id,
      label: edge.label || edge.type,
      type: edge.type,
    }));
  }, [edges]);

  const handleReflect = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!activeSession) {
        toast.error('Wait for a workspace session to load before running Reflect.');
        return;
      }
      await workspaceSession.handleSubmit(e);
    },
    [activeSession, workspaceSession.handleSubmit],
  );

  // When the research hook produces a completed result, mirror it into the
  // workspace's selected-view state so the result panel renders.
  useEffect(() => {
    if (!workspaceSession.result) return;
    const step = workspaceSession.trail.find((s) => s.id === workspaceSession.result?.step_id);
    if (step) {
      setSelectedView({ kind: 'step', step });
      void workspaceSession.refresh();
    }
  }, [workspaceSession.result, workspaceSession.trail, workspaceSession.refresh]);

  const handleRemoveScopeEntity = useCallback(async (entityId: string) => {
    if (!activeSession) return;
    const currentIds = activeSession.scope_entity_ids ?? [];
    const nextIds = currentIds.filter((id) => id !== entityId);

    setActiveSession((prev) => (prev ? { ...prev, scope_entity_ids: nextIds } : prev));

    try {
      await researchApi.updateSession(activeSession.id, { scope_entity_ids: nextIds });
    } catch (err: any) {
      logger.error('Failed to update session scope', { error: err, sessionId: activeSession.id, entityId });
      toast.error(`Failed to update scope: ${err.message || err}`);
    }
  }, [activeSession]);

  const handleUpdateScope = useCallback(async (nextIds: string[]) => {
    if (!activeSession) return;
    setActiveSession((prev) => (prev ? { ...prev, scope_entity_ids: nextIds } : prev));
    await researchApi.updateSession(activeSession.id, { scope_entity_ids: nextIds });
  }, [activeSession]);

  const handleReuseStep = useCallback((step: ResearchStepSummary) => {
    setReflectQuery(step.raw_query || step.intent_text || '');
    toast.success('Query copied to Reflect input');
  }, []);

  const handleRerunStep = useCallback(async (stepId: number) => {
    if (!serverId) {
      toast.error('Select a server before re-running.');
      return;
    }
    try {
      await researchApi.rerunStep(stepId, { server_id: serverId });
      void workspaceSession.refresh();
      toast.success('Re-running query');
    } catch (err: any) {
      logger.error('Failed to re-run step', { error: err, stepId });
      toast.error(`Failed to re-run: ${err.message || err}`);
    }
  }, [serverId]);

  const handleInspectStep = useCallback((step: ResearchStepSummary) => {
    setInspectingStep(step);
  }, []);

  const toggleEntityExpanded = useCallback((entityId: string) => {
    setExpandedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  }, []);

  const loadModelContent = useCallback(async (extId: string) => {
    if (!serverId || !bankId) return;
    setModelContentCache((prev) => {
      if (prev[extId]?.loading || prev[extId]?.content !== undefined) return prev;
      return { ...prev, [extId]: { ...prev[extId], loading: true, error: null } };
    });
    try {
      const result = await mentalModelsApi.fetchContent(serverId, bankId, extId);
      setModelContentCache((prev) => ({
        ...prev,
        [extId]: {
          content: result.content ?? null,
          found: result.found,
          loading: false,
          error: null,
        },
      }));
    } catch (err: any) {
      setModelContentCache((prev) => ({
        ...prev,
        [extId]: {
          content: prev[extId]?.content ?? null,
          found: prev[extId]?.found ?? false,
          loading: false,
          error: err.message || String(err) || 'Failed to load model content.',
        },
      }));
    }
  }, [serverId, bankId]);

  const selectEntityModel = useCallback((entityId: string, item: ModelItem) => {
    setSelectedView({ kind: 'model', entityId, extId: item.extId, name: item.label });
    void loadModelContent(item.extId);
  }, [loadModelContent]);

  useEffect(() => {
    if (!serverId || !bankId || scopeEntityIds.length === 0) {
      setEntityInfoMap(null);
      return;
    }
    let cancelled = false;
    setLoadingEntityInfo(true);
    entityInfoApi
      .info(serverId, bankId, scopeEntityIds, false)
      .then((result) => {
        if (cancelled) return;
        const mergedEntities: Record<string, EntityInfo> = {};
        for (const [id, info] of Object.entries(result.entities)) {
          mergedEntities[id] = info;
        }
        setEntityInfoMap(mergedEntities);
      })
      .catch((err: any) => {
        if (cancelled) return;
        logger.error('Failed to load entity info', { error: err, serverId, bankId, entityIds: scopeEntityIds });
        toast.error(`Failed to load entity info: ${err.message || err}`);
        setEntityInfoMap(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingEntityInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, bankId, scopeEntityIds]);

  return (
    <PageShell
      title="Workspace"
      loading={loadingServers || loadingBanks || loadingData}
    >
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <ServerBankSelectors
            servers={servers}
            banks={banks}
            selectedServerId={selectedServerId}
            selectedBankId={selectedBankId}
            setSelectedServerId={setSelectedServerId}
            setSelectedBankId={setSelectedBankId}
            loadingBanks={loadingBanks}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={!serverId || !bankId || loadingData}
            className="gap-1.5"
          >
            <RefreshCw className={cn('w-4 h-4', loadingData && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {/* Main two-column workbench */}
        <div ref={mainRowRef} className="flex-1 min-h-0 flex">
          {/* Column 1: scope + query | session items | contextual data */}
          <div ref={leftColumnRef} className="flex flex-col min-h-0" style={{ flex: columnWidths.left, minWidth: 220 }}>
            <div className="flex flex-col min-h-0 gap-2" style={{ flex: leftPaneHeights.top, minHeight: 120 }}>
              <EntityScopePanel
                className="shrink-0"
                entities={architxtEntities}
                scopeEntityIds={scopeEntityIds}
                onRemove={handleRemoveScopeEntity}
                onManage={() => setScopeManagerOpen(true)}
                loading={loadingArchitxtEntities}
              />
              <div className="flex-1 min-h-0 flex">
                <ReflectQueryPanel
                  query={reflectQuery}
                  cursor={reflectCursor}
                  setQuery={setReflectQuery}
                  setCursor={setReflectCursor}
                  onSubmit={handleReflect}
                  aqlEntities={aqlEntities}
                  aqlEdges={aqlEdges}
                  loading={reflectLoading}
                  queryOptions={queryOptions}
                  onQueryOptionsChange={setQueryOptions}
                  style={{ flex: 1, minWidth: 220 }}
                />
              </div>
            </div>

            <ResizeHandle direction="horizontal" onMouseDown={handleHResizeStart('row1')} title="Drag to resize query / lower panels" />

            <div ref={leftBottomRef} className="flex min-h-0" style={{ flex: leftPaneHeights.bottom, minHeight: 140 }}>
              {serverId && bankId ? (
                <>
                  <div className="flex flex-col min-h-0" style={{ flex: innerWidths.left, minWidth: 160 }}>
                    <AttachedEntitiesPanel
                      entityIds={scopeEntityIds}
                      entityInfoMap={entityInfoMap}
                      edges={edges}
                      entities={architxtEntities}
                      contextualNodes={entities}
                      loading={loadingEntityInfo}
                      expandedEntityIds={expandedEntityIds}
                      selectedModel={selectedModel}
                      onToggleExpand={toggleEntityExpanded}
                      onSelectModel={selectEntityModel}
                    />
                  </div>

                  <ResizeHandle direction="vertical" onMouseDown={handleInnerResizeStart('innerCol')} title="Drag to resize contextual data / session items" />

                  <div className="flex flex-col min-h-0" style={{ flex: innerWidths.right, minWidth: 160 }}>
                    <SessionItemsPanel
                      session={workspaceSession.activeSession}
                      items={workspaceSession.workspaceItems}
                      loading={workspaceSession.sessionsLoading || workspaceSession.trailLoading}
                      activeStepId={selectedStep?.id}
                      runningStepId={workspaceSession.runningStepId}
                      onSelectStep={handleSelectStep}
                      onReuseStep={handleReuseStep}
                      onRerunStep={handleRerunStep}
                      onInspectStep={handleInspectStep}
                      onRefresh={workspaceSession.refresh}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col min-h-0" style={{ flex: innerWidths.left, minWidth: 160 }}>
                    <Panel className="flex-1 min-h-0">
                      <PanelHeader title="Contextual data" />
                      <PanelContent className="p-3">
                        <div className="text-white/40 text-xs">Select a server and bank to load contextual data.</div>
                      </PanelContent>
                    </Panel>
                  </div>

                  <ResizeHandle direction="vertical" onMouseDown={handleInnerResizeStart('innerCol')} title="Drag to resize contextual data / session items" />

                  <div className="flex flex-col min-h-0" style={{ flex: innerWidths.right, minWidth: 160 }}>
                    <Panel className="flex-1 min-h-0">
                      <PanelHeader title="Session items" />
                      <PanelContent className="p-3">
                        <div className="text-white/40 text-xs">Select a server and bank to load sessions.</div>
                      </PanelContent>
                    </Panel>
                  </div>
                </>
              )}
            </div>
          </div>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('col1')} title="Drag to resize left/right columns" />

          {/* Column 2: result viewer */}
          <div className="flex flex-col min-h-0" style={{ flex: columnWidths.right, minWidth: 280 }}>
            <Panel className="flex-1 min-h-0">
              <PanelHeader
                title={
                  selectedView?.kind === 'model'
                    ? 'Model preview'
                    : selectedStep
                      ? selectedStep.action_type === 'curated_page'
                        ? 'Page preview'
                        : 'Reflect output'
                      : 'Read-only preview'
                }
                count={
                  selectedView?.kind === 'model'
                    ? undefined
                    : selectedStep
                      ? selectedStep.synthesis?.narrative || selectedStepHasGraph
                        ? undefined
                        : 0
                      : undefined
                }
              />
              <PanelContent className="p-0 overflow-hidden">
                <div className="h-full flex flex-col">
                  <WorkspaceResultPanel
                    result={previewResult}
                    loading={reflectLoading}
                    error={previewError}
                    sessionName={activeSession?.title}
                    keyPrefix="preview"
                  />
                </div>
              </PanelContent>
            </Panel>
          </div>
        </div>

        <QueryInspectDialog
          open={inspectingStep !== null}
          onOpenChange={(open) => {
            if (!open) setInspectingStep(null);
          }}
          step={inspectingStep}
        />

        <EntityScopeManagerDialog
          isOpen={scopeManagerOpen}
          onClose={() => setScopeManagerOpen(false)}
          scopeEntityIds={scopeEntityIds}
          onSave={handleUpdateScope}
        />
      </div>
    </PageShell>
  );
}
