'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { RefreshCw } from 'lucide-react';

const logger = createLogger('WorkspacePage');

type LibraryKind = 'entity' | 'edge' | 'model';
type LibraryKindFilter = 'all' | LibraryKind;

type WorkspaceModel = {
  id: number;
  extId: string;
  name?: string;
  sourceQuery?: string;
  isTemplate: boolean;
  templateRole?: string;
  dimension?: string | null;
  updatedAt?: string;
};

type LibraryItem =
  | { kind: 'entity'; data: DisplayNode }
  | { kind: 'edge'; data: DisplayEdge }
  | { kind: 'model'; data: WorkspaceModel };

function getEntitySummary(entity: DisplayNode): string | undefined {
  return entity.properties.summary || entity.properties.description || entity.properties.blurb;
}

function getModelLabel(model: WorkspaceModel): string {
  return model.name || model.extId;
}

function isGroundedNodeForWorkspace(node: DisplayNode): boolean {
  return isGroundedNode(node) && !isCandidateNode(node);
}

function isGroundedEdgeForWorkspace(edge: DisplayEdge): boolean {
  return isGroundedEdge(edge) && !isCandidateEdge(edge);
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
  const kindLabel = model.isTemplate ? 'template' : 'standard';
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
          {kindLabel}
        </Badge>
      </div>
    </button>
  );
}

