'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { serversApi, contextualGraphApi, mentalModelsApi, type Server } from '@/lib/api/client';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import {
  DisplayNode,
  DisplayEdge,
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

type LibraryTab = 'entities' | 'edges' | 'models';

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

function getNodeType(node: { labels: string[] }): string {
  if (node.labels.includes('canonical')) return 'canonical';
  if (node.labels.includes('grounded')) return 'grounded';
  if (node.labels.includes('discovered')) return 'discovered';
  if (node.labels.includes('candidate')) return 'candidate';
  return node.labels[0] || 'entity';
}

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

export default function WorkspacePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [activeTab, setActiveTab] = useState<LibraryTab>('entities');
  const [search, setSearch] = useState('');

  const [entities, setEntities] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);
  const [models, setModels] = useState<WorkspaceModel[]>([]);
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);

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

  const filteredEntities = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      e.label.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q)
    );
  }, [entities, search]);

  const filteredEdges = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return edges;
    return edges.filter((e) => {
      const text = `${e.label || ''} ${e.detail || ''} ${e.source_id} ${e.target_id} ${e.type || ''}`.toLowerCase();
      return text.includes(q);
    });
  }, [edges, search]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) =>
      getModelLabel(m).toLowerCase().includes(q) ||
      m.extId.toLowerCase().includes(q) ||
      (m.templateRole || '').toLowerCase().includes(q)
    );
  }, [models, search]);

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

  const renderLibraryList = () => {
    if (activeTab === 'entities') {
      if (filteredEntities.length === 0) {
        return <div className="text-white/50 text-sm px-3 py-4">No entities match your filters.</div>;
      }
      return (
        <div className="space-y-1">
          {filteredEntities.map((entity) => (
            <button
              key={entity.id}
              type="button"
              onClick={() => handleSelectItem({ kind: 'entity', data: entity })}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md border border-transparent transition-colors',
                selectedItem?.kind === 'entity' && selectedItem.data.id === entity.id
                  ? 'bg-emerald-900/30 border-emerald-700/30'
                  : 'hover:bg-white/5 hover:border-white/5'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-white/90 truncate">{entity.label}</span>
                <Badge variant="outline" className="text-[10px] h-5 shrink-0">{getNodeType(entity)}</Badge>
              </div>
              <div className="text-[11px] text-white/50 truncate">{entity.id}</div>
            </button>
          ))}
        </div>
      );
    }

    if (activeTab === 'edges') {
      if (filteredEdges.length === 0) {
        return <div className="text-white/50 text-sm px-3 py-4">No edges match your filters.</div>;
      }
      return (
        <div className="space-y-1">
          {filteredEdges.map((edge) => (
            <button
              key={edge.id}
              type="button"
              onClick={() => handleSelectItem({ kind: 'edge', data: edge })}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md border border-transparent transition-colors',
                selectedItem?.kind === 'edge' && selectedItem.data.id === edge.id
                  ? 'bg-emerald-900/30 border-emerald-700/30'
                  : 'hover:bg-white/5 hover:border-white/5'
              )}
            >
              <div className="text-sm text-white/90 truncate">
                {edge.source_id} <span className="text-white/40">→</span> {edge.target_id}
              </div>
              <div className="text-[11px] text-white/50 truncate">
                {edge.label || edge.type || 'edge'} · {edge.id}
              </div>
            </button>
          ))}
        </div>
      );
    }

    if (filteredModels.length === 0) {
      return <div className="text-white/50 text-sm px-3 py-4">No mental models match your filters.</div>;
    }
    return (
      <div className="space-y-1">
        {filteredModels.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => handleSelectItem({ kind: 'model', data: model })}
            className={cn(
              'w-full text-left px-3 py-2 rounded-md border border-transparent transition-colors',
              selectedItem?.kind === 'model' && selectedItem.data.id === model.id
                ? 'bg-emerald-900/30 border-emerald-700/30'
                : 'hover:bg-white/5 hover:border-white/5'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-white/90 truncate">{getModelLabel(model)}</span>
              <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                {model.isTemplate ? 'template' : 'standard'}
              </Badge>
            </div>
            <div className="text-[11px] text-white/50 truncate">{model.extId}</div>
          </button>
        ))}
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
      return (
        <div className="space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Edge</div>
            <div className="text-lg font-semibold text-white/90">
              {edge.source_id} <span className="text-white/40">→</span> {edge.target_id}
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

  return (
    <PageShell
      title="Workspace"
      subtitle="Efficient discovery and collation of prebuilt data."
      count={activeTab === 'entities' ? filteredEntities.length : activeTab === 'edges' ? filteredEdges.length : filteredModels.length}
      countLabel={activeTab === 'entities' ? 'entity' : activeTab === 'edges' ? 'edge' : 'model'}
      loading={loadingServers || loadingBanks || loadingData}
    >
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        {/* Controls */}
        <div className="flex items-center gap-3">
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
          <div className="w-80 flex flex-col min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)]">
            <div className="p-3 border-b border-white/10">
              <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as LibraryTab); setSelectedItem(null); }}>
                <TabsList className="w-full">
                  <TabsTrigger value="entities" className="text-xs">Entities</TabsTrigger>
                  <TabsTrigger value="edges" className="text-xs">Edges</TabsTrigger>
                  <TabsTrigger value="models" className="text-xs">Models</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="p-2 border-b border-white/10">
              <Input
                placeholder="Filter..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 min-h-0">
              {renderLibraryList()}
            </div>
          </div>

          {/* Quick view */}
          <div className="flex-1 min-h-0 rounded-lg border border-white/10 bg-[oklch(0.22_0_0)] p-4 overflow-y-auto">
            {renderQuickView()}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
