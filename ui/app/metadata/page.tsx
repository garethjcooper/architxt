'use client';

import { useState, useEffect, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Database as DatabaseIcon, Search, X, RefreshCw, Download, TableIcon } from 'lucide-react';
import { metadataApi, type Metadata } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { CreateMetadataDialog } from '@/components/create-metadata-dialog';
import { ViewMetadataDialog } from '@/components/view-metadata-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { BatchProgressDialog, type BatchItem, type BatchResult } from '@/components/batch-progress-dialog';
import { ImportDialog, parseMetadataImport } from '@/components/import-dialog';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('MetadataPage');

export default function MetadataPage() {
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedMetadata, setSelectedMetadata] = useState<Metadata | null>(null);
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
  const filteredMetadata = useMemo(() => {
    if (!search.trim()) return metadata;
    const q = search.toLowerCase();
    return metadata.filter(
      (m) =>
        m.key.toLowerCase().includes(q) ||
        (m.value && m.value.toLowerCase().includes(q)) ||
        (m.generated_by && m.generated_by.toLowerCase().includes(q)) ||
        m.id.toString().includes(q)
    );
  }, [metadata, search]);

  const { selected, toggleSelection, toggleAll, clearSelection, isAllSelected } = useMultiSelect(filteredMetadata);

  // Only user/import metadata can be deleted
  const deletableSelectedCount = useMemo(() => {
    return Array.from(selected).filter((id) => {
      const m = metadata.find((x) => x.id === id);
      return m && m.generated_by !== 'system';
    }).length;
  }, [selected, metadata]);

  // Always show selected rows even when filtered out by search
  const displayMetadata = useMemo(() => {
    if (!search.trim()) return filteredMetadata;
    const visibleIds = new Set(filteredMetadata.map((m) => m.id));
    const selectedHidden = metadata.filter((m) => selected.has(m.id) && !visibleIds.has(m.id));
    return [...filteredMetadata, ...selectedHidden];
  }, [filteredMetadata, metadata, search, selected]);

  const fetchMetadata = async () => {
    setLoading(true);
    try {
      const data = await metadataApi.list();
      setMetadata(data);
    } catch (err) {
      logger.error('Failed to fetch metadata', { error: err });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetadata();
  }, []);

  const openDeleteConfirm = () => {
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    // Only delete non-system metadata
    const ids = (Array.from(selected) as number[]).filter((id) => {
      const m = metadata.find((x) => x.id === id);
      return m && m.generated_by !== 'system';
    });
    if (ids.length === 0) {
      toast.info('No deletable items selected (system presets are protected)');
      setConfirmOpen(false);
      return;
    }
    setBatchTitle('Deleting Metadata');
    setBatchDescription(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}`);
    setBatchItems(ids.map((id) => {
      const m = metadata.find((x) => x.id === id);
      return { id, label: m ? `${m.key}=${m.value}` : `Meta #${id}` };
    }));
    setBatchOperation(() => async (item: BatchItem) => {
      await metadataApi.delete(item.id as number);
    });
    setConfirmOpen(false);
    setBatchProgressOpen(true);
  };

  // Compute total impacted documents for delete confirmation (only deletable items)
  const impactedDocs = useMemo(() => {
    const ids = (Array.from(selected) as number[]).filter((id) => {
      const m = metadata.find((x) => x.id === id);
      return m && m.generated_by !== 'system';
    });
    return ids.reduce((sum, id) => {
      const m = metadata.find((x) => x.id === id);
      return sum + (m?.usage_count || 0);
    }, 0);
  }, [selected, metadata]);

  const handleBatchDeleteComplete = (results: BatchResult[]) => {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed === 0) {
      toast.success(`${succeeded} ${succeeded === 1 ? 'entry' : 'entries'} deleted`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} delete operations failed`);
    } else {
      toast.warning(`${succeeded} deleted, ${failed} failed`);
    }
    clearSelection();
    fetchMetadata();
  };

  const handleMetadataClick = (item: Metadata, e: React.MouseEvent) => {
    e.preventDefault();
    // Don't open dialog if clicking on checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    setSelectedMetadata(item);
    setViewOpen(true);
  };

  return (
    <PageShell
      title="Metadata"
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
            placeholder="Search key, value, source, id…"
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
        <Button onClick={fetchMetadata} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
        <Button
          onClick={openDeleteConfirm}
          disabled={deletableSelectedCount === 0}
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
        {/* Blue header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-blue-900/20 border-b border-blue-500/30 shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompactBadges(!compactBadges)}
              title={compactBadges ? 'Expand badges' : 'Compact badges'}
              className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-blue-500/20 text-blue-400 border border-blue-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <BadgeCompactIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setFreeze(!freeze)}
              title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
              className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-blue-500/20 text-blue-400 border border-blue-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-mono text-blue-400 bg-black/30 border border-blue-500/30 px-2 py-0.5 rounded">
              {filteredMetadata.length} ({selected.size})
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
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Key</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Value</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Documents</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Source</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Created</th>
            </tr>
          </thead>
          <tbody>
            {displayMetadata.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="text-center py-8 text-white/70">
                  <div className="flex flex-col items-center gap-2">
                    <DatabaseIcon className="h-8 w-8 opacity-50" />
                    <p>No metadata entries found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              displayMetadata.map((item) => {
                const isSystem = item.generated_by === 'system';
                return (
                  <tr
                    key={item.id}
                    className={`border-b border-white/5 transition-colors cursor-pointer ${
                      isSystem
                        ? 'bg-amber-900/10 hover:bg-amber-900/15'
                        : selected.has(item.id)
                          ? 'bg-blue-900/20'
                          : 'hover:bg-white/5'
                    }`}
                    onClick={(e) => handleMetadataClick(item, e)}
                  >
                    <td className={["py-1.5 px-4", freeze && "sticky left-0 z-10 border-r border-white/5", isSystem ? "bg-amber-900/10" : (selected.has(item.id) ? "bg-blue-900/20" : "bg-[oklch(0.23_0_0)]")].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={() => {
                          if (!isSystem) toggleSelection(item.id);
                        }}
                        disabled={isSystem}
                      />
                    </td>
                    <td className="py-1.5 px-4 text-xs">
                      {item.key ? (
                        <span
                          className={`${!compactBadges ? 'inline-flex items-center gap-1 truncate max-w-[150px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                            isSystem
                              ? 'bg-amber-900/30 text-amber-300 border-amber-500/30'
                              : search.trim() && item.key.toLowerCase().includes(search.toLowerCase())
                                ? 'bg-blue-400/40 text-blue-200 border-blue-400/60 ring-1 ring-blue-400/50'
                                : 'bg-blue-400/20 text-blue-300 border-blue-400/30'
                          }`}
                        >
                          {item.key}
                        </span>
                      ) : (
                        <span className="text-white/30 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-1.5 px-4 text-xs">
                      {item.value ? (
                        <span
                          className={`${!compactBadges ? 'inline-flex truncate max-w-[150px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                            isSystem
                              ? 'bg-amber-900/20 text-amber-300/70 border-amber-500/20'
                              : search.trim() && item.value.toLowerCase().includes(search.toLowerCase())
                                ? 'bg-blue-400/40 text-blue-200 border-blue-400/60 ring-1 ring-blue-400/50'
                                : 'bg-blue-400/20 text-blue-300 border-blue-400/30'
                          }`}
                        >
                          {item.value}
                        </span>
                      ) : (
                        <span className="text-white/30 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-1.5 px-4 text-xs">
                      {item.usage_count ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-medium bg-blue-400/20 text-blue-300 border border-blue-400/30">
                          {item.usage_count} document{item.usage_count !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-white/30 text-xs">-</span>
                      )}
                    </td>
                    <td className="py-1.5 px-4 text-xs text-white/50">{item.generated_by}</td>
                    <td className="py-1.5 px-4 text-xs text-white/50">
                      {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete Selected Metadata"
        description={
          deletableSelectedCount === 0
            ? 'No deletable items selected. System metadata presets are protected and cannot be deleted.'
            : impactedDocs > 0
              ? `Are you sure you want to delete ${deletableSelectedCount} metadata ${deletableSelectedCount === 1 ? 'entry' : 'entries'}? This will remove this metadata from ${impactedDocs} document${impactedDocs !== 1 ? 's' : ''}. This action cannot be undone.`
              : `Are you sure you want to delete ${deletableSelectedCount} metadata ${deletableSelectedCount === 1 ? 'entry' : 'entries'}? This action cannot be undone.`
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

      <ViewMetadataDialog
        metadata={selectedMetadata}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onMetadataUpdated={fetchMetadata}
      />

      <CreateMetadataDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onMetadataCreated={fetchMetadata}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Import Metadata"
        description="Paste CSV with key,value pairs. Optional header: key,value. One entry per row."
        placeholder={'key,value\n"source","internal wiki"\n"author","Jane Doe"\n"document-date","2024-01-15"'}
        parser={parseMetadataImport}
        onImport={async (item) => {
          await metadataApi.create({
            key: item.data.key,
            value: item.data.value || undefined,
            generated_by: 'import',
          });
        }}
        onDone={() => fetchMetadata()}
        columns={[
          { key: 'key', label: 'Key' },
          { key: 'value', label: 'Value' },
        ]}
      />
    </PageShell>
  );
}
