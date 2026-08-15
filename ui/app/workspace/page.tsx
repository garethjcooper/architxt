'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { serversApi, contextualGraphApi, mentalModelsApi, type Server } from '@/lib/api/client';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import {
  DisplayNode,
  DisplayEdge,
  EntityListRow,
  EdgeListRow,
  colorForType,
  backendNodeToDisplayNode,
  backendEdgeToDisplayEdge,
  isGroundedNode,
  isCandidateNode,
  isCandidateEdge,
  isGroundedEdge,
} from '@/lib/contextual-graph/display';
import { RefreshCw, Plus, FileText, GripVertical, Sparkles } from 'lucide-react';

const logger = createLogger('WorkspacePage');

type WorkspaceModel = {
  id: number;
  extId: string;
  name?: string;
  isTemplate: boolean;
  templateRole?: string;
};

function isGroundedNodeForWorkspace(node: DisplayNode): boolean {
  return isGroundedNode(node) && !isCandidateNode(node);
}

function isGroundedEdgeForWorkspace(edge: DisplayEdge): boolean {
  return isGroundedEdge(edge) && !isCandidateEdge(edge);
}

function getModelLabel(model: WorkspaceModel): string {
  return model.name || model.extId;
}

function PanelHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
      <div className="text-xs font-medium truncate">{title}</div>
      {count !== undefined && (
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-white/20 text-emerald-200/80">
          {count}
        </Badge>
      )}
    </div>
  );
}

function Panel({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Card
      className={cn(
        'min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0',
        className
      )}
      style={style}
    >
      {children}
    </Card>
  );
}

function PanelContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <CardContent className={cn('flex-1 min-h-0 p-0 relative', className)}>
      {children}
    </CardContent>
  );
}

function ModelListRow({
  model,
  active,
  onClick,
}: {
  model: WorkspaceModel;
  active?: boolean;
  onClick?: () => void;
}) {
  const label = getModelLabel(model);
  const kind = model.templateRole || (model.isTemplate ? 'template' : 'standard');
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors',
        active
          ? 'border-white/10 bg-white/10'
          : 'border-white/5 bg-black/20 hover:bg-white/5'
      )}
      style={{ borderLeftColor: colorForType(kind), borderLeftWidth: 3 }}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-0.5">
        <div className="text-xs text-white/90 truncate">{label}</div>
        <div className="text-[10px] text-white/50 font-mono truncate">{model.extId}</div>
      </div>
    </button>
  );
}

function ResizeHandle({
  direction,
  onMouseDown,
  title,
}: {
  direction: 'vertical' | 'horizontal';
  onMouseDown: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const isHorizontal = direction === 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      aria-label={title || `Resize ${direction} pane`}
      onMouseDown={onMouseDown}
      className={cn(
        'shrink-0 flex items-center justify-center group',
        isHorizontal
          ? 'h-3 cursor-row-resize flex-row'
          : 'w-3 cursor-col-resize flex-col'
      )}
      title={title}
    >
      <div
        className={cn(
          'rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors',
          isHorizontal ? 'w-16 h-1' : 'w-1 h-16'
        )}
      />
    </div>
  );
}

