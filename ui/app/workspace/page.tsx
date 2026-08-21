'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { type EntityLike as AqlEntityLike, type EdgeLike as AqlEdgeLike } from '@/components/aql-editor';
import { serversApi, contextualGraphApi, entityInfoApi, entitiesApi, researchApi, type Server, type Entity } from '@/lib/api/client';
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
  type EntityInfoWithContent,
} from './_components/model-content-utils';
import { Panel, PanelHeader, PanelContent, ResizeHandle } from './_components/panel-layout';
import { EntityScopePanel } from './_components/entity-scope-panel';
import { ReflectQueryPanel } from './_components/reflect-query-panel';
import { AttachedEntitiesPanel } from './_components/attached-entities-panel';
import { SessionItemsPanel } from './_components/session-items-panel';
import { type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { QueryInspectDialog } from '@/app/research/query-inspect-dialog';
import { WorkspaceResultPanel } from './_components/workspace-result-panel';

import { SessionPageEditor } from './_components/session-page-editor';
import type { SessionPageEditorRef } from './_components/session-page-editor';
import { type ResearchCopyEvent } from '@/app/research/research-result-panel';
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

  const [entityInfoMap, setEntityInfoMap] = useState<Record<string, EntityInfoWithContent> | null>(null);
  const [loadingEntityInfo, setLoadingEntityInfo] = useState(false);
  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(new Set());
  const [selectedModelKeys, setSelectedModelKeys] = useState<Record<string, string | null>>({});
  const [selectedStep, setSelectedStep] = useState<ResearchStepSummary | null>(null);
  const selectedStepHasGraph = useMemo(() => {
    if (!selectedStep?.canvas?.graph) return false;
    return selectedStep.canvas.graph.nodes?.length > 0;
  }, [selectedStep]);
  const [editingStep, setEditingStep] = useState<ResearchStepSummary | null>(null);
  const [inspectingStep, setInspectingStep] = useState<ResearchStepSummary | null>(null);
  const editorRef = useRef<SessionPageEditorRef | null>(null);

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

  // Layout sizing: three vertical columns.
  const mainRowRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState({ left: 0.25, middle: 0.4, right: 0.35 });

  const [resizing, setResizing] = useState<null | 'col1' | 'col2'>(null);
  const resizeStartRef = useRef({
    x: 0,
    width: 0,
    widths: { left: 0.25, middle: 0.4, right: 0.35 },
  });

  const handleResizeStart = useCallback(
    (pane: 'col1' | 'col2') => (e: React.MouseEvent) => {
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
        const nextLeft = Math.max(MIN, Math.min(widths.left + delta, widths.left + widths.middle - MIN));
        const nextMiddle = Math.max(MIN, widths.middle - (nextLeft - widths.left));
        setColumnWidths((prev) => ({ ...prev, left: nextLeft, middle: nextMiddle }));
      } else if (resizing === 'col2') {
        const nextMiddle = Math.max(MIN, Math.min(widths.middle + delta, widths.middle + widths.right - MIN));
        const nextRight = Math.max(MIN, widths.right - (nextMiddle - widths.middle));
        setColumnWidths((prev) => ({ ...prev, middle: nextMiddle, right: nextRight }));
      }
    },
    [resizing]
  );

  const handleResizeEnd = useCallback(() => {
    setResizing(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Layout sizing: three horizontal panes inside the left column.
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [leftPaneHeights, setLeftPaneHeights] = useState({ top: 0.33, middle: 0.34, bottom: 0.33 });
  const [hResizing, setHResizing] = useState<null | 'row1' | 'row2'>(null);
  const hResizeStartRef = useRef({
    y: 0,
    height: 0,
    heights: { top: 0.33, middle: 0.34, bottom: 0.33 },
  });

  const handleHResizeStart = useCallback(
    (pane: 'row1' | 'row2') => (e: React.MouseEvent) => {
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
        const nextTop = Math.max(MIN, Math.min(heights.top + delta, heights.top + heights.middle - MIN));
        const nextMiddle = Math.max(MIN, heights.middle - (nextTop - heights.top));
        setLeftPaneHeights((prev) => ({ ...prev, top: nextTop, middle: nextMiddle }));
      } else if (hResizing === 'row2') {
        const nextMiddle = Math.max(MIN, Math.min(heights.middle + delta, heights.middle + heights.bottom - MIN));
        const nextBottom = Math.max(MIN, heights.bottom - (nextMiddle - heights.middle));
        setLeftPaneHeights((prev) => ({ ...prev, middle: nextMiddle, bottom: nextBottom }));
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
    };
    const up = () => {
      handleResizeEnd();
      handleHResizeEnd();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleResizeMove, handleResizeEnd, handleHResizeMove, handleHResizeEnd]);

  const handleSelectStep = useCallback((step: ResearchStepSummary) => {
    setSelectedStep(step);
  }, []);

  const handleEditPage = useCallback((step: ResearchStepSummary) => {
    setSelectedStep(step);
    setEditingStep(step);
  }, []);

  const handlePageSaved = useCallback((updated: ResearchStepSummary) => {
    setEditingStep(updated);
    setSelectedStep((prev) => (prev?.id === updated.id ? updated : prev));
    toast.success('Page updated');
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
  // workspace's selected-step state so the page editor and result panel render.
  useEffect(() => {
    if (!workspaceSession.result) return;
    const step = workspaceSession.trail.find((s) => s.id === workspaceSession.result?.step_id);
    if (step) {
      setSelectedStep(step);
      void workspaceSession.refresh();
    }
  }, [workspaceSession.result, workspaceSession.trail, workspaceSession.refresh]);

  const handleCopySection = useCallback(async (event: ResearchCopyEvent) => {
    if (!activeSession) {
      toast.error('No active session. Select a server and bank first.');
      return;
    }
    if (!editingStep) {
      const pageTitle = event.label || 'Copied section';
      try {
        const page = await researchApi.createSessionPage(activeSession.id, pageTitle);
        let updateData: Parameters<typeof researchApi.updateCuratedPage>[1] = {
          intent_text: pageTitle,
          canvas: page.canvas || undefined,
        };
        switch (event.type) {
          case 'narrative':
            updateData.synthesis = { narrative: event.payload };
            break;
          case 'graph': {
            const parsedGraph = JSON.parse(event.payload);
            updateData.canvas = {
              ...(page.canvas || { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] }),
              graph: parsedGraph,
            };
            break;
          }
          case 'tables': {
            const parsedTables = JSON.parse(event.payload);
            updateData.canvas = {
              ...(page.canvas || { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] }),
              tables: parsedTables,
            };
            break;
          }
          case 'diagrams': {
            const parsedDiagrams = JSON.parse(event.payload);
            updateData.canvas = {
              ...(page.canvas || { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] }),
              diagrams: parsedDiagrams,
            };
            break;
          }
        }
        const updated = await researchApi.updateCuratedPage(page.id, updateData);
        const nextStep: ResearchStepSummary = { ...page, intent_text: updated.intent_text ?? pageTitle, synthesis: updated.synthesis, canvas: updated.canvas };
        setSelectedStep(nextStep);
        setEditingStep(nextStep);
        void workspaceSession.refresh();
        toast.success(`Created page "${pageTitle}" with copied ${event.type}`);
        return;
      } catch (err: any) {
        toast.error(err.message || `Failed to create page for copied ${event.type}`);
        return;
      }
    }
    switch (event.type) {
      case 'narrative':
        editorRef.current?.appendBlocks(event.payload);
        break;
      case 'graph': {
        const parsedGraph = JSON.parse(event.payload);
        editorRef.current?.appendGraph(parsedGraph.nodes || [], parsedGraph.edges || []);
        break;
      }
      case 'tables': {
        const parsedTables = JSON.parse(event.payload);
        editorRef.current?.appendTables(parsedTables);
        break;
      }
      case 'diagrams': {
        const parsedDiagrams = JSON.parse(event.payload);
        editorRef.current?.appendDiagrams(parsedDiagrams);
        break;
      }
    }
    toast.success(`Copied ${event.type}${event.label ? ` "${event.label}"` : ''} into the open page`);
  }, [activeSession, editingStep, editorRef]);

  const handleToggleScopeEntity = useCallback(async (entityId: string, inScope: boolean) => {
    if (!activeSession) return;
    const currentIds = activeSession.scope_entity_ids ?? [];
    const nextIds = inScope
      ? Array.from(new Set([...currentIds, entityId]))
      : currentIds.filter((id) => id !== entityId);

    setActiveSession((prev) => (prev ? { ...prev, scope_entity_ids: nextIds } : prev));

    try {
      await researchApi.updateSession(activeSession.id, { scope_entity_ids: nextIds });
    } catch (err: any) {
      logger.error('Failed to update session scope', { error: err, sessionId: activeSession.id, entityId });
      toast.error(`Failed to update scope: ${err.message || err}`);
    }
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

  const selectEntityModel = useCallback((entityId: string, key: string) => {
    setSelectedModelKeys((prev) => ({ ...prev, [entityId]: key }));
  }, []);

  useEffect(() => {
    if (!serverId || !bankId || scopeEntityIds.length === 0) {
      setEntityInfoMap(null);
      return;
    }
    let cancelled = false;
    setLoadingEntityInfo(true);
    entityInfoApi
      .info(serverId, bankId, scopeEntityIds)
      .then((result) => {
        if (cancelled) return;
        const contentMap = result.content || {};
        const mergedEntities: Record<string, EntityInfoWithContent> = {};
        for (const [id, info] of Object.entries(result.entities)) {
          mergedEntities[id] = { ...info, content: contentMap };
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
      subtitle="Discovery and collation workbench."
      count={entities.length}
      countLabel="entity"
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

        {/* Main three-column workbench */}
        <div ref={mainRowRef} className="flex-1 min-h-0 flex">
          {/* Column 1: scope + query | session items | contextual data */}
          <div ref={leftColumnRef} className="flex flex-col min-h-0" style={{ flex: columnWidths.left, minWidth: 220 }}>
            <div className="flex flex-col min-h-0" style={{ flex: leftPaneHeights.top, minHeight: 120 }}>
              <div className="flex-1 min-h-0 flex">
                <EntityScopePanel
                  entities={architxtEntities}
                  scopeEntityIds={scopeEntityIds}
                  onToggle={handleToggleScopeEntity}
                  loading={loadingArchitxtEntities}
                  style={{ flex: 0.35, minWidth: 180 }}
                />
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
                  style={{ flex: 0.65, minWidth: 220 }}
                />
              </div>
            </div>

            <ResizeHandle direction="horizontal" onMouseDown={handleHResizeStart('row1')} title="Drag to resize query / session items" />

            {serverId && bankId ? (
              <div className="flex flex-col min-h-0" style={{ flex: leftPaneHeights.middle, minHeight: 140 }}>
                <SessionItemsPanel
                  session={workspaceSession.activeSession}
                  items={workspaceSession.workspaceItems}
                  loading={workspaceSession.sessionsLoading || workspaceSession.trailLoading}
                  activeStepId={selectedStep?.id}
                  editingStepId={editingStep?.id}
                  runningStepId={workspaceSession.runningStepId}
                  onSelectStep={handleSelectStep}
                  onEditPage={handleEditPage}
                  onReuseStep={handleReuseStep}
                  onRerunStep={handleRerunStep}
                  onInspectStep={handleInspectStep}
                  onRefresh={workspaceSession.refresh}
                />
              </div>
            ) : (
              <div className="flex flex-col min-h-0" style={{ flex: leftPaneHeights.middle, minHeight: 140 }}>
                <Panel className="flex-1 min-h-0">
                  <PanelHeader title="Session items" />
                  <PanelContent className="p-3">
                    <div className="text-white/40 text-xs">Select a server and bank to load sessions.</div>
                  </PanelContent>
                </Panel>
              </div>
            )}

            <ResizeHandle direction="horizontal" onMouseDown={handleHResizeStart('row2')} title="Drag to resize session items / contextual data" />

            <div className="flex flex-col min-h-0" style={{ flex: leftPaneHeights.bottom, minHeight: 120 }}>
              <AttachedEntitiesPanel
                entityIds={scopeEntityIds}
                entityInfoMap={entityInfoMap}
                loading={loadingEntityInfo}
                expandedEntityIds={expandedEntityIds}
                selectedModelKeys={selectedModelKeys}
                onToggleExpand={toggleEntityExpanded}
                onSelectModel={selectEntityModel}
              />
            </div>
          </div>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('col1')} title="Drag to resize left/middle columns" />

          {/* Column 2: result viewer */}
          <div className="flex flex-col min-h-0" style={{ flex: columnWidths.middle, minWidth: 280 }}>
            <Panel className="flex-1 min-h-0">
              <PanelHeader
                title={selectedStep ? (selectedStep.action_type === 'curated_page' ? 'Page preview' : 'Reflect output') : 'Read-only preview'}
                count={selectedStep ? (selectedStep.synthesis?.narrative || selectedStepHasGraph ? undefined : 0) : undefined}
              />
              <PanelContent className="p-0 overflow-hidden">
                <div className="h-full flex flex-col">
                  <WorkspaceResultPanel
                    result={selectedStep}
                    loading={reflectLoading}
                    error={reflectError}
                    sessionName={activeSession?.title}
                    onCopy={handleCopySection}
                  />
                </div>
              </PanelContent>
            </Panel>
          </div>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('col2')} title="Drag to resize middle/right columns" />

          {/* Column 3: session page editor */}
          <div className="flex flex-col min-h-0" style={{ flex: columnWidths.right, minWidth: 280 }}>
            {editingStep ? (
              <SessionPageEditor ref={editorRef} step={editingStep} onSaved={handlePageSaved} />
            ) : (
              <Panel className="flex-1 min-h-0">
                <PanelHeader title="Page editor" />
                <PanelContent className="p-4">
                  <div className="text-white/40 text-xs">
                    Open a page from the session list to edit it here.
                  </div>
                </PanelContent>
              </Panel>
            )}
          </div>
        </div>

        <QueryInspectDialog
          open={inspectingStep !== null}
          onOpenChange={(open) => {
            if (!open) setInspectingStep(null);
          }}
          step={inspectingStep}
        />
      </div>
    </PageShell>
  );
}
