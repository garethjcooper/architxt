'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { documentsApi, contextsApi, ApiError, type Context } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import type { Document } from '@/lib/types/index';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
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
import { UploadDialog } from '@/components/upload-dialog';
import { ViewDocumentDialog } from '@/components/view-document-dialog';
import { ManageTagsDialog } from '@/components/manage-tags-dialog';
import { ManageMetadataDialog } from '@/components/manage-metadata-dialog';
import { ManageContextDialog } from '@/components/manage-context-dialog';
import { ManageDocumentConfigDialog } from '@/components/manage-document-config-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { BatchProgressDialog, type BatchItem, type BatchResult } from '@/components/batch-progress-dialog';
import { FileText, AlertCircle, Plus, Trash2, Play, RefreshCw, Tag, FolderOpen, Search, X, ScanSearch, TableIcon, Settings2 } from 'lucide-react';
import { ArchitxtIcon } from '@/components/icons/architxt-icon';
import { toast } from 'sonner';
import { PageShell } from '@/app/components/page-shell';
import { BadgeExpandIcon } from '@/components/icons/badge-expand-icon';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { MetadataIcon } from '@/components/icons/metadata-icon';
import { Button } from '@/components/ui/button';
import { createLogger } from '@/lib/logger';
import { formatErrorSummary } from '@/lib/error-format';
import { getStatusBadge, familyClass } from '@/lib/status-badge';

const logger = createLogger('DocumentsPage');

// Manage tab dropdown options — pure Architxt concepts
const MANAGE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'uploaded', label: 'Uploaded' },
  { value: 'processing_extract', label: 'Extracting' },
  { value: 'extracted', label: 'Extracted' },
];

export default function DocumentsPage() {
  return (
    <Suspense fallback={
      <PageShell title="Documents" subtitle="Upload and process documents." loading={true}>
        <div className="rounded-md overflow-hidden bg-surface-card border border-white/[0.08]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-accent-primary-bg text-accent-primary-fg">
            <span className="font-medium text-sm">Documents</span>
          </div>
          <div className="py-8 text-center text-white/70">Loading...</div>
        </div>
      </PageShell>
    }>
      <DocumentsPageContent />
    </Suspense>
  );
}

