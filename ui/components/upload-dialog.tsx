/**
 * Upload Component — multi-file support with shared context & tags
 * Phased UX matching ImportDialog: select → running → done
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Upload,
  Loader2,
  X,
  FileText,
  AlertCircle,
  CheckCircle2,
  Tag,
  FolderOpen,
  ScrollText,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { contextsApi, tagsApi, metadataApi } from '@/lib/api/client';
import type { Context, Tag as TagType, Metadata } from '@/lib/types/index';

const logger = createLogger('UploadDialog');

const API_URL = '/api/v1';

type UploadPhase = 'select' | 'running' | 'done';

interface UploadFileItem {
  id: string;
  file: File;
  extId: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  error?: string;
}

interface UploadDialogProps {
  onUploadComplete?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function filenameToExtId(name: string): string {
  return name.replace(/\.[^/.]+$/, '');
}

let _idCounter = 0;
function nextId(): string {
  return `uf-${++_idCounter}-${Date.now().toString(36)}`;
}

export function UploadDialog({ onUploadComplete, open: controlledOpen, onOpenChange }: UploadDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = onOpenChange || setInternalOpen;

  const [items, setItems] = useState<UploadFileItem[]>([]);
  const [phase, setPhase] = useState<UploadPhase>('select');
  const [progress, setProgress] = useState({ current: 0, total: 0, succeeded: 0, failed: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  // Shared context & tags for the batch
  const [allContexts, setAllContexts] = useState<Context[]>([]);
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [allMetadata, setAllMetadata] = useState<Metadata[]>([]);
  const [selectedContextId, setSelectedContextId] = useState<number | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
  const [selectedMetaIds, setSelectedMetaIds] = useState<Set<number>>(new Set());
  const [prefsLoading, setPrefsLoading] = useState(false);

  /* ── Reset on open ─────────────────────── */
  useEffect(() => {
    if (open) {
      setItems([]);
      setPhase('select');
      setProgress({ current: 0, total: 0, succeeded: 0, failed: 0 });
      abortRef.current = false;
      setSelectedContextId(null);
      setSelectedTagIds(new Set());
      setSelectedMetaIds(new Set());
    }
  }, [open]);

  // Load contexts, tags & metadata once when dialog opens
  useEffect(() => {
    if (!open) return;
    setPrefsLoading(true);
    Promise.all([
      contextsApi.list().catch(() => [] as Context[]),
      tagsApi.list().catch(() => [] as TagType[]),
      metadataApi.list().catch(() => [] as Metadata[]),
    ])
      .then(([ctxs, tgs, mds]) => {
        setAllContexts(ctxs);
        setAllTags(tgs);
        setAllMetadata(mds);
      })
      .catch(() => {
        // non-fatal — user can still upload without tags/context/metadata
      })
      .finally(() => setPrefsLoading(false));
  }, [open]);

  const addFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newItems: UploadFileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      newItems.push({ id: nextId(), file, extId: filenameToExtId(file.name), status: 'pending' });
    }
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    e.target.value = '';
  }, [addFiles]);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const updateExtId = useCallback((id: string, extId: string) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, extId } : it)));
  }, []);

  const handleClose = useCallback(() => {
    if (phase === 'running') return;
    setOpen(false);
    if (phase === 'done' && progress.succeeded > 0) {
      onUploadComplete?.();
    }
  }, [phase, progress.succeeded, setOpen, onUploadComplete]);

  const toggleTag = useCallback((tagId: number) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }, []);

  const toggleMeta = useCallback((metaId: number) => {
    setSelectedMetaIds((prev) => {
      const next = new Set(prev);
      if (next.has(metaId)) next.delete(metaId);
      else next.add(metaId);
      return next;
    });
  }, []);

  const uploadAll = useCallback(async () => {
    if (items.length === 0) return;
    const emptyItems = items.filter((it) => !it.extId.trim());
    if (emptyItems.length > 0) {
      toast.error(`${emptyItems.length} file(s) missing an External ID`);
      return;
    }

    const pendingItems = items.filter((it) => it.status === 'pending');
    if (pendingItems.length === 0) return;

    setPhase('running');
    abortRef.current = false;
    setProgress({ current: 0, total: pendingItems.length, succeeded: 0, failed: 0 });

    let succeeded = 0;
    let failed = 0;
    let current = 0;

    for (const item of pendingItems) {
      if (abortRef.current) break;

      current++;
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, status: 'uploading' } : it))
      );
      setProgress((p) => ({ ...p, current }));

      const formData = new FormData();
      formData.append('file', item.file);
      formData.append('ext_id', item.extId.trim());
      if (selectedContextId !== null) {
        formData.append('context_id', String(selectedContextId));
      }
      if (selectedTagIds.size > 0) {
        formData.append('tags_to_add', JSON.stringify([...selectedTagIds]));
      }
      if (selectedMetaIds.size > 0) {
        formData.append('metadata_to_add', JSON.stringify([...selectedMetaIds]));
      }

      try {
        const response = await fetch(`${API_URL}/documents`, {
          method: 'POST',
          body: formData,
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Upload failed: ${response.status}`);
        }
        setItems((prev) =>
          prev.map((it) => (it.id === item.id ? { ...it, status: 'success' } : it))
        );
        succeeded++;
        setProgress((p) => ({ ...p, succeeded }));
      } catch (err: any) {
        const message = err?.message || String(err) || 'Failed';
        logger.warn('Upload failed', { file: item.file.name, error: message });
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id ? { ...it, status: 'error', error: message } : it
          )
        );
        failed++;
        setProgress((p) => ({ ...p, failed }));
      }
    }

    setPhase('done');
    if (succeeded > 0) toast.success(`${succeeded} document(s) uploaded`);
    if (failed > 0) toast.error(`${failed} upload(s) failed`);
  }, [items, selectedContextId, selectedTagIds, selectedMetaIds]);

  const pendingCount = items.filter((it) => it.status === 'pending').length;
  const hasErrors = items.some((it) => it.status === 'error');
  const doneSuccess = progress.succeeded > 0 && progress.failed === 0;
  const doneFailed = progress.succeeded === 0 && progress.failed > 0;
  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      {controlledOpen === undefined && (
        <DialogTrigger
          render={
            <Button>
              <Upload className="mr-2 h-4 w-4" />
              Upload Document
            </Button>
          }
        />
      )}

      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto min-h-0">
          {/* ═══════════════ SELECT PHASE ═══════════════ */}
          {phase === 'select' && (
            <>
              {/* Shared Context & Tags */}
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
                {/* Context selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/60 flex items-center gap-1.5">
                    <FolderOpen className="h-3 w-3" /> Context (applies to all)
                  </Label>
                  {prefsLoading ? (
                    <div className="h-8 bg-white/5 rounded animate-pulse" />
                  ) : (
                    <select
                      value={selectedContextId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSelectedContextId(v === '' ? null : parseInt(v, 10));
                      }}
                      className="w-full h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
                    >
                      <option value="">None</option>
                      {allContexts.map((ctx) => (
                        <option key={ctx.id} value={ctx.id}>{ctx.description || `Context ${ctx.id}`}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Tag selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/60 flex items-center gap-1.5">
                    <Tag className="h-3 w-3" /> Tags (applies to all)
                  </Label>
                  {prefsLoading ? (
                    <div className="h-6 bg-white/5 rounded animate-pulse" />
                  ) : allTags.length === 0 ? (
                    <p className="text-xs text-white/40 italic">No tags available</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {allTags.map((tag) => {
                        const active = selectedTagIds.has(tag.id);
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={`
                              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                              transition-colors border
                              ${active
                                ? 'bg-orange-800/30 text-orange-400 border-orange-500/40'
                                : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white/70'
                              }
                            `}
                          >
                            {active && <span>✓</span>}
                            {tag.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Metadata selector */}
                <div className="space-y-1.5">
                  <Label className="text-xs text-white/60 flex items-center gap-1.5">
                    <ScrollText className="h-3 w-3" /> Metadata (applies to all)
                  </Label>
                  {prefsLoading ? (
                    <div className="h-6 bg-white/5 rounded animate-pulse" />
                  ) : allMetadata.length === 0 ? (
                    <p className="text-xs text-white/40 italic">No metadata available</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {allMetadata.map((meta) => {
                        const active = selectedMetaIds.has(meta.id);
                        const isSystem = meta.generated_by === 'system';
                        return (
                          <button
                            key={meta.id}
                            type="button"
                            onClick={() => toggleMeta(meta.id)}
                            className={`
                              inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
                              transition-colors border
                              ${active
                                ? isSystem
                                  ? 'bg-slate-700/40 text-slate-300 border-slate-500/40'
                                  : 'bg-blue-800/30 text-blue-400 border-blue-500/40'
                                : isSystem
                                  ? 'bg-white/5 text-white/40 border-white/10 hover:bg-white/10 hover:text-white/60'
                                  : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10 hover:text-white/70'
                              }
                            `}
                          >
                            {active && <span>✓</span>}
                            <span className="font-mono text-[10px]">{meta.key}</span>
                            {meta.value && <span className="text-white/40">={meta.value}</span>}
                            {isSystem && <span className="text-[9px] text-slate-500 ml-0.5">(system)</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Drag & Drop Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`
                  border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
                  transition-colors hover:bg-white/5
                  ${items.length > 0 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/30'}
                `}
              >
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8 text-white/70" />
                  <p className="font-medium text-white text-sm">Drag & drop files here, or click to select</p>
                  <p className="text-xs text-white/50">Multiple files supported</p>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleInputChange}
                />
              </div>

              {/* File list */}
              {items.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs text-white/60 uppercase tracking-wider">
                      {items.length} file{items.length !== 1 ? 's' : ''} selected
                    </Label>
                    <button
                      type="button"
                      onClick={() => setItems([])}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-white/50 shrink-0" />
                          <span className="text-sm font-medium text-white truncate flex-1 min-w-0">
                            {item.file.name}
                          </span>
                          <span className="text-xs text-white/40 shrink-0">
                            {(item.file.size / 1024).toFixed(0)} KB
                          </span>
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="text-white/30 hover:text-red-400 shrink-0 p-0.5"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white/40 shrink-0">ID:</span>
                          <Input
                            value={item.extId}
                            onChange={(e) => updateExtId(item.id, e.target.value)}
                            placeholder="External ID"
                            className="h-7 text-xs bg-black/20 border-white/10"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ═══════════════ RUNNING PHASE ═══════════════ */}
          {phase === 'running' && (
            <div className="space-y-4">
              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-white/60">
                  <span>Uploading {progress.current} of {progress.total}…</span>
                  <span className="font-mono">{progress.current}/{progress.total}</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300 bg-emerald-500"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="font-medium">{progress.succeeded} succeeded</span>
                  </div>
                  {progress.failed > 0 && (
                    <div className="flex items-center gap-1.5 text-red-400">
                      <XCircle className="h-3.5 w-3.5" />
                      <span className="font-medium">{progress.failed} failed</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Running file list */}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`
                      rounded-lg border p-3 transition-colors
                      ${
                        item.status === 'success'
                          ? 'border-emerald-500/20 bg-emerald-500/5'
                          : item.status === 'error'
                            ? 'border-red-500/20 bg-red-500/5'
                            : item.status === 'uploading'
                              ? 'border-amber-500/20 bg-amber-500/5'
                              : 'border-white/10 bg-white/5'
                      }
                    `}
                  >
                    <div className="flex items-center gap-2">
                      {item.status === 'success' ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                      ) : item.status === 'error' ? (
                        <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
                      ) : item.status === 'uploading' ? (
                        <Loader2 className="h-4 w-4 text-amber-400 shrink-0 animate-spin" />
                      ) : (
                        <FileText className="h-4 w-4 text-white/30 shrink-0" />
                      )}
                      <span className="text-sm text-white truncate flex-1 min-w-0">
                        {item.file.name}
                      </span>
                      <span className="text-xs text-white/40 shrink-0">
                        {(item.file.size / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    {item.status === 'error' && item.error && (
                      <p className="text-xs text-red-400 mt-1 break-all">{item.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════ DONE PHASE ═══════════════ */}
          {phase === 'done' && (
            <div className="space-y-3">
              {/* Status header */}
              <div className="flex items-center gap-3">
                {doneSuccess ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-900/30">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  </div>
                ) : doneFailed ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-900/30">
                    <XCircle className="h-5 w-5 text-red-400" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-900/30">
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-white">
                    {doneSuccess
                      ? 'Upload Complete'
                      : doneFailed
                        ? 'Upload Failed'
                        : 'Upload Partial'}
                  </p>
                  <p className="text-xs text-white/60">
                    {progress.succeeded} succeeded · {progress.failed} failed · {progress.total} total
                  </p>
                </div>
              </div>

              {/* Failure list */}
              {items.some((it) => it.status === 'error') && (
                <div className="max-h-[140px] overflow-y-auto rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 space-y-1.5">
                  {items
                    .filter((it) => it.status === 'error')
                    .map((item) => (
                      <div key={item.id} className="flex items-start gap-2 text-xs text-red-300">
                        <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="break-all">
                          <span className="font-mono text-white/60">{item.file.name}</span>
                          {item.error && <span className="ml-1">— {item.error}</span>}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ═══════════════ FOOTER ═══════════════ */}
        <div className="shrink-0 flex justify-end gap-3 pt-2 border-t border-white/10">
          {phase === 'select' && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                className="border-white/30 text-white hover:bg-white/5"
              >
                Close
              </Button>
              {items.length > 0 && (
                <Button
                  onClick={uploadAll}
                  disabled={pendingCount === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {hasErrors && pendingCount === 0 ? (
                    'Retry failed'
                  ) : (
                    `Upload ${pendingCount}`
                  )}
                </Button>
              )}
            </>
          )}

          {phase === 'running' && (
            <Button
              disabled
              className="bg-emerald-600/50 text-white flex items-center gap-2 cursor-not-allowed"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading…
            </Button>
          )}

          {phase === 'done' && (
            <Button
              onClick={handleClose}
              className={`text-white flex items-center gap-2 ${
                doneSuccess
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : doneFailed
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {doneSuccess ? (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Close
                </>
              ) : doneFailed ? (
                <>
                  <XCircle className="h-4 w-4" /> Close
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4" /> Close
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
