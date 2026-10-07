'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutTemplate, LayoutPanelLeft, Map as MapIcon, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { PageShell } from '@/app/components/page-shell';
import { CardContent } from '@/components/ui/card';
import { ServerBankSelectors } from '@/app/research-shared/server-bank-selectors';
import { viewToMermaid } from '@/lib/graph/view-to-mermaid';
import { viewToEnvelope } from '@/lib/graph/view-to-envelope';
import { researchApi, type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { useWorkspaceSession } from '@/app/workspace/_components/use-workspace-session';
import { normalizeEnvelope, uuidv4 } from '@/lib/envelope-markdown';
import { mergeGraphs } from '@/lib/envelope-merge';
import { CuratedPageEnvelope } from '@/app/workspace/_components/curated-page-editor';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { serversApi, viewsApi, contextualGraphApi } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';
import type { View } from '@/lib/types';
import type { SelectorBank } from '@/app/research-shared/server-bank-selectors';
import { cn } from '@/lib/utils';
import { Panel, PanelContent, ResizeHandle } from '@/app/workspace/_components/panel-layout';
import ViewEditor, { type ViewEditorHandle } from './components/view-editor';
import { ViewTabs, type ViewTab, generateNewViewName } from './components/view-tabs';
import {
  DEFAULT_LAYOUT_OPTIONS,
  DEFAULT_ROUTING_TUNABLES,
  DEFAULT_NODE_TUNABLES,
  DEFAULT_BACKGROUND_VARIANT,
  type LayoutOptions,
  type RoutingTunables,
  type NodeTunables,
  type BackgroundVariantOption,
} from './components/view-editor-options';
import type { ViewControlsState } from '@/lib/types';
import { EntitiesPanel } from './components/entities-panel';
import { DetailPanel } from './components/detail-panel';
import { WorkspacePagePicker } from './components/workspace-page-picker';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import { backendEdgeToDisplayEdge, type DisplayEdge } from '@/lib/contextual-graph/display';
import { ensureEnvelopeIds } from '@/lib/envelope-markdown';
import type { UnifiedEnvelope } from '@/lib/api/client';

const logger = createLogger('ViewsPage');

export default function ViewsPage() {
  const [servers, setServers] = useState<any[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [views, setViews] = useState<View[]>([]);
  const [tabs, setTabs] = useState<ViewTab[]>([]);
  const [contextualEdges, setContextualEdges] = useState<DisplayEdge[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const tabsHydratedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [loadingViews, setLoadingViews] = useState(true);
  const [layoutOptions, setLayoutOptions] = useState<LayoutOptions>(DEFAULT_LAYOUT_OPTIONS);
  const [routingTunables, setRoutingTunables] = useState<RoutingTunables>(DEFAULT_ROUTING_TUNABLES);
  const [nodeTunables, setNodeTunables] = useState<NodeTunables>(DEFAULT_NODE_TUNABLES);
  const [showEdgeLabels, setShowEdgeLabels] = useState<boolean>(true);
  const handleShowEdgeLabelsChange = useCallback((show: boolean) => {
    controlsChangedRef.current = true;
    setShowEdgeLabels(show);
  }, []);
  const [showNodeIds, setShowNodeIds] = useState<boolean>(true);
  const handleShowNodeIdsChange = useCallback((show: boolean) => {
    controlsChangedRef.current = true;
    setShowNodeIds(show);
  }, []);
  const [showHandles, setShowHandles] = useState<boolean>(false);
  const handleShowHandlesChange = useCallback((show: boolean) => {
    controlsChangedRef.current = true;
    setShowHandles(show);
  }, []);
  const [showNodeColorBar, setShowNodeColorBar] = useState<boolean>(false);
  const handleShowNodeColorBarChange = useCallback((show: boolean) => {
    controlsChangedRef.current = true;
    setShowNodeColorBar(show);
  }, []);
  const [backgroundVariant, setBackgroundVariant] = useState<BackgroundVariantOption>(DEFAULT_BACKGROUND_VARIANT);
  const handleBackgroundVariantChange = useCallback((variant: BackgroundVariantOption) => {
    controlsChangedRef.current = true;
    setBackgroundVariant(variant);
  }, []);
  const [topK, setTopK] = useState<number | undefined>(undefined);
  const handleTopKChange = useCallback((value: number) => {
    controlsChangedRef.current = true;
    setTopK(value);
  }, []);
  const [deletingTabIds, setDeletingTabIds] = useState<string[]>([]);
  const editorRef = useRef<ViewEditorHandle | null>(null);
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [selectedItems, setSelectedItems] = useState<{ nodeIds: string[]; edgeIds: string[] }>({ nodeIds: [], edgeIds: [] });
  const [findTarget, setFindTarget] = useState<{ id: string; kind: 'node' | 'edge' } | null>(null);
  const handleFindSelected = useCallback(() => {
    // Use the page-level selection state instead of reading the editor ref,
    // because clicking the toolbar can steal focus and clear React Flow's
    // internal selection before the click handler runs.
    const nodeId = selectedItems.nodeIds[0];
    const edgeId = selectedItems.edgeIds[0];
    if (nodeId) {
      setFindTarget({ kind: 'node', id: nodeId });
    } else if (edgeId) {
      setFindTarget({ kind: 'edge', id: edgeId });
    }
  }, [selectedItems]);

  const controlsChangedRef = useRef(false);
  const controlsSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleLayoutOptionsChange = useCallback(
    (opts: LayoutOptions) => {
      controlsChangedRef.current = true;
      setLayoutOptions(opts);
    },
    []
  );

  const handleRoutingTunablesChange = useCallback(
    (opts: RoutingTunables) => {
      controlsChangedRef.current = true;
      setRoutingTunables(opts);
    },
    []
  );

  const handleNodeTunablesChange = useCallback(
    (opts: NodeTunables) => {
      controlsChangedRef.current = true;
      setNodeTunables(opts);
    },
    []
  );

  // 3-column layout state.
  const mainRowRef = useRef<HTMLDivElement>(null);
  const [columnWidths, setColumnWidths] = useState({ left: 0.2, middle: 0.5, right: 0.3 });
  const [showLeftColumn, setShowLeftColumn] = useState(true);
  const [showRightColumn, setShowRightColumn] = useState(true);
  const [resizing, setResizing] = useState<null | 'col1' | 'col2'>(null);
  const resizeStartRef = useRef({
    x: 0,
    width: 0,
    widths: { left: 0.2, middle: 0.5, right: 0.3 },
  });
  type ColumnWidths = { left: number; middle: number; right: number };
  const pendingColumnWidths = useRef<ColumnWidths | null>(null);
  const flushColumnWidthsRef = useRef<number | null>(null);

  const visibleColumnFlex = useMemo(() => {
    let left = columnWidths.left;
    const middle = columnWidths.middle;
    let right = columnWidths.right;
    if (!showLeftColumn) left = 0;
    if (!showRightColumn) right = 0;
    const total = left + middle + right;
    return {
      left: total > 0 ? left / total : 0,
      middle: total > 0 ? middle / total : 0,
      right: total > 0 ? right / total : 0,
    };
  }, [columnWidths, showLeftColumn, showRightColumn]);

  const flushColumnWidths = useCallback(() => {
    flushColumnWidthsRef.current = null;
    const next = pendingColumnWidths.current;
    if (next) {
      pendingColumnWidths.current = null;
      setColumnWidths(next);
    }
  }, []);

  const scheduleFlushColumnWidths = useCallback(() => {
    if (flushColumnWidthsRef.current != null) return;
    flushColumnWidthsRef.current = requestAnimationFrame(() => {
      flushColumnWidths();
      if (pendingColumnWidths.current != null) {
        scheduleFlushColumnWidths();
      }
    });
  }, [flushColumnWidths]);

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
      const MIN = 0.18;

      if (resizing === 'col1') {
        const nextLeft = Math.max(MIN, Math.min(widths.left + delta, 1 - MIN));
        const nextMiddle = Math.max(MIN, widths.middle - (nextLeft - widths.left));
        const nextRight = Math.max(MIN, 1 - nextLeft - nextMiddle);
        pendingColumnWidths.current = { left: nextLeft, middle: nextMiddle, right: nextRight };
      } else if (resizing === 'col2') {
        const nextRight = Math.max(MIN, Math.min(widths.right - delta, 1 - MIN));
        const nextMiddle = Math.max(MIN, widths.middle + (widths.right - nextRight));
        const nextLeft = Math.max(MIN, 1 - nextMiddle - nextRight);
        pendingColumnWidths.current = { left: nextLeft, middle: nextMiddle, right: nextRight };
      }
      scheduleFlushColumnWidths();
    },
    [resizing, scheduleFlushColumnWidths]
  );

  const handleResizeEnd = useCallback(() => {
    setResizing(null);
    if (flushColumnWidthsRef.current != null) {
      cancelAnimationFrame(flushColumnWidthsRef.current);
      flushColumnWidthsRef.current = null;
    }
    flushColumnWidths();
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [flushColumnWidths]);

  useEffect(() => {
    if (!resizing) return;
    window.addEventListener('mousemove', handleResizeMove);
    window.addEventListener('mouseup', handleResizeEnd);
    return () => {
      window.removeEventListener('mousemove', handleResizeMove);
      window.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [resizing, handleResizeMove, handleResizeEnd]);

  const handleResizeReset = useCallback(() => {
    setColumnWidths({ left: 0.2, middle: 0.6, right: 0.2 });
  }, []);

  const handleResizeResetAll = useCallback(() => {
    setColumnWidths({ left: 0.2, middle: 0.6, right: 0.2 });
    setShowLeftColumn(true);
    setShowRightColumn(true);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'F3') {
        e.preventDefault();
        handleFindSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleFindSelected]);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
    lastSessionId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId ?? '';

  const workspaceSession = useWorkspaceSession({ serverId, bankId, lastSessionId });
  const [activeSession, setActiveSession] = useState<ResearchSession | null>(workspaceSession.activeSession);

  const viewTabsKey = useMemo(() => {
    if (!serverId || !bankId) return null;
    return `architxt:views-tabs:${serverId}:${bankId}`;
  }, [serverId, bankId]);

  // Hydrate view tabs from localStorage once views are loaded.
  useEffect(() => {
    if (tabsHydratedRef.current) return;
    if (!viewTabsKey) return;
    if (loadingViews) return;

    try {
      const raw = localStorage.getItem(viewTabsKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          tabs?: ViewTab[];
          activeTabId?: string;
        };
        const restoredTabs = Array.isArray(saved.tabs) ? saved.tabs : [];
        const validTabs: ViewTab[] = [];
        for (const t of restoredTabs) {
          if (!t || typeof t.id !== 'string' || typeof t.label !== 'string') continue;
          // Drop tabs for views that no longer exist unless they are being created.
          if (t.viewId && !views.some((v) => v.id === t.viewId)) continue;
          validTabs.push({
            id: t.id,
            viewId: t.viewId,
            label: t.label,
          });
        }
        if (validTabs.length > 0) {
          setTabs(validTabs);
          if (saved.activeTabId && validTabs.some((t) => t.id === saved.activeTabId)) {
            setActiveTabId(saved.activeTabId);
          } else {
            setActiveTabId(validTabs[0].id);
          }
        }
      }
    } catch (err) {
      logger.error('Failed to hydrate view tabs', err);
    }

    tabsHydratedRef.current = true;
  }, [viewTabsKey, loadingViews, views]);

  // Persist view tabs whenever they change after hydration.
  useEffect(() => {
    if (!tabsHydratedRef.current || !viewTabsKey) return;
    try {
      localStorage.setItem(viewTabsKey, JSON.stringify({ tabs, activeTabId }));
    } catch (err) {
      logger.error('Failed to persist view tabs', err);
    }
  }, [viewTabsKey, tabs, activeTabId]);

  const [confirmMergePage, setConfirmMergePage] = useState<{ page: ResearchStepSummary; events: EnvelopeCopyEvent[] } | null>(null);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspacePickerTitle, setWorkspacePickerTitle] = useState<string>('');
  const [workspacePickerEvents, setWorkspacePickerEvents] = useState<EnvelopeCopyEvent[] | null>(null);

  useEffect(() => {
    if (!serverId || !bankId) {
      setActiveSession(null);
      return;
    }
    setActiveSession(workspaceSession.activeSession);
  }, [workspaceSession.activeSession?.id, workspaceSession.activeSession?.title, serverId, bankId]);

  const activeView = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab?.viewId) return null;
    return views.find((v) => v.id === tab.viewId) ?? null;
  }, [tabs, activeTabId, views]);


