'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { FileSearch, FileText, Loader2, AlertCircle, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ResizeHandle } from '@/app/workspace/_components/panel-layout';
import { Markdown } from '@/components/markdown';
import {
  hindsightApi,
  type HindsightMemoryEvidenceResponse,
  type HindsightChunk,
  type HindsightDocument,
} from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface EvidenceModalProps {
  /** Whether the modal is open. */
  open: boolean;
  /** Called when the modal should close. */
  onOpenChange: (open: boolean) => void;
  /** Human-readable title for the section whose evidence is being shown. */
  sectionTitle?: string;
  /** Server id to query against. */
  serverId?: number | null;
  /** Bank id to query against. */
  bankId?: string | null;
  /** Memory ids to resolve into evidence. */
  memoryIds?: string[];
}

export function EvidenceModal({
  open,
  onOpenChange,
  sectionTitle = 'Section',
  serverId,
  bankId,
  memoryIds = [],
}: EvidenceModalProps) {
  const [data, setData] = useState<HindsightMemoryEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      return;
    }
    if (!serverId || !bankId || memoryIds.length === 0) {
      setData(null);
      setError('No evidence available for this section.');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    hindsightApi
      .memoryEvidence(serverId, bankId, memoryIds)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, serverId, bankId, memoryIds]);

  const header = useMemo(
    () => (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <FileSearch className="h-4 w-4 shrink-0 text-foreground-subtle" />
          <div className="min-w-0">
            <DialogTitle className="truncate">Evidence: {sectionTitle}</DialogTitle>
          </div>
        </div>
      </div>
    ),
    [sectionTitle]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col p-0" showCloseButton>
        <DialogHeader className="px-4 py-3 border-b border-border-default shrink-0">
          {header}
        </DialogHeader>
        <EvidenceModalBody
          loading={loading}
          error={error}
          data={data}
          serverId={serverId}
          bankId={bankId}
        />
        <DialogFooter className="shrink-0 px-4 py-3 border-t border-border-default mx-0 mb-0">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type EvidenceTreeSelection =
  | { kind: 'document'; documentId: string }
  | { kind: 'chunk'; documentId: string; chunkId: string };

function EvidenceModalBody({
  loading,
  error,
  data,
  serverId,
  bankId,
}: {
  loading: boolean;
  error: string | null;
  data: HindsightMemoryEvidenceResponse | null;
  serverId?: number | null;
  bankId?: string | null;
}) {
  const [selection, setSelection] = useState<EvidenceTreeSelection | null>(null);
  const [leftWidth, setLeftWidth] = useState(35); // percentage
  const [bottomHeight, setBottomHeight] = useState(30); // percentage of left column
  const draggingRef = useRef(false);

  // Chunk cache per document for "Show in context".
  const [contextDocs, setContextDocs] = useState<Record<string, HindsightChunk[]>>({});
  // Track which documents are in context mode.
  const [contextEnabled, setContextEnabled] = useState<Record<string, boolean>>({});
  // Document metadata cache (without content).
  const [documentMeta, setDocumentMeta] = useState<Record<string, HindsightDocument | 'loading' | 'error'>>({});

  // Reset view state when the evidence payload changes.
  useEffect(() => {
    setSelection(null);
    setContextDocs({});
    setContextEnabled({});
    setDocumentMeta({});
  }, [data]);

  // Auto-select the first document/chunk when data arrives.
  useEffect(() => {
    const docs = data?.documents ?? [];
    if (docs.length > 0 && selection == null) {
      const firstDoc = docs[0];
      if (firstDoc.chunks.length > 0) {
        setSelection({ kind: 'chunk', documentId: firstDoc.document_id, chunkId: firstDoc.chunks[0].chunk_id });
      } else {
        setSelection({ kind: 'document', documentId: firstDoc.document_id });
      }
    }
  }, [data, selection]);

  const loadDocumentMeta = useCallback(
    async (documentId: string) => {
      if (!serverId || !bankId) return;
      if (documentMeta[documentId]) return;
      setDocumentMeta((prev) => ({ ...prev, [documentId]: 'loading' }));
      try {
        const meta = await hindsightApi.getHindsightDocument(serverId, bankId, documentId, true);
        setDocumentMeta((prev) => ({ ...prev, [documentId]: meta }));
      } catch (err) {
        setDocumentMeta((prev) => ({ ...prev, [documentId]: 'error' }));
      }
    },
    [bankId, documentMeta, serverId]
  );

  const setDocumentContext = useCallback(
    async (documentId: string, enabled: boolean) => {
      setContextEnabled((prev) => ({ ...prev, [documentId]: enabled }));
      if (!enabled) return;
      if (contextDocs[documentId] || !serverId || !bankId) return;

      try {
        const result = await hindsightApi.getHindsightDocumentChunks(serverId, bankId, documentId);
        setContextDocs((prev) => ({ ...prev, [documentId]: result.items }));
      } catch (err) {
        // If the fetch fails, leave cache empty; the panel can show an error.
        setContextDocs((prev) => ({ ...prev, [documentId]: [] }));
      }
    },
    [bankId, contextDocs, serverId]
  );

  const startResize = useCallback((e: React.MouseEvent, direction: 'vertical' | 'horizontal') => {
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = direction === 'horizontal' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      const rect = container.getBoundingClientRect();
      if (direction === 'vertical') {
        const pct = Math.min(60, Math.max(20, ((moveEvent.clientX - rect.left) / rect.width) * 100));
        setLeftWidth(pct);
      } else {
        const pct = Math.min(70, Math.max(15, (1 - (moveEvent.clientY - rect.top) / rect.height) * 100));
        setBottomHeight(pct);
      }
    };

    const onUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-foreground-subtle">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-xs">Resolving evidence…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 text-destructive-fg text-center">
        <AlertCircle className="h-5 w-5" />
        <span className="text-xs whitespace-pre-wrap">{error}</span>
      </div>
    );
  }

  if (!data || data.document_count === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-foreground-subtle p-4">
        No source documents found for this section.
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
      {/* Left column: source documents (top) + queried memories tree (bottom) */}
      <div
        className="flex flex-col min-h-0 bg-surface-card border-r border-border-default overflow-hidden"
        style={{ flexBasis: `${leftWidth}%`, minWidth: '16rem', maxWidth: '60%' }}
      >
        <div className="flex flex-col min-h-0" style={{ flexBasis: `${100 - bottomHeight}%` }}>
          <div className="h-10 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0 overflow-hidden">
            <div className="text-xs font-medium truncate">Source documents</div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
                {data.document_count}
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {data.documents.map((doc) => (
              <DocumentTreeNode
                key={doc.document_id}
                doc={doc}
                perQueryEvidence={data.evidence}
                selected={selection}
                onSelect={setSelection}
                contextEnabled={!!contextEnabled[doc.document_id]}
                contextChunks={contextDocs[doc.document_id]}
                onContextChange={setDocumentContext}
                onLoadMeta={loadDocumentMeta}
                meta={documentMeta[doc.document_id]}
              />
            ))}
          </div>
        </div>
        <ResizeHandle
          direction="horizontal"
          onMouseDown={(e) => startResize(e, 'horizontal')}
          onDoubleClick={() => setBottomHeight(30)}
          title="Drag to resize queried memories panel; double-click to reset"
        />
        <QueriedMemoriesTree evidence={data.evidence} style={{ flexBasis: `${bottomHeight}%` }} />
      </div>
      <ResizeHandle
        direction="vertical"
        onMouseDown={(e) => startResize(e, 'vertical')}
        onDoubleClick={() => setLeftWidth(35)}
        title="Drag to resize panels; double-click to reset"
      />
      {/* Right detail panel */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col bg-surface-card overflow-hidden">
        <DetailPanel
          selection={selection}
          documents={data.documents}
          contextEnabled={contextEnabled}
          contextDocs={contextDocs}
          documentMeta={documentMeta}
        />
      </div>
    </div>
  );
}

function DocumentTreeNode({
  doc,
  perQueryEvidence,
  selected,
  onSelect,
  contextEnabled,
  contextChunks,
  onContextChange,
  onLoadMeta,
  meta,
}: {
  doc: HindsightMemoryEvidenceResponse['documents'][number];
  perQueryEvidence: HindsightMemoryEvidenceResponse['evidence'];
  selected: EvidenceTreeSelection | null;
  onSelect: (sel: EvidenceTreeSelection) => void;
  contextEnabled: boolean;
  contextChunks?: HindsightChunk[];
  onContextChange: (documentId: string, enabled: boolean) => Promise<void> | void;
  onLoadMeta: (documentId: string) => Promise<void> | void;
  meta?: HindsightDocument | 'loading' | 'error';
}) {
  const [expanded, setExpanded] = useState(true);
  const ratio =
    doc.supporting_memory_count > 0
      ? `${doc.queried_memory_count} / ${doc.supporting_memory_count}`
      : `${doc.queried_memory_count}`;

  const isDocSelected = selected?.kind === 'document' && selected.documentId === doc.document_id;

  useEffect(() => {
    onLoadMeta(doc.document_id);
  }, [doc.document_id, onLoadMeta]);

  return (
    <div className="rounded border border-border-subtle bg-surface-inset overflow-hidden">
      <div
        className={cn(
          'w-full px-2 py-1.5 flex items-center gap-2 transition-colors',
          isDocSelected ? 'bg-accent-primary-bg' : 'hover:bg-surface-card'
        )}
        style={{ borderLeftColor: 'var(--color-accent-primary-bd)', borderLeftWidth: 3 }}
      >
        <button
          type="button"
          onClick={() => {
            setExpanded((v) => !v);
            onSelect({ kind: 'document', documentId: doc.document_id });
          }}
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-foreground-subtle shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-foreground-subtle shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-foreground-default truncate" title={doc.document_id}>
              {meta && typeof meta === 'object' && meta.title ? meta.title : doc.document_id}
            </div>
            <div className="text-[10px] text-foreground-subtle font-mono truncate">
              {ratio} memor{doc.supporting_memory_count === 1 ? 'y' : 'ies'}
            </div>
          </div>
          <span className="text-[10px] text-foreground-subtle px-1.5 py-0.5 rounded border border-border-default bg-surface-card shrink-0">
            {doc.chunks.length}
          </span>
        </button>
        <div className="flex items-center gap-1.5 shrink-0 pl-1">
          <span className="text-[9px] text-foreground-subtle">Context</span>
          <Switch
            size="sm"
            checked={contextEnabled}
            onCheckedChange={(checked) => {
              // Prevent switch click from toggling expansion/selection via document button.
              onContextChange(doc.document_id, checked);
            }}
            aria-label="Show document in context"
          />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border-default">
          {doc.chunks.length === 0 ? (
            <div className="px-3 py-2 text-xs text-foreground-subtle">No chunk data.</div>
          ) : (
            <div className="px-1 py-1 space-y-0.5">
              {doc.chunks.map((chunk) => {
                const isSelected = selected?.kind === 'chunk' && selected.chunkId === chunk.chunk_id;
                const supportingIds = chunk.memory_ids ?? [];
                return (
                  <div
                    key={chunk.chunk_id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelect({ kind: 'chunk', documentId: doc.document_id, chunkId: chunk.chunk_id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect({ kind: 'chunk', documentId: doc.document_id, chunkId: chunk.chunk_id });
                      }
                    }}
                    className={cn(
                      'w-full flex flex-col gap-1 px-2 py-1.5 text-left rounded text-[11px] transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring',
                      isSelected ? 'bg-accent-primary-bg text-accent-primary-fg' : 'text-foreground-faint hover:bg-surface-card'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 w-full">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-3 w-3 shrink-0 text-foreground-subtle" />
                        <span className="truncate" title={chunk.chunk_id}>
                          chunk {chunk.chunk_index ?? 0}
                        </span>
                      </div>
                      {supportingIds.length > 0 && (
                        <span className="text-[9px] text-foreground-subtle px-1 py-0.5 rounded border border-border-default bg-surface-card shrink-0">
                          {supportingIds.length}
                        </span>
                      )}
                    </div>
                    {supportingIds.length > 0 && (
                      <div className="pl-5 flex flex-col gap-0.5">
                        {supportingIds.map((id) => (
                          <span key={id} className="text-[10px] font-mono text-foreground-subtle truncate" title={id}>
                            {id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function countPerQueryHits(
  chunkId: string,
  perQueryEvidence: HindsightMemoryEvidenceResponse['evidence'],
  documentId: string
): number {
  let count = 0;
  for (const entry of perQueryEvidence) {
    for (const d of entry.documents) {
      if (d.document_id !== documentId) continue;
      if (d.chunks.some((c) => c.chunk_id === chunkId)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function QueriedMemoriesTree({
  evidence,
  style,
}: {
  evidence: HindsightMemoryEvidenceResponse['evidence'];
  style?: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col min-h-0 overflow-hidden" style={style}>
      <div className="h-10 px-3 border-y border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0 overflow-hidden">
        <div className="text-xs font-medium truncate">Queried memories</div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
            {evidence.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {evidence.length === 0 ? (
          <div className="text-xs text-foreground-subtle px-1">No queried memory ids.</div>
        ) : (
          evidence.map((entry) => <QueriedMemoryNode key={entry.memory_id} entry={entry} />)
        )}
      </div>
    </div>
  );
}

function QueriedMemoryNode({
  entry,
}: {
  entry: HindsightMemoryEvidenceResponse['evidence'][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const memoryIdsByDocument = useMemo(() => {
    const map = new Map<string, Map<string, string | undefined>>();
    for (const doc of entry.documents) {
      const ids = new Map<string, string | undefined>();
      for (const chunk of doc.chunks) {
        for (const id of chunk.memory_ids) {
          ids.set(id, chunk.memory_types?.[id]);
        }
      }
      if (ids.size > 0) {
        map.set(doc.document_id, ids);
      }
    }
    return map;
  }, [entry]);

  const documentsByMemoryId = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const doc of entry.documents) {
      for (const chunk of doc.chunks) {
        for (const id of chunk.memory_ids) {
          let set = map.get(id);
          if (!set) {
            set = new Set<string>();
            map.set(id, set);
          }
          set.add(doc.document_id);
        }
      }
    }
    return map;
  }, [entry]);

  const hasDecomposition = memoryIdsByDocument.size > 0 || entry.observations_skipped.length > 0;

  return (
    <div className="rounded border border-border-subtle bg-surface-inset overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full px-2 py-1.5 flex items-center gap-2 text-left transition-colors hover:bg-surface-card',
          expanded && 'bg-surface-card'
        )}
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-foreground-subtle shrink-0" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-foreground-subtle shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-xs text-foreground-default truncate font-mono" title={entry.memory_id}>
            {entry.memory_id}
          </div>
          <div className="text-[10px] text-foreground-subtle truncate">
            {entry.document_count} document{entry.document_count === 1 ? '' : 's'}
            {entry.unresolved_error && ' · unresolved'}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {entry.memory_type && (
            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded border border-border-default bg-surface-card text-foreground-subtle">
              {entry.memory_type}
            </span>
          )}
          <span className="text-[10px] text-foreground-subtle px-1.5 py-0.5 rounded border border-border-default bg-surface-card">
            {entry.documents.reduce((sum, d) => sum + d.chunks.length, 0)}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border-default px-2 py-2 space-y-2">
          {entry.unresolved_error && (
            <div className="flex items-start gap-1.5 text-xs text-destructive-fg">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span className="leading-relaxed">{entry.unresolved_error}</span>
            </div>
          )}

          {entry.observations_skipped.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-foreground-subtle">Observations skipped</div>
              <div className="flex flex-wrap gap-1">
                {entry.observations_skipped.map((id) => (
                  <MemoryIdBadge key={id} id={id} />
                ))}
              </div>
            </div>
          )}

          {hasDecomposition ? (
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-foreground-subtle">Decomposed world ids</div>
              <div className="rounded border border-border-default bg-surface-card overflow-hidden">
                {Array.from(memoryIdsByDocument.entries()).flatMap(([documentId, ids]) =>
                  Array.from(ids.entries()).map(([id, type]) => ({ id, type, documentId }))
                )
                  .sort((a, b) => a.id.localeCompare(b.id))
                  .map(({ id, type }) => {
                    const relatedDocs = documentsByMemoryId.get(id) ?? new Set<string>();
                    const relatedDoc = Array.from(relatedDocs).sort()[0];
                    return (
                      <div
                        key={id}
                        className="flex flex-col gap-0.5 px-2 py-1.5 border-b border-border-default last:border-b-0 text-[11px] hover:bg-surface-inset"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-foreground-faint" title={id}>
                            {id}
                          </span>
                          {type && (
                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded border border-border-default bg-surface-inset text-foreground-subtle shrink-0">
                              {type}
                            </span>
                          )}
                        </div>
                        {relatedDoc && (
                          <div className="text-[10px] text-foreground-subtle truncate pl-0.5" title={relatedDoc}>
                            {relatedDoc}
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ) : (
            !entry.unresolved_error && (
              <div className="text-xs text-foreground-subtle italic">No supporting world ids found.</div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  selection,
  documents,
  contextEnabled,
  contextDocs,
  documentMeta,
}: {
  selection: EvidenceTreeSelection | null;
  documents: HindsightMemoryEvidenceResponse['documents'];
  contextEnabled: Record<string, boolean>;
  contextDocs: Record<string, HindsightChunk[]>;
  documentMeta: Record<string, HindsightDocument | 'loading' | 'error'>;
}) {
  const doc = selection ? documents.find((d) => d.document_id === selection.documentId) : undefined;
  const chunk =
    selection?.kind === 'chunk'
      ? doc?.chunks.find((c) => c.chunk_id === selection.chunkId)
      : undefined;
  const documentId = selection?.documentId;
  const showContext = documentId ? !!contextEnabled[documentId] : false;
  const contextChunks = documentId ? contextDocs[documentId] : undefined;
  const meta = documentId ? documentMeta[documentId] : undefined;
  const [renderMarkdown, setRenderMarkdown] = useState(false);

  return (
    <div className="flex flex-col h-full">
      <div className="h-10 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0 overflow-hidden">
        <div className="text-xs font-medium truncate">{selection ? (showContext ? 'Document context' : 'Chunk detail') : 'Select a document or chunk'}</div>
        <div className="flex items-center gap-2 shrink-0">
          {selection && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-accent-primary-fg">Render</span>
              <Switch
                size="sm"
                checked={renderMarkdown}
                onCheckedChange={setRenderMarkdown}
                aria-label="Render chunk text as Markdown"
              />
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
        {!selection && (
          <div className="h-full flex items-center justify-center text-xs text-foreground-subtle">
            Select a document or chunk from the left to view details.
          </div>
        )}

        {doc && showContext && contextChunks && (
          <ContextDocumentView
            chunks={contextChunks}
            selectedChunkId={selection?.kind === 'chunk' ? selection.chunkId : undefined}
            selectedChunkIndex={chunk?.chunk_index ?? undefined}
            renderMarkdown={renderMarkdown}
          />
        )}

        {doc && !showContext && chunk && (
          <div className="space-y-3">
            <DocumentMetaPanel docId={doc.document_id} meta={meta} />
            <ChunkPane chunk={chunk} selected expanded renderMarkdown={renderMarkdown} />
          </div>
        )}

        {doc && !showContext && selection?.kind === 'document' && (
          <div className="space-y-2">
            <DocumentMetaPanel docId={doc.document_id} meta={meta} />
            <div className="text-[10px] uppercase tracking-wider text-foreground-subtle">Chunks</div>
            {doc.chunks.length === 0 ? (
              <div className="text-xs text-foreground-subtle">No chunks available.</div>
            ) : (
              <div className="space-y-1">
                {doc.chunks.map((c) => (
                  <ChunkPane key={c.chunk_id} chunk={c} renderMarkdown={renderMarkdown} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ContextDocumentView({
  chunks,
  selectedChunkId,
  selectedChunkIndex,
  renderMarkdown,
}: {
  chunks: HindsightChunk[];
  selectedChunkId?: string;
  selectedChunkIndex?: number;
  renderMarkdown?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedChunks = useMemo(
    () => [...chunks].sort((a, b) => a.chunk_index - b.chunk_index),
    [chunks]
  );

  const chunkRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!containerRef.current) return;
    const targetId = selectedChunkId;
    if (!targetId) return;
    const el = chunkRefs.current[targetId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedChunkId, selectedChunkIndex]);

  if (chunks.length === 0) {
    return (
      <div className="text-xs text-foreground-subtle">
        Context view enabled, but no full chunks could be loaded for this document.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-1">
      {sortedChunks.map((chunk) => {
        const isSelected = chunk.chunk_id === selectedChunkId;
        return (
          <div
            key={chunk.chunk_id}
            ref={(el) => {
              chunkRefs.current[chunk.chunk_id] = el;
            }}
          >
            <ChunkPane chunk={chunk} selected={isSelected} expanded renderMarkdown={renderMarkdown} />
          </div>
        );
      })}
    </div>
  );
}

function ChunkPane({
  chunk,
  selected,
  expanded,
  renderMarkdown,
}: {
  chunk: {
    chunk_id: string;
    chunk_index: number | null;
    chunk_text?: string | null;
  };
  selected?: boolean;
  expanded?: boolean;
  renderMarkdown?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border p-3 transition-colors',
        selected ? 'border-accent-primary-bd bg-accent-primary-bg/30' : 'border-border-default bg-surface-inset'
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] font-mono text-foreground-subtle">chunk {chunk.chunk_index ?? 0}</span>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] text-foreground-subtle font-mono text-right"
            title={chunk.chunk_id}
          >
            {chunk.chunk_id}
          </span>
          <CopyButton text={chunk.chunk_text ?? ''} label="Copy chunk" />
          <span className="text-[10px] text-foreground-subtle">
            {chunk.chunk_text ? `${chunk.chunk_text.length} chars` : '-'}
          </span>
        </div>
      </div>
      <div
        className={cn(
          'text-xs text-foreground-muted leading-relaxed',
          !chunk.chunk_text && 'italic text-foreground-subtle',
          !expanded && 'line-clamp-3',
          !renderMarkdown && 'whitespace-pre-wrap'
        )}
      >
        {chunk.chunk_text ? (
          renderMarkdown && expanded ? (
            <Markdown>{chunk.chunk_text}</Markdown>
          ) : (
            chunk.chunk_text
          )
        ) : (
          'Chunk text not available.'
        )}
      </div>
    </div>
  );
}

function CopyButton({ text, label = 'Copy text' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const disabled = !text;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={async () => {
        if (!text) return;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-foreground-subtle hover:text-foreground-default disabled:text-foreground-faint disabled:cursor-not-allowed transition-colors"
      title={disabled ? 'No text to copy' : label}
    >
      {copied ? (
        <Check className="h-3 w-3" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      <span className="sr-only">{disabled ? 'No text to copy' : label}</span>
    </button>
  );
}

function DocumentMetaPanel({
  docId,
  meta,
}: {
  docId: string;
  meta?: HindsightDocument | 'loading' | 'error';
}) {
  const title = meta && typeof meta === 'object' ? meta.title : undefined;
  const hash = meta && typeof meta === 'object' ? meta.content_hash : undefined;
  const eventDate = meta && typeof meta === 'object' ? meta.retain_params?.event_date : undefined;
  const context = meta && typeof meta === 'object' ? meta.retain_params?.context : undefined;
  const createdAt = meta && typeof meta === 'object' ? meta.created_at : undefined;
  const updatedAt = meta && typeof meta === 'object' ? meta.updated_at : undefined;
  const tags = meta && typeof meta === 'object' ? meta.tags : undefined;
  const extra = meta && typeof meta === 'object' ? meta.document_metadata : undefined;

  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-foreground-subtle">Document</div>
      <div className="rounded-md border border-border-default bg-surface-inset p-2 space-y-1">
        <div className="text-sm font-medium text-foreground-default truncate" title={docId}>
          {title ?? docId}
        </div>
        {title && (
          <div className="text-[10px] font-mono text-foreground-subtle truncate" title={docId}>
            {docId}
          </div>
        )}
        {meta === 'loading' && (
          <div className="text-[10px] text-foreground-subtle italic">Loading metadata...</div>
        )}
        {meta === 'error' && (
          <div className="text-[10px] text-destructive-fg italic">Failed to load metadata.</div>
        )}
        {hash && (
          <div className="text-[10px] font-mono text-foreground-subtle truncate" title={hash}>
            hash: {hash}
          </div>
        )}
        {context && (
          <div className="text-[10px] text-foreground-subtle leading-relaxed" title="retain context">
            context: {context}
          </div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {eventDate && (
            <div className="text-[10px] text-foreground-subtle" title={`event date: ${eventDate}`}>
              event date: {eventDate}
            </div>
          )}
          {createdAt && (
            <div className="text-[10px] text-foreground-subtle" title={`created: ${createdAt}`}>
              created: {createdAt}
            </div>
          )}
          {updatedAt && (
            <div className="text-[10px] text-foreground-subtle" title={`updated: ${updatedAt}`}>
              updated: {updatedAt}
            </div>
          )}
        </div>
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded border border-border-default bg-surface-card text-foreground-subtle"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {extra && Object.keys(extra).length > 0 && (
          <div className="pt-0.5 space-y-0.5">
            {Object.entries(extra).map(([key, value]) => (
              <div key={key} className="text-[10px] text-foreground-subtle">
                <span className="font-medium">{key}: </span>
                <span className="font-mono truncate">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryIdBadge({
  id,
  supporting = false,
}: {
  id: string;
  supporting?: boolean;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'text-[10px] h-5 px-1.5 font-mono cursor-pointer hover:bg-surface-hover',
        supporting ? 'border-l-2 border-l-accent-primary-bd' : ''
      )}
      title={supporting ? 'Supporting world memory id' : 'Queried memory id'}
    >
      {id}
    </Badge>
  );
}
