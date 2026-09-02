'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Search, AlertCircle, CheckCircle2, Loader2, Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { mentalModelsApi, hindsightApi } from '@/lib/api/client';
import { MODEL_ROLE_LABELS } from '@/lib/contextual-graph/display';
import { EnvelopeViewer } from '@/components/envelope-viewer';
import { mentalModelContentToStepSummary } from '@/app/workspace/_components/model-content-utils';
import type { MentalModelEnvelope } from '@/lib/api/client';
import type { ModelRef } from './page';

const ROLE_LABELS = MODEL_ROLE_LABELS;

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

type ContentResult = {
  ext_id: string;
  found: boolean;
  content: string | object | null;
  content_hash: string | null;
  updated_at: string | null;
  envelope?: MentalModelEnvelope | null;
};

export interface MentalModelsTabProps {
  serverId: number | null;
  bankId: string | null;
  modelRefs: ModelRef[];
  isActive?: boolean;
}

export function MentalModelsTab({ serverId, bankId, modelRefs, isActive }: MentalModelsTabProps) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [contents, setContents] = useState<Record<string, ContentResult>>({});
  const [contentErrors, setContentErrors] = useState<Record<string, string>>({});
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [pendingOps, setPendingOps] = useState<PendingOp[]>([]);
  const [selectedExtId, setSelectedExtId] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(45);
  const activeRefreshIdsRef = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(45);
  const containerWidthRef = useRef(0);

  const refs = useMemo(() => {
    const byId = new Map<string, ModelRef>();
    for (const ref of modelRefs) {
      const id = ref.ext_id || ref.role || '';
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, ref);
        continue;
      }
      // Prefer the ref with a refresh status; if both have one, prefer the latest.
      const existingHasStatus = !!existing.last_refresh_status;
      const refHasStatus = !!ref.last_refresh_status;
      if (refHasStatus && !existingHasStatus) {
        byId.set(id, ref);
      } else if (existingHasStatus && refHasStatus) {
        const existingTime = existing.last_refresh_at ? new Date(existing.last_refresh_at).getTime() : 0;
        const refTime = ref.last_refresh_at ? new Date(ref.last_refresh_at).getTime() : 0;
        if (refTime > existingTime) {
          byId.set(id, ref);
        }
      }
    }
    return Array.from(byId.values());
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

  const selectedRef = useMemo(() => filteredRefs.find((r) => (r.ext_id || null) === selectedExtId) || null, [filteredRefs, selectedExtId]);
  const selectedContent = selectedExtId ? contents[selectedExtId] || null : null;
  const selectedContentError = selectedExtId ? contentErrors[selectedExtId] || null : null;

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
      if (!opts.silent) setLoading(true);
      const results = await Promise.all(
        extIds.map(async (extId) => {
          try {
            return await mentalModelsApi.fetchContent(serverId, bankId, extId);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setContentErrors((prev) => ({ ...prev, [extId]: message }));
            return null;
          }
        })
      );
      setContents((prev) => {
        const next = { ...prev };
        for (const r of results) if (r) next[r.ext_id] = r;
        return next;
      });
      return results.filter(Boolean);
    } catch (err) {
      if (!opts.silent) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Content fetch failed: ${message}`);
      }
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [serverId, bankId]);

  useEffect(() => {
    if (!serverId || !bankId) return;

    const nextActive = new Set(
      pendingOps
        .filter((op) => ['refresh', 'mental_model_refresh'].includes(op.pop_action) && !isTerminalStatus(op.pop_status))
        .map((op) => op.pop_operation_id),
    );

    const justCompleted = pendingOps.filter(
      (op) =>
        ['refresh', 'mental_model_refresh'].includes(op.pop_action) &&
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

  const getOperationForRow = (extId?: string) => {
    if (!extId) return null;
    return pendingOps
      .filter((op) => op.pop_ext_id === extId && ['refresh', 'mental_model_refresh'].includes(op.pop_action) && !isTerminalStatus(op.pop_status))
      .sort((a, b) => new Date(b.pop_updated_at).getTime() - new Date(a.pop_updated_at).getTime())[0];
  };

  const handleSelectRow = useCallback(async (ref: ModelRef) => {
    const extId = ref.ext_id || null;
    setSelectedExtId(extId);
    if (extId) {
      await runHealthCheck([extId], { silent: true });
    }
  }, [runHealthCheck]);

  // Refresh data when the tab becomes active or the bank scope changes.
  useEffect(() => {
    if (!isActive || !serverId || !bankId) return;
    fetchPendingOps();
    if (selectedExtId) {
      runHealthCheck([selectedExtId], { silent: true });
    }
  }, [isActive, serverId, bankId, selectedExtId, fetchPendingOps, runHealthCheck]);

  const handleRefresh = useCallback(async (ref: ModelRef, e?: React.MouseEvent) => {
    e?.stopPropagation();
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

  const formatPreview = (result: ContentResult | null, error: string | null): React.ReactNode => {
    if (error) return <div className="text-xs text-red-300/90 whitespace-pre-wrap font-mono bg-red-950/20 rounded border border-red-500/20 p-3">{`Error:\n${error}`}</div>;
    if (!result) return '';
    if (result.content == null) {
      return <div className="h-full flex items-center justify-center text-xs text-white/50">No content available</div>;
    }
    // Always render through the standard envelope viewer. Plain text/non-envelope
    // content is wrapped as a narrative-only envelope by the helper below.
    return (
      <EnvelopeViewer
        envelope={mentalModelContentToStepSummary(result.ext_id || 'Content', result)}
        title="Content"
        className="h-full"
      />
    );
  };

  const formatPreviewText = (result: ContentResult | null, error: string | null): string => {
    if (error) return `Error:\n${error}`;
    if (!result) return '';
    if (result.content != null) {
      return typeof result.content === 'string' ? result.content : JSON.stringify(result.content, null, 2);
    }
    return 'No content available';
  };

  const copyContent = useCallback(() => {
    const text = formatPreviewText(selectedContent, selectedContentError);
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => toast.success('Content copied to clipboard'));
  }, [selectedContent, selectedContentError]);

  const downloadContent = useCallback(() => {
    const text = formatPreviewText(selectedContent, selectedContentError);
    if (!text) return;
    const extId = selectedExtId || 'model';
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${extId.replace(/[^a-zA-Z0-9\\-_]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [selectedContent, selectedContentError, selectedExtId]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = panelWidth;
    containerWidthRef.current = containerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!isResizingRef.current) return;
    const dx = e.clientX - resizeStartXRef.current;
    const containerWidth = containerWidthRef.current;
    if (!containerWidth) return;
    const deltaPercent = (dx / containerWidth) * 100;
    const next = Math.min(70, Math.max(20, resizeStartWidthRef.current + deltaPercent));
    setPanelWidth(next);
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

  return (
    <div ref={containerRef} className="flex flex-col h-full min-h-0">
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
          <span className="text-xs font-mono text-emerald-400 bg-black/30 border border-emerald-500/30 px-2 py-0.5 rounded">{refs.length} model ref{refs.length === 1 ? '' : 's'}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!serverId || !bankId || refreshingIds.size > 0 || filteredRefs.length === 0}
          onClick={handleRefreshAll}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', refreshingIds.size > 0 && 'animate-spin')} />
          Refresh all
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex mt-2 overflow-hidden">
        {/* Table */}
        <div
          className="min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col"
          style={{ width: `${100 - panelWidth}%` }}
        >
          <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
            <span className="font-medium text-sm">Mental Models</span>
            <span className="text-xs font-mono text-emerald-400 bg-black/30 border border-emerald-500/30 px-2 py-0.5 rounded">
              {filteredRefs.length}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-0">
            <Table className="w-full caption-bottom text-sm">
              <TableHeader>
                <TableRow className="border-b border-white/10 hover:bg-transparent">
                  <TableHead className="w-[18%] text-xs uppercase text-white/60 font-medium py-2 px-3">Role</TableHead>
                  <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-3">External ID</TableHead>
                  <TableHead className="w-28 text-xs uppercase text-white/60 font-medium py-2 px-3">Fetched</TableHead>
                  <TableHead className="w-28 text-xs uppercase text-white/60 font-medium py-2 px-3">Refresh state</TableHead>
                  <TableHead className="w-10 text-xs uppercase text-white/60 font-medium py-2 px-3"></TableHead>
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
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-8" /></TableCell>
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
                    const isRefreshing = Boolean(op) || refreshingIds.has(extId);
                    const isSelected = selectedExtId === extId;
                    return (
                      <TableRow
                        key={extId || `${ref.role}-${Math.random()}`}
                        onClick={() => handleSelectRow(ref)}
                        className={cn(
                          'border-b border-white/5 cursor-pointer transition-colors',
                          isSelected ? 'bg-emerald-900/30' : 'hover:bg-white/5'
                        )}
                      >
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
                        <TableCell className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            disabled={!extId || isRefreshing}
                            onClick={(e) => handleRefresh(ref, e)}
                            title="Refresh model"
                          >
                            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Resizer */}
        <div
          className="w-3 shrink-0 cursor-col-resize flex items-center justify-center group"
          onMouseDown={handleResizeStart}
          title="Drag to resize panels"
        >
          <div className="h-14 w-0.5 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
        </div>

        {/* Content panel */}
        <div
          className="min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col"
          style={{ width: `${panelWidth}%` }}
        >
          <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
            <span className="font-medium text-sm truncate" title={selectedExtId || undefined}>
              {selectedRef ? (ROLE_LABELS[selectedRef.role || ''] || selectedRef.role || 'Model') : 'Content'}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={!selectedContent}
                onClick={copyContent}
                title="Copy content"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={!selectedContent}
                onClick={downloadContent}
                title="Download content"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-auto p-3">
            {!selectedExtId ? (
              <div className="h-full flex items-center justify-center text-xs text-white/50">Select a mental model to view its fetched content.</div>
            ) : loading && !selectedContent ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-4 w-3/4 bg-white/10" />
                <Skeleton className="h-4 w-1/2 bg-white/10" />
                <Skeleton className="h-4 w-5/6 bg-white/10" />
                <Skeleton className="h-4 w-2/3 bg-white/10" />
              </div>
            ) : selectedContentError ? (
              <div className="text-xs text-red-300/90 whitespace-pre-wrap font-mono bg-red-950/20 rounded border border-red-500/20 p-3">
                {selectedContentError}
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-hidden">
                {formatPreview(selectedContent, selectedContentError)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
