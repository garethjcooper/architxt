'use client';

import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Tags, Search, X, RefreshCw, Download, TableIcon } from 'lucide-react';
import { tagsApi } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { CreateTagDialog } from '@/components/create-tag-dialog';
import { ViewTagDialog } from '@/components/view-tag-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { BatchProgressDialog, type BatchItem, type BatchResult } from '@/components/batch-progress-dialog';
import { ImportDialog, parseTagImport } from '@/components/import-dialog';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import type { Tag } from '@/lib/types';

const logger = createLogger('TagsPage');

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTag, setSelectedTag] = useState<Tag | null>(null);
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
  const filteredTags = useMemo(() => {
    if (!search.trim()) return tags;
    const q = search.toLowerCase();
    return tags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.generated_by && t.generated_by.toLowerCase().includes(q))
    );
  }, [tags, search]);

  const { selected, toggleSelection, toggleAll, clearSelection, isAllSelected } = useMultiSelect(filteredTags);

  // Always show selected rows even when filtered out by search
  const displayTags = useMemo(() => {
    if (!search.trim()) return filteredTags;
    const visibleIds = new Set(filteredTags.map((t) => t.id));
    const selectedHidden = tags.filter((t) => selected.has(t.id) && !visibleIds.has(t.id));
    return [...filteredTags, ...selectedHidden];
  }, [filteredTags, tags, search, selected]);

  const fetchTags = async () => {
    setLoading(true);
    try {
      const data = await tagsApi.list();
      setTags(data);
    } catch (err) {
      logger.error('Failed to fetch tags', { error: err });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, []);

  const openDeleteConfirm = () => {
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    const ids = Array.from(selected) as number[];
    setBatchTitle('Deleting Tags');
    setBatchDescription(`${ids.length} tag${ids.length !== 1 ? 's' : ''}`);
    setBatchItems(ids.map((id) => {
      const tag = tags.find((t) => t.id === id);
      return { id, label: tag?.name || `Tag #${id}` };
    }));
    setBatchOperation(() => async (item: BatchItem) => {
      await tagsApi.delete(item.id as number);
    });
    setConfirmOpen(false);
    setBatchProgressOpen(true);
  };

  // Compute total impacted documents for delete confirmation
  const impactedDocs = useMemo(() => {
    const ids = Array.from(selected) as number[];
    return ids.reduce((sum, id) => {
      const tag = tags.find((t) => t.id === id);
      return sum + (tag?.usage_count || 0);
    }, 0);
  }, [selected, tags]);

  const handleBatchDeleteComplete = (results: BatchResult[]) => {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed === 0) {
      toast.success(`${succeeded} tag${succeeded !== 1 ? 's' : ''} deleted`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} delete operations failed`);
    } else {
      toast.warning(`${succeeded} deleted, ${failed} failed`);
    }
    clearSelection();
    fetchTags();
  };

  const handleTagClick = (tag: Tag, e: React.MouseEvent) => {
    e.preventDefault();
    // Don't open dialog if clicking on checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    setSelectedTag(tag);
    setViewOpen(true);
  };

  return (
    <PageShell
      title="Tags"
      loading={loading}
    >
      <div className="flex items-center gap-2 mb-2">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, generated by…"
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
        <Button onClick={fetchTags} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
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
        {/* Orange header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-orange-900/20 border-b border-orange-500/30 shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompactBadges(!compactBadges)}
              title={compactBadges ? 'Expand badges' : 'Compact badges'}
              className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-orange-500/20 text-orange-400 border border-orange-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <BadgeCompactIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setFreeze(!freeze)}
              title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
              className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-orange-500/20 text-orange-400 border border-orange-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-mono text-orange-400 bg-black/30 border border-orange-500/30 px-2 py-0.5 rounded">
              {filteredTags.length} ({selected.size})
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
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Tag ID</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Name</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Documents</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Generated By</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Created</th>
            </tr>
          </thead>
          <tbody>
            {displayTags.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-white/70">
                  <div className="flex flex-col items-center gap-2">
                    <Tags className="h-8 w-8 opacity-50" />
                    <p>No tags found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              displayTags.map((tag) => (
                <tr
                  key={tag.id}
                  className={`border-b border-white/5 transition-colors cursor-pointer ${
                    selected.has(tag.id) ? 'bg-orange-900/20' : 'hover:bg-white/5'
                  }`}
                  onClick={(e) => handleTagClick(tag, e)}
                >
                  <td className={["py-1.5 px-4", freeze && "sticky left-0 z-10 border-r border-white/5", selected.has(tag.id) ? "bg-orange-900/20" : "bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(tag.id)}
                      onCheckedChange={() => toggleSelection(tag.id)}
                    />
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/50 font-mono">{tag.id}</td>
                  <td className="py-1.5 px-4 text-xs">
                    {tag.name ? (
                      <span
                        className={`${!compactBadges ? 'inline-flex truncate max-w-[150px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                          search.trim() && tag.name.toLowerCase().includes(search.toLowerCase())
                            ? 'bg-orange-400/40 text-orange-200 border-orange-400/60 ring-1 ring-orange-400/50'
                            : 'bg-orange-400/20 text-orange-300 border-orange-400/30'
                        }`}
                      >
                        {tag.name}
                      </span>
                    ) : (
                      <span className="text-white/30 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs">
                    {tag.usage_count ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-blue-400/20 text-blue-300 border border-blue-400/30">
                        {tag.usage_count} document{tag.usage_count !== 1 ? 's' : ''}
                      </span>
                    ) : (
                      <span className="text-white/30 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/60">{tag.generated_by}</td>
                  <td className="py-1.5 px-4 text-xs text-white/50">
                    {formatDistanceToNow(new Date(tag.created_at), { addSuffix: true })}
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
        title="Delete Selected Tags"
        description={
          impactedDocs > 0
            ? `Are you sure you want to delete ${selected.size} tag(s)? This will remove these tags from ${impactedDocs} document${impactedDocs !== 1 ? 's' : ''}. This action cannot be undone.`
            : `Are you sure you want to delete ${selected.size} tag(s)? This action cannot be undone.`
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

      <ViewTagDialog
        tag={selectedTag}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onTagUpdated={fetchTags}
      />

      <CreateTagDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onTagCreated={fetchTags}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Tags"
        description="Paste CSV with tag names. Optional header: tag_name. One tag per row."
        placeholder={'tag_name\n"Project-Alpha"\n"Billing-Module"\n"Customer-Domain"'}
        parser={parseTagImport}
        onImport={async (item) => {
          await tagsApi.create({
            name: item.data.tag_name,
            generated_by: 'import',
          });
        }}
        onDone={() => fetchTags()}
        columns={[{ key: 'tag_name', label: 'Tag Name' }]}
      />
    </PageShell>
  );
}