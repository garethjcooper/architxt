'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { type EntityLike as AqlEntityLike, type EdgeLike as AqlEdgeLike } from '@/components/aql-editor';
import { serversApi, contextualGraphApi, entityInfoApi, hindsightApi, type Server } from '@/lib/api/client';
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
import { SpinePanel } from './_components/spine-panel';
import { AttachedEntitiesPanel } from './_components/attached-entities-panel';
import { ReflectResultPanel } from './_components/reflect-result-panel';

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

  // Layout sizing.
  const [topHeight, setTopHeight] = useState(360);
  const topRowRef = useRef<HTMLDivElement>(null);
  const [topFlex, setTopFlex] = useState({ query: 2, patches: 2, spine: 2, edges: 1 });
  const totalTopFlex = topFlex.query + topFlex.patches + topFlex.spine + topFlex.edges;

  const [resizing, setResizing] = useState<null | 'top' | 'query' | 'patches' | 'spine'>(null);
  const resizeStartRef = useRef({
    x: 0,
    width: 0,
    flex: { query: 2, patches: 2, spine: 2, edges: 1 },
  });

  const handleResizeStart = useCallback(
    (pane: 'top' | 'query' | 'patches' | 'spine') => (e: React.MouseEvent) => {
      setResizing(pane);
      document.body.style.cursor = pane === 'top' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      resizeStartRef.current = {
        x: e.clientX,
        width: topRowRef.current?.getBoundingClientRect().width ?? 0,
        flex: { ...topFlex },
      };
    },
    [topFlex]
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!resizing) return;
      if (resizing === 'top') {
        const next = Math.min(Math.max(e.clientY - 180, 160), 560);
        setTopHeight(next);
        return;
      }
      const { x, width, flex } = resizeStartRef.current;
      if (width <= 0) return;
      const deltaPx = e.clientX - x;
      const deltaFlex = (deltaPx / width) * totalTopFlex;
      const MIN_FLEX = 0.4;

      if (resizing === 'query') {
        const nextQuery = Math.max(MIN_FLEX, flex.query + deltaFlex);
        const nextPatches = Math.max(MIN_FLEX, flex.patches - (nextQuery - flex.query));
        setTopFlex((prev) => ({ ...prev, query: nextQuery, patches: nextPatches }));
      } else if (resizing === 'patches') {
        const nextPatches = Math.max(MIN_FLEX, flex.patches + deltaFlex);
        const nextSpine = Math.max(MIN_FLEX, flex.spine - (nextPatches - flex.patches));
        setTopFlex((prev) => ({ ...prev, patches: nextPatches, spine: nextSpine }));
      } else if (resizing === 'spine') {
        const nextSpine = Math.max(MIN_FLEX, flex.spine + deltaFlex);
        const nextEdges = Math.max(MIN_FLEX, flex.edges - (nextSpine - flex.spine));
        setTopFlex((prev) => ({ ...prev, spine: nextSpine, edges: nextEdges }));
      }
    },
    [resizing, totalTopFlex]
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
    try {
      setReflectLoading(true);
      setReflectError(null);
      setReflectResult(null);
      // Phase 1: Reflect sends only the free-text query; corpus integration later.
      const cleanedQuery = query.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();
      const result = await hindsightApi.reflect(serverId, bankId, { query: cleanedQuery || query });
      setReflectResult(result);
      toast.success('Reflect response received');
    } catch (err: any) {
      setReflectError(err.message || String(err));
      logger.error('Reflect query failed', { error: err, serverId, bankId, query });
      toast.error(`Reflect failed: ${err.message || err}`);
    } finally {
      setReflectLoading(false);
    }
  }, [reflectQuery, serverId, bankId]);

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

        {/* Top row: reflect query | patches | entity spine | edges */}
        <div ref={topRowRef} className="flex min-h-0" style={{ height: topHeight }}>
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

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('query')} title="Drag to resize Reflect query pane" />

          {/* Patches - disabled while Reflect query is the focus */}
          <Panel style={{ flex: topFlex.patches, minWidth: 160 }}>
            <PanelHeader title="Patches" />
            <PanelContent>
              <div className="absolute inset-0 flex items-center justify-center text-white/40 text-xs px-4 text-center">
                Spine interactivity is disabled. Attach entities via [[...]] in the Reflect query to see their model content here.
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('patches')} title="Drag to resize patches pane" />

          <SpinePanel
            entities={spineEntities}
            search={spineSearch}
            onSearchChange={setSpineSearch}
          />

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('spine')} title="Drag to resize entity spine" />

          {/* Edges - disabled while Reflect query is the focus */}
          <Panel style={{ flex: topFlex.edges, minWidth: 140 }}>
            <PanelHeader title="Edges" />
            <PanelContent>
              <div className="absolute inset-0 flex items-center justify-center text-white/40 text-xs px-4 text-center">
                Spine interactivity is disabled. Use [[...]] references in the Reflect query.
              </div>
            </PanelContent>
          </Panel>
        </div>

        <ResizeHandle direction="horizontal" onMouseDown={handleResizeStart('top')} title="Drag to resize top/bottom split" />

        {/* Bottom row: attached entities | reflect result */}
        <div className="flex-1 min-h-0 flex">
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

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('query')} title="Drag to resize temporary/workspace split" />

          <ReflectResultPanel
            loading={reflectLoading}
            error={reflectError}
            result={reflectResult}
          />
        </div>
      </div>
    </PageShell>
  );
}
