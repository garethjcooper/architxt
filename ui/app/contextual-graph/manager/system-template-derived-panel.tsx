'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Activity, Eye, RefreshCw, Search, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { mentalModelsApi } from '@/lib/api/client';
import { MODEL_ROLE_LABELS, type ModelRef, type DisplayNode, type DisplayEdge } from '@/lib/contextual-graph/display';
import type { MentalModel } from '@/lib/types/index';

interface SystemTemplateDerivedPanelProps {
  role: string;
  modelRefs: ModelRef[];
  nodes?: DisplayNode[];
  edges?: DisplayEdge[];
  serverId: number | null;
  bankId: string | null;
  onHealthCheck: (extIds: string[]) => void;
  onRefresh: (extIds: string[]) => Promise<void>;
  refreshingIds?: Set<string>;
}

type ComposeRow = {
  ext_id: string;
  scopeLabel: string;
  composed_query: string | null;
  compose_error: string | null;
};

type ComposeStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; rows: ComposeRow[] };

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
    const edge = edges?.find((e) => e.id === `${scope.source_id}--${scope.target_id}` || e.id === scope.source_id + '--' + scope.target_id);
    const sourceLabel = source?.label || scope.source_id;
    const targetLabel = target?.label || scope.target_id;
    return `${sourceLabel} → ${targetLabel}`;
  }
  if ('seed_id' in scope) {
    return `seed: ${scope.seed_id}`;
  }
  return '-';
}

