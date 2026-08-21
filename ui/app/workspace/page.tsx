'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { type EntityLike as AqlEntityLike, type EdgeLike as AqlEdgeLike } from '@/components/aql-editor';
import { serversApi, contextualGraphApi, entityInfoApi, hindsightApi, researchApi, type Server } from '@/lib/api/client';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import {
  DisplayNode,
  DisplayEdge,
  backendNodeToDisplayNode,
  backendEdgeToDisplayEdge,
} from '@/lib/contextual-graph/display';
import { RefreshCw } from 'lucide-react';
import {
  isGroundedNodeForWorkspace,
  isGroundedEdgeForWorkspace,
  type EntityInfoWithContent,
} from './_components/model-content-utils';
import { Panel, PanelHeader, PanelContent, ResizeHandle } from './_components/panel-layout';
import { ReflectQueryPanel } from './_components/reflect-query-panel';
import { AttachedEntitiesPanel } from './_components/attached-entities-panel';
import { SessionItemsPanel } from './_components/session-items-panel';
import { type ResearchSession, type ResearchStepSummary } from '@/lib/api/client';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { Switch } from '@/components/ui/switch';
import { SessionPageEditor } from './_components/session-page-editor';
import type { SessionPageEditorRef } from './_components/session-page-editor';

const logger = createLogger('WorkspacePage');

