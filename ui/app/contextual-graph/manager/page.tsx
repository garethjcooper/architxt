'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { serversApi, contextualGraphApi, type GraphNode as ApiGraphNode, type GraphEdge as ApiGraphEdge } from '@/lib/api/client';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SyncJobsTab } from './sync-jobs-tab';

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
  properties: Record<string, any>;
};

type ModelRef = {
  role?: string;
  ext_id?: string;
  attached_at?: string;
  fetched_at?: string;
  content_hash?: string;
  last_refresh_status?: 'ok' | 'error' | 'skipped' | string;
  last_refresh_at?: string;
  last_refresh_error?: string;
};

type DisplayNode = {
  id: string;
  type: string;
  label: string;
  labels: string[];
  properties: Record<string, any>;
  modelRefs: ModelRef[];
};

type DisplayEdge = {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
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
    label: edge.properties.label,
    detail: edge.properties.detail,
    properties: edge.properties,
    modelRefs: edge.properties.provenance?.model_refs || [],
  };
}

function getLastRefreshedAt(modelRefs: DisplayNode['modelRefs']): string | null {
  const timestamps = modelRefs
    .filter((r) => r.fetched_at)
    .map((r) => new Date(r.fetched_at!).getTime())
    .filter((t) => !isNaN(t));
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : null;
}

