'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { serversApi, contextualGraphApi, type GraphNode as ApiGraphNode, type GraphEdge as ApiGraphEdge } from '@/lib/api/client';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SyncJobsTab } from './sync-jobs-tab';
import { MentalModelsTab } from './mental-models-tab';
import { CandidatesTab } from './candidates-tab';

const logger = createLogger('ContextManagerPage');

type PatchRole = 'sys_entity_summary' | 'sys_entity_capabilities' | 'sys_edge_context' | 'sys_discovery_context' | string;

const ROLE_LABELS: Record<string, string> = {
  sys_entity_summary: 'summary',
  sys_entity_capabilities: 'capabilities',
  sys_edge_context: 'edge context',
  sys_discovery_context: 'discovery',
};

type BackendNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};

type BackendEdge = {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
  labels?: string[];
  properties: Record<string, any>;
};

export type ModelRef = {
  role?: string;
  ext_id?: string;
  attached_at?: string;
  fetched_at?: string;
  content_hash?: string;
  last_refresh_status?: 'ok' | 'error' | 'skipped' | string;
  last_refresh_at?: string;
  last_refresh_error?: string;
};

export type DisplayNode = {
  id: string;
  type: string;
  label: string;
  labels: string[];
  properties: Record<string, any>;
  modelRefs: ModelRef[];
};

export type DisplayEdge = {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
  labels: string[];
  label?: string;
  detail?: string;
  properties: Record<string, any>;
  modelRefs: ModelRef[];
};

function backendNodeToDisplayNode(node: BackendNode): DisplayNode {
  const type = node.labels[0] ?? (typeof node.id === 'string' && node.id.includes(':') ? node.id.split(':')[0] : 'entity');
  const label = node.properties.display_name || node.properties.name || node.properties.label || node.id;
  return {
    id: node.id,
    labels: node.labels,
    type,
    label,
    properties: node.properties,
    modelRefs: node.properties.provenance?.model_refs || [],
  };
}

function backendEdgeToDisplayEdge(edge: BackendEdge): DisplayEdge {
  return {
    id: edge.id,
    source_id: edge.source_id,
    target_id: edge.target_id,
    type: edge.type,
    labels: edge.labels || [],
    label: edge.properties.label,
    detail: edge.properties.detail,
    properties: edge.properties,
    modelRefs: edge.properties.provenance?.model_refs || [],
  };
}

function isGroundedNode(node: DisplayNode): boolean {
  return node.labels.includes('canonical') || node.labels.includes('grounded');
}

function isCandidateNode(node: DisplayNode): boolean {
  return node.labels.includes('candidate');
}

function isCandidateEdge(edge: DisplayEdge): boolean {
  return edge.properties.labels?.includes('candidate') ?? false;
}

function isGroundedEdge(edge: DisplayEdge): boolean {
  return !isCandidateEdge(edge);
}