export default function WorkspacePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [kindFilter, setKindFilter] = useState<LibraryKindFilter>('all');
  const [search, setSearch] = useState('');

  const [entities, setEntities] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);
  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);

  const [libraryWidth, setLibraryWidth] = useState(320);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(libraryWidth);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = libraryWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [libraryWidth]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const nextWidth = Math.min(Math.max(startWidthRef.current + deltaX, 220), 720);
    setLibraryWidth(nextWidth);
  }, []);

  const handleResizeEnd = useCallback(() => {
    isResizingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleResizeReset = useCallback(() => {
    setLibraryWidth(320);
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
      setSelectedItem(null);
      return;
    }
    try {
      setLoadingData(true);
      const [nodesData, edgesData, modelsData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
        mentalModelsApi.list({ limit: 1000 }),
      ]);

      // Align with the Context Manager's grounded view: only canonical or
      // grounded nodes that are not candidates. This keeps the workspace focused
      // on the prebuilt/processed corpus graph rather than inferred/candidate
      // items that still need review.
      const displayNodes = nodesData.map(backendNodeToDisplayNode).filter(isGroundedNodeForWorkspace);
      const displayEdges = edgesData.map(backendEdgeToDisplayEdge).filter(isGroundedEdgeForWorkspace);

      setEntities(displayNodes);
      setEdges(displayEdges);

      setModels(
        (Array.isArray(modelsData) ? modelsData : []).map((m) => ({
          id: m.id,
          extId: m.ext_id,
          name: m.name || undefined,
          sourceQuery: m.source_query || undefined,
          isTemplate: Boolean(m.is_template || m.template_role),
          templateRole: m.template_role || undefined,
          dimension: m.dimension || null,
          updatedAt: m.updated_at || undefined,
        }))
      );
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

  const allItems = useMemo<LibraryItem[]>(() => {
    const items: LibraryItem[] = [
      ...entities.map((e) => ({ kind: 'entity' as const, data: e })),
      ...edges.map((e) => ({ kind: 'edge' as const, data: e })),
      ...models.map((m) => ({ kind: 'model' as const, data: m })),
    ];
    // Stable sort: entities first, then edges, then models, each internally by label/id.
    items.sort((a, b) => {
      const kindRank = { entity: 0, edge: 1, model: 2 };
      const rankDiff = kindRank[a.kind] - kindRank[b.kind];
      if (rankDiff !== 0) return rankDiff;
      const aKey = a.kind === 'entity' ? a.data.label : a.kind === 'edge' ? (a.data.label || a.data.id) : getModelLabel(a.data);
      const bKey = b.kind === 'entity' ? b.data.label : b.kind === 'edge' ? (b.data.label || b.data.id) : getModelLabel(b.data);
      return aKey.localeCompare(bKey);
    });
    return items;
  }, [entities, edges, models]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let items = allItems;
    if (kindFilter !== 'all') {
      items = items.filter((i) => i.kind === kindFilter);
    }
    if (!q) return items;
    return items.filter((item) => {
      if (item.kind === 'entity') {
        const e = item.data;
        return (
          e.label.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q) ||
          (e.properties.summary || '').toLowerCase().includes(q)
        );
      }
      if (item.kind === 'edge') {
        const e = item.data;
        const text = `${e.label || ''} ${e.detail || ''} ${e.source_id} ${e.target_id} ${e.type || ''}`.toLowerCase();
        return text.includes(q);
      }
      const m = item.data;
      return (
        getModelLabel(m).toLowerCase().includes(q) ||
        m.extId.toLowerCase().includes(q) ||
        (m.templateRole || '').toLowerCase().includes(q) ||
        (m.sourceQuery || '').toLowerCase().includes(q)
      );
    });
  }, [allItems, search, kindFilter]);

  const handleSelectItem = useCallback(async (item: LibraryItem) => {
    setSelectedItem(item);
    if (item.kind === 'model') {
      setRawModelContent({ content: null, loading: true });
      try {
        const result = await mentalModelsApi.fetchContent(serverId, bankId, item.data.extId);
        setRawModelContent({
          content: result.content,
          updatedAt: result.updated_at || undefined,
          loading: false,
        });
      } catch (err: any) {
        logger.error('Failed to fetch model content', { error: err, extId: item.data.extId });
        setRawModelContent({ content: null, loading: false, error: err.message || 'Failed to load model content' });
      }
    }
  }, [serverId, bankId]);

  const isSelected = useCallback((item: LibraryItem) => {
    if (!selectedItem || selectedItem.kind !== item.kind) return false;
    if (item.kind === 'entity') return selectedItem.data.id === item.data.id;
    if (item.kind === 'edge') return selectedItem.data.id === item.data.id;
    return selectedItem.data.id === item.data.id;
  }, [selectedItem]);

  const renderLibraryList = () => {
    if (filteredItems.length === 0) {
      return <div className="text-white/50 text-sm px-3 py-4">No library items match your filters.</div>;
    }
    return (
      <div className="space-y-1">
        {filteredItems.map((item) => {
          if (item.kind === 'entity') {
            return (
              <EntityListRow
                key={`entity-${item.data.id}`}
                node={item.data}
                active={isSelected(item)}
                onClick={() => handleSelectItem(item)}
              />
            );
          }
          if (item.kind === 'edge') {
            return (
              <EdgeListRow
                key={`edge-${item.data.id}`}
                edge={item.data}
                active={isSelected(item)}
                sourceLabel={nodeById.get(item.data.source_id)?.label}
                targetLabel={nodeById.get(item.data.target_id)?.label}
                onClick={() => handleSelectItem(item)}
              />
            );
          }
          return (
            <ModelListRow
              key={`model-${item.data.id}`}
              model={item.data}
              active={isSelected(item)}
              onClick={() => handleSelectItem(item)}
            />
          );
        })}
      </div>
    );
  };

  const renderQuickView = () => {
    if (!selectedItem) {
      return (
        <div className="h-full flex items-center justify-center text-white/50 text-sm px-6 text-center">
          Select an item from the library to inspect its contents.
        </div>
      );
    }

    if (selectedItem.kind === 'entity') {
      const entity = selectedItem.data;
      const summary = getEntitySummary(entity);
      const modelRefs = entity.properties.provenance?.model_refs || [];
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
          {modelRefs.length > 0 && (
            <Section title="Model refs">
              <div className="space-y-2">
                {modelRefs.map((ref: any, idx: number) => (
                  <div key={idx} className="text-[11px] text-white/70 bg-black/20 rounded p-1.5">
                    <div className="font-medium text-white/90">{ref.ext_id || 'unknown'}</div>
                    <div className="text-white/50">{ref.role || 'no role'} · fetched {formatRelative(ref.fetched_at)}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      );
    }

    if (selectedItem.kind === 'edge') {
      const edge = selectedItem.data;
      const modelRefs = edge.properties.provenance?.model_refs || [];
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
          {modelRefs.length > 0 && (
            <Section title="Model refs">
              <div className="space-y-2">
                {modelRefs.map((ref: any, idx: number) => (
                  <div key={idx} className="text-[11px] text-white/70 bg-black/20 rounded p-1.5">
                    <div className="font-medium text-white/90">{ref.ext_id || 'unknown'}</div>
                    <div className="text-white/50">{ref.role || 'no role'} · fetched {formatRelative(ref.fetched_at)}</div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      );
    }

    const model = selectedItem.data;
    return (
      <div className="space-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Mental Model</div>
          <div className="text-lg font-semibold text-white/90">{getModelLabel(model)}</div>
          <div className="text-xs text-white/50 font-mono">{model.extId}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {model.isTemplate && <Badge variant="outline" className="text-[10px] h-5">template</Badge>}
          {model.templateRole && <Badge variant="outline" className="text-[10px] h-5">{model.templateRole}</Badge>}
          {model.dimension && <Badge variant="outline" className="text-[10px] h-5">{model.dimension}</Badge>}
        </div>
        {model.sourceQuery && <Section title="Source query"><PropertyRow label="" value={model.sourceQuery} /></Section>}
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

  const kindFilters: { value: LibraryKindFilter; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: allItems.length },
    { value: 'entity', label: 'Entities', count: entities.length },
    { value: 'edge', label: 'Edges', count: edges.length },
    { value: 'model', label: 'Models', count: models.length },
  ];

  return (
    <PageShell
      title="Workspace"
      subtitle="Efficient discovery and collation of prebuilt data."
      count={filteredItems.length}
      countLabel="item"
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

        {/* Main workspace */}
        <div className="flex-1 flex min-h-0 gap-3">
          {/* Library */}
          <div className="flex flex-col min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)]" style={{ width: libraryWidth, minWidth: libraryWidth, maxWidth: libraryWidth }}>
            <div className="p-3 border-b border-white/10">
              <Input
                placeholder="Search library..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="px-3 py-2 border-b border-white/10">
              <div className="flex items-center gap-1.5 flex-wrap">
                {kindFilters.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => { setKindFilter(f.value); setSelectedItem(null); }}
                    className={cn(
                      'text-[11px] px-2 py-1 rounded border transition-colors',
                      kindFilter === f.value
                        ? 'bg-emerald-900/30 border-emerald-700/30 text-emerald-100'
                        : 'border-white/10 text-white/60 hover:bg-white/5'
                    )}
                  >
                    {f.label} <span className="text-white/40 ml-0.5">{f.count}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 min-h-0">
              {renderLibraryList()}
            </div>
          </div>

          {/* Resize grab bar */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize library pane"
            title="Drag to resize; double-click to reset"
            onMouseDown={handleResizeStart}
            onDoubleClick={handleResizeReset}
            className="w-1.5 -ml-0.5 -mr-0.5 cursor-col-resize rounded-full hover:bg-white/20 active:bg-white/30 transition-colors shrink-0 z-10"
          />

          {/* Quick view */}
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)] p-4 overflow-y-auto">
            {renderQuickView()}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