function getRefreshState(modelRefs: ModelRef[]): { status: 'ok' | 'error' | 'none'; at: string | null; error: string | null } {
  const errorRef = modelRefs.find((r) => r.last_refresh_status === 'error');
  if (errorRef) {
    return { status: 'error', at: errorRef.last_refresh_at || null, error: errorRef.last_refresh_error || null };
  }
  const okTimestamps = modelRefs
    .filter((r) => r.last_refresh_status === 'ok' && r.last_refresh_at)
    .map((r) => new Date(r.last_refresh_at!).getTime())
    .filter((t) => !isNaN(t));
  return okTimestamps.length > 0
    ? { status: 'ok', at: new Date(Math.max(...okTimestamps)).toISOString(), error: null }
    : { status: 'none', at: null, error: null };
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
  const [servers, setServers] = useState<Array<{ id: number; name?: string; base_url?: string }>>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [nodes, setNodes] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  useEffect(() => {
    async function loadServers() {
      try {
        setLoadingServers(true);
        const data = await serversApi.list();
        setServers(data.map((s) => ({ id: s.id, name: s.name || s.base_url })));
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

  useEffect(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    if (serverId && bankId) {
      loadGraph();
    } else {
      setNodes([]);
      setEdges([]);
    }
  }, [serverId, bankId, loadGraph]);

  const handleImportGraph = useCallback(async () => {
    if (!serverId || !bankId) return;
    if (!window.confirm(`Import Hindsight skeleton into ${bankId}? This will add nodes and edges to the working graph.`)) return;
    try {
      setActionLoading('import');
      const result = await contextualGraphApi.import(serverId, bankId);
      if (result.success) {
        toast.success(`Imported ${result.imported?.nodes ?? 0} nodes, ${result.imported?.edges ?? 0} edges`);
      } else {
        toast.error(`Import failed: ${result.error || result.code || 'unknown'}`);
      }
      await loadGraph();
    } catch (err: any) {
      logger.error('Failed to import contextual graph', { error: err, serverId, bankId });
      toast.error(`Import failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId, loadGraph]);

  const handleRefreshPatches = useCallback(async () => {
    if (!serverId || !bankId) return;
    const message = `Refresh contextual patches for ${bankId}? This will sync mental-model config, request fresh Hindsight output for any changed models, and apply any changed outputs.`;
    if (!window.confirm(message)) return;
    try {
      setActionLoading('refresh');
      const result = await contextualGraphApi.refresh(serverId, bankId);
      if (result.success) {
        const stats = result.stats;
        const syncUpdated = stats?.sync?.updated ?? 0;
        const rerunRequested = stats?.rerunRequested ?? 0;
        const base = `Refresh complete — fetched ${stats?.fetched ?? 0}, applied ${stats?.applied ?? 0}, unchanged ${stats?.skippedUnchanged ?? 0}, failed ${stats?.failed ?? 0}`;
        const syncPart = syncUpdated > 0 ? `synced ${syncUpdated}` : '';
        const rerunPart = rerunRequested > 0 ? `re-runs requested ${rerunRequested}` : '';
        const parts = [syncPart, rerunPart].filter(Boolean);
        toast.success(parts.length > 0 ? `${base} (${parts.join(', ')})` : base);
      } else {
        toast.error(`Refresh failed: ${result.error || result.code || 'unknown'}`);
      }
      await loadGraph();
    } catch (err: any) {
      logger.error('Refresh failed', { error: err, serverId, bankId });
      toast.error(`Refresh failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId, loadGraph]);

  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => a.label.localeCompare(b.label));
  }, [nodes]);

  const sortedEdges = useMemo(() => {
    return [...edges].sort((a, b) => {
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

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) ?? null : null;
  const selectedItem: (DisplayNode | DisplayEdge) | null = selectedNode || selectedEdge;

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
                const status = ref.last_refresh_status || (ref.fetched_at ? 'ok' : 'none');
                const statusColor =
                  status === 'error' ? 'text-red-400' :
                  status === 'skipped' ? 'text-amber-400' :
                  status === 'ok' ? 'text-emerald-400' : 'text-white/50';
                const statusIcon =
                  status === 'error' ? '✗' :
                  status === 'skipped' ? '⊘' :
                  status === 'ok' ? '✓' : '−';
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
                      <span className={cn('font-medium', statusColor)}>
                        {statusIcon} refresh {status}{ref.last_refresh_at ? ` ${formatRelative(ref.last_refresh_at)}` : ''}
                      </span>
                      {ref.last_refresh_error && (
                        <span className="text-red-300/80 line-clamp-2" title={ref.last_refresh_error}>{ref.last_refresh_error}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Refresh status">
          {(() => {
            const { status, at, error } = getRefreshState(modelRefs);
            return (
              <div className="text-[11px] space-y-1">
                <div className={cn('font-medium', status === 'error' ? 'text-red-400' : status === 'ok' ? 'text-emerald-400' : 'text-white/50')}>
                  {status === 'error' ? '⚠ last refresh failed' : status === 'ok' ? '✓ last refresh ok' : '− no refresh recorded'}
                </div>
                {at && <div className="text-white/50">{formatRelative(at)}</div>}
                {error && <div className="text-red-300/80 line-clamp-3" title={error}>{error}</div>}
              </div>
            );
          })()}
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
      subtitle="Manage contextual graph data and sync jobs."
      count={nodes.length}
      countLabel="node"
      loading={graphLoading}
    >
      <Tabs defaultValue="graph" className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 shrink-0">
          <TabsList variant="line">
            <TabsTrigger value="graph">Graph</TabsTrigger>
            <TabsTrigger value="jobs">Sync Jobs</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!serverId || !bankId || actionLoading === 'import'}
              onClick={handleImportGraph}
            >
              {actionLoading === 'import' ? 'Importing…' : 'Import skeleton'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!serverId || !bankId || actionLoading === 'refresh'}
              onClick={handleRefreshPatches}
            >
              {actionLoading === 'refresh' ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </div>

        <TabsContent value="graph" className="flex flex-col flex-1 min-h-0 mt-0">
          <div className="flex items-center gap-3 border-b border-white/10 pb-2 shrink-0 mt-2">
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

          <div className="flex-1 min-h-0 flex mt-2 gap-2">
            <div className="min-w-0 flex flex-col gap-1" style={{ flex: 1 }}>
              <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col" style={{ flex: 1.5 }}>
                <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm">Entities</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono">
                    {sortedNodes.length}
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                  {graphLoading ? (
                    <div className="p-3 space-y-2">
                      <Skeleton className="h-10 w-full bg-white/10" />
                      <Skeleton className="h-10 w-full bg-white/10" />
                      <Skeleton className="h-10 w-full bg-white/10" />
                    </div>
                  ) : sortedNodes.length === 0 ? (
                    <div className="text-[11px] text-white/40 px-2 py-3">No entities loaded.</div>
                  ) : (
                    sortedNodes.map((node) => {
                      const active = selectedNodeId === node.id;
                      const typeLine = node.type && !node.id.startsWith(`${node.type}:`) ? `${node.type}:${node.id}` : node.id;
                      const lastRefreshed = getLastRefreshedAt(node.modelRefs);
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => { setSelectedNodeId(node.id); setSelectedEdgeId(null); }}
                          className={cn(
                            'w-full flex flex-col gap-1 rounded border bg-black/10 px-2 py-1.5 text-left transition-colors',
                            active ? 'border-emerald-500/50 bg-emerald-900/30' : 'border-white/5 hover:bg-white/5'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <div className="text-xs text-white/90 truncate">{node.label}</div>
                              <div className="text-[10px] text-white/40 truncate">{typeLine}</div>
                            </div>
                            <span className="text-[10px] text-white/30 shrink-0">{formatRelative(lastRefreshed)}</span>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {node.modelRefs.map((ref, i) => (
                              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-white/50">
                                {ROLE_LABELS[ref.role || ''] || ref.role}
                              </Badge>
                            ))}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col mt-1" style={{ flex: 1 }}>
                <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm">Edges</span>
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono">
                    {sortedEdges.length}
                  </span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                  {sortedEdges.length === 0 && (
                    <div className="text-[11px] text-white/40 px-2 py-3">No edges loaded.</div>
                  )}
                  {sortedEdges.map((edge) => {
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
                          'w-full text-left rounded border px-2 py-1.5 transition-colors',
                          active ? 'bg-emerald-900/30 border-emerald-500/50' : 'bg-black/10 border-white/5 hover:bg-white/5'
                        )}
                      >
                        <div className="text-xs text-white/90 truncate">{edge.detail || edge.label || edge.type || 'Edge'}</div>
                        <div className="text-[10px] text-white/40 truncate">
                          {source?.label || edge.source_id} → {target?.label || edge.target_id}
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            {edge.modelRefs.map((ref, i) => (
                              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-white/50">
                                {ROLE_LABELS[ref.role || ''] || ref.role}
                              </Badge>
                            ))}
                          </div>
                          <span className="text-[10px] text-white/30 shrink-0">{formatRelative(lastRefreshed)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <Card className="min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0" style={{ flex: 1.4 }}>
              {renderDetailPanel()}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="flex flex-col flex-1 min-h-0 mt-0">
          <SyncJobsTab
            servers={servers}
            banks={banks}
            loadingServers={loadingServers}
            loadingBanks={loadingBanks}
            selectedServerId={selectedServerId || ''}
            setSelectedServerId={setSelectedServerId}
            selectedBankId={selectedBankId || ''}
            setSelectedBankId={setSelectedBankId}
          />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
