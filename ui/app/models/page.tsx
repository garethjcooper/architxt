'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { mentalModelsApi, ApiError } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import type { MentalModel } from '@/lib/types/index';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { ManageModelTagsDialog } from '@/components/manage-model-tags-dialog';
import { ManageModelEntitiesDialog } from '@/components/manage-model-entities-dialog';
import { ManageModelConfigDialog } from '@/components/manage-model-config-dialog';
import { ModelForm } from '@/components/model-form';
import { ModelDetailsDialog } from '@/components/model-details-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Plus, Trash2, RefreshCw, Tag, Search, X, TableIcon, Settings2, LayoutTemplate } from 'lucide-react';
import { EntityIcon } from '@/components/icons/entity-icon';
import { toast } from 'sonner';
import { PageShell } from '@/app/components/page-shell';
import { BadgeExpandIcon } from '@/components/icons/badge-expand-icon';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ModelsPage');

export default function ModelsPage() {
  return (
    <Suspense fallback={
      <PageShell title="Models" loading={true}>
        <div className="rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-emerald-900/20 text-emerald-300">
            <span className="font-medium text-sm">Mental Models</span>
          </div>
          <div className="py-8 text-center text-white/70">Loading...</div>
        </div>
      </PageShell>
    }>
      <ModelsPageContent />
    </Suspense>
  );
}

