'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, ChevronDown, Check, FileText, Clock, ArrowRight, ChevronRight, ChevronUp, Calendar as CalendarIcon, X, Sparkles, AlertCircle } from 'lucide-react';
import { ArchitxtIcon } from './icons/architxt-icon';
import { formatDistanceToNow, format, parseISO } from 'date-fns';
import { documentsApi, type Document, type Metadata } from '@/lib/api/client';
import { toast } from 'sonner';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SmartEditDialog } from './smart-edit-dialog';
import { EntityDetectionDialog } from './entity-detection-dialog';
import { EntityTaggedContent } from './entity-tagged-content';
import { loadFormatRegistry } from '@/lib/entity-tag-format';
import { formatErrorValue } from '@/lib/error-format';

interface Context {
  id: number;
  description: string;
}

interface ProcessingHistoryEntry {
  timestamp: string;
  from: string;
  to: string;
  success: boolean;
  error?: string;
  reason?: string;
  metrics?: Record<string, any>;
}

interface ViewDocumentDialogProps {
  document: Document | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDocumentUpdated?: () => void;
  contexts?: Context[];
}

const statusColors: Record<string, string> = {
  uploaded:              'bg-fuchsia-800/15 text-fuchsia-400 border-fuchsia-700/20',
  ready_to_extract:      'bg-sky-800/15 text-sky-400 border-sky-700/20',
  processing_extract:    'bg-amber-800/15 text-amber-400 border-amber-700/20',
  request_release:       'bg-yellow-800/15 text-yellow-400 border-yellow-700/20',
  processed_extract_success: 'bg-emerald-800/15 text-emerald-400 border-emerald-700/20',
  processed_extract_failed:  'bg-rose-800/15 text-rose-400 border-rose-700/20',
  publishing:            'bg-orange-800/15 text-orange-400 border-orange-700/20',
  published:             'bg-emerald-800/15 text-emerald-400 border-emerald-700/20',
};

