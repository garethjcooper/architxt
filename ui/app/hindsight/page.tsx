'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { serversApi, hindsightApi } from '@/lib/api/client';
import {
  AlertCircle,
  ArrowRightLeft,
  Server,
  Database,
  RefreshCw,
  Download,
  Upload,
  GitCompare,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { BatchProgressDialog, type BatchItem } from '@/components/batch-progress-dialog';
import CompareModal from './compare-modal';
import EntityCompareModal from './entity-compare-modal';
import SyncRow from './sync-row';
import EntitySyncRow from './entity-sync-row';

const logger = createLogger('HindsightPage');


interface DiffResult {
  same: { ext_id: string; arch: any; hindsight: any; divergence?: any }[];
  different: { ext_id: string; arch: any; hindsight: any; divergence?: any }[];
  only_architxt: { ext_id: string; arch: any }[];
  only_hindsight: { ext_id: string; hindsight: any }[];
}

interface Counts {
  same: number;
  different: number;
  only_architxt: number;
  only_hindsight: number;
  total: number;
}

type Col2Filter = 'out_of_sync' | 'in_sync' | 'all';

// ═══════════════════════════════════════════════════════════════════
// ColumnCard — MUST be defined at module level (not inside HindsightPage)
// so that React maintains a stable component identity across renders.
// If defined inside the parent, selecting a checkbox (which updates selectedIds)
// would cause ColumnCard to unmount/remount, resetting scroll position.
// ═══════════════════════════════════════════════════════════════════
interface ColumnCardProps {
  title: string;
  icon: React.ReactNode;
  count: number;
  colorClass: string;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
  extIds: string[];
  showSelectAll?: boolean;
  selectedIds: Set<string>;
  onSelectAll: (extIds: string[], checked: boolean) => void;
}

function ColumnCard({
  title,
  icon,
  count,
  colorClass,
  headerExtra,
  children,
  extIds,
  showSelectAll = true,
  selectedIds,
  onSelectAll,
}: ColumnCardProps) {
  const allSelected = extIds.length > 0 && extIds.every((id) => selectedIds.has(id));
  const selectedCount = extIds.filter((id) => selectedIds.has(id)).length;

  return (
    <div className="rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col h-full">
      {/* Header */}
      <div className={`px-3 py-2 border-b border-white/10 ${colorClass}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-medium text-sm">{title}</span>
            {headerExtra && <div className="ml-1">{headerExtra}</div>}
          </div>
          <span className="text-xs font-mono bg-black/30 px-2 py-0.5 rounded">{count} ({selectedCount})</span>
        </div>
      </div>

      {/* Select-all bar */}
      {showSelectAll && (
        <div className="px-3 py-1.5 border-b border-white/5 flex items-center gap-2 bg-white/[0.02]">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => onSelectAll(extIds, checked === true)}
          />
          <span className="text-[10px] text-white/40">{allSelected ? 'Deselect all' : 'Select all'}</span>
        </div>
      )}

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

export default function HindsightPage() {
  const [servers, setServers] = useState<any[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [banks, setBanks] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [selectedObject, setSelectedObject] = useState<'documents' | 'entities'>('documents');
  const [loadingServers, setLoadingServers] = useState(true);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingOps, setPendingOps] = useState<any[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [col2Filter, setCol2Filter] = useState<Col2Filter>('all');
  const [searchCol1, setSearchCol1] = useState('');
  const [searchCol2, setSearchCol2] = useState('');
  const [searchCol3, setSearchCol3] = useState('');

  const [compareId, setCompareId] = useState<string | null>(null);
  const [entityCompareId, setEntityCompareId] = useState<string | null>(null);

  // ── Batch progress dialog state ────────────────────────────────────
  const [batchProgressOpen, setBatchProgressOpen] = useState(false);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchDescription, setBatchDescription] = useState('');
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchOperation, setBatchOperation] = useState<(item: BatchItem) => Promise<void>>(() => async () => {});
  const [batchOnComplete, setBatchOnComplete] = useState<(() => void) | null>(null);

  // Clear selections when the On Both filter badge changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [col2Filter]);

  // Poll pending operations every 5 seconds when a server+bank is selected
  useEffect(() => {
    if (!selectedServerId || !selectedBankId) {
      setPendingOps([]);
      return;
    }
    fetchPendingOps();
    const id = setInterval(fetchPendingOps, 5000);
    return () => clearInterval(id);
  }, [selectedServerId, selectedBankId]);

  // Auto-refresh diff when all pending operations clear
  const hadPendingOps = useRef(false);
  useEffect(() => {
    const hasPending = pendingOps.length > 0;
    if (hasPending) {
      hadPendingOps.current = true;
    } else if (hadPendingOps.current) {
      // We previously had pending ops and now have none — refresh the diff
      hadPendingOps.current = false;
      fetchDiff();
    }
  }, [pendingOps]);

  // Fetch servers on mount
  useEffect(() => {
    fetchServers();
  }, []);

  // Fetch banks when server changes
  useEffect(() => {
    if (!selectedServerId) {
      setBanks([]);
      setSelectedBankId('');
      return;
    }
    fetchBanks(parseInt(selectedServerId, 10));
  }, [selectedServerId]);

  const fetchServers = async () => {
    setLoadingServers(true);
    try {
      const data = await serversApi.list();
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to fetch servers', err);
      toast.error('Failed to load servers');
    } finally {
      setLoadingServers(false);
    }
  };

  const fetchBanks = async (serverId: number) => {
    setLoadingBanks(true);
    setBanks([]);
    setSelectedBankId('');
    try {
      const data = await serversApi.listBanks(serverId);
      setBanks(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to fetch banks', err);
      toast.error('Failed to load banks from server');
    } finally {
      setLoadingBanks(false);
    }
  };

  const fetchDiff = async () => {
    if (!selectedServerId || !selectedBankId) {
      toast.error('Select a server and bank first');
      return;
    }

    setLoadingDiff(true);
    setError(null);
    setDiffResult(null);
    setSelectedIds(new Set());

    try {
      const data = await hindsightApi.diff(parseInt(selectedServerId, 10), selectedBankId, selectedObject);
      setDiffResult(data.data);
      setCounts(data.counts);
      // fetch pending ops once diff returns (keeps the auto-refresh state machine intact)
      await fetchPendingOps();
    } catch (err: any) {
      logger.error('Hindsight diff failed', err);
      setError(err.message);
      toast.error(`Diff failed: ${err.message}`);
    } finally {
      setLoadingDiff(false);
    }
  };

  const fetchPendingOps = async () => {
    if (!selectedServerId || !selectedBankId) return;
    try {
      const res = await hindsightApi.listOperations(parseInt(selectedServerId, 10), selectedBankId);
      setPendingOps(res.operations || []);
    } catch (err) {
      logger.error('Failed to fetch pending ops', err);
    }
  };

  const getPendingStatus = (extId: string) => {
    const op = pendingOps.find((op) => op.pop_ext_id === extId);
    return op ? op.pop_status : null;
  };

  // ── Selection helpers ───────────────────────────────────────────────

  const isSelected = (extId: string) => selectedIds.has(extId);

  const toggleSelection = useCallback((extId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(extId);
      else next.delete(extId);
      return next;
    });
  }, []);

  const selectAll = useCallback((extIds: string[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of extIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  // ── Push / Pull single (documents) ────────────────────────────────
  // These are thin wrappers around the API — they THROW on error so
  // the batch dialog can catch and display them. Callers (e.g. single-row
  // actions) should add their own try/catch if they want toast handling.

  const pushOne = async (extId: string, docId: number) => {
    if (!selectedServerId || !selectedBankId) {
      throw new Error('Select a server and bank first');
    }
    if (!docId) {
      throw new Error(`Document ${extId} has no architxt ID`);
    }
    await hindsightApi.push(parseInt(selectedServerId, 10), selectedBankId, docId);
  };

  const pullOne = async (extId: string) => {
    if (!selectedServerId || !selectedBankId) {
      throw new Error('Select a server and bank first');
    }
    await hindsightApi.pull(parseInt(selectedServerId, 10), selectedBankId, extId);
  };

  // ── Entity Push / Pull by type ────────────────────────────────────

  const extractTypeNames = (extIds: string[]) => [...new Set(extIds.map((id) => id.split(':')[0]))];

  const handlePushEntityTypes = async (extIds: string[]) => {
    if (!selectedServerId || !selectedBankId) return;
    const typeNames = extractTypeNames(extIds);
    try {
      await hindsightApi.pushEntities(parseInt(selectedServerId, 10), selectedBankId, typeNames);
      toast.success(`Pushed ${typeNames.length} type(s) to Hindsight`);
      await fetchDiff();
    } catch (err: any) {
      logger.error('Entity push failed', err);
      toast.error(`Entity push failed: ${err.message}`);
    }
  };

  const handlePullEntityTypes = async (extIds: string[]) => {
    if (!selectedServerId || !selectedBankId) return;
    const typeNames = extractTypeNames(extIds);
    try {
      const result = await hindsightApi.pullEntities(parseInt(selectedServerId, 10), selectedBankId, typeNames);
      const parts = [
        result.createdEntities ? `${result.createdEntities} created` : null,
        result.updatedEntities ? `${result.updatedEntities} updated` : null,
        result.deletedEntities ? `${result.deletedEntities} removed` : null,
      ].filter(Boolean);
      toast.success(parts.length > 0 ? `Pulled: ${parts.join(', ')}` : 'Already in sync');
      await fetchDiff();
    } catch (err: any) {
      logger.error('Entity pull failed', err);
      toast.error(`Entity pull failed: ${err.message}`);
    }
  };

  // ── Batch actions (dispatch by object mode) ───────────────────────

  const handlePushSelected = (extIds: string[]) => {
    if (isEntityMode) {
      handlePushEntityTypes(extIds);
      return;
    }
    const archIdMap = new Map(
      (diffResult?.only_architxt || [])
        .filter((d) => extIds.includes(d.ext_id))
        .map((d) => [d.ext_id, d.arch?.id])
    );
    setBatchTitle('Pushing Documents');
    setBatchDescription(`${extIds.length} document${extIds.length !== 1 ? 's' : ''}`);
    setBatchItems(extIds.map((id) => ({ id, label: id })));
    setBatchOperation(() => async (item: BatchItem) => {
      const archId = archIdMap.get(String(item.id));
      await pushOne(String(item.id), archId);
    });
    setBatchOnComplete(() => () => fetchDiff());
    setBatchProgressOpen(true);
  };

  const handlePullSelected = (extIds: string[]) => {
    if (isEntityMode) {
      handlePullEntityTypes(extIds);
      return;
    }
    setBatchTitle('Pulling Documents');
    setBatchDescription(`${extIds.length} document${extIds.length !== 1 ? 's' : ''}`);
    setBatchItems(extIds.map((id) => ({ id, label: id })));
    setBatchOperation(() => async (item: BatchItem) => {
      await pullOne(String(item.id));
    });
    setBatchOnComplete(() => () => fetchDiff());
    setBatchProgressOpen(true);
  };

  const handleMakeLikeArchitxt = (extIds: string[]) => {
    if (isEntityMode) {
      handlePushEntityTypes(extIds);
      return;
    }
    const items = onBoth.filter((d) => extIds.includes(d.ext_id) && d.syncStatus === 'out_of_sync');
    const archIdMap = new Map(items.map((d) => [d.ext_id, d.arch?.id]));
    setBatchTitle('Pushing to Server');
    setBatchDescription(`${items.length} document${items.length !== 1 ? 's' : ''}`);
    setBatchItems(items.map((item) => ({ id: item.ext_id, label: item.ext_id })));
    setBatchOperation(() => async (item: BatchItem) => {
      const archId = archIdMap.get(String(item.id));
      await pushOne(String(item.id), archId);
    });
    setBatchOnComplete(() => () => fetchDiff());
    setBatchProgressOpen(true);
  };

  const handleMakeLikeBank = (extIds: string[]) => {
    if (isEntityMode) {
      handlePullEntityTypes(extIds);
      return;
    }
    const items = onBoth.filter((d) => extIds.includes(d.ext_id) && d.syncStatus === 'out_of_sync');
    setBatchTitle('Pulling from Server');
    setBatchDescription(`${items.length} document${items.length !== 1 ? 's' : ''}`);
    setBatchItems(items.map((item) => ({ id: item.ext_id, label: item.ext_id })));
    setBatchOperation(() => async (item: BatchItem) => {
      await pullOne(String(item.id));
    });
    setBatchOnComplete(() => () => fetchDiff());
    setBatchProgressOpen(true);
  };

  // ── Object-aware rendering helpers ─────────────────────────────────

  const isEntityMode = selectedObject === 'entities';

  const emptyCol1Text = isEntityMode
    ? 'All architxt entities exist on server'
    : 'All architxt documents exist on server';

  const emptyCol2Text = isEntityMode
    ? (col2Filter === 'out_of_sync' ? 'No out-of-sync entities' : col2Filter === 'in_sync' ? 'No in-sync entities' : 'No shared entities')
    : (col2Filter === 'out_of_sync' ? 'No out-of-sync documents' : col2Filter === 'in_sync' ? 'No in-sync documents' : 'No shared documents');

  const emptyCol3Text = isEntityMode
    ? 'All server entities exist on architxt'
    : 'All server documents exist on architxt';

  const col1 = diffResult?.only_architxt || [];
  const col3 = diffResult?.only_hindsight || [];


  // Merge same + different into onBoth with syncStatus flag
  const onBoth = [
    ...(diffResult?.same || []).map((d) => ({ ...d, syncStatus: 'in_sync' as const })),
    ...(diffResult?.different || []).map((d) => ({ ...d, syncStatus: 'out_of_sync' as const })),
  ];

  const col2 = onBoth.filter((d) => {
    if (col2Filter === 'all') return true;
    return d.syncStatus === col2Filter;
  });

  const filterBySearch = (items: any[], query: string) => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((item) => {
      const haystack = [
        item.ext_id,
        item.arch?.filename,
        item.arch?.title,
        item.hindsight?.title,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  };

  // Merge search results with selected-but-hidden rows so the user
  // always sees what will be affected by an action.
  // Pure filtered = search matches only (for the header count).
  // Merged = search matches + selected rows that don't match (appended at bottom).
  const mergeFiltered = (items: any[], query: string) => {
    const filtered = filterBySearch(items, query);
    if (!query.trim()) return { pureFiltered: filtered, merged: filtered };
    const visibleIds = new Set(filtered.map((d) => d.ext_id));
    const selectedHidden = items.filter((d) => selectedIds.has(d.ext_id) && !visibleIds.has(d.ext_id));
    return { pureFiltered: filtered, merged: [...filtered, ...selectedHidden] };
  };

  const col1Filtered = mergeFiltered(col1, searchCol1);
  const col2Filtered = mergeFiltered(col2, searchCol2);
  const col3Filtered = mergeFiltered(col3, searchCol3);

  const filteredCol1 = col1Filtered.merged;
  const filteredCol2 = col2Filtered.merged;
  const filteredCol3 = col3Filtered.merged;

  return (
    <PageShell
      title="Hindsight"
      subtitle={isEntityMode
        ? "Compare and synchronise entity labels with a remote Hindsight server."
        : "Compare and synchronise documents with a remote Hindsight server."}
      loading={loadingServers}
    >
      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-white/40" />
          <select
            value={selectedServerId}
            onChange={(e) => setSelectedServerId(e.target.value)}
            className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
          >
            <option value="">Select server...</option>
            {servers.map((s, idx) => (
              <option key={s.id ?? `server-${idx}`} value={s.id}>{s.name || s.base_url}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-white/40" />
          <select
            value={selectedBankId}
            onChange={(e) => setSelectedBankId(e.target.value)}
            disabled={!selectedServerId || loadingBanks || banks.length === 0}
            className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:opacity-50"
          >
            <option value="">{loadingBanks ? 'Loading...' : banks.length === 0 ? 'No banks' : 'Select bank...'}</option>
            {banks.map((b, idx) => (
              <option key={b.id ?? `bank-${idx}`} value={b.id}>{b.name || b.id}</option>
            ))}
          </select>
        </div>

        {/* Object selector */}
        <div className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-white/40" />
          <select
            value={selectedObject}
            onChange={(e) => {
              setSelectedObject(e.target.value as 'documents' | 'entities');
              setDiffResult(null);
              setCounts(null);
              setSelectedIds(new Set());
            }}
            className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
          >
            <option value="documents">Documents</option>
            <option value="entities">Entities</option>
          </select>
        </div>

        <Button
          onClick={fetchDiff}
          disabled={loadingDiff || !selectedServerId || !selectedBankId}
          className="inline-flex items-center gap-2 h-8 px-3 rounded text-sm font-medium bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50 transition-colors disabled:opacity-50"
        >
          {loadingDiff ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
          {loadingDiff ? 'Fetching...' : `Fetch ${selectedObject === 'documents' ? 'Documents' : 'Entities'}`}
        </Button>

        {counts && (
          <span className="text-xs text-white/40">{counts.total} total</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded bg-red-900/20 border border-red-500/30 text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {/* Empty state */}
      {!diffResult && !loadingDiff && (
        <div className="text-center py-16 text-white/30">
          <ArrowRightLeft className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Select a server and bank, then click Fetch {selectedObject === 'documents' ? 'Documents' : 'Entities'} to start the comparison.</p>
        </div>
      )}

      {/* Loading skeletons */}
      {loadingDiff && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08]">
              <div className="px-4 py-2 border-b border-white/10"><Skeleton className="h-4 w-24" /></div>
              {Array.from({ length: 5 }).map((_, j) => (
                <div key={j} className="px-4 py-3 border-b border-white/5"><Skeleton className="h-3 w-full" /></div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* 3-Column Grid */}
      {diffResult && counts && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100vh-240px)] min-h-[300px]">
          {/* ── Column 1: Only on architxt ── */}
          <div className="flex flex-col gap-3 h-full min-h-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <Input
                  value={searchCol1}
                  onChange={(e) => setSearchCol1(e.target.value)}
                  placeholder="Search..."
                  className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
                {searchCol1 && (
                  <button
                    onClick={() => setSearchCol1('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Button
                onClick={() => {
                  const ids = filteredCol1.filter((d) => selectedIds.has(d.ext_id)).map((d) => d.ext_id);
                  if (ids.length === 0) return;
                  handlePushSelected(ids);
                }}
                disabled={!filteredCol1.some((d) => selectedIds.has(d.ext_id))}
                className="inline-flex items-center justify-center gap-2 h-8 w-36 rounded text-sm font-medium bg-blue-900/30 border border-blue-500/30 text-blue-300 hover:bg-blue-900/50 transition-colors disabled:opacity-50 shrink-0"
              >
                <Upload className="h-4 w-4" /> Push to Bank
              </Button>
            </div>
            <ColumnCard
              title="Only on architxt"
              icon={<Server className="h-4 w-4 text-blue-400" />}
              count={col1Filtered.pureFiltered.length}
              colorClass="bg-blue-900/20 text-blue-300 border-blue-500/20"
              extIds={filteredCol1.map((d) => d.ext_id)}
              selectedIds={selectedIds}
              onSelectAll={selectAll}
            >
              {filteredCol1.length === 0 ? (
                <div className="px-3 py-6 text-center text-white/30 text-xs">{emptyCol1Text}</div>
              ) : (
                isEntityMode ? (
                  filteredCol1.map((item) => (
                    <EntitySyncRow
                      key={item.ext_id}
                      ext_id={item.ext_id}
                      arch={item.arch}
                      isSelected={isSelected(item.ext_id)}
                      onSelect={(checked) => toggleSelection(item.ext_id, checked)}
                    />
                  ))
                ) : (
                  filteredCol1.map((item) => (
                    <SyncRow
                      key={item.ext_id}
                      ext_id={item.ext_id}
                      archFilename={item.arch?.filename}
                      archHash={item.arch?.content_hash}
                      archStatus={item.arch?.status}
                      isSelected={isSelected(item.ext_id)}
                      onSelect={(checked) => toggleSelection(item.ext_id, checked)}
                      pendingStatus={getPendingStatus(item.ext_id)}
                    />
                  ))
                )
              )}
            </ColumnCard>
          </div>

          {/* ── Column 2: On Both ── */}
          <div className="flex flex-col gap-3 h-full min-h-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <Input
                  value={searchCol2}
                  onChange={(e) => setSearchCol2(e.target.value)}
                  placeholder="Search..."
                  className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
                {searchCol2 && (
                  <button
                    onClick={() => setSearchCol2('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => {
                    const ids = filteredCol2.filter((d) => selectedIds.has(d.ext_id)).map((d) => d.ext_id);
                    if (ids.length === 0) return;
                    handleMakeLikeBank(ids);
                  }}
                  disabled={!filteredCol2.some((d) => selectedIds.has(d.ext_id) && d.syncStatus === 'out_of_sync')}
                  className="inline-flex items-center justify-center gap-2 h-8 w-36 rounded text-sm font-medium bg-purple-900/30 border border-purple-500/30 text-purple-300 hover:bg-purple-900/50 transition-colors disabled:opacity-50 shrink-0"
                >
                  <Download className="h-4 w-4" /> Pull from Bank
                </Button>
                <Button
                  onClick={() => {
                    const ids = filteredCol2.filter((d) => selectedIds.has(d.ext_id)).map((d) => d.ext_id);
                    if (ids.length === 0) return;
                    handleMakeLikeArchitxt(ids);
                  }}
                  disabled={!filteredCol2.some((d) => selectedIds.has(d.ext_id) && d.syncStatus === 'out_of_sync')}
                  className="inline-flex items-center justify-center gap-2 h-8 w-36 rounded text-sm font-medium bg-blue-900/30 border border-blue-500/30 text-blue-300 hover:bg-blue-900/50 transition-colors disabled:opacity-50 shrink-0"
                >
                  <Upload className="h-4 w-4" /> Push to Bank
                </Button>
              </div>
            </div>
            <ColumnCard
              title="On Both"
              icon={<ArrowRightLeft className="h-4 w-4 text-emerald-400" />}
              count={col2Filtered.pureFiltered.length}
              colorClass="bg-emerald-900/20 text-emerald-300 border-emerald-500/20"
              extIds={filteredCol2.map((d) => d.ext_id)}
              showSelectAll={col2Filter === 'out_of_sync'}
              selectedIds={selectedIds}
              onSelectAll={selectAll}
              headerExtra={
                <div className="flex items-center gap-1">
                  {(['all', 'out_of_sync', 'in_sync'] as Col2Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setCol2Filter(f)}
                      className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                        col2Filter === f
                          ? 'bg-emerald-900/40 border-emerald-500/40 text-emerald-200'
                          : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'
                      }`}
                    >
                      {f === 'out_of_sync' ? 'Out of Sync' : f === 'in_sync' ? 'In Sync' : 'All'}
                    </button>
                  ))}
                </div>
              }
            >
              {filteredCol2.length === 0 ? (
                <div className="px-3 py-6 text-center text-white/30 text-xs">
                  {emptyCol2Text}
                </div>
              ) : (
                isEntityMode ? (
                  filteredCol2.map((item) => (
                    <EntitySyncRow
                      key={item.ext_id}
                      ext_id={item.ext_id}
                      arch={item.arch}
                      hindsight={item.hindsight}
                      divergence={item.divergence}
                      isSelected={isSelected(item.ext_id)}
                      onSelect={(checked) => toggleSelection(item.ext_id, checked)}
                      showCheckbox={item.syncStatus === 'out_of_sync'}
                      showCompare={item.syncStatus === 'out_of_sync'}
                      onCompare={() => setEntityCompareId(item.ext_id)}
                    />
                  ))
                ) : (
                  filteredCol2.map((item) => (
                    <SyncRow
                      key={item.ext_id}
                      ext_id={item.ext_id}
                      archFilename={item.arch?.filename}
                      hindTitle={item.hindsight?.title}
                      archHash={item.arch?.content_hash}
                      hindHash={item.hindsight?.content_hash}
                      archStatus={item.arch?.status}
                      divergence={item.divergence}
                      isSelected={isSelected(item.ext_id)}
                      onSelect={(checked) => toggleSelection(item.ext_id, checked)}
                      showCheckbox={item.syncStatus === 'out_of_sync'}
                      showCompare={item.syncStatus === 'out_of_sync'}
                      onCompare={() => setCompareId(item.ext_id)}
                      pendingStatus={getPendingStatus(item.ext_id)}
                    />
                  ))
                )
              )}
            </ColumnCard>
          </div>

          {/* ── Column 3: Only on Server ── */}
          <div className="flex flex-col gap-3 h-full min-h-0">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <Input
                  value={searchCol3}
                  onChange={(e) => setSearchCol3(e.target.value)}
                  placeholder="Search..."
                  className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
                {searchCol3 && (
                  <button
                    onClick={() => setSearchCol3('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Button
                onClick={() => {
                  const ids = filteredCol3.filter((d) => selectedIds.has(d.ext_id)).map((d) => d.ext_id);
                  if (ids.length === 0) return;
                  handlePullSelected(ids);
                }}
                disabled={!filteredCol3.some((d) => selectedIds.has(d.ext_id))}
                className="inline-flex items-center justify-center gap-2 h-8 w-36 rounded text-sm font-medium bg-purple-900/30 border border-purple-500/30 text-purple-300 hover:bg-purple-900/50 transition-colors disabled:opacity-50 shrink-0"
              >
                <Download className="h-4 w-4" /> Pull from Bank
              </Button>
            </div>
            <ColumnCard
              title="Only on Bank"
              icon={<Database className="h-4 w-4 text-purple-400" />}
              count={col3Filtered.pureFiltered.length}
              colorClass="bg-purple-900/20 text-purple-300 border-purple-500/20"
              extIds={filteredCol3.map((d) => d.ext_id)}
              selectedIds={selectedIds}
              onSelectAll={selectAll}
            >
              {filteredCol3.length === 0 ? (
                <div className="px-3 py-6 text-center text-white/30 text-xs">{emptyCol3Text}</div>
              ) : (
                isEntityMode ? (
                  filteredCol3.map((item) => (
                    <EntitySyncRow
                      key={item.ext_id}
                      ext_id={item.ext_id}
                      hindsight={item.hindsight}
                      isSelected={isSelected(item.ext_id)}
                      onSelect={(checked) => toggleSelection(item.ext_id, checked)}
                    />
                  ))
                ) : (
                  filteredCol3.map((item) => (
                    <SyncRow
                      key={item.ext_id}
                      ext_id={item.ext_id}
                      hindTitle={item.hindsight?.title}
                      hindHash={item.hindsight?.content_hash}
                      isSelected={isSelected(item.ext_id)}
                      onSelect={(checked) => toggleSelection(item.ext_id, checked)}
                      pendingStatus={getPendingStatus(item.ext_id)}
                    />
                  ))
                )
              )}
            </ColumnCard>
          </div>
        </div>
      )}

      {/* Compare Modal */}
      <CompareModal
        isOpen={!!compareId}
        onClose={() => setCompareId(null)}
        serverId={parseInt(selectedServerId, 10)}
        bankId={selectedBankId}
        documentId={compareId || ''}
      />

      {/* Entity Compare Modal */}
      {(() => {
        const item = diffResult?.different?.find((d: any) => d.ext_id === entityCompareId);
        return (
          <EntityCompareModal
            isOpen={!!entityCompareId}
            onClose={() => setEntityCompareId(null)}
            ext_id={entityCompareId || ''}
            arch_count={item?.arch?.count}
            hind_count={item?.hindsight?.count}
            divergence={item?.divergence}
          />
        );
      })()}

      <BatchProgressDialog
        open={batchProgressOpen}
        onClose={() => {
          setBatchProgressOpen(false);
          setBatchItems([]);
          batchOnComplete?.();
        }}
        title={batchTitle}
        description={batchDescription}
        items={batchItems}
        operation={batchOperation}
      />
    </PageShell>
  );
}