function ModelsPageContent() {
  const [models, setModels] = useState<MentalModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [manageTagsDialogOpen, setManageTagsDialogOpen] = useState(false);
  const [manageEntitiesDialogOpen, setManageEntitiesDialogOpen] = useState(false);
  const [manageConfigDialogOpen, setManageConfigDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<MentalModel | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [freeze, setFreeze] = useState(false);
  const [compactBadges, setCompactBadges] = useState(false);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [search, setSearch] = useState('');
  const searchParams = useSearchParams();

  const filteredModels = useMemo(() => {
    let filtered = models;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((m) =>
        m.id.toString().includes(q) ||
        (m.ext_id && m.ext_id.toLowerCase().includes(q)) ||
        (m.name && m.name.toLowerCase().includes(q)) ||
        (m.source_query && m.source_query.toLowerCase().includes(q)) ||
        (m.tags?.some((t) => t.name.toLowerCase().includes(q))) ||
        (m.entities?.some((e) => e.name.toLowerCase().includes(q) || e.entity_id.toLowerCase().includes(q)))
      );
    }
    return filtered;
  }, [models, search]);

  const { selected, toggleSelection, toggleAll, clearSelection } = useMultiSelect(filteredModels);
  const displayModels = useMemo(() => {
    if (!search.trim()) return filteredModels;
    const visibleIds = new Set(filteredModels.map((item) => item.id));
    const selectedHidden = models.filter((item) => selected.has(item.id) && !visibleIds.has(item.id));
    return [...filteredModels, ...selectedHidden];
  }, [filteredModels, models, search, selected]);

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setCreateDialogOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchModels();
  }, []);

  async function fetchModels() {
    try {
      setLoading(true);
      setError(null);
      clearSelection();
      const response = await mentalModelsApi.list({ limit: 1000 });
      setModels(Array.isArray(response) ? response : []);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(String(err), 500, 'CLIENT_ERROR');
      setError(apiErr);
      logger.error('Failed to load mental models', { error: apiErr.message });
    } finally {
      setLoading(false);
    }
  }

  const openDeleteConfirm = () => {
    setDeleteConfirmOpen(true);
  };

  const handleDeleteSelectedConfirmed = async () => {
    const ids = Array.from(selected) as number[];
    try {
      await Promise.all(ids.map((id) => mentalModelsApi.delete(id)));
      toast.success(`Deleted ${ids.length} mental model(s)`);
      clearSelection();
      setDeleteConfirmOpen(false);
      fetchModels();
    } catch (err) {
      toast.error('Failed to delete mental models');
    }
  };

  const handleRowClick = (model: MentalModel) => {
    setSelectedModel(model);
    setDetailsOpen(true);
  };

  const formatDate = (date?: string | null) => {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB');
  };

  const badgeText = (text: string) => {
    if (compactBadges || text.length <= 30) return text;
    return text.slice(0, 30) + '...';
  };

  const isAllSelected = filteredModels.length > 0 && selected.size === filteredModels.length;

  return (
    <>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <PageShell title="Models" loading={loading}>
        {
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search id, ext id, name, source query, tags, entities…"
                className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <Button onClick={() => setManageTagsDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-orange-500/30 text-orange-300 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Tag className="h-3.5 w-3.5" />Tags</Button>
            <Button onClick={() => setManageEntitiesDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-emerald-500/30 text-emerald-300 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><EntityIcon className="h-3.5 w-3.5" />Entities</Button>
            <Button onClick={() => setManageConfigDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/20 text-white/80 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Settings2 className="h-3.5 w-3.5" />Config</Button>
            <div className="flex-1" />
            <div className="w-px h-5 bg-white/10 mx-1" />
            <Button onClick={fetchModels} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
            <Button onClick={openDeleteConfirm} disabled={selected.size === 0} title="Delete" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-red-500/30 text-red-400 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Trash2 className="h-3.5 w-3.5" /></Button>
            <Button onClick={() => setCreateDialogOpen(true)} title="Add" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><Plus className="h-3.5 w-3.5" /></Button>
          </div>
        }
        <div className={["rounded-md bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden", !freeze ? "max-h-[calc(100vh-240px)]" : ""].filter(Boolean).join(" ")}>
          <div className="flex items-center justify-end px-3 py-2 border-b border-white/10 bg-emerald-900/20 text-emerald-300">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAllBadges(!showAllBadges)}
                title={showAllBadges ? 'Limit to 3 badges' : 'Show all badges'}
                className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", showAllBadges ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
              >
                <BadgeExpandIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => setCompactBadges(!compactBadges)}
                title={compactBadges ? 'Expand badges' : 'Compact badges'}
                className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
              >
                <BadgeCompactIcon className="h-5 w-5" />
              </button>
              <button
                onClick={() => setFreeze(!freeze)}
                title={freeze ? 'Unfreeze panes' : 'Freeze panes'}
                className={["inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors", freeze ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
              >
                <TableIcon className="h-3.5 w-3.5" />
              </button>
              <span className="text-xs font-mono text-emerald-400 bg-black/30 border border-emerald-500/30 px-2 py-0.5 rounded">{filteredModels.length} ({selected.size})</span>
            </div>
          </div>

          <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
            <table className="w-full caption-bottom text-sm table-fixed">
              <TableHeader>
                <TableRow className="border-b border-white/10">
                  <TableHead className={["w-12 py-1.5 px-4", !freeze && "sticky top-0 left-0 z-30 bg-[oklch(0.23_0_0)] border-r border-white/5"].filter(Boolean).join(" ")}>
                    <Checkbox checked={isAllSelected} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead className={["w-12 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>ID</TableHead>
                  <TableHead className={["w-20 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Template</TableHead>
                  <TableHead className={["w-[16%] text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>External ID</TableHead>
                  <TableHead className={["w-[16%] text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Name</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Entities</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Tags</TableHead>
                  <TableHead className={["w-24 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Tags Match</TableHead>
                  <TableHead className={["w-28 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Refresh Type</TableHead>
                  <TableHead className={["w-32 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Refresh After</TableHead>
                  <TableHead className={["w-24 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Exclude All</TableHead>
                  <TableHead className={["w-24 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Max Tokens</TableHead>
                  <TableHead className={["w-32 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-b border-white/5">
                      <TableCell className={["py-1.5 px-4", !freeze && "sticky left-0 z-10 bg-[oklch(0.23_0_0)] border-r border-white/5"].filter(Boolean).join(" ")}><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-8" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-14" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-10" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : displayModels.length === 0 ? (
                  <TableRow>
                  <TableCell colSpan={12} className="text-center py-8 text-white/70">
                      <div className="flex flex-col items-center gap-2">
                        <EntityIcon className="h-8 w-8 opacity-50" />
                        <p>No mental models found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayModels.map((model) => (
                    <TableRow
                      key={model.id}
                      onClick={() => handleRowClick(model)}
                      className={`border-b border-white/5 transition-colors cursor-pointer ${
                        selected.has(model.id) ? 'bg-emerald-900/20' : 'hover:bg-white/5'
                      }`}
                    >
                      <TableCell className={["py-1.5 px-4", !freeze && `sticky left-0 z-10 border-r border-white/5 ${selected.has(model.id) ? 'bg-emerald-900/20' : 'bg-[oklch(0.23_0_0)]'}`].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(model.id)}
                          onCheckedChange={() => toggleSelection(model.id)}
                        />
                      </TableCell>
                      <TableCell className="py-1.5 px-4 font-mono text-xs">{model.id}</TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        {model.is_template ? (
                          <Badge className="text-[10px] px-2.5 py-1 border inline-flex items-center gap-1 bg-purple-800/15 text-purple-400 border-purple-700/20">
                            Template
                          </Badge>
                        ) : (
                          <span className="text-white/30">-</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 font-mono text-xs text-white font-semibold">
                        <span className="truncate max-w-full inline-block">{model.ext_id || '-'}</span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-white/70">{model.name || '-'}</TableCell>
                      <TableCell className="py-1.5 px-4 text-xs whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {(showAllBadges ? model.entities : model.entities?.slice(0, 3))?.map((e) => {
                            const isHit = search.trim() && (e.name.toLowerCase().includes(search.toLowerCase()) || e.entity_id.toLowerCase().includes(search.toLowerCase()));
                            return (
                              <span
                                key={e.id}
                                className={`${!compactBadges ? 'inline-flex truncate max-w-[100px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                                  isHit
                                    ? 'bg-purple-400/40 text-purple-200 border-purple-400/60 ring-1 ring-purple-400/50'
                                    : 'bg-purple-800/15 text-purple-400 border-purple-700/20'
                                }`}
                                title={`${e.entity_id} — ${e.name}`}
                              >
                                {badgeText(`${e.entity_id} — ${e.name}`)}
                              </span>
                            );
                          })}
                          {!showAllBadges && (model.entities?.length || 0) > 3 && (
                            <span
                              className={`text-[10px] px-1 rounded ${
                                search.trim() && model.entities!.slice(3).some((e) => e.name.toLowerCase().includes(search.toLowerCase()) || e.entity_id.toLowerCase().includes(search.toLowerCase()))
                                  ? 'text-purple-300 bg-purple-400/15'
                                  : 'text-white/30'
                              }`}
                            >
                              +{model.entities!.length - 3}
                            </span>
                          )}
                          {(!model.entities || model.entities.length === 0) && (
                            <span className="text-white/30 text-xs">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs whitespace-normal">
                        <div className="flex flex-wrap gap-1">
                          {(showAllBadges ? model.tags : model.tags?.slice(0, 3))?.map((t) => {
                            const isHit = search.trim() && t.name.toLowerCase().includes(search.toLowerCase());
                            return (
                              <span
                                key={t.id}
                                className={`${!compactBadges ? 'inline-flex truncate max-w-[100px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                                  isHit
                                    ? 'bg-orange-400/40 text-orange-200 border-orange-400/60 ring-1 ring-orange-400/50'
                                    : 'bg-orange-400/20 text-orange-300 border-orange-400/30'
                                }`}
                                title={t.name}
                              >
                                {badgeText(t.name)}
                              </span>
                            );
                          })}
                          {!showAllBadges && (model.tags?.length || 0) > 3 && (
                            <span
                              className={`text-[10px] px-1 rounded ${
                                search.trim() && model.tags!.slice(3).some((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                                  ? 'text-orange-300 bg-orange-400/15'
                                  : 'text-white/30'
                              }`}
                            >
                              +{model.tags!.length - 3}
                            </span>
                          )}
                          {(!model.tags || model.tags.length === 0) && (
                            <span className="text-white/30 text-xs">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-white/70">
                        {model.tags_match_mode ?? 'all_strict'}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-slate-700/40 text-white/80 border-slate-600">
                          {model.refresh_mode === 'delta' ? 'Delta' : 'Full'}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                          model.refresh_after_consolidation
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-700/40 text-white/60 border-slate-600'
                        }`}>
                          {model.refresh_after_consolidation ? 'ON' : 'OFF'}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                          model.exclude_all_mental_models
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : 'bg-slate-700/40 text-white/60 border-slate-600'
                        }`}>
                          {model.exclude_all_mental_models ? 'ON' : 'OFF'}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs font-mono text-white/70">
                        {model.max_tokens ?? 2048}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-white/50">
                        {formatDistanceToNow(new Date(model.created_at), { addSuffix: true })}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
        </div>
      </PageShell>

      <ManageModelTagsDialog
        isOpen={manageTagsDialogOpen}
        onClose={() => setManageTagsDialogOpen(false)}
        selectedModelIds={useMemo(() => Array.from(selected), [selected])}
        onTagsUpdated={() => {
          clearSelection();
          fetchModels();
        }}
      />

      <ManageModelEntitiesDialog
        isOpen={manageEntitiesDialogOpen}
        onClose={() => setManageEntitiesDialogOpen(false)}
        selectedModelIds={useMemo(() => Array.from(selected), [selected])}
        onEntitiesUpdated={() => {
          clearSelection();
          fetchModels();
        }}
      />

      <ManageModelConfigDialog
        isOpen={manageConfigDialogOpen}
        onClose={() => setManageConfigDialogOpen(false)}
        selectedModelIds={useMemo(() => Array.from(selected), [selected])}
        models={models}
        onConfigUpdated={() => {
          clearSelection();
          fetchModels();
        }}
      />

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[oklch(0.23_0_0)] border border-white/10 rounded-lg p-6 max-w-sm w-full shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-2">Delete Selected Models</h2>
            <p className="text-sm text-white/70 mb-6">Are you sure you want to delete {selected.size} mental model(s)? This action cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)} className="text-white/70 hover:text-white hover:bg-white/5">Cancel</Button>
              <Button onClick={handleDeleteSelectedConfirmed} className="bg-red-600 hover:bg-red-700 text-white">Delete</Button>
            </div>
          </div>
        </div>
      )}

      {createDialogOpen && (
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold text-white">Create Mental Model</DialogTitle>
            </DialogHeader>
            <ModelForm
              onSubmit={async (data) => {
                try {
                  await mentalModelsApi.create(data);
                  toast.success('Mental model created');
                  setCreateDialogOpen(false);
                  fetchModels();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : 'Failed to create mental model');
                }
              }}
              onCancel={() => setCreateDialogOpen(false)}
              submitLabel="Create"
            />
          </DialogContent>
        </Dialog>
      )}

      {detailsOpen && selectedModel && (
        <ModelDetailsDialog
          model={selectedModel}
          open={detailsOpen}
          onOpenChange={(open) => {
            setDetailsOpen(open);
            if (!open) setSelectedModel(null);
          }}
          onUpdated={() => {
            setDetailsOpen(false);
            setSelectedModel(null);
            fetchModels();
          }}
        />
      )}
    </>
  );
}
