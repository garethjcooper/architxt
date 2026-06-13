'use client';

import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, FolderOpen, Search, X, RefreshCw, Download, TableIcon } from 'lucide-react';
import { contextsApi } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { CreateContextDialog } from '@/components/create-context-dialog';
import { ViewContextDialog } from '@/components/view-context-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { BatchProgressDialog, type BatchItem, type BatchResult } from '@/components/batch-progress-dialog';
import { ImportDialog, parseContextImport } from '@/components/import-dialog';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import type { Context } from '@/lib/types';

const logger = createLogger('ContextsPage');

export default function ContextsPage() {
  const [contexts, setContexts] = useState<Context[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedContext, setSelectedContext] = useState<Context | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [batchProgressOpen, setBatchProgressOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchDescription, setBatchDescription] = useState('');
  const [batchOperation, setBatchOperation] = useState<(item: BatchItem) => Promise<void>>(() => async () => {});
  const [importOpen, setImportOpen] = useState(false);

  /* ── Freeze panes state ── */
  const [freeze, setFreeze] = useState(false);
  const [compactBadges, setCompactBadges] = useState(false);

  // Multi-select hook — scoped to filtered results
  const filteredContexts = useMemo(() => {
    if (!search.trim()) return contexts;
    const q = search.toLowerCase();
    return contexts.filter(
      (c) =>
        c.description.toLowerCase().includes(q) ||
        (c.generated_by && c.generated_by.toLowerCase().includes(q))
    );
  }, [contexts, search]);

  const { selected, toggleSelection, toggleAll, clearSelection, isAllSelected } = useMultiSelect(filteredContexts);
  // Always show selected rows even when filtered out by search
  const displayContexts = useMemo(() => {
    if (!search.trim()) return filteredContexts;
    const visibleIds = new Set(filteredContexts.map((item) => item.id));
    const selectedHidden = contexts.filter((item) => selected.has(item.id) && !visibleIds.has(item.id));
    return [...filteredContexts, ...selectedHidden];
  }, [filteredContexts, contexts, search, selected]);


  const fetchContexts = async () => {
    setLoading(true);
    try {
      const data = await contextsApi.list();
      setContexts(data);
    } catch (err) {
      logger.error('Failed to fetch contexts', { error: err });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContexts();
  }, []);

  const openDeleteConfirm = () => {
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    const ids = Array.from(selected) as number[];
    setBatchTitle('Deleting Contexts');
    setBatchDescription(`${ids.length} context${ids.length !== 1 ? 's' : ''}`);
    setBatchItems(ids.map((id) => {
      const ctx = contexts.find((c) => c.id === id);
      return { id, label: ctx?.description || `Context #${id}` };
    }));
    setBatchOperation(() => async (item: BatchItem) => {
      await contextsApi.delete(item.id as number);
    });
    setConfirmOpen(false);
    setBatchProgressOpen(true);
  };

  // Compute total impacted documents for delete confirmation
  const impactedDocs = useMemo(() => {
    const ids = Array.from(selected) as number[];
    return ids.reduce((sum, id) => {
      const ctx = contexts.find((c) => c.id === id);
      return sum + (ctx?.usage_count || 0);
    }, 0);
  }, [selected, contexts]);

  const handleBatchDeleteComplete = (results: BatchResult[]) => {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed === 0) {
      toast.success(`${succeeded} context${succeeded !== 1 ? 's' : ''} deleted`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} delete operations failed`);
    } else {
      toast.warning(`${succeeded} deleted, ${failed} failed`);
    }
    clearSelection();
    fetchContexts();
  };

  const handleContextClick = (context: Context, e: React.MouseEvent) => {
    e.preventDefault();
    // Don't open dialog if clicking on checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    setSelectedContext(context);
    setViewOpen(true);
  };

  return (
    <PageShell
      title="Contexts"
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
            placeholder="Search description, generated by…"
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
        <div className="flex-1" />
        <div className="w-px h-5 bg-white/10 mx-1" />
        <Button onClick={() => setImportOpen(true)} title="Import" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><Download className="h-3.5 w-3.5" /></Button>
        <Button onClick={fetchContexts} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
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
        {/* Violet header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-violet-900/20 border-b border-violet-500/30 shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompactBadges(!compactBadges)}
              title={compactBadges ? 'Expand badges' : 'Compact badges'}
              className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-violet-500/20 text-violet-400 border border-violet-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <BadgeCompactIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setFreeze(!freeze)}
              title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
              className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-violet-500/20 text-violet-400 border border-violet-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-mono text-violet-400 bg-black/30 border border-violet-500/30 px-2 py-0.5 rounded">
              {filteredContexts.length} ({selected.size})
            </span>
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
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Context ID</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Description</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Documents</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Generated By</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Created</th>
            </tr>
          </thead>
          <tbody>
            {displayContexts.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-white/70">
                  <div className="flex flex-col items-center gap-2">
                    <FolderOpen className="h-8 w-8 opacity-50" />
                    <p>No contexts found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              displayContexts.map((context) => (
                <tr
                  key={context.id}
                  className={`border-b border-white/5 transition-colors cursor-pointer ${
                    selected.has(context.id) ? 'bg-violet-900/20' : 'hover:bg-white/5'
                  }`}
                  onClick={(e) => handleContextClick(context, e)}
                >
                  <td className={["py-1.5 px-4", freeze && "sticky left-0 z-10 border-r border-white/5", selected.has(context.id) ? "bg-violet-900/20" : "bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(context.id)}
                      onCheckedChange={() => toggleSelection(context.id)}
                    />
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/50 font-mono">{context.id}</td>
                  <td className="py-1.5 px-4 text-xs">
                    {context.description ? (
                      <span
                        className={`${!compactBadges ? 'inline-flex truncate max-w-[150px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                          search.trim() && context.description.toLowerCase().includes(search.toLowerCase())
                            ? 'bg-violet-400/40 text-violet-200 border-violet-400/60 ring-1 ring-violet-400/50'
                            : 'bg-violet-400/20 text-violet-300 border-violet-400/30'
                        }`}
                      >
                        {context.description}
                      </span>
                    ) : (
                      <span className="text-white/30 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs">
                    {context.usage_count ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-blue-400/20 text-blue-300 border border-blue-400/30">
                        {context.usage_count} document{context.usage_count !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-white/30 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/60">{context.generated_by}</td>
                  <td className="py-1.5 px-4 text-xs text-white/50">
                    {formatDistanceToNow(new Date(context.created_at), { addSuffix: true })}
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
        title="Delete Selected Contexts"
        description={
          impactedDocs > 0
            ? `Are you sure you want to delete ${selected.size} context(s)? This will remove the context assignment from ${impactedDocs} document${impactedDocs !== 1 ? 's' : ''}. This action cannot be undone.`
            : `Are you sure you want to delete ${selected.size} context(s)? This action cannot be undone.`
        }
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

      <ViewContextDialog
        context={selectedContext}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onContextUpdated={fetchContexts}
      />

      <CreateContextDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onContextCreated={fetchContexts}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Contexts"
        description="Paste CSV with context descriptions. Optional header: context_description. One context per row."
        placeholder={'context_description\n"Business Capabilities"\n"Technical Architecture"\n"Customer Domain"'}
        parser={parseContextImport}
        onImport={async (item) => {
          await contextsApi.create({
            description: item.data.context_description,
          });
        }}
        onDone={() => fetchContexts()}
        columns={[{ key: 'context_description', label: 'Description' }]}
      />
    </PageShell>
  );
}
