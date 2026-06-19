'use client';

import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, FolderOpen, Search, X, RefreshCw, Download, TableIcon, Tag } from 'lucide-react';
import { directivesApi } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { BadgeExpandIcon } from '@/components/icons/badge-expand-icon';
import { CreateDirectiveDialog } from '@/components/create-directive-dialog';
import { ViewDirectiveDialog } from '@/components/view-directive-dialog';
import { ManageDirectiveTagsDialog } from '@/components/manage-directive-tags-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { BatchProgressDialog, type BatchItem, type BatchResult } from '@/components/batch-progress-dialog';
import { ImportDialog, parseDirectiveImport } from '@/components/import-dialog';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import type { Directive } from '@/lib/types';

const logger = createLogger('DirectivesPage');

export default function DirectivesPage() {
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedDirective, setSelectedDirective] = useState<Directive | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [batchProgressOpen, setBatchProgressOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchDescription, setBatchDescription] = useState('');
  const [batchOperation, setBatchOperation] = useState<(item: BatchItem) => Promise<void>>(() => async () => {});
  const [importOpen, setImportOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  /* ── Freeze panes + badge display state ── */
  const [freeze, setFreeze] = useState(false);
  const [compactBadges, setCompactBadges] = useState(false);
  const [showAllBadges, setShowAllBadges] = useState(false);

  // Multi-select hook — scoped to filtered results
  const filteredDirectives = useMemo(() => {
    if (!search.trim()) return directives;
    const q = search.toLowerCase();
    return directives.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.statement.toLowerCase().includes(q) ||
        (d.generated_by && d.generated_by.toLowerCase().includes(q)) ||
        d.priority === Number(search) ||
        d.tags?.some((t) => t.name.toLowerCase().includes(q))
    );
  }, [directives, search]);

  const { selected, toggleSelection, toggleAll, clearSelection, isAllSelected } = useMultiSelect(filteredDirectives);
  // Always show selected rows even when filtered out by search
  const displayDirectives = useMemo(() => {
    if (!search.trim()) return filteredDirectives;
    const visibleIds = new Set(filteredDirectives.map((item) => item.id));
    const selectedHidden = directives.filter((item) => selected.has(item.id) && !visibleIds.has(item.id));
    return [...filteredDirectives, ...selectedHidden];
  }, [filteredDirectives, directives, search, selected]);


  const fetchDirectives = async () => {
    setLoading(true);
    try {
      const data = await directivesApi.list();
      setDirectives(data);
    } catch (err) {
      logger.error('Failed to fetch directives', { error: err });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDirectives();
  }, []);

  const openDeleteConfirm = () => {
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    const ids = Array.from(selected) as number[];
    setBatchTitle('Deleting Directives');
    setBatchDescription(`${ids.length} directive${ids.length !== 1 ? 's' : ''}`);
    setBatchItems(ids.map((id) => {
      const dir = directives.find((d) => d.id === id);
      return { id, label: dir?.name || `Directive #${id}` };
    }));
    setBatchOperation(() => async (item: BatchItem) => {
      await directivesApi.delete(item.id as number);
    });
    setConfirmOpen(false);
    setBatchProgressOpen(true);
  };

  const handleBatchDeleteComplete = (results: BatchResult[]) => {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed === 0) {
      toast.success(`${succeeded} directive${succeeded !== 1 ? 's' : ''} deleted`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} delete operations failed`);
    } else {
      toast.warning(`${succeeded} deleted, ${failed} failed`);
    }
    clearSelection();
    fetchDirectives();
  };

  const handleDirectiveClick = (directive: Directive, e: React.MouseEvent) => {
    e.preventDefault();
    // Don't open dialog if clicking on checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    setSelectedDirective(directive);
    setViewOpen(true);
  };

  return (
    <PageShell
      title="Directives"
      loading={loading}
    >
      {/* Action buttons */}
      <div className="flex items-center gap-2 mb-2">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, statement, generated by…"
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
        <Button
          onClick={() => setTagsOpen(true)}
          disabled={selected.size === 0}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-orange-500/30 text-orange-300 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Tag className="h-3.5 w-3.5" />Tags
        </Button>
        <div className="flex-1" />
        <div className="w-px h-5 bg-white/10 mx-1" />
        <Button onClick={() => setImportOpen(true)} title="Import" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><Download className="h-3.5 w-3.5" /></Button>
        <Button onClick={fetchDirectives} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
        <Button
          onClick={openDeleteConfirm}
          disabled={selected.size === 0}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-red-500/30 text-red-400 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"
          title="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className={["rounded-md bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden", !freeze ? "max-h-[calc(100vh-240px)]" : ""].filter(Boolean).join(" ")}>
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-amber-900/20 border-b border-amber-500/30 shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAllBadges(!showAllBadges)}
              title={showAllBadges ? 'Limit to 3 badges' : 'Show all badges'}
              className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", showAllBadges ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <BadgeExpandIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setCompactBadges(!compactBadges)}
              title={compactBadges ? 'Expand badges' : 'Compact badges'}
              className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <BadgeCompactIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setFreeze(!freeze)}
              title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
              className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-amber-500/20 text-amber-400 border border-amber-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-mono text-amber-400 bg-black/30 border border-amber-500/30 px-2 py-0.5 rounded">{filteredDirectives.length} ({selected.size})</span>
          </div>
        </div>

        <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
        <table className="w-full caption-bottom text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className={["w-12 py-2 px-4 text-left", !freeze && "sticky top-0 left-0 z-30 bg-[oklch(0.23_0_0)] border-r border-white/5"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>ID</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Name</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Statement</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Active</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Priority</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Tags</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Generated By</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Created</th>
            </tr>
          </thead>
          <tbody>
            {displayDirectives.length === 0 && !loading ? (
              <tr>
                <td colSpan={9} className="text-center py-8 text-white/70">
                  <div className="flex flex-col items-center gap-2">
                    <FolderOpen className="h-8 w-8 opacity-50" />
                    <p>No directives found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              displayDirectives.map((directive) => (
                <tr
                  key={directive.id}
                  className={`border-b border-white/5 transition-colors cursor-pointer ${
                    selected.has(directive.id) ? 'bg-amber-900/20' : 'hover:bg-white/5'
                  }`}
                  onClick={(e) => handleDirectiveClick(directive, e)}
                >
                  <td className={["py-1.5 px-4", freeze && "sticky left-0 z-10 border-r border-white/5", selected.has(directive.id) ? "bg-amber-900/20" : "bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(directive.id)}
                      onCheckedChange={() => toggleSelection(directive.id)}
                    />
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/50 font-mono">{directive.id}</td>
                  <td className="py-1.5 px-4 text-xs font-semibold text-white">
                    {directive.name ? (
                      <span className={search.trim() && directive.name.toLowerCase().includes(search.toLowerCase()) ? 'text-amber-300' : ''}>
                        {directive.name}
                      </span>
                    ) : (
                      <span className="text-white/30 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/80 max-w-md">
                    <span className={compactBadges ? 'whitespace-normal break-words' : 'truncate block'}>
                      {directive.statement}
                    </span>
                  </td>
                  <td className="py-1.5 px-4 text-xs">
                    {directive.is_active ? (
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-[10px] font-semibold tracking-wide border bg-emerald-950/30 text-emerald-400 border-emerald-500/40">
                        ACTIVE
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-[10px] font-semibold tracking-wide border bg-red-950/30 text-red-400 border-red-500/40">
                        INACTIVE
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/60">{directive.priority ?? 0}</td>
                  <td className="py-1.5 px-4">
                    <div className="flex flex-wrap gap-1">
                      {directive.tags?.length ? (
                        (() => {
                          const tagsToShow = showAllBadges ? directive.tags : directive.tags.slice(0, 3);
                          const remaining = !showAllBadges ? Math.max(0, (directive.tags?.length || 0) - 3) : 0;
                          return (
                            <>
                              {tagsToShow.map((tag) => (
                                <span
                                  key={tag.id}
                                  className="inline-flex px-2 py-0.5 rounded-full text-[10px] border bg-amber-500/20 text-amber-300 border-amber-500/30"
                                >
                                  {tag.name}
                                </span>
                              ))}
                              {remaining > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border bg-amber-500/10 text-amber-400/80 border-amber-500/20">
                                  +{remaining}
                                </span>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <span className="text-white/30 text-xs">-</span>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/60">{directive.generated_by}</td>
                  <td className="py-1.5 px-4 text-xs text-white/50">
                    {formatDistanceToNow(new Date(directive.created_at), { addSuffix: true })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete Selected Directives"
        description={`Are you sure you want to delete ${selected.size} directive${selected.size !== 1 ? 's' : ''}? This action cannot be undone.`}
        onConfirm={handleDeleteConfirmed}
        variant="destructive"
      />

      <BatchProgressDialog
        open={batchProgressOpen}
        onClose={() => {
          setBatchProgressOpen(false);
          setBatchItems([]);
        }}
        title={batchTitle}
        description={batchDescription}
        items={batchItems}
        operation={batchOperation}
        onComplete={handleBatchDeleteComplete}
      />

      <ViewDirectiveDialog
        directive={selectedDirective}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onDirectiveUpdated={fetchDirectives}
      />

      <CreateDirectiveDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDirectiveCreated={fetchDirectives}
      />

      <ManageDirectiveTagsDialog
        isOpen={tagsOpen}
        onClose={() => setTagsOpen(false)}
        selectedDirectiveIds={Array.from(selected) as number[]}
        onTagsUpdated={() => {
          clearSelection();
          fetchDirectives();
        }}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Directives"
        description="Paste CSV with directive name and statement. Optional header: directive_name, directive_statement. Optional columns: is_active, priority."
        placeholder={'directive_name,directive_statement,is_active,priority\n"Quality First","All changes must include tests",true,1\n"Security","Never commit secrets",true,2'}
        parser={parseDirectiveImport}
        onImport={async (item) => {
          await directivesApi.create({
            name: item.data.directive_name,
            statement: item.data.directive_statement,
            is_active: item.data.is_active,
            priority: item.data.priority,
            generated_by: 'import',
          });
        }}
        onDone={() => fetchDirectives()}
        columns={[{ key: 'directive_name', label: 'Name' }, { key: 'directive_statement', label: 'Statement' }]}
      />
    </PageShell>
  );
}