export function SystemTemplateDerivedPanel({
  role,
  modelRefs,
  nodes,
  edges,
  serverId,
  bankId,
  onHealthCheck,
  onRefresh,
  refreshingIds,
}: SystemTemplateDerivedPanelProps) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState<MentalModel | null>(null);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [queryOpen, setQueryOpen] = useState(false);
  const [queryStatus, setQueryStatus] = useState<ComposeStatus>({ state: 'idle' });
  const [querySelectedExtId, setQuerySelectedExtId] = useState<string | null>(null);

  // Load the local system-template definition by role so we can use its source_query.
  useEffect(() => {
    let cancelled = false;
    setLoadingTemplate(true);
    mentalModelsApi
      .list({ limit: 1000 })
      .then((models) => {
        if (cancelled) return;
        const match = models.find((m) => m.template_role === role || m.ext_id === role);
        setTemplate(match || null);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(`Failed to load template: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingTemplate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const roleLabel = MODEL_ROLE_LABELS[role] || role;

  const grounded = useMemo(() => {
    return modelRefs.filter((r) => r.role === role && r.ext_id);
  }, [modelRefs, role]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return grounded;
    return grounded.filter((r) => {
      const scope = getScopeLabel(r, nodes, edges).toLowerCase();
      const extId = (r.ext_id || '').toLowerCase();
      return scope.includes(q) || extId.includes(q);
    });
  }, [grounded, search, nodes, edges]);

  const visibleIds = useMemo(() => filtered.map((r) => r.ext_id!), [filtered]);
  const isAllVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const isSomeVisibleSelected = visibleIds.length > 0 && visibleIds.some((id) => selected.has(id)) && !isAllVisibleSelected;

  const toggleOne = useCallback((extId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(extId)) next.delete(extId);
      else next.add(extId);
      return next;
    });
  }, []);

  const toggleAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (visibleIds.every((id) => next.has(id))) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [visibleIds]);

  const selectedExtIds = useMemo(() => Array.from(selected).filter((id) => grounded.some((r) => r.ext_id === id)), [selected, grounded]);

  const handleRefreshSelected = useCallback(async () => {
    if (!serverId || !bankId) {
      toast.error('Select a server and bank first');
      return;
    }
    if (selectedExtIds.length === 0) {
      toast.error('Select at least one grounded instance');
      return;
    }
    await onRefresh(selectedExtIds);
  }, [serverId, bankId, selectedExtIds, onRefresh]);

  const handleHealth = useCallback(() => {
    if (selectedExtIds.length === 0) {
      toast.error('Select at least one grounded instance');
      return;
    }
    onHealthCheck(selectedExtIds);
  }, [selectedExtIds, onHealthCheck]);

  const handleQuery = useCallback(async () => {
    if (!template) {
      toast.error('Template definition not loaded yet');
      return;
    }
    if (selectedExtIds.length === 0) {
      toast.error('Select at least one grounded instance');
      return;
    }
    setQueryOpen(true);
    setQueryStatus({ state: 'loading' });
    setQuerySelectedExtId(null);
    try {
      const items = selectedExtIds.map((extId) => ({
        role,
        template_role: role,
        source_query: template.source_query || '',
      }));
      const res = await mentalModelsApi.composePreview(items);
      const rows: ComposeRow[] = selectedExtIds.map((extId, i) => ({
        ext_id: extId,
        scopeLabel: getScopeLabel(grounded.find((r) => r.ext_id === extId)!, nodes, edges),
        composed_query: res.results[i]?.composed_query ?? null,
        compose_error: res.results[i]?.compose_error ?? null,
      }));
      setQueryStatus({ state: 'done', rows });
      if (rows.length > 0) setQuerySelectedExtId(rows[0].ext_id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setQueryStatus({ state: 'error', message });
      toast.error(`Compose preview failed: ${message}`);
    }
  }, [template, selectedExtIds, role, grounded, nodes, edges]);

  const selectedQueryRow = useMemo(() => {
    if (queryStatus.state !== 'done') return null;
    return queryStatus.rows.find((r) => r.ext_id === querySelectedExtId) || queryStatus.rows[0] || null;
  }, [queryStatus, querySelectedExtId]);

  const queryRows = useMemo(() => (queryStatus.state === 'done' ? queryStatus.rows : []), [queryStatus]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-white/10 bg-purple-500/10 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-purple-200">Grounded instances</h3>
            <p className="text-[10px] text-purple-300/70">
              {selectedExtIds.length > 0 ? `${selectedExtIds.length} selected · ` : ''}
              {grounded.length} total{search.trim() ? ` · ${filtered.length} shown` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-44">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
              <Input
                type="search"
                placeholder="Search instances..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 pl-8 pr-2 bg-black/20 border-white/10 text-white/80 placeholder:text-white/40 text-xs"
              />
            </div>
            <Button
              onClick={handleHealth}
              disabled={selectedExtIds.length === 0}
              title="Check Hindsight content health"
              className="h-7 px-2 text-xs bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Activity className="h-3.5 w-3.5" />
              Health
            </Button>
            <Button
              onClick={handleRefreshSelected}
              disabled={selectedExtIds.length === 0 || !serverId || !bankId}
              title="Refresh selected grounded instances"
              className="h-7 px-2 text-xs bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshingIds && refreshingIds.size > 0 && 'animate-spin')} />
              Refresh
            </Button>
            <Button
              onClick={handleQuery}
              disabled={selectedExtIds.length === 0 || !template || loadingTemplate}
              title="Preview composed prompts"
              className="h-7 px-2 text-xs bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Eye className="h-3.5 w-3.5" />
              Query
            </Button>
          </div>
        </div>
        {loadingTemplate && (
          <div className="text-[10px] text-white/50">Loading template definition…</div>
        )}
        {!loadingTemplate && !template && (
          <div className="text-[10px] text-amber-300/80">
            No local system template definition found for role <code className="text-amber-200">{role}</code>.
            Query preview is unavailable.
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-0">
        <Table className="w-full caption-bottom text-sm">
          <TableHeader>
            <TableRow className="border-b border-white/10 hover:bg-transparent">
              <TableHead className="w-8 py-2 px-2">
                <Checkbox
                  checked={isAllVisibleSelected}
                  indeterminate={isSomeVisibleSelected}
                  onCheckedChange={toggleAllVisible}
                  aria-label="Select all visible grounded instances"
                />
              </TableHead>
              <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-2">Scope</TableHead>
              <TableHead className="text-xs uppercase text-white/60 font-medium py-2 px-2">External ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-xs text-white/50">
                  {search.trim() ? 'No grounded instances match your search.' : `No grounded instances for ${roleLabel}.`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((ref) => {
                const extId = ref.ext_id || '';
                const isRefreshing = refreshingIds?.has(extId);
                const scopeLabel = getScopeLabel(ref, nodes, edges);
                return (
                  <TableRow key={extId} className="border-b border-white/5 hover:bg-white/5">
                    <TableCell className="py-2 px-2">
                      <Checkbox
                        checked={selected.has(extId)}
                        onCheckedChange={() => toggleOne(extId)}
                        aria-label={`Select ${extId}`}
                      />
                    </TableCell>
                    <TableCell className="py-2 px-2 text-xs text-white/80 truncate" title={scopeLabel}>
                      {scopeLabel}
                    </TableCell>
                    <TableCell className="py-2 px-2 text-xs font-mono text-white/60 truncate" title={extId}>
                      {extId}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={queryOpen} onOpenChange={(open) => !open && setQueryOpen(false)}>
        <DialogContent className="!w-[85vw] !max-w-none max-h-[85vh] overflow-hidden p-0 flex flex-col">
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle className="text-lg font-semibold text-white flex items-center gap-2">
              <Eye className="h-5 w-5 text-purple-400" />
              Composed Query Preview — {roleLabel}
            </DialogTitle>
          </DialogHeader>

          <div className="px-6 py-2 text-xs text-white/50">
            Shows the composed prompt the system template will use for each selected grounded instance.
          </div>

          <div className="flex-1 min-h-0 flex flex-row overflow-hidden px-6 py-3 gap-4">
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-auto">
                {queryStatus.state === 'loading' ? (
                  <div className="h-full flex items-center justify-center gap-2 text-sm text-white/60">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading composed queries…
                  </div>
                ) : queryStatus.state === 'error' ? (
                  <div className="h-full flex items-center justify-center text-sm text-red-400">
                    {queryStatus.message}
                  </div>
                ) : queryStatus.state !== 'done' ? null : (
                  <Table className="w-full caption-bottom text-sm table-fixed">
                    <TableHeader>
                      <TableRow className="border-b border-white/10 hover:bg-transparent">
                        <TableHead className="w-[40%] text-xs uppercase text-white/60 font-medium py-2 px-3">Scope</TableHead>
                        <TableHead className="w-[40%] text-xs uppercase text-white/60 font-medium py-2 px-3">External ID</TableHead>
                        <TableHead className="w-[20%] text-xs uppercase text-white/60 font-medium py-2 px-3">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {queryRows.map((row) => {
                        const selected = selectedQueryRow?.ext_id === row.ext_id;
                        const hasError = !!row.compose_error;
                        const hasContent = !!row.composed_query;
                        return (
                          <TableRow
                            key={row.ext_id}
                            onClick={() => setQuerySelectedExtId(row.ext_id)}
                            className={cn(
                              'border-b border-white/5 cursor-pointer transition-colors',
                              selected ? 'bg-purple-900/30' : 'hover:bg-white/5'
                            )}
                          >
                            <TableCell className="py-2 px-3 text-xs text-white/80 truncate" title={row.scopeLabel}>
                              {row.scopeLabel}
                            </TableCell>
                            <TableCell className="py-2 px-3 text-xs font-mono text-white/60 truncate" title={row.ext_id}>
                              {row.ext_id}
                            </TableCell>
                            <TableCell className="py-2 px-3">
                              <span
                                className={cn(
                                  'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
                                  hasError
                                    ? 'bg-red-500/15 text-red-300 border-red-500/30'
                                    : hasContent
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : 'bg-slate-700/40 text-white/60 border-slate-600'
                                )}
                                title={hasError ? row.compose_error ?? undefined : hasContent ? 'Composed query available' : 'No composed query'}
                              >
                                {hasContent ? 'Composed' : hasError ? 'Failed' : 'Pending'}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>

            <div className="w-1/2 min-w-[360px] flex flex-col border border-white/10 rounded-md overflow-hidden bg-black/20">
              <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-center justify-between">
                <span className="text-xs uppercase text-white/60 font-medium">Composed Query</span>
                {selectedQueryRow && (
                  <span className="text-[10px] text-white/40 tabular-nums">
                    {selectedQueryRow.composed_query?.length?.toLocaleString() ?? 0} chars
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-auto p-3">
                {queryStatus.state === 'loading' ? (
                  <div className="h-full flex items-center justify-center gap-2 text-sm text-white/60">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : selectedQueryRow?.compose_error ? (
                  <div className="h-full flex flex-col gap-2">
                    <span className="text-xs font-medium text-red-300">Composition failed</span>
                    <pre className="text-xs font-mono text-red-300/80 whitespace-pre-wrap break-all">
                      {selectedQueryRow.compose_error}
                    </pre>
                  </div>
                ) : selectedQueryRow?.composed_query ? (
                  <pre className="text-xs font-mono text-white/80 whitespace-pre-wrap break-all">
                    {selectedQueryRow.composed_query}
                  </pre>
                ) : selectedQueryRow ? (
                  <div className="h-full flex items-center justify-center text-sm text-white/50">
                    No composed query available for this instance.
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-white/50">
                    Select an instance to view its composed query.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="shrink-0 px-6 py-4 border-t border-white/10 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setQueryOpen(false)} className="text-white/70 hover:text-white hover:bg-white/5">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