function envelopeFromEvents(events: EnvelopeCopyEvent[]): UnifiedEnvelope {
  const out: UnifiedEnvelope = {
    narratives: [],
    graph: { name: '', nodes: [], edges: [] },
    tables: [],
    diagrams: [],
  };
  for (const event of events) {
    switch (event.type) {
      case 'narrative': {
        out.narratives.push({
          id: event.id || uuidv4(),
          narrative_name: event.label || 'Section',
          narrative: event.payload,
          evidence: event.evidence || [],
        });
        break;
      }
      case 'tables': {
        try {
          const parsed = JSON.parse(event.payload);
          if (Array.isArray(parsed)) out.tables.push(...parsed);
        } catch (err) {
          logger.error('Failed to parse table copy event payload', err);
        }
        break;
      }
      case 'diagrams': {
        try {
          const parsed = JSON.parse(event.payload);
          if (Array.isArray(parsed)) {
            out.diagrams.push(
              ...parsed.map((d: { id?: string | null; name?: string; type?: string; content?: string; evidence?: string[] }) => {
                const item: UnifiedEnvelope['diagrams'][number] = {
                  id: d.id || uuidv4(),
                  name: d.name || '',
                  type: d.type || '',
                  content: d.content || '',
                  evidence: d.evidence || [],
                };
                return item;
              })
            );
          }
        } catch (err) {
          logger.error('Failed to parse diagram copy event payload', err);
        }
        break;
      }
      case 'graph': {
        try {
          const parsed = JSON.parse(event.payload);
          out.graph.name = parsed.name || out.graph.name;
          out.graph.nodes.push(...(parsed.nodes || []));
          out.graph.edges.push(...(parsed.edges || []));
        } catch (err) {
          logger.error('Failed to parse graph copy event payload', err);
        }
        break;
      }
    }
  }
  return ensureEnvelopeIds(out);
}

  const handleApplyEventsToWorkspacePage = useCallback(
    async (page: ResearchStepSummary, events: EnvelopeCopyEvent[], options?: { skipConfirm?: boolean }) => {
      if (!events.length) return;
      const sourceEnvelope = normalizeEnvelope(page);
      const incomingEnvelope = envelopeFromEvents(events);
      const hasExistingGraph =
        (sourceEnvelope.graph?.nodes?.length ?? 0) > 0 ||
        (sourceEnvelope.graph?.edges?.length ?? 0) > 0;
      if ((incomingEnvelope.graph.nodes.length > 0 || incomingEnvelope.graph.edges.length > 0) && hasExistingGraph && !options?.skipConfirm) {
        setConfirmMergePage({ page, events });
        return;
      }

      const nextEnvelope: CuratedPageEnvelope = {
        narratives: [...(sourceEnvelope.narratives ?? []), ...(incomingEnvelope.narratives ?? [])],
        graph: { nodes: [...(sourceEnvelope.graph?.nodes ?? [])], edges: [...(sourceEnvelope.graph?.edges ?? [])] },
        tables: [...(sourceEnvelope.tables ?? []), ...(incomingEnvelope.tables ?? [])],
        diagrams: [...(sourceEnvelope.diagrams ?? [])],
      };

      const graphMerge = mergeGraphs(nextEnvelope.graph, incomingEnvelope.graph);
      nextEnvelope.graph = { nodes: graphMerge.nodes, edges: graphMerge.edges };

      const newDiagrams = incomingEnvelope.diagrams.map((d) => ({ ...d, id: uuidv4(), evidence: d.evidence ?? [] }));
      nextEnvelope.diagrams = [...nextEnvelope.diagrams, ...newDiagrams];

      await researchApi.updateCuratedPage(page.id, { envelope: nextEnvelope });
      await workspaceSession.fetchTrail(activeSession?.id ?? page.session_id);
      toast.success(`Applied to ${page.intent_text || `Page ${page.id}`}: +${graphMerge.addedNodes} nodes, +${graphMerge.addedEdges} edges, +${newDiagrams.length} diagram(s), +${incomingEnvelope.narratives.length} section(s)`);
    },
    [activeSession, normalizeEnvelope, mergeGraphs, uuidv4, workspaceSession.fetchTrail]
  );

  const handleConfirmMerge = useCallback(() => {
    const payload = confirmMergePage;
    setConfirmMergePage(null);
    if (payload) {
      handleApplyEventsToWorkspacePage(payload.page, payload.events, { skipConfirm: true });
    }
  }, [confirmMergePage, handleApplyEventsToWorkspacePage]);

  const handleCreateWorkspacePageAndApply = useCallback(
    async () => {
      if (!activeSession || !workspacePickerEvents?.length) return;
      const title = workspacePickerTitle || 'Section';
      try {
        const newPage = await researchApi.createSessionPage(activeSession.id, title);
        await workspaceSession.fetchTrail(activeSession.id);
        await handleApplyEventsToWorkspacePage(newPage, workspacePickerEvents);
        setWorkspacePickerOpen(false);
      } catch (err: unknown) {
        logger.error('Failed to create workspace page from view', err);
        toast.error(`Failed to create page: ${String(err instanceof Error ? err.message : String(err))}`);
      }
    },
    [activeSession, workspacePickerEvents, workspacePickerTitle, workspaceSession, handleApplyEventsToWorkspacePage]
  );

  const handleSendViewToWorkspace = useCallback(() => {
    if (!activeView) return;
    const envelope = viewToEnvelope(activeView, {
      direction: layoutOptions.direction,
      title: activeView.name,
      showEdgeLabels,
      edgeMergeMode: layoutOptions.edgeMergeMode,
      diagramName: activeView.name || 'View diagram',
      graphName: activeView.name || 'View graph',
    });
    const events: EnvelopeCopyEvent[] = [];
    if (envelope.graph.nodes.length > 0 || envelope.graph.edges.length > 0) {
      events.push({ type: 'graph', payload: JSON.stringify(envelope.graph), label: envelope.graph.name ?? undefined });
    }
    for (const d of envelope.diagrams) {
      events.push({ type: 'diagrams', payload: JSON.stringify([d]), label: d.name ?? undefined, evidence: d.evidence ?? undefined, id: d.id });
    }
    setWorkspacePickerTitle(activeView.name || 'Untitled view');
    setWorkspacePickerEvents(events.length ? events : null);
    setWorkspacePickerOpen(true);
  }, [activeView, layoutOptions.direction, showEdgeLabels, layoutOptions.edgeMergeMode]);

  const handleDetailAddToPage = useCallback((event: EnvelopeCopyEvent) => {
    setWorkspacePickerTitle(event.label ?? 'Section');
    setWorkspacePickerEvents([event]);
    setWorkspacePickerOpen(true);
  }, []);

  const handleViewChange = useCallback(
    async (updates: { graph?: View['graph']; layout?: View['layout'] }) => {
      if (!serverId || !bankId || !activeView) return;

      setSaving(true);
      try {
        const result = await viewsApi.update(serverId, bankId, activeView.id, updates);
        setViews((prev) =>
          prev.map((v) => (v.id === result.id ? { ...v, ...updates } : v))
        );
      } catch (err) {
        logger.error('Failed to save view', err);
        toast.error('Failed to save view changes');
      } finally {
        setSaving(false);
      }
    },
    [serverId, bankId, activeView]
  );
  const handleResetControls = useCallback(() => {
    setLayoutOptions(DEFAULT_LAYOUT_OPTIONS);
    setRoutingTunables(DEFAULT_ROUTING_TUNABLES);
    setNodeTunables(DEFAULT_NODE_TUNABLES);
    setShowEdgeLabels(true);
    setShowNodeIds(true);
    setShowHandles(false);
    setShowNodeColorBar(false);
    setBackgroundVariant(DEFAULT_BACKGROUND_VARIANT);
    setTopK(undefined);
    if (activeView) {
      const layout: View['layout'] = {
        ...activeView.layout,
        controls: {
          layoutOptions: DEFAULT_LAYOUT_OPTIONS,
          routingTunables: DEFAULT_ROUTING_TUNABLES,
          nodeTunables: DEFAULT_NODE_TUNABLES,
          showEdgeLabels: true,
          showNodeIds: true,
          showHandles: false,
          showNodeColorBar: false,
          backgroundVariant: DEFAULT_BACKGROUND_VARIANT,
          topK: undefined,
        },
      };
      handleViewChange({ layout });
    }
  }, [activeView, handleViewChange]);

  // Restore per-view controls whenever the active view changes.
  useEffect(() => {
    if (!activeView) return;
    const controls = activeView.layout?.controls;
    if (controls) {
      setLayoutOptions(controls.layoutOptions as LayoutOptions);
      setRoutingTunables(controls.routingTunables as RoutingTunables);
      setNodeTunables({ ...DEFAULT_NODE_TUNABLES, ...(controls.nodeTunables as NodeTunables) });
      setShowEdgeLabels(controls.showEdgeLabels !== false);
      setShowNodeIds(controls.showNodeIds !== false);
      setShowHandles(controls.showHandles !== false);
      setShowNodeColorBar(controls.showNodeColorBar === true);
      setBackgroundVariant(controls.backgroundVariant ?? DEFAULT_BACKGROUND_VARIANT);
      setTopK(controls.topK);
    } else {
      setLayoutOptions(DEFAULT_LAYOUT_OPTIONS);
      setRoutingTunables(DEFAULT_ROUTING_TUNABLES);
      setNodeTunables(DEFAULT_NODE_TUNABLES);
      setShowEdgeLabels(true);
      setShowNodeIds(true);
      setShowHandles(false);
      setShowNodeColorBar(false);
      setBackgroundVariant(DEFAULT_BACKGROUND_VARIANT);
      setTopK(undefined);
    }
    controlsChangedRef.current = false;
    if (controlsSaveTimeoutRef.current) {
      clearTimeout(controlsSaveTimeoutRef.current);
      controlsSaveTimeoutRef.current = null;
    }
  }, [activeView?.id]);

  // Persist control changes back to the active view after a short idle delay.
  useEffect(() => {
    if (!activeView || !controlsChangedRef.current) return;
    if (controlsSaveTimeoutRef.current) {
      clearTimeout(controlsSaveTimeoutRef.current);
    }
    controlsSaveTimeoutRef.current = setTimeout(() => {
      controlsChangedRef.current = false;
      const layout: View['layout'] = {
        ...activeView.layout,
        controls: {
          layoutOptions,
          routingTunables,
          nodeTunables,
          showEdgeLabels,
          showNodeIds,
          showHandles,
          showNodeColorBar,
          backgroundVariant,
          topK,
        },
      };
      handleViewChange({ layout });
    }, 600);
    return () => {
      if (controlsSaveTimeoutRef.current) {
        clearTimeout(controlsSaveTimeoutRef.current);
      }
    };
  }, [activeView, layoutOptions, routingTunables, nodeTunables, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, backgroundVariant, topK, handleViewChange]);

  // Load servers
  useEffect(() => {
    let cancelled = false;
    setLoadingServers(true);
    serversApi.list()
      .then((srvs) => {
        if (cancelled) return;
        setServers(srvs);
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Failed to load servers', err);
        toast.error('Failed to load servers');
      })
      .finally(() => {
        if (!cancelled) setLoadingServers(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Load banks for selected server
  useEffect(() => {
    if (!serverId) {
      setBanks([]);
      return;
    }
    let cancelled = false;
    setLoadingBanks(true);
    serversApi.get(serverId)
      .then((srv) => {
        if (cancelled) return;
        setBanks(
          (srv.contextual_graph_banks || []).map((b) => ({
            bank_id: b.bank_id,
            name: b.bank_id,
          }))
        );
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Failed to load server banks', err);
        toast.error('Failed to load banks');
      })
      .finally(() => {
        if (!cancelled) setLoadingBanks(false);
      });
    return () => { cancelled = true; };
  }, [serverId]);

  const loadViews = useCallback(async () => {
    if (!serverId || !bankId) return;
    setLoadingViews(true);
    try {
      const list = await viewsApi.list(serverId, bankId);
      setViews(list);

      // Update labels of open tabs to match latest names.
      setTabs((prev) => {
        const byId = new Map(list.map((v) => [v.id, v.name]));
        return prev.map((t) => {
          const latest = t.viewId ? byId.get(t.viewId) : undefined;
          return latest !== undefined && latest !== t.label ? { ...t, label: latest } : t;
        });
      });

      // If a persisted tab was open but the view no longer exists, close it.
      setTabs((prev) => prev.filter((t) => list.some((v) => v.id === t.viewId)));
    } catch (err) {
      logger.error('Failed to load views', err);
      toast.error('Failed to load views');
    } finally {
      setLoadingViews(false);
    }
  }, [serverId, bankId, tabs]);

  useEffect(() => {
    tabsHydratedRef.current = false;
    setViews([]);
    setTabs([]);
    setContextualEdges([]);
    setActiveTabId('');
    if (serverId && bankId) {
      loadViews();
      contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 })
        .then((edges) => setContextualEdges(edges.map(backendEdgeToDisplayEdge)))
        .catch((err) => logger.error('Failed to load contextual edges', err));
    }
  }, [serverId, bankId]);

  const handleCreateView = async (name: string) => {
    if (!serverId || !bankId) return;
    try {
      const { id } = await viewsApi.create(serverId, bankId, { name });
      toast.success('View created');
      await loadViews();
      setTabs((prev) => {
        const exists = prev.some((t) => t.viewId === id);
        if (exists) return prev;
        return [...prev, { id: `view-${id}`, viewId: id, label: name }];
      });
      setActiveTabId(`view-${id}`);
    } catch (err) {
      logger.error('Failed to create view', err);
      toast.error('Failed to create view');
      throw err;
    }
  };

  const handleSelectView = useCallback((viewId: string) => {
    const view = views.find((v) => v.id === viewId);
    if (!view) return;
    const tabId = `view-${viewId}`;
    setTabs((prev) => {
      if (prev.some((t) => t.id === tabId)) return prev;
      return [...prev, { id: tabId, viewId, label: view.name }];
    });
    setActiveTabId(tabId);
  }, [views]);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTabId === tabId) {
        const fallback = next[index] ?? next[next.length - 1] ?? null;
        setActiveTabId(fallback?.id ?? '');
      }
      return next;
    });
  }, [activeTabId]);

  const handleRenameView = useCallback(async (tab: ViewTab, nextLabel: string) => {
    if (!serverId || !bankId || !tab.viewId) return;
    try {
      await viewsApi.update(serverId, bankId, tab.viewId, { name: nextLabel });
      toast.success('View renamed');
      await loadViews();
      setTabs((prev) =>
        prev.map((t) => (t.id === tab.id ? { ...t, label: nextLabel } : t))
      );
    } catch (err) {
      logger.error('Failed to rename view', err);
      toast.error('Failed to rename view');
    }
  }, [serverId, bankId, loadViews]);

  const handleDeleteView = useCallback(async (tab: ViewTab) => {
    if (!serverId || !bankId || !tab.viewId) return;
    if (deletingTabIds.includes(tab.id)) return;
    setDeletingTabIds((prev) => [...prev, tab.id]);
    try {
      // Optimistically remove the tab before the API call so a slow network or
      // double-click cannot trigger a second delete.
      setTabs((prev) => prev.filter((t) => t.id !== tab.id));
      if (activeTabId === tab.id) {
        const index = tabs.findIndex((t) => t.id === tab.id);
        const remaining = tabs.filter((t) => t.id !== tab.id);
        const fallback = remaining[index] ?? remaining[remaining.length - 1] ?? null;
        setActiveTabId(fallback?.id ?? '');
      }
      await viewsApi.delete(serverId, bankId, tab.viewId);
      toast.success('View deleted');
      await loadViews();
    } catch (err) {
      logger.error('Failed to delete view', err);
      toast.error('Failed to delete view');
      // Restore the tab on failure so the user can retry or see the error.
      setTabs((prev) => {
        if (prev.some((t) => t.id === tab.id)) return prev;
        return [...prev, tab];
      });
    } finally {
      setDeletingTabIds((prev) => prev.filter((id) => id !== tab.id));
    }
  }, [serverId, bankId, activeTabId, loadViews, deletingTabIds]);

  const pageToolbar = (
    <div className="flex items-center gap-2 justify-between w-full">
      <div className="flex items-center gap-2">
        <ServerBankSelectors
          servers={servers}
          selectedServerId={selectedServerId}
          setSelectedServerId={setSelectedServerId}
          banks={banks}
          selectedBankId={selectedBankId}
          setSelectedBankId={setSelectedBankId}
          loadingBanks={loadingBanks}
          disabled={loadingServers}
        />
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setShowLeftColumn((v) => !v)}
          className={cn(
            'h-7 w-7 inline-flex items-center justify-center rounded border transition-colors',
            showLeftColumn
              ? 'bg-accent-primary-bg/30 border-accent-primary-bd text-accent-primary-fg'
              : 'bg-surface-panel border-border-default text-foreground-faint hover:text-foreground-default hover:bg-surface-card'
          )}
          title={showLeftColumn ? 'Hide left column' : 'Show left column'}
        >
          <LayoutPanelLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowRightColumn((v) => !v)}
          className={cn(
            'h-7 w-7 inline-flex items-center justify-center rounded border transition-colors',
            showRightColumn
              ? 'bg-accent-primary-bg/30 border-accent-primary-bd text-accent-primary-fg'
              : 'bg-surface-panel border-border-default text-foreground-faint hover:text-foreground-default hover:bg-surface-card'
          )}
          title={showRightColumn ? 'Hide detail column' : 'Show detail column'}
        >
          <MessageSquare className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  return (
    <PageShell title="Views">
      <div className="flex flex-col flex-1 min-h-0 h-full gap-2">
        <div className="px-1 py-2">{pageToolbar}</div>

        <div ref={mainRowRef} className="flex-1 min-h-0 flex">
          {/* Column 1: Entities */}
          {showLeftColumn && (
            <EntitiesPanel
              serverId={serverId || null}
              bankId={bankId || null}
              activeView={activeView}
              onChange={handleViewChange}
              findTarget={findTarget}
              onFindComplete={() => setFindTarget(null)}
              style={{ flex: visibleColumnFlex.left, minWidth: 220 }}
            />
          )}

          {showLeftColumn && (
            <ResizeHandle
              direction="vertical"
              onMouseDown={handleResizeStart('col1')}
              onDoubleClick={handleResizeReset}
              title="Drag to resize entities / graph columns; double-click to reset"
            />
          )}

          {/* Column 2: Graph editor */}
          <Panel className="min-h-0" style={{ flex: visibleColumnFlex.middle, minWidth: 280 }}>
            <ViewTabs
              tabs={tabs}
              activeTabId={activeTabId}
              views={views}
              deletingTabIds={deletingTabIds}
              layoutOptions={layoutOptions}
              routingTunables={routingTunables}
              nodeTunables={nodeTunables}
              onLayoutOptionsChange={handleLayoutOptionsChange}
              onRoutingTunablesChange={handleRoutingTunablesChange}
              onNodeTunablesChange={handleNodeTunablesChange}
              onResetControls={handleResetControls}
              onAutoLayout={() => editorRef.current?.runAutoLayout()}
              autoLayouting={editorRef.current?.autoLayouting ?? false}
              showEdgeLabels={showEdgeLabels}
              onShowEdgeLabelsChange={handleShowEdgeLabelsChange}
              showNodeIds={showNodeIds}
              onShowNodeIdsChange={handleShowNodeIdsChange}
              showHandles={showHandles}
              onShowHandlesChange={handleShowHandlesChange}
              showNodeColorBar={showNodeColorBar}
              onShowNodeColorBarChange={handleShowNodeColorBarChange}
              backgroundVariant={backgroundVariant}
              onBackgroundVariantChange={handleBackgroundVariantChange}
              topK={topK}
              onTopKChange={handleTopKChange}
              totalNodes={(activeView?.graph?.nodes?.length || 0)}
              exportContainer={graphContainerRef.current}
              exportNodes={editorRef.current?.getNodes() ?? []}
              exportEdges={editorRef.current?.getEdges() ?? []}
              onSelect={setActiveTabId}
              onSelectView={handleSelectView}
              onCloseTab={handleCloseTab}
              onCreate={() => void handleCreateView(generateNewViewName(tabs, views))}
              onRename={handleRenameView}
              onDelete={handleDeleteView}
              onToggleTimeline={() => editorRef.current?.toggleTimeline()}
              onDeleteNotes={() => editorRef.current?.deleteSelectedNotes()}
              onFind={handleFindSelected}
              onUndo={() => editorRef.current?.undo()}
              onRedo={() => editorRef.current?.redo()}
              onSendToWorkspace={handleSendViewToWorkspace}
              canDeleteNotes={
                selectedItems.nodeIds.length > 0 || selectedItems.edgeIds.length > 0
              }
              canFind={selectedItems.nodeIds.length > 0 || selectedItems.edgeIds.length > 0}
              canUndo={historyState.canUndo}
              canRedo={historyState.canRedo}
              hasWorkspaceSession={!!activeSession}
            />

            <CardContent className="flex-1 min-h-0 p-0 relative" ref={graphContainerRef}>
              {activeView && serverId && bankId ? (
                <ViewEditor
                  ref={editorRef}
                  key={activeView.id}
                  view={activeView}
                  serverId={serverId}
                  bankId={bankId}
                  layoutOptions={layoutOptions}
                  routingTunables={routingTunables}
                  nodeTunables={nodeTunables}
                  showEdgeLabels={showEdgeLabels}
                  showNodeIds={showNodeIds}
                  showHandles={showHandles}
                  showNodeColorBar={showNodeColorBar}
                  backgroundVariant={backgroundVariant}
                  onChange={handleViewChange}
                  saving={saving}
                  topK={topK}
                  onHistoryChange={setHistoryState}
                  onSelectionChange={setSelectedItems}
                  contextualEdges={contextualEdges}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-foreground-faint text-sm px-6 text-center gap-2">
                  <MapIcon className="h-8 w-8 opacity-50" />
                  <p>
                    {bankId
                      ? 'Select a view to edit, or create a new one.'
                      : 'Select a server and bank to get started.'}
                  </p>
                </div>
              )}
            </CardContent>
          </Panel>

          {showRightColumn && (
            <ResizeHandle
              direction="vertical"
              onMouseDown={handleResizeStart('col2')}
              onDoubleClick={handleResizeResetAll}
              title="Drag to resize graph / detail columns; double-click to reset"
            />
          )}

          {/* Column 3: Detail */}
          {showRightColumn && (
            <Panel className="min-h-0" style={{ flex: visibleColumnFlex.right, minWidth: 300 }}>
              <PanelContent className="min-h-0 overflow-hidden">
                <DetailPanel
                  serverId={serverId || null}
                  bankId={bankId || null}
                  activeView={activeView}
                  selectedNodeIds={selectedItems.nodeIds}
                  selectedEdgeIds={selectedItems.edgeIds}
                  edgeMergeMode={layoutOptions.edgeMergeMode}
                  onAddToPage={handleDetailAddToPage}
                />
              </PanelContent>
            </Panel>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmMergePage}
        onOpenChange={(open) => !open && setConfirmMergePage(null)}
        title="Merge with existing page graph?"
        description={
          confirmMergePage
            ? `"${confirmMergePage.page.intent_text || `Page ${confirmMergePage.page.id}`}" already contains a graph. Applying this view will merge the new nodes and edges into it. Are you sure you want to continue?`
            : ''
        }
        confirmLabel="Merge"
        cancelLabel="Cancel"
        onConfirm={handleConfirmMerge}
      />

      <WorkspacePagePicker
        open={workspacePickerOpen}
        title={workspacePickerTitle}
        hasSession={!!activeSession}
        curatedPages={workspaceSession.curatedPages}
        onClose={() => setWorkspacePickerOpen(false)}
        onCreatePage={handleCreateWorkspacePageAndApply}
        onApplyToPage={(page) => {
          if (workspacePickerEvents) {
            handleApplyEventsToWorkspacePage(page, workspacePickerEvents);
          }
          setWorkspacePickerOpen(false);
        }}
      />
    </PageShell>
  );
}