function DocumentsPageContent() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [manageFilter, setManageFilter] = useState('all');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [manageTagsDialogOpen, setManageTagsDialogOpen] = useState(false);
  const [manageMetadataDialogOpen, setManageMetadataDialogOpen] = useState(false);
  const [manageContextDialogOpen, setManageContextDialogOpen] = useState(false);
  const [manageConfigDialogOpen, setManageConfigDialogOpen] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [processActionConfirmOpen, setProcessActionConfirmOpen] = useState(false);
  const [batchProgressOpen, setBatchProgressOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchDescription, setBatchDescription] = useState('');
  const [batchOperation, setBatchOperation] = useState<(item: BatchItem) => Promise<void>>(() => async () => {});
  const searchParams = useSearchParams();
  const [freeze, setFreeze] = useState(false);
  const [compactBadges, setCompactBadges] = useState(false);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [search, setSearch] = useState('');

  // Client-side filtering + search (must be before useMultiSelect)
  const filteredDocuments = useMemo(() => {
    let filtered = documents;

    if (manageFilter === 'extracted') {
      filtered = documents.filter(doc =>
        doc.status === 'processed_extract_success' || doc.status === 'processed_extract_failed'
      );
    } else if (manageFilter === 'processing_extract') {
      filtered = documents.filter(doc =>
        doc.status === 'ready_to_extract' || doc.status === 'processing_extract'
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter((d) =>
        d.id.toString().includes(q) ||
        (d.filename && d.filename.toLowerCase().includes(q)) ||
        (d.ext_id && d.ext_id.toLowerCase().includes(q)) ||
        (d.timestamp && d.timestamp.includes(q)) ||
        (d.context?.description && d.context.description.toLowerCase().includes(q)) ||
        (d.tags?.some((t) => t.name.toLowerCase().includes(q))) ||
        (d.metadata?.some((m) => m.key.toLowerCase().includes(q) || (m.value && m.value.toLowerCase().includes(q)))) ||
        (d.has_entities && ['detected', 'entities', 'entity'].some((k) => k.startsWith(q)))
      );
    }

    return filtered;
  }, [documents, manageFilter, search]);

  // Multi-select hooks — scoped to filtered results
  const { selected, toggleSelection, toggleAll, clearSelection } = useMultiSelect(filteredDocuments);
  // Always show selected rows even when filtered out by search
  const displayDocuments = useMemo(() => {
    if (!search.trim()) return filteredDocuments;
    const visibleIds = new Set(filteredDocuments.map((item) => item.id));
    const selectedHidden = documents.filter((item) => selected.has(item.id) && !visibleIds.has(item.id));
    return [...filteredDocuments, ...selectedHidden];
  }, [filteredDocuments, documents, search, selected]);


  // Auto-open upload dialog when ?upload=true
  useEffect(() => {
    if (searchParams.get('upload') === 'true') {
      setUploadDialogOpen(true);
    }
  }, [searchParams]);

  // Clear selections when Manage filter changes
  useEffect(() => {
    clearSelection();
  }, [manageFilter]);

  // Fetch contexts once on mount
  useEffect(() => {
    const loadContexts = async () => {
      try {
        const data = await contextsApi.list();
        setContexts(Array.isArray(data) ? data : []);
      } catch (err) {
        logger.error('Failed to load contexts', err);
      }
    };
    loadContexts();
  }, []);

  // Fetch documents when filter changes
  useEffect(() => {
    fetchDocuments();
  }, [manageFilter]);

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    clearSelection();
    try {
      let params;
      if (manageFilter === 'uploaded') {
        params = { status: 'uploaded' };
      } else {
        params = undefined; // all, extracted, or extracting (filter client-side)
      }

      const data = await documentsApi.list(params);
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 500, 'CLIENT_ERROR'));
    } finally {
      setLoading(false);
    }
  };

  const openDeleteConfirm = () => {
    setDeleteConfirmOpen(true);
  };

  const handleDeleteSelectedConfirmed = async () => {
    const ids = Array.from(selected) as number[];
    setBatchTitle('Deleting Documents');
    setBatchDescription(`${ids.length} document${ids.length !== 1 ? 's' : ''}`);
    setBatchItems(ids.map((id) => {
      const doc = documents.find((d) => d.id === id);
      return { id, label: doc?.ext_id || doc?.filename || `Doc #${id}` } as BatchItem;
    }));
    setBatchOperation(() => async (item: BatchItem) => {
      await documentsApi.delete(item.id as number);
    });
    setDeleteConfirmOpen(false);
    setBatchProgressOpen(true);
  };

  const handleBatchComplete = (results: BatchResult[]) => {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    const isDelete = batchTitle === 'Deleting Documents';
    const verb = isDelete ? 'deleted' : 'extracted';
    const noun = isDelete ? 'delete' : 'extract';
    if (failed === 0) {
      toast.success(`${succeeded} document${succeeded !== 1 ? 's' : ''} ${verb}`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} ${noun} operations failed`);
    } else {
      toast.warning(`${succeeded} ${verb}, ${failed} failed`);
    }
    clearSelection();
    fetchDocuments();
  };

  const handleView = (doc: Document) => {
    setSelectedDocument(doc);
    setViewDialogOpen(true);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB');
  };

  const badgeText = (text: string) => {
    if (compactBadges || text.length <= 30) return text;
    return text.slice(0, 30) + '...';
  };

  const getLastExtractError = (doc: Document): string | null => {
    if (!doc.processing_history?.length) return null;
    const failed = [...doc.processing_history].reverse().find(
      (h) => h.to === 'processed_extract_failed' || h.success === false,
    );
    return failed?.error || null;
  };

  const isAllSelected = filteredDocuments.length > 0 && selected.size === filteredDocuments.length;

  // Dynamic Extract button state — based on selected document statuses
  // Count uploaded (new) and extracted (reprocess) among selected docs
  const extractCounts = useMemo(() => {
    let newCount = 0;
    let reprocessCount = 0;
    // Only process uploaded or extracted items
    selected.forEach((id) => {
      const doc = documents.find((d) => d.id === id);
      if (doc) {
        if (doc.status === 'uploaded') {
          newCount++;
        } else if (doc.status === 'processed_extract_success' || doc.status === 'processed_extract_failed') {
          reprocessCount++;
        }
      }
    });
    return { newCount, reprocessCount };
  }, [selected, documents]);

  // Build dynamic button label
  const extractButtonLabel = useMemo(() => {
    const { newCount, reprocessCount } = extractCounts;
    if (newCount === 0 && reprocessCount === 0) return 'Extract';
    const parts: string[] = [];
    if (newCount > 0) parts.push(`new ${newCount}`);
    if (reprocessCount > 0) parts.push(`reprocess ${reprocessCount}`);
    return `Extract (${parts.join(', ')})`;
  }, [extractCounts]);

  const isExtractDisabled = extractCounts.newCount === 0 && extractCounts.reprocessCount === 0;

  const handleExtractAction = () => {
    if (isExtractDisabled) return;
    setProcessActionConfirmOpen(true);
  };

  return (
    <>
      <UploadDialog
        onUploadComplete={fetchDocuments}
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
      />

      <ViewDocumentDialog
        document={selectedDocument}
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
        onDocumentUpdated={fetchDocuments}
        contexts={contexts}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <PageShell
        title="Documents"
        loading={loading}
      >
        {
          <div className="flex items-center gap-2 mb-2">
              {/* Search */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search id, filename, date, context, tags, metadata…"
                  className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle"
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
              <Button onClick={() => setManageTagsDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-accent-secondary-bd text-accent-secondary-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Tag className="h-3.5 w-3.5" />Tags</Button>
              <Button onClick={() => setManageMetadataDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-accent-secondary-bd text-accent-secondary-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><MetadataIcon className="h-3.5 w-3.5" />Metadata</Button>
              <Button onClick={() => setManageContextDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-accent-secondary-bd text-accent-secondary-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><FolderOpen className="h-3.5 w-3.5" />Context</Button>
              <Button onClick={() => setManageConfigDialogOpen(true)} disabled={selected.size === 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-white/20 text-white/80 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Settings2 className="h-3.5 w-3.5" />Config</Button>
              <Button onClick={handleExtractAction} disabled={isExtractDisabled} className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-accent-secondary-bd text-accent-secondary-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Play className="h-3.5 w-3.5" />{extractButtonLabel}</Button>
              <div className="flex-1" />
              <div className="w-px h-5 bg-white/10 mx-1" />
              <Button onClick={fetchDocuments} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
              <Button onClick={openDeleteConfirm} disabled={selected.size === 0} title="Delete" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-destructive-bd text-destructive-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Trash2 className="h-3.5 w-3.5" /></Button>
              <Button onClick={() => setUploadDialogOpen(true)} title="Add" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"><Plus className="h-3.5 w-3.5" /></Button>
            </div>
        }
        <div className="rounded-md bg-surface-card border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-accent-primary-bg text-accent-primary-fg">
            <div className="flex items-center gap-1">
              {MANAGE_FILTERS.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setManageFilter(f.value)}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${manageFilter === f.value ? 'bg-accent-secondary-bg border-accent-secondary-bd text-accent-secondary-fg' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAllBadges(!showAllBadges)}
                  title={showAllBadges ? 'Limit to 3 badges' : 'Show all badges'}
                  className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", showAllBadges ? "bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
                >
                  <BadgeExpandIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setCompactBadges(!compactBadges)}
                  title={compactBadges ? 'Expand badges' : 'Compact badges'}
                  className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
                >
                  <BadgeCompactIcon className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setFreeze(!freeze)}
                  title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
                  className={["inline-flex items-center justify-center h-6 w-6 rounded-md transition-colors", freeze ? "bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
                >
                  <TableIcon className="h-3.5 w-3.5" />
                </button>
                <span className="text-xs font-mono text-accent-secondary-fg bg-black/30 border border-accent-secondary-bd px-2 py-0.5 rounded">{filteredDocuments.length} ({selected.size})</span>
              </div>
            </div>

          <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
            <table className="w-full caption-bottom text-sm table-fixed">
              <TableHeader>
                <TableRow className="border-b border-white/10">
                  <TableHead className={["w-12 py-1.5 px-4", !freeze && "sticky top-0 left-0 z-30 bg-surface-card border-r border-white/5"].filter(Boolean).join(" ")}>
                    <Checkbox
                      checked={isAllSelected}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead className={["w-12 text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>ID</TableHead>
                  <TableHead className={["w-[25%] text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>External ID</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Document Date</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Tags</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Context</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Metadata</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Char (K)</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Entities</TableHead>
                  <TableHead className={["text-xs uppercase text-white/60 font-medium py-1.5 px-4", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-b border-white/5">
                      <TableCell className={["py-1.5 px-4", !freeze && "sticky left-0 z-10 bg-surface-card border-r border-white/5"].filter(Boolean).join(" ")}><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-8" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell className="py-1.5 px-4"><Skeleton className="h-4 w-16" /></TableCell>
                    </TableRow>
                  ))
                ) : displayDocuments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-white/70">
                      <div className="flex flex-col items-center gap-2">
                        <FileText className="h-8 w-8 opacity-50" />
                        <p>No documents found.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayDocuments.map((doc) => (
                    <TableRow
                      key={doc.id}
                      className={`border-b border-white/5 transition-colors ${
                        selected.has(doc.id) ? 'bg-accent-primary-bg' : 'hover:bg-white/5'
                      }`}
                    >
                      <TableCell className={["py-1.5 px-4", !freeze && `sticky left-0 z-10 border-r border-white/5 ${selected.has(doc.id) ? 'bg-accent-primary-bg' : 'bg-surface-card'}`].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(doc.id)}
                          onCheckedChange={() => toggleSelection(doc.id)}
                        />
                      </TableCell>
                      <TableCell className="py-1.5 px-4 font-mono text-xs cursor-pointer"
                        onClick={() => handleView(doc)}
                      >{doc.id}</TableCell>
                      <TableCell className="py-1.5 px-4 font-mono text-xs cursor-pointer text-white font-semibold"
                        onClick={() => handleView(doc)}
                      ><span className="truncate max-w-full inline-block">{doc.ext_id || '-'}</span></TableCell>
                      <TableCell className="py-1.5 px-4 text-xs cursor-pointer"
                        onClick={() => handleView(doc)}
                      >{formatDate(doc.timestamp) || '-'}</TableCell>
                      <TableCell className="py-1.5 px-4 text-xs cursor-pointer whitespace-normal"
                        onClick={() => handleView(doc)}
                      >
                        <div className="flex flex-wrap gap-1">
                          {(showAllBadges ? doc.tags : doc.tags?.slice(0, 3))?.map((t) => {
                            const isHit = search.trim() && t.name.toLowerCase().includes(search.toLowerCase());
                            return (
                              <span
                                key={t.id}
                                className={`${!compactBadges ? 'inline-flex truncate max-w-[100px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                                  isHit
                                    ? 'bg-destructive-bg-hover text-destructive-fg border-destructive-bd ring-1 ring-destructive-fg/50'
                                    : 'bg-destructive-bg text-destructive-fg border-destructive-bd'
                                }`}
                                title={t.name}
                              >
                                {badgeText(t.name)}
                              </span>
                            );
                          })}
                          {!showAllBadges && (doc.tags?.length || 0) > 3 && (
                            <span
                              className={`text-[10px] px-1 rounded ${
                                search.trim() && doc.tags!.slice(3).some((t) => t.name.toLowerCase().includes(search.toLowerCase()))
                                  ? 'text-destructive-fg bg-destructive-bg'
                                  : 'text-white/30'
                              }`}
                            >
                              +{doc.tags!.length - 3}
                            </span>
                          )}
                          {(!doc.tags || doc.tags.length === 0) && (
                            <span className="text-white/30 text-xs">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="py-1.5 px-4 text-xs cursor-pointer text-white/70 whitespace-normal"
                        onClick={() => handleView(doc)}
                      >
                        {doc.context ? (
                          <span
                            className={`${!compactBadges ? 'inline-flex truncate max-w-full' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                              search.trim() && doc.context.description.toLowerCase().includes(search.toLowerCase())
                                ? `${familyClass.entity} ring-1 ring-badge-entity-fg/50`
                                : familyClass.entity
                            }`}
                            title={doc.context.description}
                          >
                            {badgeText(doc.context.description)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell
                        className="py-1.5 px-4 text-xs cursor-pointer whitespace-normal"
                        onClick={() => handleView(doc)}
                      >
                        <div className="flex flex-wrap gap-1">
                          {(showAllBadges ? doc.metadata : doc.metadata?.slice(0, 3))?.map((m) => {
                            const q = search.toLowerCase();
                            const isHit = search.trim() &&
                              (m.key.toLowerCase().includes(q) || (m.value && m.value.toLowerCase().includes(q)));
                            const label = m.value !== null ? `${m.key}=${m.value}` : m.key;
                            return (
                              <span
                                key={m.key}
                                className={`${!compactBadges ? 'inline-flex truncate max-w-[120px]' : 'inline-block whitespace-normal break-words max-w-[200px]'} px-2.5 py-1 rounded-full text-[10px] border transition-colors ${
                                  isHit
                                    ? 'bg-accent-secondary-bg-hover text-accent-secondary-fg border-accent-secondary-bd ring-1 ring-accent-secondary-fg/50'
                                    : 'bg-accent-secondary-bg text-accent-secondary-fg border-accent-secondary-bd'
                                }`}
                                title={label}
                              >
                                {badgeText(label)}
                              </span>
                            );
                          })}
                          {!showAllBadges && (doc.metadata?.length || 0) > 3 && (
                            <span
                              className={`text-[10px] px-1 rounded ${
                                search.trim() && doc.metadata!.slice(3).some((m) => {
                                  const q = search.toLowerCase();
                                  return m.key.toLowerCase().includes(q) || (m.value && m.value.toLowerCase().includes(q));
                                })
                                  ? 'text-accent-secondary-fg bg-accent-secondary-bg'
                                  : 'text-white/30'
                              }`}
                            >
                              +{doc.metadata!.length - 3}
                            </span>
                          )}
                          {(!doc.metadata || doc.metadata.length === 0) && (
                            <span className="text-white/30 text-xs">-</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell
                        className="py-1.5 px-4 text-xs cursor-pointer font-mono text-white/60"
                        onClick={() => handleView(doc)}
                      >{doc.content_length_k != null ? `${doc.content_length_k}K` : '-'}</TableCell>
                      <TableCell
                        className="py-1.5 px-4 text-xs cursor-pointer"
                        onClick={() => handleView(doc)}
                      >
                        {doc.has_entities ? (
                          <Badge className={`${familyClass.entity} text-[10px] px-2.5 py-1 border inline-flex items-center gap-1`}>
                            <ScanSearch className="h-3 w-3" />
                            Detected
                          </Badge>
                        ) : (
                          <span className="text-white/30 text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell
                        className="py-1.5 px-4 text-xs cursor-pointer"
                        onClick={() => handleView(doc)}
                      >
                        <Badge
                          title={getLastExtractError(doc) || undefined}
                          className={`${getStatusBadge(doc.status).className} text-[10px] px-2.5 py-1 border inline-flex items-center gap-1`}
                        >
                          {doc.status === 'processed_extract_failed' ? (
                            <AlertCircle className="h-3 w-3 shrink-0" />
                          ) : (
                            <ArchitxtIcon className="h-3 w-3" />
                          )}
                          {getStatusBadge(doc.status).label}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </table>
          </div>
        </div>
      </PageShell>

      <ManageTagsDialog
        isOpen={manageTagsDialogOpen}
        onClose={() => setManageTagsDialogOpen(false)}
        selectedDocIds={useMemo(() => Array.from(selected), [selected])}
        onTagsUpdated={() => {
          clearSelection();
          fetchDocuments();
        }}
      />

      <ManageMetadataDialog
        isOpen={manageMetadataDialogOpen}
        onClose={() => setManageMetadataDialogOpen(false)}
        selectedDocIds={useMemo(() => Array.from(selected), [selected])}
        onMetadataUpdated={() => {
          clearSelection();
          fetchDocuments();
        }}
      />

      <ManageContextDialog
        isOpen={manageContextDialogOpen}
        onClose={() => setManageContextDialogOpen(false)}
        selectedDocIds={useMemo(() => Array.from(selected), [selected])}
        onContextUpdated={() => {
          clearSelection();
          fetchDocuments();
        }}
      />

      <ManageDocumentConfigDialog
        isOpen={manageConfigDialogOpen}
        onClose={() => setManageConfigDialogOpen(false)}
        selectedDocIds={useMemo(() => Array.from(selected), [selected])}
        documents={documents}
        onConfigUpdated={() => {
          clearSelection();
          fetchDocuments();
        }}
      />

      <ConfirmDialog
        open={processActionConfirmOpen}
        onOpenChange={setProcessActionConfirmOpen}
        title="Are you sure?"
        description={(() => {
          const { newCount, reprocessCount } = extractCounts;
          const parts: string[] = [];
          if (newCount > 0) {
            parts.push(`extract ${newCount} new document${newCount !== 1 ? 's' : ''}`);
          }
          if (reprocessCount > 0) {
            parts.push(`re-extract ${reprocessCount} document${reprocessCount !== 1 ? 's' : ''}`);
          }
          const actionText = parts.join(' and ');
          const overwriteNote = reprocessCount > 0 ? ' Re-extraction will overwrite existing extracted content.' : '';
          return `You are about to ${actionText}.${overwriteNote} This action cannot be undone.`;
        })()}
        onConfirm={() => {
          // Only process documents that are in an extractable state
          const eligibleStatuses = ['uploaded', 'processed_extract_success', 'processed_extract_failed'];
          const ids = (Array.from(selected) as number[]).filter((id) => {
            const doc = documents.find((d) => d.id === id);
            return doc && eligibleStatuses.includes(doc.status);
          });
          const { reprocessCount } = extractCounts;
          setBatchTitle(reprocessCount > 0 ? 'Extracting / Re-extracting Documents' : 'Extracting Documents');
          setBatchDescription(`${ids.length} document${ids.length !== 1 ? 's' : ''}`);
          setBatchItems(ids.map((id) => {
            const doc = documents.find((d) => d.id === id);
            return { id, label: doc?.ext_id || doc?.filename || `Doc #${id}` };
          }));
          setBatchOperation(() => async (item: BatchItem) => {
            await documentsApi.process(item.id as number);
          });
          setProcessActionConfirmOpen(false);
          setBatchProgressOpen(true);
        }}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete Selected Documents"
        description={`Are you sure you want to delete ${selected.size} document(s)? This action cannot be undone.`}
        onConfirm={handleDeleteSelectedConfirmed}
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
        onComplete={handleBatchComplete}
      />
    </>
  );
}
