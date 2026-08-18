'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { DerivedMentalModel, MentalModelReturns } from '@/lib/types/index';
import { mentalModelsApi, hindsightApi, serversApi } from '@/lib/api/client';
import { ServerBankSelectors, type SelectorServer, type SelectorBank } from '@/app/research/server-bank-selectors';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { NarrativeViewer } from '@/components/narrative-viewer';
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
  narrative_length?: number;
  graph_present?: boolean;
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
  const [confirmRefreshAllOpen, setConfirmRefreshAllOpen] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState(40);
  const rightPanelContainerRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(40);
  const containerWidthRef = useRef(0);
  const activeRefreshIdsRef = useRef<Set<string>>(new Set());

  const refreshAllEligibleCount = useMemo(
    () => derived.filter((d) => d.ext_id).length,
    [derived],
  );

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
    if (isOpen) {
      setRightPanelWidth(40);
    }
  }, [isOpen]);

  const handleResizeReset = useCallback(() => {
    setRightPanelWidth(40);
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = rightPanelWidth;
    const container = rightPanelContainerRef.current?.parentElement;
    containerWidthRef.current = container?.getBoundingClientRect().width ?? window.innerWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [rightPanelWidth]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const dx = resizeStartXRef.current - e.clientX;
    const containerWidth = containerWidthRef.current;
    if (!containerWidth) return;
    const deltaPercent = (dx / containerWidth) * 100;
    const next = Math.min(60, Math.max(20, resizeStartWidthRef.current + deltaPercent));
    setRightPanelWidth(next);
  }, []);

  const handleResizeEnd = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => handleResizeMove(e);
    const onUp = () => handleResizeEnd();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [handleResizeMove, handleResizeEnd]);

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

  const runHealthCheck = async (models: { ext_id: string; returns?: MentalModelReturns }[], opts: { silent?: boolean } = {}) => {
    if (!selectedServerId || !selectedBankId || models.length === 0) return null;
    const response = await mentalModelsApi.healthCheck({
      server_id: Number(selectedServerId),
      bank_id: selectedBankId,
      models,
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
        derived.map((d) => ({ ext_id: d.ext_id || '', returns: 'generic' })),
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

  const handleRefreshAll = async () => {
    if (!selectedServerId || !selectedBankId) {
      toast.error('Select a server and bank first');
      return;
    }
    if (derived.length === 0) return;
    setConfirmRefreshAllOpen(false);

    const eligible = derived.map((d, idx) => ({ d, idx })).filter(({ d }) => d.ext_id);
    if (eligible.length === 0) return;

    setRefreshingIds((prev) => {
      const next = new Set(prev);
      for (const { idx } of eligible) next.add(idx);
      return next;
    });

    const results = await Promise.all(
      eligible.map(async ({ d, idx }) => {
        try {
          await mentalModelsApi.refresh({
            server_id: Number(selectedServerId),
            bank_id: selectedBankId,
            ext_id: d.ext_id!,
          });
          return { idx, success: true, name: d.name || d.ext_id };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { idx, success: false, name: d.name || d.ext_id, message };
        }
      }),
    );

    setRefreshingIds((prev) => {
      const next = new Set(prev);
      for (const { idx } of eligible) next.delete(idx);
      return next;
    });

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (failed.length === 0) {
      toast.success(`Refresh queued for ${succeeded.length} model${succeeded.length === 1 ? '' : 's'}`);
    } else {
      toast.error(`${failed.length} refresh${failed.length === 1 ? '' : 'es'} failed`, {
        description: failed.map((f) => `${f.name}: ${f.message}`).join('\n'),
      });
    }

    await fetchPendingOps();
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
          model: { ext_id: op.pop_ext_id, returns: 'generic' },
        };
      })
      .filter(Boolean) as { idx: number; model: { ext_id: string; returns?: MentalModelReturns } }[];

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
    if (result.content != null) {
      return typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
    }
    return 'No content available';
  };

  const parseEnvelope = (result: HealthResult | null) => {
    if (!result || result.error) return null;
    const raw = result.content;
    if (!raw) return null;
    let parsed: unknown;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
    } else {
      parsed = raw;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.narrative !== 'string' ||
      !obj.graph || typeof obj.graph !== 'object' ||
      !Array.isArray(obj.tables) ||
      !Array.isArray(obj.diagrams)
    ) {
      return null;
    }
    return {
      narrative: obj.narrative,
      diagrams: obj.diagrams as { name: string; type: string; content: string }[],
    };
  };

  const selectedEnvelope = useMemo(() => parseEnvelope(selectedResult), [selectedResult]);

  const selectedPreviewText = useMemo(() => {
    if (selectedEnvelope) return selectedEnvelope.narrative;
    return selectedResult ? formatPreview(selectedResult) : '';
  }, [selectedResult, selectedEnvelope]);

  return (
    <>
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
                      <TableHead className="w-[22%] text-xs uppercase text-white/60 font-medium py-2 px-3">External ID</TableHead>
                      <TableHead className="w-[18%] text-xs uppercase text-white/60 font-medium py-2 px-3">Entity</TableHead>
                      <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3">Health</TableHead>
                      <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3">Chars</TableHead>
                      <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3">Narr Chars</TableHead>
                      <TableHead className="w-[8%] text-xs uppercase text-white/60 font-medium py-2 px-3">Nodes</TableHead>
                      <TableHead className="w-[8%] text-xs uppercase text-white/60 font-medium py-2 px-3">Edges</TableHead>
                      <TableHead className="w-[10%] text-xs uppercase text-white/60 font-medium py-2 px-3">Status</TableHead>
                      <TableHead className="w-[8%] text-xs uppercase text-white/60 font-medium py-2 px-3 text-right">Refresh</TableHead>
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
                            {result && (
                              <span className="text-[10px] text-white/50 tabular-nums" title={`${(result.narrative_length ?? 0).toLocaleString()} narrative characters`}>
                                {result.narrative_length?.toLocaleString() ?? '-'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="py-2 px-3">
                            {result?.graph_present ? (
                              <span className="text-[10px] text-white/50 tabular-nums">
                                {(result.node_count ?? 0).toLocaleString()}
                              </span>
                            ) : (
                              result && <span className="text-[10px] text-white/30">-</span>
                            )}
                          </TableCell>
                          <TableCell className="py-2 px-3">
                            {result?.graph_present ? (
                              <span className="text-[10px] text-white/50 tabular-nums">
                                {(result.edge_count ?? 0).toLocaleString()}
                              </span>
                            ) : (
                              result && <span className="text-[10px] text-white/30">-</span>
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

            <div
              className="w-3 shrink-0 cursor-col-resize flex items-center justify-center group"
              onMouseDown={handleResizeStart}
              onDoubleClick={handleResizeReset}
              title="Drag to resize data list and response content panels; double-click to reset"
            >
              <div className="h-14 w-0.5 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
            </div>

            <div
              ref={rightPanelContainerRef}
              className="flex flex-col border border-white/10 rounded-md overflow-hidden bg-black/20"
              style={{ width: `${rightPanelWidth}%`, minWidth: 320 }}
            >
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-center justify-between">
                <span className="text-xs uppercase text-white/60 font-medium">Response Content</span>
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
                {selectedEnvelope ? (
                  <NarrativeViewer
                    envelope={selectedEnvelope}
                    title="Model output"
                    viewMode="markdown"
                    showIndex={false}
                    className="min-h-full"
                  />
                ) : (
                  <pre className="text-xs font-mono text-white/80 whitespace-pre-wrap break-all">
                    {formatPreview(selectedResult)}
                  </pre>
                )}
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
              variant="outline"
              onClick={() => setConfirmRefreshAllOpen(true)}
              disabled={!selectedServerId || !selectedBankId || status.state === 'loading' || derived.length === 0}
              className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Refresh All
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

      <Dialog open={confirmRefreshAllOpen} onOpenChange={setConfirmRefreshAllOpen}>
        <DialogContent className="!w-auto max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-white">Refresh all mental models?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/70">
            This will queue a Hindsight refresh for {refreshAllEligibleCount} model{refreshAllEligibleCount === 1 ? '' : 's'}.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="ghost"
              onClick={() => setConfirmRefreshAllOpen(false)}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRefreshAll}
              className="bg-purple-600 hover:bg-purple-500 text-white"
            >
              Refresh All
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default DerivedModelHealthDialog;