export default function WorkspacePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [entities, setEntities] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);

  const [spineSearch, setSpineSearch] = useState('');
  const [reflectQuery, setReflectQuery] = useState('');
  const [manuallyAttachedIds, setManuallyAttachedIds] = useState<string[]>([]);
  const [entityInfoMap, setEntityInfoMap] = useState<Record<string, EntityInfoWithContent> | null>(null);
  const [loadingEntityInfo, setLoadingEntityInfo] = useState(false);
  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(new Set());
  const [selectedModelKeys, setSelectedModelKeys] = useState<Record<string, string | null>>({});
  const [reflectResult, setReflectResult] = useState<unknown | null>(null);
  const [reflectLoading, setReflectLoading] = useState(false);
  const [reflectError, setReflectError] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<ResearchStepSummary | null>(null);
  const [editingStep, setEditingStep] = useState<ResearchStepSummary | null>(null);
  const [activeSession, setActiveSession] = useState<ResearchSession | null>(null);
  const [sessionRefreshSignal, setSessionRefreshSignal] = useState(0);
  const [previewPlain, setPreviewPlain] = useState(false);
  const [previewShowIndex, setPreviewShowIndex] = useState(true);
  const editorRef = useRef<SessionPageEditorRef | null>(null);

  const mentionedEntityIds = useMemo(() => {
    const mentioned: string[] = [];
    const tokenRegex = /\[\[((?:[^\[\]]|\[[^\]])+?)\]\]/g;
    let match;
    while ((match = tokenRegex.exec(reflectQuery)) !== null) {
      const inner = match[1];
      const parenMatch = inner.match(/\(([^)]+)\)$/);
      if (parenMatch) {
        mentioned.push(parenMatch[1]);
      } else if (/^[\w-]+:[\w-]+$/.test(inner)) {
        mentioned.push(inner);
      }
    }
    return mentioned;
  }, [reflectQuery]);

  const attachedEntityIds = useMemo(() => {
    return Array.from(new Set([...manuallyAttachedIds, ...mentionedEntityIds]));
  }, [manuallyAttachedIds, mentionedEntityIds]);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

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

  useEffect(() => {
    const move = (e: MouseEvent) => handleResizeMove(e);
    const up = () => handleResizeEnd();
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleResizeMove, handleResizeEnd]);

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
    setSessionRefreshSignal((n) => n + 1);
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

  const aqlEntities: AqlEntityLike[] = useMemo(() => {
    return entities.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
    }));
  }, [entities]);

  const aqlEdges: AqlEdgeLike[] = useMemo(() => {
    return edges.map((edge) => ({
      from: edge.source_id,
      to: edge.target_id,
      label: edge.label || edge.type,
      type: edge.type,
    }));
  }, [edges]);

  const spineEntities = useMemo(() => {
    const q = spineSearch.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      e.label.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q)
    );
  }, [entities, spineSearch]);

  const handleReflect = useCallback(async () => {
    const query = reflectQuery.trim();
    if (!query) return;
    if (!serverId || !bankId) {
      toast.error('Select a server and bank before running Reflect.');
      return;
    }
    if (!activeSession) {
      toast.error('Wait for a workspace session to load before running Reflect.');
      return;
    }
    try {
      setReflectLoading(true);
      setReflectError(null);
      setReflectResult(null);
      const cleanedQuery = query.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();
      const result = await researchApi.discover({
        server_id: serverId,
        bank_id: bankId,
        session_id: activeSession.id,
        viewpoint_ids: activeSession.viewpoint_ids || [],
        intent_text: cleanedQuery || query,
        query_depth: 'reflect',
        budget: 'low',
      });
      setReflectResult(result);
      setSessionRefreshSignal((n) => n + 1);
      toast.success('Reflect query started');
    } catch (err: any) {
      setReflectError(err.message || String(err));
      logger.error('Reflect query failed', { error: err, serverId, bankId, query });
      toast.error(`Reflect failed: ${err.message || err}`);
    } finally {
      setReflectLoading(false);
    }
  }, [reflectQuery, serverId, bankId, activeSession]);

  const handleCopySection = useCallback(async (markdown: string, sectionTitle?: string) => {
    if (!activeSession) {
      toast.error('No active session. Select a server and bank first.');
      return;
    }
    if (!editingStep) {
      const pageTitle = sectionTitle || 'Copied section';
      try {
        const page = await researchApi.createSessionPage(activeSession.id, pageTitle);
        const updated = await researchApi.updateCuratedPage(page.id, {
          intent_text: pageTitle,
          synthesis: { narrative: markdown },
          canvas: page.canvas || undefined,
        });
        const nextStep: ResearchStepSummary = { ...page, intent_text: updated.intent_text ?? pageTitle, synthesis: updated.synthesis, canvas: updated.canvas };
        setSelectedStep(nextStep);
        setEditingStep(nextStep);
        setSessionRefreshSignal((n) => n + 1);
        toast.success(`Created page "${pageTitle}" with copied section`);
        return;
      } catch (err: any) {
        toast.error(err.message || 'Failed to create page for copied section');
        return;
      }
    }
    editorRef.current?.appendBlocks(markdown);
    toast.success(`Copied "${sectionTitle || 'section'}" into the open page`);
  }, [activeSession, editingStep, editorRef]);

  const handleAttachEntity = useCallback((entityId: string) => {
    setManuallyAttachedIds((prev) => {
      if (prev.includes(entityId)) return prev;
      return [...prev, entityId];
    });
  }, []);

  const handleDetachEntity = useCallback((entityId: string) => {
    setManuallyAttachedIds((prev) => prev.filter((id) => id !== entityId));
    setExpandedEntityIds((prev) => {
      const next = new Set(prev);
      next.delete(entityId);
      return next;
    });
    setSelectedModelKeys((prev) => {
      const next = { ...prev };
      delete next[entityId];
      return next;
    });
    // If the entity is still present as a [[...]] token, remove that token from the query
    // so the user isn't stuck with an attachment they explicitly removed.
    setReflectQuery((prev) => {
      const tokenRegex = /\[\[((?:[^\[\]]|\[[^\]])+?)\]\]/g;
      return prev.replace(tokenRegex, (match, inner: string) => {
        const parenMatch = inner.match(/\(([^)]+)\)$/);
        const id = parenMatch ? parenMatch[1] : inner;
        return id === entityId ? '' : match;
      });
    });
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
    if (!serverId || !bankId || attachedEntityIds.length === 0) {
      setEntityInfoMap(null);
      return;
    }
    let cancelled = false;
    setLoadingEntityInfo(true);
    entityInfoApi
      .info(serverId, bankId, attachedEntityIds)
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
        logger.error('Failed to load entity info', { error: err, serverId, bankId, entityIds: attachedEntityIds });
        toast.error(`Failed to load entity info: ${err.message || err}`);
        setEntityInfoMap(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingEntityInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, bankId, attachedEntityIds]);

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
          {/* Column 1: query + entities | session items | contextual data */}
          <div className="flex flex-col min-h-0" style={{ flex: columnWidths.left, minWidth: 220 }}>
            <ReflectQueryPanel
              query={reflectQuery}
              onChange={setReflectQuery}
              onSubmit={handleReflect}
              attachedEntityIds={attachedEntityIds}
              entityInfoMap={entityInfoMap}
              aqlEntities={aqlEntities}
              aqlEdges={aqlEdges}
              onDetachEntity={handleDetachEntity}
              disabled={!reflectQuery.trim() || !serverId || !bankId}
            />

            {serverId && bankId ? (
              <SessionItemsPanel
                serverId={serverId}
                bankId={bankId}
                activeStepId={selectedStep?.id}
                editingStepId={editingStep?.id}
                refreshSignal={sessionRefreshSignal}
                onSelectStep={handleSelectStep}
                onEditPage={handleEditPage}
                onActiveSessionChange={setActiveSession}
              />
            ) : (
              <Panel className="flex-1 min-h-0">
                <PanelHeader title="Session items" />
                <PanelContent className="p-3">
                  <div className="text-white/40 text-xs">Select a server and bank to load sessions.</div>
                </PanelContent>
              </Panel>
            )}

            <AttachedEntitiesPanel
              entityIds={attachedEntityIds}
              entityInfoMap={entityInfoMap}
              loading={loadingEntityInfo}
              expandedEntityIds={expandedEntityIds}
              selectedModelKeys={selectedModelKeys}
              onDetach={handleDetachEntity}
              onToggleExpand={toggleEntityExpanded}
              onSelectModel={selectEntityModel}
            />
          </div>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('col1')} title="Drag to resize left/middle columns" />

          {/* Column 2: read-only NarrativeViewer */}
          <div className="flex flex-col min-h-0" style={{ flex: columnWidths.middle, minWidth: 280 }}>
            <Panel className="flex-1 min-h-0">
              <PanelHeader
                title={selectedStep ? (selectedStep.action_type === 'curated_page' ? 'Page preview' : 'Reflect output') : 'Read-only preview'}
                count={selectedStep ? (selectedStep.synthesis?.narrative ? undefined : 0) : undefined}
              />
              <PanelContent className="p-0">
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="px-3 py-2 border-b border-white/10 flex items-center gap-4 shrink-0">
                    <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
                      <Switch
                        checked={previewShowIndex}
                        onCheckedChange={(checked) => setPreviewShowIndex(Boolean(checked))}
                        size="sm"
                      />
                      Show index
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
                      <Switch
                        checked={previewPlain}
                        onCheckedChange={(checked) => setPreviewPlain(Boolean(checked))}
                        size="sm"
                      />
                      Plain text
                    </label>
                  </div>
                  <div className="flex-1 min-h-0 p-3">
                    {selectedStep ? (
                      <NarrativeViewer
                        content={selectedStep.synthesis?.narrative ?? ''}
                        title="Sections"
                        viewMode={previewPlain ? 'plain' : 'markdown'}
                        showIndex={previewShowIndex}
                        className="h-full"
                        onCopySection={handleCopySection}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-white/40 text-xs">
                        Select a Reflect output or page from the session list to preview it here.
                      </div>
                    )}
                  </div>
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
      </div>
    </PageShell>
  );
}