export default function WorkspacePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [entities, setEntities] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);
  const [models, setModels] = useState<WorkspaceModel[]>([]);

  const [selectedEntity, setSelectedEntity] = useState<DisplayNode | null>(null);
  const [selectedPatch, setSelectedPatch] = useState<WorkspaceModel | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<DisplayEdge | null>(null);

  const [spineSearch, setSpineSearch] = useState('');
  const [reflectQuery, setReflectQuery] = useState('');

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
  const [queryWidth, setQueryWidth] = useState(220);
  const [patchesWidth, setPatchesWidth] = useState(240);
  const [spineWidth, setSpineWidth] = useState(280);

  const [resizing, setResizing] = useState<null | 'top' | 'query' | 'patches' | 'spine'>(null);

  const handleResizeStart = useCallback((pane: 'top' | 'query' | 'patches' | 'spine') => (e: React.MouseEvent) => {
    setResizing(pane);
    document.body.style.cursor = pane === 'top' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!resizing) return;
      if (resizing === 'top') {
        const next = Math.min(Math.max(e.clientY - 180, 160), 560);
        setTopHeight(next);
      } else if (resizing === 'query') {
        const next = Math.min(Math.max(e.clientX - 16, 160), 380);
        setQueryWidth(next);
      } else if (resizing === 'patches') {
        const next = Math.min(Math.max(e.clientX - queryWidth - 32, 160), 380);
        setPatchesWidth(next);
      } else if (resizing === 'spine') {
        const next = Math.min(Math.max(e.clientX - queryWidth - patchesWidth - 48, 200), 440);
        setSpineWidth(next);
      }
    },
    [resizing, queryWidth, patchesWidth]
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
      setModels([]);
      setSelectedEntity(null);
      setSelectedPatch(null);
      setSelectedEdge(null);
      return;
    }
    try {
      setLoadingData(true);
      const [nodesData, edgesData, modelsData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
        mentalModelsApi.list({ limit: 1000 }),
      ]);

      const displayNodes = nodesData.map(backendNodeToDisplayNode).filter(isGroundedNodeForWorkspace);
      const displayEdges = edgesData.map(backendEdgeToDisplayEdge).filter(isGroundedEdgeForWorkspace);

      setEntities(displayNodes);
      setEdges(displayEdges);

      const mappedModels = (Array.isArray(modelsData) ? modelsData : []).map((m) => ({
        id: m.id,
        extId: m.ext_id,
        name: m.name || undefined,
        isTemplate: Boolean(m.is_template || m.template_role),
        templateRole: m.template_role || undefined,
      }));
      setModels(mappedModels);

      setSelectedEntity((prev) => {
        if (!prev) return null;
        return displayNodes.find((n) => n.id === prev.id) || null;
      });
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

  const nodeById = useMemo(() => {
    const map = new Map<string, DisplayNode>();
    entities.forEach((node) => map.set(node.id, node));
    return map;
  }, [entities]);

  const spineEntities = useMemo(() => {
    const q = spineSearch.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      e.label.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q)
    );
  }, [entities, spineSearch]);

  const selectedEntityPatches = useMemo(() => {
    if (!selectedEntity) return [];
    const refExtIds = new Set<string>(
      selectedEntity.modelRefs.map((ref) => ref.ext_id).filter((id): id is string => Boolean(id))
    );
    return models.filter((m) => refExtIds.has(m.extId));
  }, [models, selectedEntity]);

  const selectedEntityEdges = useMemo(() => {
    if (!selectedEntity) return [];
    return edges.filter(
      (edge) => edge.source_id === selectedEntity.id || edge.target_id === selectedEntity.id
    );
  }, [edges, selectedEntity]);

  const handleSelectEntity = useCallback((entity: DisplayNode) => {
    setSelectedEntity(entity);
    setSelectedPatch(null);
    setSelectedEdge(null);
  }, []);

  const handleSelectPatch = useCallback((model: WorkspaceModel) => {
    setSelectedPatch(model);
    setSelectedEdge(null);
  }, []);

  const handleSelectEdge = useCallback((edge: DisplayEdge) => {
    setSelectedEdge(edge);
    setSelectedPatch(null);
  }, []);

  const handleReflect = useCallback(() => {
    const query = reflectQuery.trim();
    if (!query) return;
    if (!serverId || !bankId) {
      toast.error('Select a server and bank before running Reflect.');
      return;
    }
    // TODO: Phase C will wire the Reflect API and add the result to temporary content.
    toast.info(`Reflect query staged: "${query}"`);
  }, [reflectQuery, serverId, bankId]);

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
        <div className="flex min-h-0" style={{ height: topHeight }}>
          {/* Reflect query */}
          <Panel style={{ width: queryWidth, minWidth: queryWidth, maxWidth: queryWidth }}>
            <PanelHeader title="Reflect query" />
            <PanelContent className="p-3">
              <div className="absolute inset-0 p-3 flex flex-col gap-2">
                <Textarea
                  placeholder="Ask Reflect..."
                  value={reflectQuery}
                  onChange={(e) => setReflectQuery(e.target.value)}
                  className="flex-1 resize-none text-sm min-h-0"
                />
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={!reflectQuery.trim() || !serverId || !bankId}
                  onClick={handleReflect}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Reflect
                </Button>
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('query')} title="Drag to resize Reflect query pane" />

          {/* Patches */}
          <Panel style={{ width: patchesWidth, minWidth: patchesWidth, maxWidth: patchesWidth }}>
            <PanelHeader
              title="Patches"
              count={selectedEntity ? selectedEntityPatches.length : undefined}
            />
            <PanelContent>
              <div className="absolute inset-0 overflow-y-auto p-2 space-y-1">
                {!selectedEntity ? (
                  <div className="h-full flex items-center justify-center text-white/40 text-xs px-2 text-center">
                    Select an entity from the spine to see its patches.
                  </div>
                ) : selectedEntityPatches.length === 0 ? (
                  <div className="text-white/40 text-xs px-2 py-3">No patches for this entity.</div>
                ) : (
                  selectedEntityPatches.map((m) => (
                    <ModelListRow
                      key={m.extId}
                      model={m}
                      active={selectedPatch?.id === m.id}
                      onClick={() => handleSelectPatch(m)}
                    />
                  ))
                )}
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('patches')} title="Drag to resize patches pane" />

          {/* Entity spine */}
          <Panel style={{ width: spineWidth, minWidth: spineWidth, maxWidth: spineWidth }}>
            <PanelHeader title="Entity spine" count={spineEntities.length} />
            <PanelContent className="p-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="p-3 sticky top-0 bg-[oklch(0.23_0_0)] z-10 border-b border-white/10">
                  <Input
                    placeholder="Filter entities..."
                    value={spineSearch}
                    onChange={(e) => setSpineSearch(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="p-2 space-y-1">
                  {spineEntities.map((node) => (
                    <EntityListRow
                      key={node.id}
                      node={node}
                      active={selectedEntity?.id === node.id}
                      onClick={() => handleSelectEntity(node)}
                    />
                  ))}
                </div>
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('spine')} title="Drag to resize entity spine" />

          {/* Edges */}
          <Panel className="flex-1">
            <PanelHeader
              title="Edges"
              count={selectedEntity ? selectedEntityEdges.length : undefined}
            />
            <PanelContent>
              <div className="absolute inset-0 overflow-y-auto p-2 space-y-1">
                {!selectedEntity ? (
                  <div className="h-full flex items-center justify-center text-white/40 text-xs px-2 text-center">
                    Select an entity from the spine to see its edges.
                  </div>
                ) : selectedEntityEdges.length === 0 ? (
                  <div className="text-white/40 text-xs px-2 py-3">No edges connected to this entity.</div>
                ) : (
                  selectedEntityEdges.map((edge) => (
                    <EdgeListRow
                      key={edge.id}
                      edge={edge}
                      active={selectedEdge?.id === edge.id}
                      sourceLabel={nodeById.get(edge.source_id)?.label}
                      targetLabel={nodeById.get(edge.target_id)?.label}
                      onClick={() => handleSelectEdge(edge)}
                    />
                  ))
                )}
              </div>
            </PanelContent>
          </Panel>
        </div>

        <ResizeHandle
          direction="horizontal"
          onMouseDown={handleResizeStart('top')}
          title="Drag to resize top and bottom panels"
        />

        {/* Bottom row: temporary content | workspace pages */}
        <div className="flex-1 min-h-0 flex gap-3">
          {/* Temporary content */}
          <Panel className="flex-1">
            <PanelHeader title="Temporary content" />
            <PanelContent>
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
                <div className="text-white/40 text-sm mb-3">
                  Selections from patches/edges and Reflect queries will appear here.
                </div>
                <div className="flex items-center gap-2 text-white/30 text-xs">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add sections from patches or edges to build temporary output.</span>
                </div>
              </div>
            </PanelContent>
          </Panel>

          {/* Workspace pages */}
          <Panel className="flex-1">
            <PanelHeader title="Workspace pages" />
            <PanelContent>
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
                <FileText className="w-8 h-8 text-white/20 mb-3" />
                <div className="text-white/40 text-sm mb-2">No workspace pages yet.</div>
                <div className="text-white/30 text-xs">
                  Add temporary content to a new page to start a session.
                </div>
              </div>
            </PanelContent>
            <div className="px-3 py-2 border-t border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-2 text-white/50">
                <GripVertical className="w-3.5 h-3.5" />
                <div className="text-[11px]">Page tabs will appear here.</div>
              </div>
              <Button variant="outline" size="sm" className="h-6 text-[11px] gap-1">
                <Plus className="w-3.5 h-3.5" /> New page
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
