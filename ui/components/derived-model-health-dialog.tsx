'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { DerivedMentalModel } from '@/lib/types/index';
import { mentalModelsApi, hindsightApi, serversApi } from '@/lib/api/client';
import { ServerBankSelectors, type SelectorServer, type SelectorBank } from '@/app/research/server-bank-selectors';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface DerivedModelHealthDialogProps {
  isOpen: boolean;
  onClose: () => void;
  derived: DerivedMentalModel[];
}

type HealthResult = {
  ext_id: string;
  healthy: boolean;
  found?: boolean;
  content?: string | object | null;
  content_length?: number;
  parsed?: { narrative?: string; graph?: { nodes: unknown[]; edges: unknown[] } };
  node_count?: number;
  edge_count?: number;
  error?: string;
};

type PendingOp = {
  pop_id: number;
  pop_operation_id: string;
  pop_server_id: number;
  pop_bank_id: string;
  pop_ext_id: string | null;
  pop_action: string;
  pop_status: string;
  pop_error_message: string | null;
  pop_created_at: string;
  pop_updated_at: string;
};

type HealthStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; results: HealthResult[] };

const isTerminalStatus = (s: string) => ['completed', 'failed', 'acknowledged', 'cancelled', 'canceled'].includes(s);

export function DerivedModelHealthDialog({ isOpen, onClose, derived }: DerivedModelHealthDialogProps) {
  const [servers, setServers] = useState<SelectorServer[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);
  const [status, setStatus] = useState<HealthStatus>({ state: 'idle' });
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  const [pendingOps, setPendingOps] = useState<PendingOp[]>([]);
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const activeRefreshIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    serversApi.list().then((data) => {
      if (cancelled) return;
      setServers(Array.isArray(data) ? data : []);
    }).catch(() => {
      if (!cancelled) setServers([]);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedServerId) {
      setBanks([]);
      return;
    }
    let cancelled = false;
    setLoadingBanks(true);
    serversApi.listBanks(Number(selectedServerId)).then((data) => {
      if (cancelled) return;
      setBanks(Array.isArray(data) ? data : []);
    }).catch(() => {
      if (!cancelled) setBanks([]);
    }).finally(() => {
      if (!cancelled) setLoadingBanks(false);
    });
    return () => { cancelled = true; };
  }, [selectedServerId]);

  const fetchPendingOps = async () => {
    if (!selectedServerId || !selectedBankId) {
      setPendingOps([]);
      activeRefreshIdsRef.current = new Set();
      return;
    }
    try {
      const res = await hindsightApi.listOperations(Number(selectedServerId), selectedBankId, true);
      setPendingOps(res.operations || []);
    } catch (err) {
      // silent fail — don't spam the user
    }
  };

  useEffect(() => {
    if (!isOpen || !selectedServerId || !selectedBankId) {
      setPendingOps([]);
      return;
    }
    fetchPendingOps();
    const id = setInterval(fetchPendingOps, 5000);
    return () => clearInterval(id);
  }, [isOpen, selectedServerId, selectedBankId]);

  useEffect(() => {
    if (!isOpen) {
      activeRefreshIdsRef.current = new Set();
      setStatus({ state: 'idle' });
      setSelectedResultId(null);
      setPendingOps([]);
      setRefreshingIds(new Set());
    }
  }, [isOpen]);

  const runHealthCheck = async (models: { ext_id: string; returns?: 'json' | 'narrative' }[], opts: { silent?: boolean } = {}) => {
    if (!selectedServerId || !selectedBankId || models.length === 0) return null;
    const response = await mentalModelsApi.healthCheck({
      server_id: Number(selectedServerId),
      bank_id: selectedBankId,
      models: models.map((m) => ({ ext_id: m.ext_id, returns: m.returns as 'json' | 'narrative' | undefined })),
    });
    return response.results || [];
  };

  const handleRun = async () => {
    if (!selectedServerId || !selectedBankId) {
      toast.error('Select a server and bank first');
      return;
    }
    if (derived.length === 0) return;

    setStatus({ state: 'loading' });
    setSelectedResultId(null);
    try {
      const results = await runHealthCheck(
        derived.map((d) => ({ ext_id: d.ext_id || '', returns: d.returns as 'json' | 'narrative' | undefined })),
      );
      setStatus({ state: 'done', results: results || [] });
      if ((results || []).length > 0) {
        setSelectedResultId(0);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ state: 'error', message });
      toast.error(`Health check failed: ${message}`);
    }
  };

  const handleRefresh = async (d: DerivedMentalModel, idx: number) => {
    if (!selectedServerId || !selectedBankId || !d.ext_id) {
      toast.error('Select a server and bank first');
      return;
    }
    setRefreshingIds((prev) => new Set(prev).add(d.id));
    try {
      await mentalModelsApi.refresh({
        server_id: Number(selectedServerId),
        bank_id: selectedBankId,
        ext_id: d.ext_id,
      });
      toast.success(`Refresh queued for ${d.name || d.ext_id}`);
      await fetchPendingOps();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Refresh failed: ${message}`);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(d.id);
        return next;
      });
    }
  };

  useEffect(() => {
    if (status.state !== 'done' || !selectedServerId || !selectedBankId) return;

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
      .map((op) => {
        const idx = derived.findIndex((d) => d.ext_id === op.pop_ext_id);
        if (idx === -1 || !op.pop_ext_id) return null;
        return {
          idx,
          model: { ext_id: op.pop_ext_id, returns: derived[idx].returns as 'json' | 'narrative' | undefined },
        };
      })
      .filter(Boolean) as { idx: number; model: { ext_id: string; returns?: 'json' | 'narrative' } }[];

    if (targets.length === 0) return;

    (async () => {
      try {
        const fresh = await runHealthCheck(targets.map((t) => t.model), { silent: true });
        if (!fresh) return;
        setStatus((prev) => {
          if (prev.state !== 'done') return prev;
          const next = [...prev.results];
          for (const t of targets) {
            const match = fresh.find((r) => r.ext_id === t.model.ext_id);
            if (match) next[t.idx] = match;
          }
          return { state: 'done', results: next };
        });
      } catch (err) {
        // silent fail — don't spam on background refresh
      }
    })();
  }, [pendingOps, status.state, selectedServerId, selectedBankId, derived]);

  const getOperationForRow = (extId?: string) => {
    if (!extId) return null;
    // most recent non-terminal refresh op for this ext_id
    return pendingOps
      .filter((op) => op.pop_ext_id === extId && op.pop_action === 'refresh' && !isTerminalStatus(op.pop_status))
      .sort((a, b) => new Date(b.pop_updated_at).getTime() - new Date(a.pop_updated_at).getTime())[0];
  };

  const getLatestRefreshStatus = (extId?: string): string | null => {
    if (!extId) return null;
    const latest = pendingOps
      .filter((op) => op.pop_ext_id === extId && op.pop_action === 'refresh')
      .sort((a, b) => new Date(b.pop_updated_at).getTime() - new Date(a.pop_updated_at).getTime())[0];
    return latest ? latest.pop_status : null;
  };

  const results = status.state === 'done' ? status.results : [];
  const selectedResult = selectedResultId != null ? results[selectedResultId] : null;

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
    if (result.parsed?.narrative != null) {
      return result.parsed.narrative;
    }
    if (result.parsed?.graph) {
      return JSON.stringify(result.parsed.graph, null, 2);
    }
    if (result.content != null) {
      return typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
    }
    return 'No content available';
  };

  const selectedPreviewText = selectedResult ? formatPreview(selectedResult) : '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[85vw] !max-w-none max-h-[85vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle className="text-lg font-semibold text-white flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-400" />
            Derived Instance Health
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-3 border-b border-white/10">
          <ServerBankSelectors
            servers={servers}
            selectedServerId={selectedServerId}
            setSelectedServerId={setSelectedServerId}
            banks={banks}
            selectedBankId={selectedBankId}
            setSelectedBankId={setSelectedBankId}
            loadingBanks={loadingBanks}
            disabled={status.state === 'loading'}
          />
        </div>

        <div className="flex-1 min-h-0 flex flex-row overflow-hidden px-6 py-3 gap-4">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto">
              <Table className="w-full caption-bottom text-sm table-fixed">
                <TableHeader>
                  <TableRow className="border-b border-white/10 hover:bg-transparent">
                    <TableHead className="w-[22%] text-xs uppercase text-white/60 font-medium py-2 px-3">Name</TableHead>
                    <TableHead className="w-[22%] text-xs uppercase text-white/60 font-medium py-2 px-3">External ID</TableHead>
                    <TableHead className="w-[16%] text-xs uppercase text-white/60 font-medium py-2 px-3">Entity</TableHead>
                    <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3">Health</TableHead>
                    <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3">Chars</TableHead>
                    <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3">Status</TableHead>
                    <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3 text-right">Refresh</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {derived.map((d, idx) => {
                    const result = results[idx];
                    const selected = selectedResultId === idx;
                    const op = getOperationForRow(d.ext_id || undefined);
                    const refreshStatus = getLatestRefreshStatus(d.ext_id || undefined);

                    let healthBadge: React.ReactNode = <span className="text-white/40">-</span>;
                    if (status.state === 'loading') {
                      healthBadge = <Loader2 className="h-4 w-4 animate-spin text-white/50" />;
                    } else if (result) {
                      healthBadge = result.healthy ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                          OK
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-red-500/15 text-red-300 border-red-500/30"
                          title={result.error || 'Unhealthy'}
                        >
                          {result.found === false ? 'Missing' : 'Error'}
                        </span>
                      );
                    }

                    const statusBadge = op ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border bg-sky-500/10 text-sky-400 border-sky-500/20"
                        title={`Refresh ${op.pop_status}`}
                      >
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {op.pop_status}
                      </span>
                    ) : refreshStatus === 'failed' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-red-500/15 text-red-300 border-red-500/30">
                        refresh failed
                      </span>
                    ) : null;

                    const isRefreshing = refreshingIds.has(d.id);

                    const previewLength = result ? formatPreview(result).length : 0;

                    return (
                      <TableRow
                        key={d.id}
                        onClick={() => result && setSelectedResultId(idx)}
                        className={`border-b border-white/5 cursor-pointer transition-colors ${
                          selected ? 'bg-purple-900/30' : result ? 'hover:bg-white/5' : ''
                        }`}
                      >
                        <TableCell className="py-2 px-3 text-xs text-white/80 truncate" title={d.name || '-'}>
                          {d.name || '-'}
                        </TableCell>
                        <TableCell className="py-2 px-3 text-xs font-mono text-white/60 truncate" title={d.ext_id || '-'}>
                          {d.ext_id || '-'}
                        </TableCell>
                        <TableCell className="py-2 px-3 text-xs text-white/60 truncate" title={`${d.derived_entity?.entity_id} — ${d.derived_entity?.name}`}>
                          {d.derived_entity?.entity_id} — {d.derived_entity?.name}
                        </TableCell>
                        <TableCell className="py-2 px-3">
                          <div className="flex flex-row flex-wrap items-center gap-2">
                            {healthBadge}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 px-3">
                          {result && (
                            <span className="text-[10px] text-white/50 tabular-nums" title={`${previewLength.toLocaleString()} characters`}>
                              {previewLength.toLocaleString()}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 px-3">
                          <div className="flex flex-row flex-wrap items-center gap-2">
                            {statusBadge}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 px-3 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-white/50 hover:text-purple-300 hover:bg-purple-500/10 disabled:opacity-30"
                            disabled={!selectedServerId || !selectedBankId || isRefreshing || !!op || !result}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRefresh(d, idx);
                            }}
                            title={
                              !result
                                ? 'Run health check first'
                                : !!op
                                ? 'Refresh in progress'
                                : 'Refresh mental model on Hindsight'
                            }
                          >
                            {isRefreshing || !!op ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {status.state === 'error' && (
              <p className="mt-3 text-xs text-red-400">{status.message}</p>
            )}
          </div>

          <div className="w-1/2 min-w-[360px] flex flex-col border border-white/10 rounded-md overflow-hidden bg-black/20">
            <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-center justify-between">
              <span className="text-xs uppercase text-white/60 font-medium">Parsed Content</span>
              {selectedResult && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white/40" title={`${selectedPreviewText.length.toLocaleString()} characters`}>
                    {selectedPreviewText.length.toLocaleString()} chars
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                    selectedResult.healthy
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-red-500/15 text-red-300 border-red-500/30'
                  }`}>
                    {selectedResult.healthy ? 'Healthy' : selectedResult.found === false ? 'Missing' : 'Error'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto p-3">
              <pre className="text-xs font-mono text-white/80 whitespace-pre-wrap break-all">
                {formatPreview(selectedResult)}
              </pre>
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleRun}
            disabled={!selectedServerId || !selectedBankId || status.state === 'loading'}
            className="bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {status.state === 'loading' && <Loader2 className="h-4 w-4 animate-spin" />}
            {status.state === 'loading' ? 'Checking...' : 'Run Check'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DerivedModelHealthDialog;
