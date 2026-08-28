'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
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
import { canonicalNodeId, resolveNodeType } from '@/app/research/graph-utils';
import {
  isGroundedNodeForWorkspace,
  isGroundedEdgeForWorkspace,
  mentalModelContentToStepSummary,
  type ModelContentCacheEntry,
} from './_components/model-content-utils';
import { Panel, PanelHeader, PanelContent, ResizeHandle } from './_components/panel-layout';
import { ReflectQueryPanel } from './_components/reflect-query-panel';
import { AttachedEntitiesPanel, type ModelItem } from './_components/attached-entities-panel';
import { SessionItemsPanel } from './_components/session-items-panel';
import { type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { QueryInspectDialog } from '@/app/research/query-inspect-dialog';
import { WorkspaceResultPanel } from './_components/workspace-result-panel';

import { useWorkspaceSession } from './_components/use-workspace-session';

import { CuratedPageTabs, type WorkspaceTab, ANCHOR_TAB_ID, makeAnchorTab } from './_components/curated-page-tabs';
import { CuratedPageEnvelope } from './_components/curated-page-editor';
import { normalizeEnvelope } from '@/lib/envelope-markdown';
import { type EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import { mergeGraphs } from '@/lib/envelope-merge';

const logger = createLogger('WorkspacePage');

export default function WorkspacePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);

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

  // Tab state for curated pages and read-only views.
  const [tabs, setTabs] = useState<WorkspaceTab[]>([makeAnchorTab()]);
  const [activeTabId, setActiveTabId] = useState<string | null>(ANCHOR_TAB_ID);

  const [pendingSection, setPendingSection] = useState<{ events: EnvelopeCopyEvent[]; title?: string } | null>(null);

  // Local envelope overrides per curated-page id. These represent edits that
  // have been applied in the UI (copy/add from a view) but not yet persisted.
  const [pendingCuratedEdits, setPendingCuratedEdits] = useState<Record<number, CuratedPageEnvelope>>({});

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

  const activeCuratedPage = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.kind !== 'curated' || tab.stepId == null) return null;
    return workspaceSession.curatedPages.find((p) => p.id === tab.stepId) ?? null;
  }, [tabs, activeTabId, workspaceSession.curatedPages]);

  const activeCuratedPageWithEdits = useMemo(() => {
    if (!activeCuratedPage) return null;
    const edits = pendingCuratedEdits[activeCuratedPage.id];
    if (!edits) return activeCuratedPage;
    return {
      ...activeCuratedPage,
      envelope: edits,
    };
  }, [activeCuratedPage, pendingCuratedEdits]);

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

  const groundedNodeIds = useMemo(() => {
    return entities.map((n) => n.id);
  }, [entities]);

  const previewResult = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab?.kind === 'curated' && activeTab.stepId != null) {
      const page = workspaceSession.curatedPages.find((p) => p.id === activeTab.stepId);
      return page ?? null;
    }
    if (!selectedView) return null;
    if (selectedView.kind === 'step') return selectedView.step;
    const entry = modelContentCache[selectedView.extId];
    if (!entry || entry.loading || entry.error) return null;
    // Render from the normalized server envelope when present, even if raw content
    // is empty or not yet populated. This prevents edge-context models with valid
    // structured envelopes from appearing blank because the raw content field is
    // a JSON string rather than rendered Markdown.
    if (!entry.content && !entry.envelope) return null;

    return mentalModelContentToStepSummary(selectedView.name, entry);
  }, [tabs, activeTabId, selectedView, modelContentCache, workspaceSession.curatedPages]);

  const previewTitle = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab) return activeTab.label;
    if (selectedView?.kind === 'model') return 'Model preview';
    if (selectedStep?.action_type === 'curated_page') return 'Page preview';
    if (selectedStep) return 'Reflect output';
    return 'Read-only preview';
  }, [tabs, activeTabId, selectedView, selectedStep]);

  const activeViewLabel = useMemo(() => {
    if (selectedView?.kind === 'model') return selectedView.name || 'Model';
    if (selectedStep) return selectedStep.intent_text || selectedStep.raw_query || `Reflect ${selectedStep.id}`;
    return 'Preview';
  }, [selectedView, selectedStep]);

  const updateAnchorTab = useCallback((label: string) => {
    setTabs((prev) => {
      const anchorIndex = prev.findIndex((t) => t.id === ANCHOR_TAB_ID);
      if (anchorIndex === -1) return prev;
      const next = [...prev];
      next[anchorIndex] = { ...next[anchorIndex], label: label.slice(0, 40) };
      return next;
    });
  }, []);

  const previewError = useMemo(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (activeTab?.kind === 'curated') return null;
    if (selectedView?.kind === 'step') return selectedView.step.error_message || null;
    if (selectedView?.kind === 'model') {
      const entry = modelContentCache[selectedView.extId];
      if (!entry) return `Model ${selectedView.extId} is not loaded.`;
      if (entry.loading) return null;
      if (entry.error) return entry.error;
      if (!entry.content && !entry.envelope) return `Model ${selectedView.extId} has no content.`;
      return null;
    }
    return reflectError;
  }, [tabs, activeTabId, selectedView, modelContentCache, reflectError]);

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

  // Narrative / graph resize within the right-hand result panel.
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const [narrativeWidth, setNarrativeWidth] = useState(40);
  const [isDraggingNarrativeWidth, setIsDraggingNarrativeWidth] = useState(false);
  const narrativeResizeStartRef = useRef({ x: 0, containerWidth: 0, startWidth: 40 });

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

  const handleNarrativeResizeStart = useCallback((e: React.MouseEvent) => {
    setIsDraggingNarrativeWidth(true);
    narrativeResizeStartRef.current = {
      x: e.clientX,
      containerWidth: rightPanelRef.current?.getBoundingClientRect().width ?? 0,
      startWidth: narrativeWidth,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [narrativeWidth]);

  const handleNarrativeResizeMove = useCallback((e: MouseEvent) => {
    if (!isDraggingNarrativeWidth) return;
    const { x, containerWidth, startWidth } = narrativeResizeStartRef.current;
    if (containerWidth <= 0) return;
    const deltaPct = ((e.clientX - x) / containerWidth) * 100;
    const nextWidth = Math.min(Math.max(startWidth + deltaPct, 20), 70);
    setNarrativeWidth(nextWidth);
  }, [isDraggingNarrativeWidth]);

  const handleNarrativeResizeEnd = useCallback(() => {
    setIsDraggingNarrativeWidth(false);
    if (!resizing && !innerResizing && !hResizing) {
      document.body.style.cursor = '';
    }
    document.body.style.userSelect = '';
  }, [resizing, innerResizing, hResizing]);

  const handleNarrativeResizeReset = useCallback(() => {
    setNarrativeWidth(40);
  }, []);

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
      handleNarrativeResizeMove(e);
    };
    const up = () => {
      handleResizeEnd();
      handleHResizeEnd();
      handleInnerResizeEnd();
      handleNarrativeResizeEnd();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleResizeMove, handleResizeEnd, handleHResizeMove, handleHResizeEnd, handleInnerResizeMove, handleInnerResizeEnd, handleNarrativeResizeMove, handleNarrativeResizeEnd]);

  const handleSaveCuratedPage = useCallback(
    async (stepId: number, envelope: CuratedPageEnvelope) => {
      try {
        await researchApi.updateCuratedPage(stepId, { envelope });
        // Clear local pending edits for this page once the server confirms the save.
        setPendingCuratedEdits((prev) => {
          const next = { ...prev };
          delete next[stepId];
          return next;
        });
        await workspaceSession.refresh();
        toast.success('Page saved');
      } catch (err: unknown) {
        logger.error('Failed to save curated page', err);
        toast.error(`Failed to save page: ${String(err instanceof Error ? err.message : String(err))}`);
        throw err;
      }
    },
    [workspaceSession.refresh]
  );

  const handleApplyCopyEvent = useCallback(
    (stepId: number, event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => {
      const page = workspaceSession.curatedPages.find((p) => p.id === stepId);
      if (!page) return;

      // Merge into a fresh local envelope instead of persisting immediately.
      // The editor renders the updated envelope, compares it to the server
      // baseline, and enables Save so the user can persist the change.
      const sourceEnvelope = pendingCuratedEdits[stepId] ?? normalizeEnvelope(page);
      const nextEnvelope: CuratedPageEnvelope = {
        narrative: sourceEnvelope.narrative,
        graph: {
          nodes: [...(sourceEnvelope.graph?.nodes ?? [])],
          edges: [...(sourceEnvelope.graph?.edges ?? [])],
        },
        tables: [...(sourceEnvelope.tables ?? [])],
        diagrams: [...(sourceEnvelope.diagrams ?? [])],
      };
      let toastMessage = '';
      const events = Array.isArray(event) ? event : [event];

      for (const ev of events) {
        switch (ev.type) {
          case 'narrative': {
            const prefix = nextEnvelope.narrative.trim() ? '\n\n' : '';
            nextEnvelope.narrative = `${nextEnvelope.narrative}${prefix}${ev.payload}`;
            toastMessage = `Added ${ev.label || 'section'} to ${page.intent_text || `Page ${page.id}`}`;
            break;
          }
          case 'graph': {
            const parsedGraph = JSON.parse(ev.payload);
            const mergeResult = mergeGraphs(
              nextEnvelope.graph,
              { nodes: parsedGraph.nodes || [], edges: parsedGraph.edges || [] }
            );
            nextEnvelope.graph = { nodes: mergeResult.nodes, edges: mergeResult.edges };
            toastMessage = `Merged graph into ${page.intent_text || `Page ${page.id}`}: +${mergeResult.addedNodes} nodes, +${mergeResult.addedEdges} edges`;
            break;
          }
          case 'tables': {
            const parsedTables = JSON.parse(ev.payload);
            const existingNames = new Set(nextEnvelope.tables.map((t) => t.name));
            const newTables = (parsedTables ?? []).filter((t: { name: string }) => !existingNames.has(t.name));
            nextEnvelope.tables = [...nextEnvelope.tables, ...newTables];
            toastMessage = `Added ${newTables.length} table(s) to ${page.intent_text || `Page ${page.id}`}`;
            break;
          }
          case 'diagrams': {
            const parsedDiagrams = JSON.parse(ev.payload);
            const existingNames = new Set(nextEnvelope.diagrams.map((d) => d.name));
            const newDiagrams = (parsedDiagrams ?? []).filter((d: { name: string }) => !existingNames.has(d.name));
            nextEnvelope.diagrams = [...nextEnvelope.diagrams, ...newDiagrams];
            toastMessage = `Added ${newDiagrams.length} diagram(s) to ${page.intent_text || `Page ${page.id}`}`;
            break;
          }
        }
      }

      // Update the local pending edit so the editor sees the new envelope and
      // becomes dirty against the server baseline.
      setPendingCuratedEdits((prev) => ({
        ...prev,
        [stepId]: nextEnvelope,
      }));
      // Make the target page visible so the user sees the applied change and
      // the Save button reflect the updated envelope.
      setActiveTabId((current) => {
        const targetId = `curated-${stepId}`;
        return current === targetId ? current : targetId;
      });
      if (toastMessage) toast.success(toastMessage);
    },
    [workspaceSession.curatedPages, pendingCuratedEdits]
  );

  const handleCopyToCuratedPage = useCallback(
    (event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => {
      const events = Array.isArray(event) ? event : [event];
      const firstLabel = events[0]?.label;
      if (activeCuratedPage) {
        // Apply to the currently active curated page immediately.
        handleApplyCopyEvent(activeCuratedPage.id, events);
        return;
      }
      // No active curated page: show target picker.
      setPendingSection({ events, title: firstLabel });
    },
    [activeCuratedPage, handleApplyCopyEvent]
  );

  const handleSelectStep = useCallback((step: ResearchStepSummary, openInNewTab = false) => {
    setSelectedView({ kind: 'step', step });
    // Curated pages are handled via the dedicated Pages list and tab state.
    if (step.action_type === 'curated_page') return;

    const label = step.intent_text || step.raw_query || `Reflect ${step.id}`;

    if (openInNewTab) {
      const id = `view-step-${step.id}`;
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [...prev, { id, kind: 'view', label: label.slice(0, 40), sourceId: String(step.id) }];
      });
      setActiveTabId(id);
    } else {
      updateAnchorTab(label);
      setActiveTabId(ANCHOR_TAB_ID);
    }
  }, [updateAnchorTab]);

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
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
      ]);

      const displayNodes = nodesData.map(backendNodeToDisplayNode).filter(isGroundedNodeForWorkspace);
      const displayEdges = edgesData.map(backendEdgeToDisplayEdge).filter(isGroundedEdgeForWorkspace);

      setEntities(displayNodes);
      setEdges(displayEdges);
    } catch (err: unknown) {
      logger.error('Failed to load workspace data', { error: err, serverId, bankId });
      toast.error(`Failed to load workspace data: ${String(err instanceof Error ? err.message : String(err))}`);
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
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error('Failed to load Architxt entities', err);
        toast.error('Failed to load entities for contextual data');
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
      updateAnchorTab(step.intent_text || step.raw_query || `Reflect ${step.id}`);
      void workspaceSession.refresh();
    }
  }, [workspaceSession.result, workspaceSession.trail, workspaceSession.refresh, updateAnchorTab]);

  const handleRerunStep = useCallback(async (stepId: number) => {
    // Delegate to the research hook's rerun path so runningStepId is set and
    // pollForStepCompletion keeps the trail/status live until completion.
    await workspaceSession.handleRerunStep(stepId);
  }, [workspaceSession.handleRerunStep]);

  const handleReuseStep = useCallback((step: ResearchStepSummary) => {
    setReflectQuery(step.raw_query || step.intent_text || '');
    toast.success('Query copied to Reflect input');
  }, []);

  const handleInspectStep = useCallback((step: ResearchStepSummary) => {
    setInspectingStep(step);
  }, []);

  const handleRenameCuratedPage = useCallback(
    async (stepId: number, title: string) => {
      // Optimistically update any open curated tab labels.
      setTabs((prev) =>
        prev.map((t) => (t.kind === 'curated' && t.stepId === stepId ? { ...t, label: title } : t))
      );
      try {
        await researchApi.updateCuratedPage(stepId, { intent_text: title });
        await workspaceSession.refresh();
        toast.success('Page renamed');
      } catch (err: unknown) {
        logger.error('Failed to rename curated page', err);
        toast.error(`Failed to rename page: ${String(err instanceof Error ? err.message : String(err))}`);
      }
    },
    [workspaceSession.refresh]
  );

  const selectCuratedPage = useCallback((stepId: number) => {
    const page = workspaceSession.curatedPages.find((p) => p.id === stepId);
    if (!page) return;
    const id = `curated-${stepId}`;
    setTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [
        ...prev,
        {
          id,
          kind: 'curated',
          label: page.intent_text || `Page ${page.id}`,
          stepId,
        },
      ];
    });
    setActiveTabId(id);
  }, [workspaceSession.curatedPages]);

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
      const cached = prev[extId];
      const cachedEnvelope = cached?.envelope;
      const cachedEnvelopeEmpty =
        cachedEnvelope != null &&
        (cachedEnvelope.graph?.nodes?.length ?? 0) === 0 &&
        (cachedEnvelope.graph?.edges?.length ?? 0) === 0 &&
        (cachedEnvelope.tables?.length ?? 0) === 0 &&
        (cachedEnvelope.diagrams?.length ?? 0) === 0 &&
        !cachedEnvelope.narrative?.trim();
      // Re-fetch if loading, never fetched, or the cached envelope is empty while
      // raw content exists (server may now normalize the same content correctly).
      const needsFetch =
        !cached ||
        cached.loading ||
        cached.content === undefined ||
        cached.envelope === undefined ||
        cachedEnvelopeEmpty;
      if (!needsFetch) return prev;
      return { ...prev, [extId]: { ...prev[extId], loading: true, error: null } };
    });
    try {
      const result = await mentalModelsApi.fetchContent(serverId, bankId, extId);
      setModelContentCache((prev) => ({
        ...prev,
        [extId]: {
          content: result.content ?? null,
          envelope: result.envelope ?? undefined,
          found: result.found,
          loading: false,
          error: null,
        },
      }));
    } catch (err: unknown) {
      setModelContentCache((prev) => ({
        ...prev,
        [extId]: {
          content: prev[extId]?.content ?? null,
          envelope: prev[extId]?.envelope ?? undefined,
          found: prev[extId]?.found ?? false,
          loading: false,
          error: String(err instanceof Error ? err.message : String(err)) || 'Failed to load model content.',
        },
      }));
    }
  }, [serverId, bankId]);

  const selectEntityModel = useCallback((entityId: string, item: ModelItem, openInNewTab = false) => {
    setSelectedView({ kind: 'model', entityId, extId: item.extId, name: item.label });
    void loadModelContent(item.extId);

    if (openInNewTab) {
      const id = `view-model-${item.extId}`;
      const label = item.label || item.extId;
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [...prev, { id, kind: 'view', label: label.slice(0, 40), sourceId: item.extId }];
      });
      setActiveTabId(id);
    } else {
      updateAnchorTab(item.label || item.extId);
      setActiveTabId(ANCHOR_TAB_ID);
    }
  }, [loadModelContent, updateAnchorTab]);

  useEffect(() => {
    if (!serverId || !bankId || groundedNodeIds.length === 0) {
      setEntityInfoMap(null);
      return;
    }
    let cancelled = false;
    setLoadingEntityInfo(true);

    // The /entities/info route caps requests at 100 ids, so batch large graphs.
    async function loadAllEntityInfo() {
      const mergedEntities: Record<string, EntityInfo> = {};
      const BATCH = 100;
      for (let i = 0; i < groundedNodeIds.length; i += BATCH) {
        if (cancelled) return;
        const batch = groundedNodeIds.slice(i, i + BATCH);
        try {
          const result = await entityInfoApi.info(serverId, bankId, batch, false);
          if (cancelled) return;
          for (const [id, info] of Object.entries(result.entities)) {
            mergedEntities[id] = info;
          }
        } catch (err: unknown) {
          if (cancelled) return;
          logger.error('Failed to load entity info batch', { error: err, serverId, bankId, batchIndex: i / BATCH });
          toast.error(`Failed to load entity info: ${String(err instanceof Error ? err.message : String(err))}`);
        }
      }
      if (!cancelled) {
        setEntityInfoMap(mergedEntities);
        setLoadingEntityInfo(false);
      }
    }

    loadAllEntityInfo();
    return () => {
      cancelled = true;
    };
  }, [serverId, bankId, groundedNodeIds]);

  // Keep curated tabs in sync with the session's curated pages. Preserve the anchor tab.
  useEffect(() => {
    setTabs((prev) => {
      const anchor = prev.find((t) => t.id === ANCHOR_TAB_ID) ?? makeAnchorTab();
      const existingCuratedIds = new Set(
        prev.filter((t) => t.kind === 'curated' && t.stepId != null).map((t) => t.stepId!)
      );
      const currentPageIds = new Set(workspaceSession.curatedPages.map((p) => p.id));

      // Remove tabs whose pages were deleted, keep all view tabs including anchor.
      const cleaned = prev.filter(
        (t) => t.id === ANCHOR_TAB_ID || t.kind !== 'curated' || (t.stepId != null && currentPageIds.has(t.stepId))
      );

      // Add tabs for new pages.
      const added = workspaceSession.curatedPages
        .filter((p) => !existingCuratedIds.has(p.id))
        .map((p) => ({
          id: `curated-${p.id}`,
          kind: 'curated' as const,
          label: p.intent_text || `Page ${p.id}`,
          stepId: p.id,
        }));

      const next = [anchor, ...cleaned.filter((t) => t.id !== ANCHOR_TAB_ID), ...added];

      // Ensure an active tab exists if we have tabs and the current one is stale.
      setActiveTabId((current) => {
        const stillActive = next.some((t) => t.id === current);
        if (!stillActive && next.length > 0) {
          return added[0]?.id || next[0].id;
        }
        if (next.length === 0) return null;
        return current;
      });

      return next;
    });
  }, [workspaceSession.curatedPages]);

  return (
    <PageShell
      title="Workspace"
      loading={loadingServers || loadingBanks}
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
        </div>

        {/* Main two-column workbench */}
        <div ref={mainRowRef} className="flex-1 min-h-0 flex">
          {/* Column 1: scope + query | session items | contextual data */}
          <div ref={leftColumnRef} className="flex flex-col min-h-0" style={{ flex: columnWidths.left, minWidth: 220 }}>
            <div className="flex flex-col min-h-0" style={{ flex: leftPaneHeights.top, minHeight: 120 }}>
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
                className="flex-1 min-h-0"
              />
            </div>

            <ResizeHandle direction="horizontal" onMouseDown={handleHResizeStart('row1')} title="Drag to resize query / lower panels" />

            <div ref={leftBottomRef} className="flex min-h-0" style={{ flex: leftPaneHeights.bottom, minHeight: 140 }}>
              {serverId && bankId ? (
                <>
                  <div className="flex flex-col min-h-0" style={{ flex: innerWidths.left, minWidth: 160 }}>
                    <AttachedEntitiesPanel
                      entityIds={groundedNodeIds}
                      entityInfoMap={entityInfoMap}
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
          <div ref={rightPanelRef} className="flex flex-col min-h-0 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] overflow-hidden" style={{ flex: columnWidths.right, minWidth: 280 }}>
            <CuratedPageTabs
              tabs={tabs}
              activeTabId={activeTabId}
              curatedPages={workspaceSession.curatedPages}
              onSelect={setActiveTabId}
              onSelectCuratedPage={selectCuratedPage}
              onCreateCuratedPage={async (title) => {
                if (!activeSession) return;
                try {
                  await researchApi.createSessionPage(activeSession.id, title);
                  await workspaceSession.refresh();
                  toast.success(`Created ${title}`);
                } catch (err: unknown) {
                  logger.error('Failed to create curated page', err);
                  toast.error(`Failed to create page: ${String(err instanceof Error ? err.message : String(err))}`);
                }
              }}
              onRenameCuratedPage={handleRenameCuratedPage}
              onDeleteCuratedPage={async (stepId) => {
                try {
                  await researchApi.deleteStep(stepId);
                  await workspaceSession.refresh();
                  toast.success('Page deleted');
                } catch (err: unknown) {
                  logger.error('Failed to delete curated page', err);
                  toast.error(`Failed to delete page: ${String(err instanceof Error ? err.message : String(err))}`);
                }
              }}
              onCloseTab={(tabId, kind, isEmpty) => {
                const tab = tabs.find((t) => t.id === tabId);
                if (!tab || tab.pinned) return;
                if (kind === 'curated') {
                  // Closing a curated tab only deletes the page if it is empty.
                  if (isEmpty) {
                    if (tab.stepId != null) {
                      void researchApi.deleteStep(tab.stepId).then(() => workspaceSession.refresh());
                    }
                  }
                }
                setTabs((prev) => prev.filter((t) => t.id !== tabId));
                if (activeTabId === tabId) {
                  const remaining = tabs.filter((t) => t.id !== tabId);
                  setActiveTabId(remaining[0]?.id ?? ANCHOR_TAB_ID);
                }
              }}
              onCloseAllViews={() => {
                setTabs((prev) => {
                  const anchor = prev.find((t) => t.id === ANCHOR_TAB_ID) ?? makeAnchorTab();
                  return [anchor, ...prev.filter((t) => t.kind === 'curated')];
                });
                setActiveTabId(ANCHOR_TAB_ID);
              }}
            />
            <WorkspaceResultPanel
              result={previewResult}
              title={previewTitle}
              isRunning={reflectLoading && activeTabId === ANCHOR_TAB_ID}
              error={previewError}
              sessionName={activeSession?.title}
              keyPrefix="preview"
              activeCuratedPage={activeCuratedPageWithEdits}
              activeCuratedPageBaseline={activeCuratedPage ? normalizeEnvelope(activeCuratedPage) : undefined}
              curatedPages={workspaceSession.curatedPages}
              onSaveCuratedPage={handleSaveCuratedPage}
              onCopyToCuratedPage={handleCopyToCuratedPage}
            />
          </div>
        </div>

        <QueryInspectDialog
          open={inspectingStep !== null}
          onOpenChange={(open) => {
            if (!open) setInspectingStep(null);
          }}
          step={inspectingStep}
        />

        {pendingSection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="rounded-lg border border-white/10 bg-[oklch(0.18_0_0)] p-4 w-80 shadow-lg">
              <div className="text-sm font-medium text-white/90 mb-2">Add section to page</div>
              <p className="text-xs text-white/60 mb-4">
                “{pendingSection.title || 'Untitled section'}”
              </p>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto mb-4">
                {workspaceSession.curatedPages.length === 0 && (
                  <div className="text-xs text-white/40">No curated pages yet. Create one from the Pages menu.</div>
                )}
                {workspaceSession.curatedPages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => {
                      void handleApplyCopyEvent(page.id, pendingSection.events);
                      setPendingSection(null);
                    }}
                    className="text-left text-xs px-2 py-1.5 rounded border border-white/10 bg-black/20 text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    {page.intent_text || `Page ${page.id}`}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPendingSection(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}

      </div>
    </PageShell>
  );
}