const statusLabels: Record<string, string> = {
  uploaded: 'uploaded',
  ready_to_extract: 'ready to extract',
  processing_extract: 'extracting',
  request_release: 'releasing',
  processed_extract_success: 'extracted',
  processed_extract_failed: 'extracted - failed',
  publishing: 'publishing',
  published: 'published',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function MetricBadge({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
      <span className="text-white/40">{label}:</span>
      <span className="text-white/70 font-mono">{value}</span>
    </span>
  );
}

export function ViewDocumentDialog({
  document,
  open,
  onOpenChange,
  onDocumentUpdated,
  contexts = [],
}: ViewDocumentDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [extId, setExtId] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [fullPath, setFullPath] = useState('');
  const [authors, setAuthors] = useState<string[]>([]);
  const [authorInput, setAuthorInput] = useState('');

  // Tab state
  const [activeTab, setActiveTab] = useState<'content' | 'history' | 'expandedMetadata'>('content');

  // Smart edit dialog state
  const [smartEditOpen, setSmartEditOpen] = useState(false);

  // Entity detection dialog state
  const [entityDetectionOpen, setEntityDetectionOpen] = useState(false);

  // Expanded metadata state
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [metadataLoading, setMetadataLoading] = useState(false);

  // Document content state
  const [content, setContent] = useState<string | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [contentBlocks, setContentBlocks] = useState<any[] | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [showPlainText, setShowPlainText] = useState(false);

  // Processing history state
  const [history, setHistory] = useState<ProcessingHistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedHistoryIdx, setExpandedHistoryIdx] = useState<number | null>(null);

  // Kick off format registry load (no state needed — getCachedFormat is safe)
  useEffect(() => {
    if (open) {
      loadFormatRegistry().catch(() => { /* silent — default fallback handles it */ });
    }
  }, [open]);

  useEffect(() => {
    if (document) {
      setExtId(document.ext_id || '');
      setTimestamp(document.timestamp || '');
      setFullPath(document.full_path || '');
      setAuthors(document.authors || []);
      setAuthorInput('');
    }
  }, [document, open]);

  // Fetch document content when dialog opens
  useEffect(() => {
    if (!open || !document) {
      setContent(null);
      setContentHash(null);
      setContentBlocks(null);
      setHistory(null);
      setMetadata([]);
      setActiveTab('content');
      setExpandedHistoryIdx(null);
      return;
    }

    const loadContent = async () => {
      setContentLoading(true);
      try {
        const data = await documentsApi.getContent(document.id);
        setContent(data.content);
        setContentHash(data.content_hash);
        setContentBlocks(data.content_blocks);
      } catch (err) {
        setContent(null);
        setContentHash(null);
        setContentBlocks(null);
      } finally {
        setContentLoading(false);
      }
    };

    loadContent();
  }, [open, document?.id]);

  // Fetch processing history when switching to history tab
  useEffect(() => {
    if (!open || !document || activeTab !== 'history') return;

    const loadHistory = async () => {
      setHistoryLoading(true);
      try {
        const data = await documentsApi.getProcessingHistory(document.id);
        setHistory(data.processing_history);
      } catch (err) {
        setHistory(null);
      } finally {
        setHistoryLoading(false);
      }
    };

    loadHistory();
  }, [open, document?.id, activeTab]);

  // Fetch expanded metadata when switching to expanded metadata tab
  useEffect(() => {
    if (!open || !document || activeTab !== 'expandedMetadata') return;

    const loadMetadata = async () => {
      setMetadataLoading(true);
      try {
        const data = await documentsApi.getExpandedMetadata(document.id);
        setMetadata(data);
      } catch (err) {
        setMetadata([]);
      } finally {
        setMetadataLoading(false);
      }
    };

    loadMetadata();
  }, [open, document?.id, activeTab]);

  if (!document) return null;

  const hasChanges =
    extId !== (document.ext_id || '') ||
    timestamp !== (document.timestamp || '') ||
    fullPath !== (document.full_path || '') ||
    JSON.stringify(authors) !== JSON.stringify(document.authors || []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: Record<string, any> = {};

      if (extId !== (document.ext_id || '')) {
        updates.ext_id = extId || null;
      }

      if (timestamp !== (document.timestamp || '')) {
        updates.timestamp = timestamp || null;
      }

      if (fullPath !== (document.full_path || '')) {
        updates.full_path = fullPath || null;
      }

      const authorsChanged = JSON.stringify(authors) !== JSON.stringify(document.authors || []);
      if (authorsChanged) {
        updates.authors = authors.length > 0 ? authors : null;
      }

      if (Object.keys(updates).length > 0) {
        await documentsApi.update(document.id, updates);
        toast.success('Document updated');
        onDocumentUpdated?.();
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[85vw] !max-w-none h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            Document Details
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6 overflow-hidden flex-1 min-h-0">
          {/* Left Column — Details */}
          <div className="space-y-6 overflow-y-auto custom-scrollbar min-h-0">
            {/* Status Badge */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/70">Status:</span>
              <Badge className={`text-[10px] px-1.5 py-0.5 border inline-flex items-center gap-1 ${statusColors[document.status] || 'bg-neutral-500/15 text-neutral-300 border-neutral-400/30'}`}>
                <ArchitxtIcon className="h-3 w-3" />
                {statusLabels[document.status] || document.status}
              </Badge>
            </div>

            {/* Editable Fields */}
            <div className="space-y-4">
              {/* External ID */}
              <div className="space-y-2">
                <Label htmlFor="ext-id" className="text-xs uppercase text-white/50 font-medium">
                  External ID
                </Label>
                <Input
                  id="ext-id"
                  value={extId}
                  onChange={(e) => setExtId(e.target.value)}
                  placeholder="Enter external ID"
                  className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                  style={{
                    '--tw-ring-color': 'rgb(52, 211, 153)',
                    '--tw-ring-opacity': '0.4',
                  } as React.CSSProperties}
                />
              </div>

              {/* Document Date + Full Path */}
              <div className="flex gap-4">
                {/* Document Date */}
                <div className="space-y-2 shrink-0 w-[240px]">
                  <Label className="text-xs uppercase text-white/50 font-medium">Document Date</Label>
                  <Popover>
                    <PopoverTrigger>
                      <div
                        className={cn(
                          "w-full justify-start text-left font-normal cursor-pointer inline-flex items-center rounded-lg border border-white/20 bg-transparent px-3 py-2 text-white hover:bg-white/5 transition-colors",
                          !timestamp && "text-white/40"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-white/50 shrink-0" />
                        {timestamp ? (
                          <span className="text-white">{(() => {
                            try {
                              const d = parseISO(timestamp);
                              if (isNaN(d.getTime())) throw new Error('invalid');
                              return format(d, 'dd/MM/yyyy HH:mm:ss');
                            } catch {
                              return timestamp;
                            }
                          })()}</span>
                        ) : (
                          <span>dd/mm/yyyy hh:mm</span>
                        )}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-[oklch(0.20_0_0)] border-white/20">
                      <div className="p-3">
                        <Calendar
                          mode="single"
                          selected={(() => {
                            try {
                              const d = parseISO(timestamp);
                              return isNaN(d.getTime()) ? undefined : d;
                            } catch {
                              return undefined;
                            }
                          })()}
                          onSelect={(date) => {
                            if (date) {
                              // Preserve existing time when selecting a new date
                              const current = (() => {
                                try {
                                  const d = parseISO(timestamp);
                                  return isNaN(d.getTime()) ? undefined : d;
                                } catch {
                                  return undefined;
                                }
                              })();
                              const result = new Date(date);
                              if (current) {
                                result.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), 0);
                              }
                              setTimestamp(result.toISOString());
                            }
                          }}
                          className="text-white"
                        />
                        {/* Time inputs */}
                        <div className="flex items-center gap-2 px-2 pt-2 border-t border-white/10">
                          <div className="flex items-center gap-1.5">
                            <label className="text-[11px] text-white/40 uppercase">Time</label>
                            <input
                              type="text"
                              pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                              placeholder="HH:MM:SS"
                              value={(() => {
                                try {
                                  const d = parseISO(timestamp);
                                  return isNaN(d.getTime()) ? '' : format(d, 'HH:mm:ss');
                                } catch {
                                  return '';
                                }
                              })()}
                              onChange={(e) => {
                                const [hours, minutes, seconds] = e.target.value.split(':').map(Number);
                                const base = (() => {
                                  try {
                                    const d = parseISO(timestamp);
                                    return isNaN(d.getTime()) ? new Date() : d;
                                  } catch {
                                    return new Date();
                                  }
                                })();
                                base.setHours(hours || 0, minutes || 0, seconds || 0, 0);
                                setTimestamp(base.toISOString());
                              }}
                              className="bg-[oklch(0.18_0_0)] border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500/50 w-[90px]"
                            />
                          </div>
                          <div className="flex items-center gap-1 ml-auto">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-400 hover:text-blue-300 hover:bg-transparent"
                              onClick={() => setTimestamp('')}
                            >
                              Clear
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-400 hover:text-blue-300 hover:bg-transparent"
                              onClick={() => setTimestamp(new Date().toISOString())}
                            >
                              Now
                            </Button>
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Full Path */}
                <div className="space-y-2 flex-1">
                  <Label htmlFor="full-path" className="text-xs uppercase text-white/50 font-medium">
                    Full Path
                  </Label>
                  <Input
                    id="full-path"
                    value={fullPath}
                    onChange={(e) => setFullPath(e.target.value)}
                    placeholder="e.g. https://..."
                    className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                    style={{
                      '--tw-ring-color': 'rgb(52, 211, 153)',
                      '--tw-ring-opacity': '0.4',
                    } as React.CSSProperties}
                  />
                </div>
              </div>
            </div>

            {/* Authors */}
            <div className="space-y-2">
              <Label className="text-xs uppercase text-white/50 font-medium">Authors</Label>
              <div className="flex gap-2 items-start">
                <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                  {authors.map((a, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-purple-800/15 text-purple-400 border border-purple-700/20"
                    >
                      {a}
                      <button
                        type="button"
                        onClick={() => setAuthors((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-purple-400/60 hover:text-purple-300"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 shrink-0" style={{ width: '30%' }}>
                  <Input
                    value={authorInput}
                    onChange={(e) => setAuthorInput(e.target.value)}
                    placeholder="Add author…"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const trimmed = authorInput.trim();
                        if (trimmed && !authors.includes(trimmed)) {
                          setAuthors((prev) => [...prev, trimmed]);
                          setAuthorInput('');
                        }
                      }
                    }}
                    className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                    style={{
                      '--tw-ring-color': 'rgb(52, 211, 153)',
                      '--tw-ring-opacity': '0.4',
                    } as React.CSSProperties}
                  />
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    const trimmed = authorInput.trim();
                    if (trimmed && !authors.includes(trimmed)) {
                      setAuthors((prev) => [...prev, trimmed]);
                      setAuthorInput('');
                    }
                  }}>
                    Add
                  </Button>
                </div>
              </div>
            </div>
            <div className="space-y-3 pt-2 border-t border-white/10">
              {/* Row 1: ID, Generated By, Created */}
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-xs uppercase text-white/50 font-medium">Document ID</p>
                  <p className="text-sm text-white font-mono">{document.id}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase text-white/50 font-medium">Generated By</p>
                  <p className="text-sm text-white font-mono">{document.generated_by}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase text-white/50 font-medium">Created</p>
                  <p className="text-sm text-white/70">
                    {formatDistanceToNow(new Date(document.created_at), { addSuffix: true })}
                  </p>
                </div>
              </div>

              {/* Row 2: Filename — full width */}
              <div className="space-y-1">
                <p className="text-xs uppercase text-white/50 font-medium">Filename</p>
                <p className="text-sm text-white font-mono break-all">{document.filename || '-'}</p>
              </div>
            </div>

            {/* Tags, Context & Metadata */}
            <div className="space-y-3 pt-2 border-t border-white/10">
              {/* Context */}
              <div>
                <p className="text-xs uppercase text-white/50 font-medium mb-2">Context</p>
                {document.context_id ? (
                  <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-xs border border-violet-500/30">
                    {contexts.find(c => c.id === document.context_id)?.description || `ID ${document.context_id}`}
                  </span>
                ) : (
                  <span className="text-sm text-white/40 italic">-</span>
                )}
              </div>

              {/* Tags */}
              <div>
                <p className="text-xs uppercase text-white/50 font-medium mb-2">Tags</p>
                {document.tags && document.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {document.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-xs border border-orange-500/30"
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-white/40 italic">-</span>
                )}
              </div>

              {/* Metadata */}
              <div>
                <p className="text-xs uppercase text-white/50 font-medium mb-2">Metadata</p>
                {document.metadata && document.metadata.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {document.metadata.map((m) => (
                      <span
                        key={m.id}
                        className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-xs border border-blue-500/30"
                      >
                        {m.value !== undefined && m.value !== null ? `${m.key}=${m.value}` : m.key}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-sm text-white/40 italic">-</span>
                )}
              </div>
            </div>
          </div>

          {/* Right Column — Tabs + Content */}
          <div className="flex flex-col gap-2 min-h-0 overflow-hidden">
            {/* Tab Bar */}
            <div className="flex gap-1 rounded-lg bg-white/5 p-1">
              <button
                onClick={() => setActiveTab('content')}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'content'
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                Document Content
              </button>
              <button
                onClick={() => setActiveTab('expandedMetadata')}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'expandedMetadata'
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                Expanded Metadata
                {metadata && metadata.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                    {metadata.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'history'
                    ? 'bg-white/10 text-white'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                Processing History
                {history && history.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">
                    {history.length}
                  </span>
                )}
              </button>
            </div>

            {/* Tab Content */}
            <div className="flex flex-col flex-1 rounded-lg border border-white/20 bg-[oklch(0.18_0_0)] p-3 overflow-hidden">
              {activeTab === 'content' ? (
                /* Content Tab */
                contentLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-5 w-5 text-white/40 animate-spin" />
                    <span className="ml-2 text-sm text-white/40">Loading content...</span>
                  </div>
                ) : content ? (
                  <div className="flex flex-col h-full overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 flex-shrink-0">
                      <span className="text-[10px] text-white/40 font-sans">
                        {showPlainText ? 'Plain text view' : 'Highlighted entities'}
                      </span>
                      <button
                        onClick={() => setShowPlainText((v) => !v)}
                        className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-white/50 hover:text-white/80 hover:border-white/20 transition-colors font-sans"
                      >
                        {showPlainText ? 'Show Tags' : 'Show Plain'}
                      </button>
                    </div>
                    <div className="flex-1 p-3 overflow-y-auto custom-scrollbar font-mono text-[13px] leading-relaxed">
                      {showPlainText ? (
                        <pre className="whitespace-pre-wrap text-white/80">{content}</pre>
                      ) : (
                        <EntityTaggedContent content={content} />
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-white/40">
                    <FileText className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">No content available</p>
                    <p className="text-xs mt-1">Content appears after extraction</p>
                  </div>
                )
              ) : activeTab === 'expandedMetadata' ? (
                /* Expanded Metadata Tab */
                metadataLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-5 w-5 text-white/40 animate-spin" />
                    <span className="ml-2 text-sm text-white/40">Loading metadata...</span>
                  </div>
                ) : metadata.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-white/40">
                    <FileText className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">No metadata available</p>
                  </div>
                ) : (
                  <div className="h-full overflow-y-auto custom-scrollbar space-y-2 pr-1">
                    {metadata.map((m) => (
                      <div
                        key={m.id}
                        className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${
                          m.expanded
                            ? 'bg-amber-900/10 border-amber-500/20'
                            : 'bg-white/[0.03] border-white/10'
                        }`}
                      >
                        <span className="text-xs font-mono text-white/60 shrink-0 w-40 truncate">
                          {m.key}
                        </span>
                        <span className="text-xs text-white/80 flex-1 min-w-0 whitespace-normal break-words">
                          {m.value ?? '-'}
                        </span>
                        <div className="flex items-start gap-1.5 shrink-0">
                          {m.expanded && (
                            <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[10px] px-1.5 py-0">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Computed
                            </Badge>
                          )}
                          {m.generated_by === 'user' && (
                            <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/20 text-[10px] px-1.5 py-0">
                              User
                            </Badge>
                          )}
                          {m.generated_by === 'import' && (
                            <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/20 text-[10px] px-1.5 py-0">
                              Import
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                /* History Tab */
                historyLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-5 w-5 text-white/40 animate-spin" />
                    <span className="ml-2 text-sm text-white/40">Loading history...</span>
                  </div>
                ) : history && history.length > 0 ? (
                  <div className="h-full overflow-y-auto custom-scrollbar space-y-3 pr-1">
                    {history.map((entry, idx) => {
                      const isExpanded = expandedHistoryIdx === idx;
                      const hasMetrics = entry.metrics && Object.keys(entry.metrics).length > 0;

                      return (
                        <div
                          key={idx}
                          className="rounded-lg bg-white/[0.03] border border-white/10 overflow-hidden"
                        >
                          {/* Header row */}
                          <button
                            onClick={() => setExpandedHistoryIdx(isExpanded ? null : idx)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.02] transition-colors"
                          >
                            {/* Success / Failure icon */}
                            <div
                              className={`flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center ${
                                entry.success
                                  ? 'bg-green-500/15 text-green-400'
                                  : 'bg-red-500/15 text-red-400'
                              }`}
                            >
                              {entry.success ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <span className="text-xs font-bold">!</span>
                              )}
                            </div>

                            {/* Transition */}
                            <div className="flex-1 min-w-0 flex items-center gap-2 text-xs">
                              <span className="text-white/50 font-mono truncate">{entry.from}</span>
                              <ArrowRight className="h-3 w-3 text-white/30 flex-shrink-0" />
                              <span className="text-white/50 font-mono truncate">{entry.to}</span>
                            </div>

                            {/* Timestamp */}
                            <div className="flex items-center gap-1 text-[11px] text-white/40 flex-shrink-0">
                              <Clock className="h-3 w-3" />
                              <span>
                                {formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })}
                              </span>
                            </div>

                            {/* Expand chevron */}
                            {hasMetrics && (
                              <div className="flex-shrink-0 text-white/30">
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </div>
                            )}
                          </button>

                          {/* Expanded metrics */}
                          {isExpanded && hasMetrics && (
                            <div className="px-3 pb-3 pt-1 border-t border-white/[0.04] space-y-3">
                              {entry.error && (
                                <div className="rounded bg-red-500/10 border border-red-500/20 px-2.5 py-2">
                                  <div className="flex items-start gap-2">
                                    <AlertCircle className="h-3.5 w-3.5 text-red-400 mt-0.5 shrink-0" />
                                    <p className="text-xs text-red-200/80 leading-relaxed whitespace-pre-wrap">
                                      {formatErrorValue(entry.error)}
                                    </p>
                                  </div>
                                </div>
                              )}

                              {entry.reason && !entry.error && (
                                <div className="text-xs text-white/40 italic">
                                  Reason: {formatErrorValue(entry.reason)}
                                </div>
                              )}

                              {Object.entries(entry.metrics!).map(([stageKey, stageMetrics]: [string, any]) => (
                                <div key={stageKey} className="space-y-1">
                                  {stageKey === 'errorDetails' && Array.isArray(stageMetrics) ? (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <ChevronRight className="h-3 w-3 text-white/20" />
                                        <span className="text-[11px] uppercase font-medium text-white/40">
                                          Error Details
                                        </span>
                                      </div>
                                      <div className="ml-5 space-y-2">
                                        {stageMetrics.map((detail: any, dIdx: number) => (
                                          <div key={dIdx} className="rounded bg-white/[0.03] border border-white/[0.06] px-2 py-1.5 space-y-1">
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] uppercase font-medium text-white/50">{detail.stage || 'unknown'}</span>
                                              {detail.metrics?.durationMs !== undefined && (
                                                <span className="text-[11px] text-white/30">{formatDuration(detail.metrics.durationMs)}</span>
                                              )}
                                            </div>
                                            {detail.error && (
                                              <p className="text-[11px] text-red-300/80 leading-relaxed whitespace-pre-wrap">{formatErrorValue(detail.error)}</p>
                                            )}
                                            {detail.metrics?.doclingStatus && (
                                              <MetricBadge label="status" value={String(detail.metrics.doclingStatus)} />
                                            )}
                                            {Array.isArray(detail.metrics?.doclingErrors) && detail.metrics.doclingErrors.length > 0 && (
                                              <div className="flex flex-col gap-0.5">
                                                {detail.metrics.doclingErrors.map((err: any, eIdx: number) => (
                                                  <span key={eIdx} className="text-[11px] text-white/50 leading-relaxed">• {formatErrorValue(err)}</span>
                                                ))}
                                              </div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <ChevronRight className="h-3 w-3 text-white/20" />
                                        <span className="text-[11px] uppercase font-medium text-white/40">
                                          {stageKey}
                                        </span>
                                        {stageMetrics.durationMs !== undefined && (
                                          <span className="text-[11px] text-white/30">
                                            {formatDuration(stageMetrics.durationMs)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="ml-5 flex flex-wrap gap-1.5">
                                        {stageMetrics.fileSize !== undefined && (
                                          <MetricBadge label="file" value={stageMetrics.fileSize.toLocaleString()} />
                                        )}
                                        {stageMetrics.markdownLength !== undefined && (
                                          <MetricBadge label="md" value={stageMetrics.markdownLength.toLocaleString()} />
                                        )}
                                        {stageMetrics.imageCount !== undefined && (
                                          <MetricBadge label="images" value={stageMetrics.imageCount} />
                                        )}
                                        {stageMetrics.originalLength !== undefined && (
                                          <MetricBadge label="orig" value={stageMetrics.originalLength.toLocaleString()} />
                                        )}
                                        {stageMetrics.cleanedLength !== undefined && (
                                          <MetricBadge label="clean" value={stageMetrics.cleanedLength.toLocaleString()} />
                                        )}
                                        {stageMetrics.reductionPercent !== undefined && (
                                          <MetricBadge label="reduction" value={`${stageMetrics.reductionPercent}%`} />
                                        )}
                                        {stageMetrics.stats?.inputLength !== undefined && (
                                          <MetricBadge label="in" value={stageMetrics.stats.inputLength.toLocaleString()} />
                                        )}
                                        {stageMetrics.stats?.outputLength !== undefined && (
                                          <MetricBadge label="out" value={stageMetrics.stats.outputLength.toLocaleString()} />
                                        )}
                                        {stageMetrics.stats?.chunkCount !== undefined && (
                                          <MetricBadge label="chunks" value={stageMetrics.stats.chunkCount} />
                                        )}
                                        {stageMetrics.avgDurationMs !== undefined && (
                                          <MetricBadge label="avg" value={formatDuration(stageMetrics.avgDurationMs)} />
                                        )}
                                        {stageMetrics.minDurationMs !== undefined && stageMetrics.maxDurationMs !== undefined && (
                                          <MetricBadge label="range" value={`${formatDuration(stageMetrics.minDurationMs)}–${formatDuration(stageMetrics.maxDurationMs)}`} />
                                        )}
                                        {stageMetrics.totalItems !== undefined && (
                                          <MetricBadge label="items" value={stageMetrics.totalItems} />
                                        )}
                                        {stageMetrics.totalTokens !== undefined && (
                                          <MetricBadge label="tokens" value={stageMetrics.totalTokens.toLocaleString()} />
                                        )}
                                        {stageMetrics.error && (
                                          <MetricBadge label="error" value={formatErrorValue(stageMetrics.error)} />
                                        )}
                                        {stageMetrics.doclingStatus && (
                                          <MetricBadge label="docling status" value={String(stageMetrics.doclingStatus)} />
                                        )}
                                        {Array.isArray(stageMetrics.doclingErrors) && stageMetrics.doclingErrors.map((err: any, eIdx: number) => (
                                          <span key={eIdx} className="inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[11px] text-red-300/80">
                                            docling: {formatErrorValue(err)}
                                          </span>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-white/40">
                    <Clock className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">No processing history</p>
                    <p className="text-xs mt-1">History appears after pipeline runs</p>
                  </div>
                )
              )}
            </div>

            {/* Bottom info bar */}
            {activeTab === 'expandedMetadata' && metadata && metadata.length > 0 && (
              <div className="flex justify-between items-center">
                <p className="text-xs text-white/40">
                  {metadata.length} tag{metadata.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-white/30">
                  {metadata.filter(m => m.expanded).length} computed
                </p>
              </div>
            )}
            {activeTab === 'content' && (
              <div className="flex justify-between items-center">
                <p className="text-xs text-white/40">
                  {content ? `${content.length.toLocaleString()} chars` : ''}
                </p>
                {content && (
                  <p className="text-xs text-white/40">
                    {(() => {
                      const tokens = Math.round(content.length / 4 / 1000) * 1000;
                      return `~${tokens.toLocaleString()} tokens`;
                    })()}
                  </p>
                )}
                {contentHash && (
                  <p className="text-xs text-white/30 font-mono truncate max-w-[200px]" title={contentHash}>
                    {contentHash.slice(0, 8)}...{contentHash.slice(-8)}
                  </p>
                )}
              </div>
            )}
            {activeTab === 'history' && history && history.length > 0 && (
              <div className="flex justify-between items-center">
                <p className="text-xs text-white/40">
                  {history.length} run{history.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-white/30">
                  {history.filter(h => h.success).length} succeeded, {history.filter(h => !h.success).length} failed
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={() => setEntityDetectionOpen(true)}
            className="text-white/70 hover:text-white hover:bg-white/5 flex items-center gap-2"
          >
            <ArchitxtIcon className="h-4 w-4" />
            Entities
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSmartEditOpen(true)}
            className="text-white/70 hover:text-white hover:bg-white/5 flex items-center gap-2"
          >
            <ArchitxtIcon className="h-4 w-4" />
            Smart Edit
          </Button>

          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        <SmartEditDialog
          documentId={document.id}
          content={content}
          contentBlocks={contentBlocks}
          contentLoading={contentLoading}
          isOpen={smartEditOpen}
          onClose={() => setSmartEditOpen(false)}
          onSaved={async () => {
            try {
              const data = await documentsApi.getContent(document.id);
              setContent(data.content);
              setContentHash(data.content_hash);
              setContentBlocks(data.content_blocks);
            } catch {
              // Best-effort refresh
            }
            onDocumentUpdated?.();
          }}
        />
        <EntityDetectionDialog
          documentId={document.id}
          content={content}
          isOpen={entityDetectionOpen}
          onClose={() => setEntityDetectionOpen(false)}
          onSaved={async () => {
            try {
              const data = await documentsApi.getContent(document.id);
              setContent(data.content);
              setContentHash(data.content_hash);
              setContentBlocks(data.content_blocks);
            } catch {
              // Best-effort refresh
            }
            onDocumentUpdated?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
