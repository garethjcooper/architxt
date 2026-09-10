'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, Search, AlertCircle, CheckCircle2, Loader2, MessageSquareText } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { mentalModelsApi, hindsightApi } from '@/lib/api/client';
import { EnvelopeViewer } from '@/components/envelope-viewer';
import { mentalModelContentToStepSummary } from '@/app/workspace/_components/model-content-utils';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { EnvelopeControls } from '@/components/envelope-controls';
import { isContextualRole, getRoleScopeLabel, getRoleLabel, getDerivationScope, type ModelRef, type DisplayNode, type DisplayEdge, loadRoleScopeMap } from '@/lib/contextual-graph/display';
import type { MentalModelEnvelope } from '@/lib/api/client';
import { SystemTemplateQueryPreviewDialog } from './system-template-query-preview-dialog';

function getScopeLabel(ref: ModelRef, nodes?: DisplayNode[], edges?: DisplayEdge[]): string {
  const scope = ref.scope;
  if (!scope) return '-';
  if ('node_id' in scope) {
    const node = nodes?.find((n) => n.id === scope.node_id);
    return node ? `${node.label} (${scope.node_id})` : scope.node_id;
  }
  if ('source_id' in scope && 'target_id' in scope) {
    const source = nodes?.find((n) => n.id === scope.source_id);
    const target = nodes?.find((n) => n.id === scope.target_id);
    return `${source?.label || scope.source_id} → ${target?.label || scope.target_id}`;
  }
  if ('seed_id' in scope) {
    return `seed: ${scope.seed_id}`;
  }
  return '-';
}

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
  nodes?: DisplayNode[];
  edges?: DisplayEdge[];
  isActive?: boolean;
}