function getLastRefreshedAt(modelRefs: DisplayNode['modelRefs']): string | null {
  const timestamps = modelRefs
    .filter((r) => r.fetched_at)
    .map((r) => new Date(r.fetched_at!).getTime())
    .filter((t) => !isNaN(t));
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function formatRelative(value?: string | null): string {
  if (!value) return 'never';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return formatDistanceToNow(d, { addSuffix: true });
}

function renderValue(value: unknown): React.ReactNode {
  if (value === undefined || value === null) return <span className="text-white/40 italic">null</span>;
  if (typeof value === 'string') {
    return value.trim().length === 0
      ? <span className="text-white/40 italic">empty</span>
      : <p className="whitespace-pre-wrap text-white/80">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-white/80">{String(value)}</span>;
  }
  return (
    <pre className="text-[11px] text-white/70 bg-black/20 rounded p-1.5 overflow-x-auto">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-white/5 bg-black/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5 text-white/50" /> : <ChevronRight className="w-3.5 h-3.5 text-white/50" />}
        <span className="text-[11px] font-medium text-white/80">{title}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5 pt-1 space-y-2">{children}</div>}
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/40 mb-0.5">{label}</div>
      {renderValue(value)}
    </div>
  );
}

export default function ContextManagerPage() {
  const [servers, setServers] = useState<Array<{ id: number; name?: string; base_url?: string; contextual_graph_banks?: any }>>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [nodes, setNodes] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Graph tab search/filter state.
  const [graphSearch, setGraphSearch] = useState('');

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  const selectedServer = servers.find((s) => s.id === serverId);
  const bankConfig = useMemo(() => {
    if (!selectedServer?.contextual_graph_banks) return null;
    const banks = Array.isArray(selectedServer.contextual_graph_banks)
      ? selectedServer.contextual_graph_banks
      : [];
    return banks.find((b: any) => b.bank_id === bankId) || null;
  }, [selectedServer, bankId]);
  const bankMode = bankConfig?.mode ?? null; // 'manual' | 'auto' | null
  const restriction = bankConfig?.restriction || {};
  const importRestriction = restriction.import || {};
  const deployRestriction = restriction.deploy || {};
  const allowedModelTypes = deployRestriction.allowed_model_types || [];
  const topKNodes = importRestriction.top_k_nodes;
  const maxModelsPerRun = deployRestriction.max_models_per_run;

  useEffect(() => {
    async function loadServers() {
      try {
        setLoadingServers(true);
        const data = await serversApi.list();
        setServers(data.map((s) => ({ id: s.id, name: s.name || s.base_url, contextual_graph_banks: s.contextual_graph_banks })));
      } catch (err) {
        logger.error('Failed to load servers', { error: err });
        toast.error('Failed to load servers');
      } finally {
        setLoadingServers(false);
      }
    }
    loadServers();
  }, []);

  useEffect(() => {
    if (!serverId) {
      setBanks([]);
      return;
    }
    async function loadBanks() {
      try {
        setLoadingBanks(true);
        const data = await serversApi.listBanks(serverId);
        setBanks(data.map((b) => ({ bank_id: b.bank_id, name: b.name || b.bank_id })));
      } catch (err) {
        logger.error('Failed to load banks', { error: err, serverId });
        toast.error('Failed to load banks');
      } finally {
        setLoadingBanks(false);
      }
    }
    loadBanks();
  }, [serverId]);

  const loadGraph = useCallback(async () => {
    if (!serverId || !bankId) return;
    try {
      setGraphLoading(true);
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
      ]);
      setNodes(nodesData.map(backendNodeToDisplayNode));
      setEdges(edgesData.map(backendEdgeToDisplayEdge));
    } catch (err: any) {
      logger.error('Failed to load contextual graph', { error: err, serverId, bankId });
      toast.error(`Failed to load graph: ${err.message || err}`);
      setNodes([]);
      setEdges([]);
    } finally {
      setGraphLoading(false);
    }
  }, [serverId, bankId]);

  const handleRunSyncJob = useCallback(async () => {
    if (!serverId || !bankId) return;
    if (!window.confirm(`Run a full contextual sync job for ${bankId}? This imports the Hindsight skeleton, deploys configured contextual models, syncs mental-model config, and refreshes patches.`)) return;
    try {
      setActionLoading('sync-job');
      const result = await contextualGraphApi.startSyncJob(serverId, bankId);
      if (result.success) {
        toast.success(`Sync job started — ${result.job?.id ?? 'queued'}`);
      } else {
        toast.error(`Sync job failed: ${result.error || result.code || 'unknown'}`);
      }
    } catch (err: any) {
      logger.error('Failed to start sync job', { error: err, serverId, bankId });
      toast.error(`Sync job failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId]);

  const sortedNodes = useMemo(() => {
    return [...nodes]
      .filter((n) => isGroundedNode(n))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [nodes]);

  const sortedEdges = useMemo(() => {
    return [...edges]
      .filter((e) => isGroundedEdge(e))
      .sort((a, b) => {
        const aKey = `${a.source_id}|${a.target_id}`;
        const bKey = `${b.source_id}|${b.target_id}`;
        return aKey.localeCompare(bKey);
      });
  }, [edges]);

  const nodeById = useMemo(() => {
    const map = new Map<string, DisplayNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  const filteredSortedNodes = useMemo(() => {
    const q = graphSearch.trim().toLowerCase();
    if (!q) return sortedNodes;
    return sortedNodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q)
    );
  }, [sortedNodes, graphSearch]);

  const filteredSortedEdges = useMemo(() => {
    const q = graphSearch.trim().toLowerCase();
    if (!q) return sortedEdges;
    return sortedEdges.filter((e) => {
      const source = nodeById.get(e.source_id)?.label || e.source_id;
      const target = nodeById.get(e.target_id)?.label || e.target_id;
      const text = `${e.detail || ''} ${e.label || ''} ${e.type || ''} ${source} ${target}`.toLowerCase();
      return text.includes(q);
    });
  }, [sortedEdges, graphSearch, nodeById]);

  const allModelRefs = useMemo(() => {
    const refs: ModelRef[] = [];
    for (const node of nodes) refs.push(...node.modelRefs);
    for (const edge of edges) refs.push(...edge.modelRefs);
    return refs;
  }, [nodes, edges]);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) ?? null : null;
  const selectedItem: (DisplayNode | DisplayEdge) | null = selectedNode || selectedEdge;

  const [activeTab, setActiveTab] = useState('graph');

  // Resizer state: same pattern as explore page.
  const [topFlex, setTopFlex] = useState(2.5);
  const bottomFlex = 5 - topFlex;
  const [leftFlex, setLeftFlex] = useState(1.5);
  const rightFlex = 5 - leftFlex;
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startTopFlexRef = useRef(2.5);
  const containerHeightRef = useRef(0);

  // Vertical resize between Entities and Edges panels.
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    startTopFlexRef.current = topFlex;
    const container = leftPaneRef.current;
    if (container) {
      containerHeightRef.current = container.getBoundingClientRect().height;
    }
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [topFlex]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isDraggingRef.current) return;
    const deltaY = e.clientY - startYRef.current;
    const containerHeight = containerHeightRef.current;
    if (containerHeight > 0) {
      const deltaFlex = (deltaY / containerHeight) * 5;
      const nextTopFlex = Math.min(Math.max(startTopFlexRef.current + deltaFlex, 0.8), 4.2);
      setTopFlex(nextTopFlex);
    }
  }, []);

  const handleResizeEnd = useCallback(() => {
    isDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  // Horizontal resize between left lists and detail panel.
  const isHorizontalDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startLeftFlexRef = useRef(1.5);
  const containerWidthRef = useRef(0);

  const handleHorizontalResizeStart = useCallback((e: React.MouseEvent) => {
    isHorizontalDraggingRef.current = true;
    startXRef.current = e.clientX;
    startLeftFlexRef.current = leftFlex;
    const container = leftPaneRef.current?.parentElement;
    if (container) {
      containerWidthRef.current = container.getBoundingClientRect().width;
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [leftFlex]);

  const handleHorizontalResizeMove = useCallback((e: MouseEvent) => {
    if (!isHorizontalDraggingRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const containerWidth = containerWidthRef.current;
    if (containerWidth > 0) {
      const deltaFlex = (deltaX / containerWidth) * 5;
      const nextLeftFlex = Math.min(Math.max(startLeftFlexRef.current + deltaFlex, 0.5), 4.5);
      setLeftFlex(nextLeftFlex);
    }
  }, []);

  const handleHorizontalResizeEnd = useCallback(() => {
    isHorizontalDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      handleResizeMove(e);
      handleHorizontalResizeMove(e);
    };
    const up = () => {
      handleResizeEnd();
      handleHorizontalResizeEnd();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleResizeMove, handleResizeEnd, handleHorizontalResizeMove, handleHorizontalResizeEnd]);

  useEffect(() => {
    if (!serverId || !bankId) {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setNodes([]);
      setEdges([]);
      return;
    }
    // Refresh graph data whenever the user switches back to a data-driven tab.
    if (activeTab === 'graph' || activeTab === 'candidates' || activeTab === 'models') {
      loadGraph();
    }
  }, [serverId, bankId, activeTab, loadGraph]);

  const renderDetailPanel = () => {
    if (!selectedItem) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-white/50 text-sm px-6 text-center">
          <p>Select an entity or edge from the left to view its contextual graph data.</p>
        </div>
      );
    }

    const isNode = !('source_id' in selectedItem);
    const title = isNode ? selectedItem.label : (selectedItem.detail || selectedItem.label || selectedItem.type || selectedItem.id);
    const subtitle = isNode ? selectedItem.id : `${selectedItem.source_id} → ${selectedItem.target_id}`;
    const modelRefs = selectedItem.modelRefs;
    const lastRefreshed = getLastRefreshedAt(modelRefs);
    const provenance = selectedItem.properties.provenance || {};
    const rawStored = { ...selectedItem.properties };
    delete rawStored.provenance;

    return (
      <div className="h-full overflow-y-auto p-4 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white/90">{title}</h2>
          <div className="text-xs text-white/50 font-mono">{subtitle}</div>
          <div className="flex flex-wrap gap-2 mt-2">
            {isNode ? (
              selectedItem.labels.map((label: string) => (
                <Badge key={label} variant="outline" className="text-[10px] border-white/10 text-white/60">
                  {label}
                </Badge>
              ))
            ) : (
              <Badge variant="outline" className="text-[10px] border-white/10 text-white/60">
                {selectedItem.type || 'edge'}
              </Badge>
            )}
          </div>
        </div>

        <Section title="Mental model refs">
          {modelRefs.length === 0 ? (
            <span className="text-white/50 italic">No mental-model refs attached.</span>
          ) : (
            <div className="space-y-2">
              {modelRefs.map((ref, i) => {
                return (
                  <div key={`${ref.ext_id ?? ref.role ?? 'ref'}-${i}`} className="rounded border border-white/5 bg-black/10 p-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge className="text-[10px] bg-emerald-900/30 text-emerald-300 border-emerald-500/20">
                        {ROLE_LABELS[ref.role || ''] || ref.role || 'model'}
                      </Badge>
                      {ref.ext_id && <span className="text-[10px] font-mono text-white/50 truncate" title={ref.ext_id}>{ref.ext_id}</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px] text-white/50">
                      {ref.attached_at && <span>attached {formatRelative(ref.attached_at)}</span>}
                      {ref.fetched_at && <span>fetched {formatRelative(ref.fetched_at)}</span>}
                      {ref.content_hash && <span className="font-mono col-span-2">hash {ref.content_hash}</span>}
                    </div>
                    <div className="flex flex-col gap-0.5 text-[10px]">
                      {ref.last_refresh_status ? (
                        <span className={cn('font-medium', ref.last_refresh_status === 'error' ? 'text-red-400' : ref.last_refresh_status === 'skipped' ? 'text-amber-400' : 'text-emerald-400')}>
                          {ref.last_refresh_status === 'error' ? '✗' : ref.last_refresh_status === 'skipped' ? '⊘' : '✓'} refresh {ref.last_refresh_status}
                          {ref.last_refresh_at ? ` ${formatRelative(ref.last_refresh_at)}` : ''}
                        </span>
                      ) : null}
                      {ref.last_refresh_error ? (
                        <span className="text-red-300/80 line-clamp-2" title={ref.last_refresh_error}>{ref.last_refresh_error}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Provenance">
          {Object.keys(provenance).length === 0 ? (
            <span className="text-white/50 italic">No provenance recorded.</span>
          ) : (
            <div className="space-y-2">
              {Object.entries(provenance).map(([key, value]) => (
                <PropertyRow key={key} label={key} value={value} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Stored data">
          {Object.keys(rawStored).length === 0 ? (
            <span className="text-white/50 italic">No stored data.</span>
          ) : (
            <div className="space-y-2">
              {Object.entries(rawStored).map(([key, value]) => (
                <PropertyRow key={key} label={key} value={value} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Timestamps">
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <PropertyRow label="last refreshed" value={lastRefreshed ? formatRelative(lastRefreshed) : 'never'} />
            <PropertyRow label="created" value={selectedItem.properties.created_at ? formatRelative(selectedItem.properties.created_at) : 'unknown'} />
            <PropertyRow label="updated" value={selectedItem.properties.updated_at ? formatRelative(selectedItem.properties.updated_at) : 'unknown'} />
            <PropertyRow label="last seen" value={selectedItem.properties.last_seen_at ? formatRelative(selectedItem.properties.last_seen_at) : 'unknown'} />
          </div>
        </Section>
      </div>
    );
  };

  return (
    <PageShell
      title="Context Manager"
    >
      <div className="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-white/10">
        <div className="flex items-center gap-3 flex-wrap">
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

          {bankId && (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Config</span>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] border-white/10',
                    bankMode === 'auto' ? 'bg-blue-500/10 text-blue-300' : 'bg-white/5 text-white/50'
                  )}
                >
                  {bankMode === 'auto' ? 'Auto refresh' : bankMode === 'manual' ? 'Manual refresh' : 'Unmanaged'}
                </Badge>
                {typeof topKNodes === 'number' && (
                  <Badge variant="outline" className="text-[10px] border-white/10 text-white/50">
                    Import top {topKNodes} nodes
                  </Badge>
                )}
                {typeof maxModelsPerRun === 'number' && (
                  <Badge variant="outline" className="text-[10px] border-white/10 text-white/50">
                    Deploy max {maxModelsPerRun}
                  </Badge>
                )}
              </div>

              <div className="w-px h-4 bg-white/10" />

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Model Types</span>
                {allowedModelTypes.length > 0 ? (
                  allowedModelTypes.map((type: string) => (
                    <Badge key={type} variant="outline" className="text-[10px] border-white/10 text-white/50">
                      {type}
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline" className="text-[10px] border-white/10 text-white/50">All types</Badge>
                )}
              </div>

              <div className="w-px h-4 bg-white/10" />

              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-white/40">Graph</span>
                <Badge variant="outline" className="text-[10px] border-white/10 text-white/50">
                  {nodes.length} node{nodes.length !== 1 ? 's' : ''} / {edges.length} edge{edges.length !== 1 ? 's' : ''}
                </Badge>
              </div>
            </div>
          )}
        </div>
        {bankMode === 'manual' && (
          <Button
            variant="outline"
            size="sm"
            disabled={!serverId || !bankId || actionLoading === 'sync-job'}
            onClick={handleRunSyncJob}
          >
            {actionLoading === 'sync-job' ? 'Running…' : 'Run sync job'}
          </Button>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 shrink-0">
          <TabsList variant="line">
            <TabsTrigger value="graph">Graph</TabsTrigger>
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
            <TabsTrigger value="models">Mental Models</TabsTrigger>
            <TabsTrigger value="jobs">Sync Jobs</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="graph" className="flex flex-col flex-1 min-h-0 mt-0">
          <div className="flex items-center gap-3 pb-2 border-b border-white/10 shrink-0">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
              <Input
                value={graphSearch}
                onChange={(e) => setGraphSearch(e.target.value)}
                placeholder="Search entities and edges..."
                className="h-8 pl-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/40"
              />
            </div>
            <span className="text-[11px] text-white/50 ml-auto">
              {filteredSortedNodes.length} node{filteredSortedNodes.length !== 1 ? 's' : ''} / {filteredSortedEdges.length} edge
              {filteredSortedEdges.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex-1 min-h-0 flex mt-2">
            <div
              ref={leftPaneRef}
              className="min-w-0 flex flex-col gap-1"
              style={{ flex: leftFlex }}
            >
              <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col" style={{ flex: topFlex }}>
                <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm">Entities</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono">
                    {filteredSortedNodes.length}
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                  {graphLoading ? (
                    <div className="p-3 space-y-2">
                      <Skeleton className="h-10 w-full bg-white/10" />
                      <Skeleton className="h-10 w-full bg-white/10" />
                      <Skeleton className="h-10 w-full bg-white/10" />
                    </div>
                  ) : filteredSortedNodes.length === 0 ? (
                    <div className="text-[11px] text-white/40 px-2 py-3">No grounded entities loaded.</div>
                  ) : (
                    filteredSortedNodes.map((node) => {
                      const active = selectedNodeId === node.id;
                      const typeLine = node.type && !node.id.startsWith(`${node.type}:`) ? `${node.type}:${node.id}` : node.id;
                      const lastRefreshed = getLastRefreshedAt(node.modelRefs);
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
                          className={cn(
                            'w-full rounded border bg-black/10 px-1.5 py-1 text-left transition-colors',
                            active ? 'border-emerald-500/50 bg-emerald-900/30' : 'border-white/5 hover:bg-white/5'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-0 min-w-0">
                              <div className="text-xs text-white/90 truncate">{node.label}</div>
                              <div className="text-[10px] text-white/40 truncate">{typeLine}</div>
                            </div>
                            <span className="text-[10px] text-white/30 shrink-0">{formatRelative(lastRefreshed)}</span>
                          </div>
                          {node.modelRefs.length > 0 && (
                            <div className="flex items-center gap-1 flex-wrap mt-0.5">
                              {node.modelRefs.map((ref, i) => (
                                <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-white/50">
                                  {ROLE_LABELS[ref.role || ''] || ref.role}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div
                onMouseDown={handleResizeStart}
                onDoubleClick={() => setTopFlex(2.5)}
                className="h-2 shrink-0 cursor-row-resize flex items-center justify-center group"
                title="Drag to resize top and bottom panels; double-click to reset"
              >
                <div className="w-16 h-1 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
              </div>

              <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col" style={{ flex: bottomFlex }}>
                <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm">Edges</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono">
                    {filteredSortedEdges.length}
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                  {filteredSortedEdges.length === 0 && (
                    <div className="text-[11px] text-white/40 px-2 py-3">No grounded edges loaded.</div>
                  )}
                  {filteredSortedEdges.map((edge) => {
                    const active = selectedEdgeId === edge.id;
                    const source = nodeById.get(edge.source_id);
                    const target = nodeById.get(edge.target_id);
                    const lastRefreshed = getLastRefreshedAt(edge.modelRefs);
                    return (
                      <button
                        key={edge.id}
                        type="button"
                        onClick={() => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
                        className={cn(
                          'w-full text-left rounded border px-1.5 py-1 transition-colors',
                          active ? 'bg-emerald-900/30 border-emerald-500/50' : 'bg-black/10 border-white/5 hover:bg-white/5'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs text-white/90 truncate">{edge.detail || edge.label || edge.type || 'Edge'}</div>
                            <div className="text-[10px] text-white/40 truncate">
                              {source?.label || edge.source_id} → {target?.label || edge.target_id}
                            </div>
                          </div>
                          <span className="text-[10px] text-white/30 shrink-0">{formatRelative(lastRefreshed)}</span>
                        </div>
                        {edge.modelRefs.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            {edge.modelRefs.map((ref, i) => (
                              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-white/50">
                                {ROLE_LABELS[ref.role || ''] || ref.role}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              onMouseDown={handleHorizontalResizeStart}
              onDoubleClick={() => setLeftFlex(1.5)}
              className="w-3 shrink-0 cursor-col-resize flex flex-col items-center justify-center group"
              title="Drag to resize left and right panels; double-click to reset"
            >
              <div className="w-1 h-16 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
            </div>

            <Card className="min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0" style={{ flex: rightFlex }}>
              {renderDetailPanel()}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="flex flex-col flex-1 min-h-0 mt-0">
          <SyncJobsTab
            servers={servers}
            banks={banks}
            loadingBanks={loadingBanks}
            selectedServerId={selectedServerId || ''}
            selectedBankId={selectedBankId || ''}
            isActive={activeTab === 'jobs'}
          />
        </TabsContent>

        <TabsContent value="candidates" className="flex flex-col flex-1 min-h-0 mt-0">
          <CandidatesTab
            nodes={nodes}
            edges={edges}
            nodeById={nodeById}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSelectNode={(id) => { setSelectedNodeId(id); setSelectedEdgeId(null); }}
            onSelectEdge={(id) => { setSelectedEdgeId(id); setSelectedNodeId(null); }}
            loading={graphLoading}
          />
        </TabsContent>

        <TabsContent value="models" className="flex flex-col flex-1 min-h-0 mt-0">
          <MentalModelsTab
            serverId={selectedServerId ? Number(selectedServerId) : null}
            bankId={selectedBankId}
            modelRefs={allModelRefs}
            isActive={activeTab === 'models'}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
