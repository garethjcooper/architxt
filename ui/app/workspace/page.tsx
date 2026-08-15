'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
  backendNodeToDisplayNode,
  backendEdgeToDisplayEdge,
  isGroundedNode,
  isCandidateNode,
  isCandidateEdge,
  isGroundedEdge,
  formatRelative,
  renderValue,
  Section,
  PropertyRow,
} from '@/lib/contextual-graph/display';
import { RefreshCw, Plus, FileText, GripVertical } from 'lucide-react';

const logger = createLogger('WorkspacePage');

type WorkspaceModel = {
  id: number;
  extId: string;
  name?: string;
  sourceQuery?: string;
  isTemplate: boolean;
  templateRole?: string;
  updatedAt?: string;
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
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-2 py-1.5 rounded transition-colors',
        active ? 'bg-emerald-900/30' : 'hover:bg-white/5'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-white/90 truncate">{label}</div>
          <div className="text-[11px] text-white/40 truncate">{model.extId}</div>
        </div>
        <Badge variant="outline" className="text-[10px] h-5 border-white/20 text-white/60 shrink-0">
          {model.templateRole || (model.isTemplate ? 'template' : 'standard')}
        </Badge>
      </div>
    </button>
  );
}

function ResizeHandle({
  direction,
  onMouseDown,
  onDoubleClick,
  title,
}: {
  direction: 'vertical' | 'horizontal';
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  title?: string;
}) {
  const isHorizontal = direction === 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      aria-label={title || `Resize ${direction} pane`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
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

  const [rawModelContent, setRawModelContent] = useState<{ content: string | object | null; updatedAt?: string; loading: boolean; error?: string }>({
    content: null,
    loading: false,
  });

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
  const [patchesWidth, setPatchesWidth] = useState(260);
  const [spineWidth, setSpineWidth] = useState(320);

  const [resizing, setResizing] = useState<null | 'top' | 'patches' | 'spine'>(null);

  const handleResizeStart = useCallback((pane: 'top' | 'patches' | 'spine') => (e: React.MouseEvent) => {
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
      } else if (resizing === 'patches') {
        const next = Math.min(Math.max(e.clientX - 16, 180), 420);
        setPatchesWidth(next);
      } else if (resizing === 'spine') {
        const next = Math.min(Math.max(e.clientX - patchesWidth - 32, 220), 480);
        setSpineWidth(next);
      }
    },
    [resizing, patchesWidth]
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
        sourceQuery: m.source_query || undefined,
        isTemplate: Boolean(m.is_template || m.template_role),
        templateRole: m.template_role || undefined,
        updatedAt: m.updated_at || undefined,
      }));
      setModels(mappedModels);

      // Keep selected entity if it still exists, otherwise clear.
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

  const selectedEntityEdges = useMemo(() => {
    if (!selectedEntity) return [];
    return edges.filter(
      (edge) => edge.source_id === selectedEntity.id || edge.target_id === selectedEntity.id
    );
  }, [edges, selectedEntity]);

  const selectedEntityPatches = useMemo(() => {
    if (!selectedEntity) return [];
    const refs = selectedEntity.properties.provenance?.model_refs || [];
    const refExtIds = new Set<string>((refs || []).map((ref: any) => ref.ext_id).filter(Boolean));
    return models.filter((m) => refExtIds.has(m.extId));
  }, [models, selectedEntity]);

  const handleSelectEntity = useCallback((entity: DisplayNode) => {
    setSelectedEntity(entity);
    setSelectedPatch(null);
    setSelectedEdge(null);
    setRawModelContent({ content: null, loading: false });
  }, []);

  const handleSelectPatch = useCallback(
    async (model: WorkspaceModel) => {
      setSelectedPatch(model);
      setSelectedEdge(null);
      setRawModelContent({ content: null, loading: true });
      try {
        const result = await mentalModelsApi.fetchContent(serverId, bankId, model.extId);
        setRawModelContent({
          content: result.content,
          updatedAt: result.updated_at || undefined,
          loading: false,
        });
      } catch (err: any) {
        logger.error('Failed to fetch model content', { error: err, extId: model.extId });
        setRawModelContent({ content: null, loading: false, error: err.message || 'Failed to load model content' });
      }
    },
    [serverId, bankId]
  );

  const handleSelectEdge = useCallback((edge: DisplayEdge) => {
    setSelectedEdge(edge);
    setSelectedPatch(null);
    setRawModelContent({ content: null, loading: false });
  }, []);

  const renderPatchQuickView = () => {
    if (!selectedPatch) {
      return (
        <div className="h-full flex items-center justify-center text-white/50 text-sm px-6 text-center">
          Select a patch from the left panel to inspect its contents.
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Patch / Model</div>
          <div className="text-lg font-semibold text-white/90">{getModelLabel(selectedPatch)}</div>
          <div className="text-xs text-white/50 font-mono">{selectedPatch.extId}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {selectedPatch.isTemplate && <Badge variant="outline" className="text-[10px] h-5">template</Badge>}
          {selectedPatch.templateRole && <Badge variant="outline" className="text-[10px] h-5">{selectedPatch.templateRole}</Badge>}
        </div>
        {selectedPatch.sourceQuery && <Section title="Source query"><PropertyRow label="" value={selectedPatch.sourceQuery} /></Section>}
        <Section title="Raw content">
          {rawModelContent.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : rawModelContent.error ? (
            <div className="text-red-400 text-sm">{rawModelContent.error}</div>
          ) : (
            <div>
              {rawModelContent.updatedAt && (
                <div className="text-[10px] text-white/40 mb-1">Updated {formatRelative(rawModelContent.updatedAt)}</div>
              )}
              {renderValue(rawModelContent.content)}
            </div>
          )}
        </Section>
      </div>
    );
  };

  const renderEntityQuickView = () => {
    if (!selectedEntity) {
      return (
        <div className="h-full flex items-center justify-center text-white/50 text-sm px-6 text-center">
          Select an entity from the spine to see its context.
        </div>
      );
    }
    const entity = selectedEntity;
    const summary = entity.properties.summary || entity.properties.description || entity.properties.blurb;
    return (
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Entity</div>
          <div className="text-lg font-semibold text-white/90">{entity.label}</div>
          <div className="text-xs text-white/50 font-mono">{entity.id}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {entity.labels.map((label) => (
            <Badge key={label} variant="outline" className="text-[10px] h-5">{label}</Badge>
          ))}
        </div>
        {summary && <Section title="Summary"><PropertyRow label="" value={summary} /></Section>}
        <Section title="Properties">
          <div className="space-y-2">
            {Object.entries(entity.properties).map(([key, value]) => (
              <PropertyRow key={key} label={key} value={value} />
            ))}
          </div>
        </Section>
      </div>
    );
  };

  const renderEdgeQuickView = () => {
    if (!selectedEdge) {
      return (
        <div className="h-full flex items-center justify-center text-white/50 text-sm px-6 text-center">
          Select an edge from the right panel to inspect it.
        </div>
      );
    }
    const edge = selectedEdge;
    const sourceLabel = nodeById.get(edge.source_id)?.label;
    const targetLabel = nodeById.get(edge.target_id)?.label;
    return (
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Edge</div>
          <div className="text-lg font-semibold text-white/90">
            {sourceLabel || edge.source_id} <span className="text-white/40">→</span> {targetLabel || edge.target_id}
          </div>
          <div className="text-xs text-white/50 font-mono">{edge.id}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {edge.labels.map((label) => (
            <Badge key={label} variant="outline" className="text-[10px] h-5">{label}</Badge>
          ))}
          {edge.type && <Badge variant="outline" className="text-[10px] h-5">{edge.type}</Badge>}
        </div>
        {(edge.label || edge.detail) && (
          <Section title="Description">
            {edge.label && <PropertyRow label="Label" value={edge.label} />}
            {edge.detail && <PropertyRow label="Detail" value={edge.detail} />}
          </Section>
        )}
        <Section title="Properties">
          <div className="space-y-2">
            {Object.entries(edge.properties).map(([key, value]) => (
              <PropertyRow key={key} label={key} value={value} />
            ))}
          </div>
        </Section>
      </div>
    );
  };

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

        {/* Top row: patches | entity spine | edges */}
        <div className="flex min-h-0" style={{ height: topHeight }}>
          {/* Patches */}
          <div className="flex flex-col min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)]" style={{ width: patchesWidth, minWidth: patchesWidth, maxWidth: patchesWidth }}>
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <div className="text-xs font-medium text-white/80">Patches</div>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">{selectedEntity ? selectedEntityPatches.length : models.length}</Badge>
            </div>
            <div className="flex-1 overflow-y-auto p-2 min-h-0 space-y-1">
              {!selectedEntity ? (
                models.map((m) => (
                  <ModelListRow
                    key={m.extId}
                    model={m}
                    active={selectedPatch?.id === m.id}
                    onClick={() => handleSelectPatch(m)}
                  />
                ))
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
            <div className="p-2 border-t border-white/10">
              <div className="text-[10px] text-white/40">
                {selectedEntity ? `${selectedEntityPatches.length} related` : `${models.length} total`}
              </div>
            </div>
          </div>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('patches')} title="Drag to resize patches pane" />

          {/* Entity spine */}
          <div className="flex flex-col min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)]" style={{ width: spineWidth, minWidth: spineWidth, maxWidth: spineWidth }}>
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <div className="text-xs font-medium text-white/80">Entity spine</div>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">{spineEntities.length}</Badge>
            </div>
            <div className="p-3 border-b border-white/10">
              <Input
                placeholder="Filter entities..."
                value={spineSearch}
                onChange={(e) => setSpineSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 min-h-0 space-y-1">
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

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('spine')} title="Drag to resize entity spine" />

          {/* Edges */}
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)] flex flex-col">
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <div className="text-xs font-medium text-white/80">Edges</div>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">{selectedEntity ? selectedEntityEdges.length : edges.length}</Badge>
            </div>
            <div className="flex-1 overflow-y-auto p-2 min-h-0 space-y-1">
              {!selectedEntity ? (
                edges.map((edge) => (
                  <EdgeListRow
                    key={edge.id}
                    edge={edge}
                    active={selectedEdge?.id === edge.id}
                    sourceLabel={nodeById.get(edge.source_id)?.label}
                    targetLabel={nodeById.get(edge.target_id)?.label}
                    onClick={() => handleSelectEdge(edge)}
                  />
                ))
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
            <div className="p-2 border-t border-white/10">
              <div className="text-[10px] text-white/40">
                {selectedEntity ? `${selectedEntityEdges.length} connected` : `${edges.length} total`}
              </div>
            </div>
          </div>
        </div>

        <ResizeHandle
          direction="horizontal"
          onMouseDown={handleResizeStart('top')}
          title="Drag to resize top and bottom panels"
        />

        {/* Bottom row: temporary content | workspace pages */}
        <div className="flex-1 min-h-0 flex gap-3">
          {/* Temporary content */}
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)] flex flex-col">
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <div className="text-xs font-medium text-white/80">Temporary content</div>
              <Badge variant="outline" className="text-[10px] h-4 px-1.5">0</Badge>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-0 overflow-y-auto">
              <div className="text-white/40 text-sm mb-3">
                Selections from patches/edges and Reflect queries will appear here.
              </div>
              <div className="flex items-center gap-2 text-white/30 text-xs">
                <Plus className="w-3.5 h-3.5" />
                <span>Add sections from patches or edges to build temporary output.</span>
              </div>
            </div>
          </div>

          {/* Workspace pages */}
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)] flex flex-col">
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between">
              <div className="text-xs font-medium text-white/80">Workspace pages</div>
              <Button variant="outline" size="sm" className="h-6 text-[11px] gap-1">
                <Plus className="w-3.5 h-3.5" /> New page
              </Button>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center min-h-0 overflow-y-auto">
              <FileText className="w-8 h-8 text-white/20 mb-3" />
              <div className="text-white/40 text-sm mb-2">No workspace pages yet.</div>
              <div className="text-white/30 text-xs">
                Add temporary content to a new page to start a session.
              </div>
            </div>
            <div className="px-3 py-2 border-t border-white/10 flex items-center gap-2">
              <GripVertical className="w-3.5 h-3.5 text-white/30" />
              <div className="text-[11px] text-white/50">Page tabs will appear here.</div>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