export function MentalModelsTab({ serverId, bankId, modelRefs, nodes, edges, isActive }: MentalModelsTabProps) {
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [contents, setContents] = useState<Record<string, ContentResult>>({});
  const [contentErrors, setContentErrors] = useState<Record<string, string>>({});
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [pendingOps, setPendingOps] = useState<PendingOp[]>([]);
  const [selectedExtId, setSelectedExtId] = useState<string | null>(null);
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set());
  const [panelWidth, setPanelWidth] = useState(45);
  const [confirmRefreshAllOpen, setConfirmRefreshAllOpen] = useState(false);
  const [queryDialogRef, setQueryDialogRef] = useState<ModelRef | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<string | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [plainView, setPlainView] = useState(false);
  const activeRefreshIdsRef = useRef<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(45);
  const containerWidthRef = useRef(0);
  const [roleScopeMap, setRoleScopeMap] = useState<Record<string, string>>({});

  useEffect(() => {
    loadRoleScopeMap().then(setRoleScopeMap);
  }, []);

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
      const roleLabel = getRoleLabel(r.role).toLowerCase();
      const scopeLabel = getRoleScopeLabel(r.role).toLowerCase();
      return id.includes(q) || role.includes(q) || roleLabel.includes(q) || scopeLabel.includes(q);
    });
  }, [refs, search]);

  const selectedRef = useMemo(() => filteredRefs.find((r) => (r.ext_id || null) === selectedExtId) || null, [filteredRefs, selectedExtId]);
  const selectedContent = selectedExtId ? contents[selectedExtId] || null : null;
  const selectedContentError = selectedExtId ? contentErrors[selectedExtId] || null : null;

  // Main-table multi-select helpers
  const toggleRefSelection = useCallback((extId: string) => {
    setSelectedRefIds((prev) => {
      const next = new Set(prev);
      if (next.has(extId)) next.delete(extId);
      else next.add(extId);
      return next;
    });
  }, []);

  const visibleRefIds = useMemo(() => filteredRefs.map((r) => r.ext_id || ''), [filteredRefs]);
  const isAllVisibleRefsSelected = visibleRefIds.length > 0 && visibleRefIds.every((id) => selectedRefIds.has(id));
  const isSomeVisibleRefsSelected = visibleRefIds.length > 0 && visibleRefIds.some((id) => selectedRefIds.has(id)) && !isAllVisibleRefsSelected;

  const toggleAllVisibleRefs = useCallback(() => {
    setSelectedRefIds((prev) => {
      const next = new Set(prev);
      if (visibleRefIds.every((id) => next.has(id))) {
        visibleRefIds.forEach((id) => next.delete(id));
      } else {
        visibleRefIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [visibleRefIds]);

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

  // Refresh selected refs in the main table.
  const handleRefreshSelected = useCallback(async (extIds?: string[]) => {
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    const targets = extIds?.length ? extIds : Array.from(selectedRefIds).filter(Boolean);
    if (targets.length === 0) {
      toast.error('Select at least one mental model');
      return;
    }
    setRefreshingIds((prev) => {
      const next = new Set(prev);
      for (const id of targets) next.add(id);
      return next;
    });

    const results = await Promise.all(
      targets.map(async (extId) => {
        try {
          await mentalModelsApi.refresh({ server_id: serverId, bank_id: bankId, ext_id: extId });
          return { extId, success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { extId, success: false, message };
        }
      })
    );

    setRefreshingIds((prev) => {
      const next = new Set(prev);
      for (const id of targets) next.delete(id);
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
  }, [serverId, bankId, selectedRefIds, fetchPendingOps]);

  const handleQuery = useCallback(async (ref: ModelRef) => {
    const role = ref.role;
    if (!role || !isContextualRole(role)) {
      toast.error('Query preview is only available for system-template roles');
      return;
    }
    setQueryDialogRef(ref);
    setQueryLoading(true);
    setQueryResult(null);
    setQueryError(null);
    try {
      const all = await mentalModelsApi.list({ limit: 1000 });
      const template = all.find((m) => m.template_role === role || (m.is_system_template && m.ext_id === role));
      if (!template) {
        throw new Error(`No local system template found for role "${role}"`);
      }
      const res = await mentalModelsApi.composePreview([
        {
          role,
          template_role: role,
          returns: role,
          source_query: template.source_query || '',
        },
      ]);
      const row = res.results[0];
      if (row?.compose_error) {
        setQueryError(row.compose_error);
      } else {
        setQueryResult(row?.composed_query ?? null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setQueryError(message);
      toast.error(`Failed to compose query: ${message}`);
    } finally {
      setQueryLoading(false);
    }
  }, []);

  const closeQueryDialog = useCallback(() => {
    setQueryDialogRef(null);
    setQueryResult(null);
    setQueryError(null);
  }, []);

  const formatPreview = (result: ContentResult | null, error: string | null): React.ReactNode => {
    if (error) return <div className="text-xs text-destructive-fg/90 whitespace-pre-wrap font-mono bg-destructive-bg rounded border border-destructive-bd p-3">{`Error:\n${error}`}</div>;
    if (!result) return '';
    if (result.content == null) {
      return <div className="h-full flex items-center justify-center text-xs text-foreground-subtle">No content available</div>;
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

  const saveContentMd = useCallback(() => {
    const text = formatPreviewText(selectedContent, selectedContentError);
    if (!text) return;
    const extId = selectedExtId || 'model';
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${extId.replace(/[^a-zA-Z0-9\\-_]/g, '_')}.md`;
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
      <div className="flex items-center justify-between gap-2 border-b border-border-default pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground-subtle pointer-events-none" />
            <Input
              type="search"
              placeholder="Search by ext id or role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 pr-2 bg-surface-inset border-border-default text-foreground-muted placeholder:text-foreground-subtle text-xs"
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded bg-surface-panel text-foreground-faint hover:text-foreground-default hover:bg-surface-panel disabled:opacity-30 transition-colors"
          disabled={!serverId || !bankId || refreshingIds.size > 0 || filteredRefs.length === 0 || selectedRefIds.size === 0}
          onClick={() => setConfirmRefreshAllOpen(true)}
          title="Refresh selected mental models"
        >
          <RefreshCw className={cn('h-4 w-4', refreshingIds.size > 0 && 'animate-spin')} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 flex mt-2 overflow-hidden">
        {/* Table */}
        <div
          className="min-w-0 rounded-md overflow-hidden bg-surface-card border border-on-dark/[0.08] flex flex-col"
          style={{ width: `${100 - panelWidth}%` }}
        >
          <div className="h-10 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
            <span className="font-medium text-sm">Mental Models</span>
            <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
              {filteredRefs.length}
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-0">
            <Table className="w-full caption-bottom text-sm">
              <TableHeader>
                <TableRow className="border-b border-border-default hover:bg-transparent">
                  <TableHead className="w-8 py-2 px-2">
                    <Checkbox
                      checked={isAllVisibleRefsSelected}
                      indeterminate={isSomeVisibleRefsSelected}
                      onCheckedChange={toggleAllVisibleRefs}
                      aria-label="Select all visible mental models"
                    />
                  </TableHead>
                  <TableHead className="w-[16%] text-xs uppercase text-foreground-faint font-medium py-2 px-3">Template Role</TableHead>
                  <TableHead className="w-[8%] text-xs uppercase text-foreground-faint font-medium py-2 px-3">Scope</TableHead>
                  <TableHead className="w-[16%] text-xs uppercase text-foreground-faint font-medium py-2 px-3">Target</TableHead>
                  <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-3">External ID</TableHead>
                  <TableHead className="w-28 text-xs uppercase text-foreground-faint font-medium py-2 px-3">Fetched</TableHead>
                  <TableHead className="w-28 text-xs uppercase text-foreground-faint font-medium py-2 px-3">Refresh state</TableHead>
                  <TableHead className="w-10 text-xs uppercase text-foreground-faint font-medium py-2 px-3"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && filteredRefs.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-b border-border-subtle">
                      <TableCell className="py-2 px-2"><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-2 px-3"><Skeleton className="h-4 w-8" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredRefs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-xs text-foreground-subtle">
                      {search.trim() ? 'No model refs match your search.' : 'No mental-model refs attached to this bank.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRefs.map((ref) => {
                    const extId = ref.ext_id || '';
                    const roleLabel = getRoleLabel(ref.role);
                    const scopeBadge = getDerivationScope(ref.role, ref.scope);
                    const scopeDetail = getScopeLabel(ref, nodes, edges);
                    const op = getOperationForRow(extId);
                    const isRefreshing = Boolean(op) || refreshingIds.has(extId);
                    const isRowSelected = selectedExtId === extId;
                    return (
                      <TableRow
                        key={extId || `${ref.role}-${Math.random()}`}
                        onClick={() => handleSelectRow(ref)}
                        className={cn(
                          'border-b border-border-subtle cursor-pointer transition-colors',
                          isRowSelected ? 'bg-accent-primary-bg' : 'hover:bg-surface-card'
                        )}
                      >
                        <TableCell className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedRefIds.has(extId)}
                            onCheckedChange={() => toggleRefSelection(extId)}
                            aria-label={`Select ${extId || 'model ref'}`}
                          />
                        </TableCell>
                        <TableCell className="py-2 px-3">
                          <span className="text-xs text-foreground-default truncate" title={ref.role}>{roleLabel}</span>
                        </TableCell>
                        <TableCell className="py-2 px-3">
                          <Badge className="text-[10px] bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd w-fit">
                            {scopeBadge}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2 px-3 text-xs text-foreground-faint truncate" title={scopeDetail}>
                          {scopeDetail}
                        </TableCell>
                        <TableCell className="py-2 px-3 font-mono text-xs text-foreground-muted truncate" title={extId || '-'}>
                          {extId || '-'}
                        </TableCell>
                        <TableCell className="py-2 px-3 text-xs text-foreground-faint">
                          {ref.fetched_at ? formatDistanceToNow(new Date(ref.fetched_at), { addSuffix: true }) : 'never'}
                        </TableCell>
                        <TableCell className="py-2 px-3 text-xs">
                          {isRefreshing ? (
                            <span className="inline-flex items-center gap-1 text-accent-tertiary-fg">
                              <Loader2 className="h-3 w-3 animate-spin" /> refreshing
                            </span>
                          ) : ref.last_refresh_status === 'error' ? (
                            <span className="inline-flex items-center gap-1 text-destructive-fg" title={ref.last_refresh_error || ''}>
                              <AlertCircle className="h-3 w-3" /> error
                            </span>
                          ) : ref.last_refresh_status === 'ok' ? (
                            <span className="inline-flex items-center gap-1 text-accent-primary-fg">
                              <CheckCircle2 className="h-3 w-3" /> ok
                              {ref.last_refresh_at ? ` ${formatDistanceToNow(new Date(ref.last_refresh_at), { addSuffix: true })}` : ''}
                            </span>
                          ) : ref.last_refresh_status === 'skipped' ? (
                            <span className="inline-flex items-center gap-1 text-accent-tertiary-fg">⊘ skipped</span>
                          ) : (
                            <span className="text-foreground-subtle">−</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              disabled={!extId || isRefreshing}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRefreshSelected([extId]);
                              }}
                              title="Refresh model"
                            >
                              <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
                            </Button>
                            {(isContextualRole(ref.role) || !!roleScopeMap[ref.role || '']) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                disabled={!extId}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleQuery(ref);
                                }}
                                title="Preview composed query"
                              >
                                <MessageSquareText className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
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
          <div className="h-14 w-0.5 rounded-full bg-surface-strong group-hover:bg-accent-primary-bd-hover transition-colors" />
        </div>

        {/* Content panel */}
        <div
          className="min-w-0 rounded-md overflow-hidden bg-surface-card border border-on-dark/[0.08] flex flex-col"
          style={{ width: `${panelWidth}%` }}
        >
          <EnvelopeControls
            headerTitle={selectedRef ? getRoleLabel(selectedRef.role) : 'Content'}
            plain={plainView}
            onPlainChange={setPlainView}
            onCopyText={copyContent}
            onSaveMd={saveContentMd}
            showControlsToggle
          />

          <div className="flex-1 min-h-0 overflow-auto p-3">
            {!selectedExtId ? (
              <div className="h-full flex items-center justify-center text-xs text-foreground-subtle">Select a mental model to view its fetched content.</div>
            ) : loading && !selectedContent ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-4 w-3/4 bg-surface-panel" />
                <Skeleton className="h-4 w-1/2 bg-surface-panel" />
                <Skeleton className="h-4 w-5/6 bg-surface-panel" />
                <Skeleton className="h-4 w-2/3 bg-surface-panel" />
              </div>
            ) : selectedContentError ? (
              <div className="text-xs text-destructive-fg/90 whitespace-pre-wrap font-mono bg-destructive-bg rounded border border-destructive-bd p-3">
                {selectedContentError}
              </div>
            ) : plainView ? (
              <pre className="text-xs text-foreground-muted font-mono whitespace-pre-wrap">
                {formatPreviewText(selectedContent, selectedContentError)}
              </pre>
            ) : (
              formatPreview(selectedContent, selectedContentError)
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmRefreshAllOpen}
        onOpenChange={setConfirmRefreshAllOpen}
        title="Refresh selected mental models?"
        description={`This will queue a refresh for ${selectedRefIds.size} selected mental model ref${selectedRefIds.size === 1 ? '' : 's'}. This operation can be expensive and may take time to complete.`}
        confirmLabel="Refresh selected"
        cancelLabel="Cancel"
        onConfirm={() => {
          setConfirmRefreshAllOpen(false);
          handleRefreshSelected();
        }}
      />

      <SystemTemplateQueryPreviewDialog
        isOpen={!!queryDialogRef}
        onClose={closeQueryDialog}
        refItem={queryDialogRef}
        composedQuery={queryResult}
        composeError={queryError}
        loading={queryLoading}
      />
    </div>
  );
}
