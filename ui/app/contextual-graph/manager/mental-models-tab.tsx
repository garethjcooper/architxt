'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Eye, RefreshCw, Search, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { mentalModelsApi, hindsightApi } from '@/lib/api/client';
import type { ModelRef } from './page';

const ROLE_LABELS: Record<string, string> = {
  sys_entity_summary: 'summary',
  sys_entity_capabilities: 'capabilities',
  sys_edge_context: 'edge context',
  sys_discovery_context: 'discovery',
};

const isTerminalStatus = (s: string) => ['completed', 'failed', 'acknowledged', 'cancelled', 'canceled'].includes(s);

type PendingOp = {
  pop_id: number;
  pop_operation_id: string;
  pop_ext_id: string | null;
  pop_action: string;
  pop_status: string;
  pop_error_message: string | null;
  pop_updated_at: string;
};

type HealthResult = {
  ext_id: string;
  healthy: boolean;
  found?: boolean;
  content?: string | object | null;
  content_length?: number;
  error?: string;
};

export interface MentalModelsTabProps {
  serverId: number | null;
  bankId: string | null;
  modelRefs: ModelRef[];
}

export function MentalModelsTab({ serverId, bankId, modelRefs }: MentalModelsTabProps) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<Record<string, HealthResult>>({});
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [pendingOps, setPendingOps] = useState<PendingOp[]>([]);
  const [viewing, setViewing] = useState<{ extId: string; title: string } | null>(null);
  const activeRefreshIdsRef = useRef<Set<string>>(new Set());

  const refs = useMemo(() => {
    const seen = new Set<string>();
    const out: ModelRef[] = [];
    for (const ref of modelRefs) {
      const id = ref.ext_id || ref.role || '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(ref);
    }
    return out;
  }, [modelRefs]);

  const filteredRefs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return refs;
    return refs.filter((r) => {
      const id = (r.ext_id || '').toLowerCase();
      const role = (r.role || '').toLowerCase();
      return id.includes(q) || role.includes(q);
    });
  }, [refs, search]);

  const fetchPendingOps = useCallback(async () => {
    if (!serverId || !bankId) {
      setPendingOps([]);
      return;
    }
    try {
      const res = await hindsightApi.listOperations(serverId, bankId, true);
      setPendingOps(res.operations || []);
    } catch {
      // silent
    }
  }, [serverId, bankId]);

  useEffect(() => {
    if (!serverId || !bankId) {
      setPendingOps([]);
      return;
    }
    fetchPendingOps();
    const id = setInterval(fetchPendingOps, 5000);
    return () => clearInterval(id);
  }, [serverId, bankId, fetchPendingOps]);

  const runHealthCheck = useCallback(async (extIds: string[], opts: { silent?: boolean } = {}) => {
    if (!serverId || !bankId || extIds.length === 0) return;
    try {
      setLoading(!opts.silent);
      const response = await mentalModelsApi.healthCheck({
        server_id: serverId,
        bank_id: bankId,
        models: extIds.map((ext_id) => ({ ext_id })),
      });
      const results = response.results || [];
      setHealth((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.ext_id] = r;
        return next;
      });
      return results;
    } catch (err) {
      if (!opts.silent) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Health check failed: ${message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [serverId, bankId]);

  // When pending refresh operations complete, re-check those models.
  useEffect(() => {
    if (!serverId || !bankId) return;

    const nextActive = new Set(
      pendingOps
        .filter((op) => op.pop_action === 'refresh' && !isTerminalStatus(op.pop_status))
        .map((op) => op.pop_operation_id),
    );

    const justCompleted = pendingOps.filter(
      (op) =>
        op.pop_action === 'refresh' &&
        op.pop_status === 'completed' &&
        activeRefreshIdsRef.current.has(op.pop_operation_id),
    );

    activeRefreshIdsRef.current = nextActive;
    if (justCompleted.length === 0) return;

    const targets = justCompleted
      .map((op) => op.pop_ext_id)
      .filter((extId): extId is string => Boolean(extId));
    if (targets.length === 0) return;

    runHealthCheck(targets, { silent: true });
  }, [pendingOps, serverId, bankId, runHealthCheck]);

  const handleView = useCallback(async (ref: ModelRef) => {
    const extId = ref.ext_id || '';
    if (!extId || !serverId || !bankId) return;
    setLoading(true);
    try {
      await runHealthCheck([extId], { silent: true });
      setViewing({ extId, title: ROLE_LABELS[ref.role || ''] || ref.role || extId });
    } finally {
      setLoading(false);
    }
  }, [serverId, bankId, runHealthCheck]);

  const handleRefresh = useCallback(async (ref: ModelRef) => {
    const extId = ref.ext_id || '';
    if (!extId || !serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    setRefreshingIds((prev) => new Set(prev).add(extId));
    try {
      await mentalModelsApi.refresh({ server_id: serverId, bank_id: bankId, ext_id: extId });
      toast.success(`Refresh queued for ${extId}`);
      await fetchPendingOps();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Refresh failed: ${message}`);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(extId);
        return next;
      });
    }
  }, [serverId, bankId, fetchPendingOps]);

  const handleRefreshAll = useCallback(async () => {
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    const eligible = filteredRefs.filter((r) => r.ext_id).map((r) => r.ext_id!);
    if (eligible.length === 0) return;

    setRefreshingIds((prev) => {
      const next = new Set(prev);
      for (const id of eligible) next.add(id);
      return next;
    });

    const results = await Promise.all(
      eligible.map(async (extId) => {
        try {
          await mentalModelsApi.refresh({ server_id: serverId, bank_id: bankId, ext_id: extId });
          return { extId, success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { extId, success: false, message };
        }
      }),
    );

    setRefreshingIds((prev) => {
      const next = new Set(prev);
      for (const id of eligible) next.delete(id);
      return next;
    });

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      toast.success(`Refresh queued for ${succeeded.length} model${succeeded.length === 1 ? '' : 's'}`);
    } else {
      toast.error(`${failed.length} refresh${failed.length === 1 ? '' : 'es'} failed`, {
        description: failed.map((f) => `${f.extId}: ${f.message}`).join('\n'),
      });
    }
    await fetchPendingOps();
  }, [serverId, bankId, filteredRefs, fetchPendingOps]);

  const getOperationForRow = (extId?: string) => {
    if (!extId) return null;
    return pendingOps
      .filter((op) => op.pop_ext_id === extId && op.pop_action === 'refresh' && !isTerminalStatus(op.pop_status))
      .sort((a, b) => new Date(b.pop_updated_at).getTime() - new Date(a.pop_updated_at).getTime())[0];
  };

  const formatPreview = (result: HealthResult | null): string => {
    if (!result) return '';
    if (result.error) {
      let out = `Error:\n${result.error}`;
      if (result.content != null) {
        const contentText = typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
        out += `\n\nReturned content:\n${contentText}`;
      }
      return out;
    }
    if (result.content != null) {
      return typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
    }
    return 'No content available';
  };

  const viewedResult = viewing ? health[viewing.extId] || null : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
            <Input
              type="search"
              placeholder="Search by ext id or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 pr-2 bg-black/20 border-white/10 text-white/80 placeholder:text-white/40 text-xs"
            />
          </div>
          <span className="text-xs text-white/50">{refs.length} model ref{refs.length === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!serverId || !bankId || refreshingIds.size > 0 || filteredRefs.length === 0}
            onClick={handleRefreshAll}
          >
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', refreshingIds.size > 0 && 'animate-spin')} />
            Refresh all
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!serverId || !bankId || loading}
            onClick={() => runHealthCheck(filteredRefs.map((r) => r.ext_id).filter(Boolean) as string[])}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ActivityIcon className="h-3.5 w-3.5 mr-1.5" />}
            Check health
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto mt-2">
        <Table className="w-full caption-bottom text-sm">
          <TableHeader>
            <TableRow className="border-b border-white/10 hover:bg-transparent">
              <TableHead className="w-[18%] text-xs uppercase text-white/60 font-medium py-2 px-3">Role</TableHead>
              <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-3">External ID</TableHead>
              <TableHead className="w-32 text-xs uppercase text-white/60 font-medium py-2 px-3">Fetched</TableHead>
              <TableHead className="w-32 text-xs uppercase text-white/60 font-medium py-2 px-3">Refresh state</TableHead>
              <TableHead className="w-36 text-xs uppercase text-white/60 font-medium py-2 px-3">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && filteredRefs.length === 0 ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-b border-white/5">
                  <TableCell className="py-2 px-3"><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="py-2 px-3"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell className="py-2 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="py-2 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="py-2 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))
            ) : filteredRefs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-xs text-white/50">
                  {search.trim() ? 'No model refs match your search.' : 'No mental-model refs attached to this bank.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredRefs.map((ref) => {
                const extId = ref.ext_id || '';
                const roleLabel = ROLE_LABELS[ref.role || ''] || ref.role || 'model';
                const op = getOperationForRow(extId);
                const result = extId ? health[extId] : null;
                const isRefreshing = Boolean(op) || refreshingIds.has(extId);
                return (
                  <TableRow key={extId || `${ref.role}-${Math.random()}`} className="border-b border-white/5 hover:bg-white/5">
                    <TableCell className="py-2 px-3">
                      <Badge className="text-[10px] bg-emerald-900/30 text-emerald-300 border-emerald-500/20">
                        {roleLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 px-3 font-mono text-xs text-white/80 truncate" title={extId || '-'}>
                      {extId || '-'}
                    </TableCell>
                    <TableCell className="py-2 px-3 text-xs text-white/60">
                      {ref.fetched_at ? formatDistanceToNow(new Date(ref.fetched_at), { addSuffix: true }) : 'never'}
                    </TableCell>
                    <TableCell className="py-2 px-3 text-xs">
                      {isRefreshing ? (
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <Loader2 className="h-3 w-3 animate-spin" /> refreshing
                        </span>
                      ) : ref.last_refresh_status === 'error' ? (
                        <span className="inline-flex items-center gap-1 text-red-400" title={ref.last_refresh_error || ''}>
                          <AlertCircle className="h-3 w-3" /> error
                        </span>
                      ) : ref.last_refresh_status === 'ok' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> ok
                          {ref.last_refresh_at ? ` ${formatDistanceToNow(new Date(ref.last_refresh_at), { addSuffix: true })}` : ''}
                        </span>
                      ) : ref.last_refresh_status === 'skipped' ? (
                        <span className="inline-flex items-center gap-1 text-amber-400">⊘ skipped</span>
                      ) : (
                        <span className="text-white/40">−</span>
                      )}
                    </TableCell>
                    <TableCell className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={!extId || loading}
                          onClick={() => handleView(ref)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" /> View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={!extId || isRefreshing}
                          onClick={() => handleRefresh(ref)}
                        >
                          <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isRefreshing && 'animate-spin')} /> Refresh
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!viewing} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="!max-w-3xl max-h-[80vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="px-4 py-3 border-b border-white/10 shrink-0">
            <DialogTitle className="text-sm font-semibold text-white/90">
              {viewing?.title} — {viewing?.extId}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-auto p-4">
            {viewedResult?.error ? (
              <div className="text-xs text-red-300/90 whitespace-pre-wrap font-mono bg-red-950/20 rounded border border-red-500/20 p-3">
                {viewedResult.error}
              </div>
            ) : (
              <pre className="text-xs text-white/80 whitespace-pre-wrap font-mono bg-black/20 rounded border border-white/10 p-3">
                {formatPreview(viewedResult)}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
