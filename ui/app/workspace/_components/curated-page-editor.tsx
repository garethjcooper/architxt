'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Trash2, Undo2, Loader2, Eye } from 'lucide-react';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { parseNarrativeBlocks, buildUserNarrativeContent, getSectionBlockIds, type NarrativeBlock } from '@/components/narrative-blocks';
import { MermaidDiagram } from '@/components/mermaid-diagram';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';
import { buildEnvelopeMarkdown, normalizeEnvelope } from '@/lib/envelope-markdown';
import { downloadMarkdown } from '@/lib/utils';
import { toast } from 'sonner';

function parseSyntheticHeading(title?: string): { kind: 'graph' | 'table' | 'diagram'; name?: string } | null {
  if (!title) return null;
  const trimmed = title.trim();
  const graphMatch = trimmed.match(/^Graph(?::\s*(.+))?$/i);
  if (graphMatch) return { kind: 'graph', name: graphMatch[1]?.trim() };
  const tableMatch = trimmed.match(/^Table:\s*(.+)$/i);
  if (tableMatch) return { kind: 'table', name: tableMatch[1].trim() };
  const diagramMatch = trimmed.match(/^Diagram:\s*(.+)$/i);
  if (diagramMatch) return { kind: 'diagram', name: diagramMatch[1].trim() };
  return null;
}

function structuredKey(parsed: NonNullable<ReturnType<typeof parseSyntheticHeading>>): string {
  if (parsed.kind === 'graph') return 'graph';
  return `${parsed.kind}:${parsed.name || 'untitled'}`;
}

export type CuratedPageEnvelope = ReturnType<typeof normalizeEnvelope>;

function getPageTitle(page: ResearchStepSummary | DiscoverStepResponse): string {
  if ('intent_text' in page && page.intent_text) return page.intent_text;
  if ('id' in page && typeof page.id === 'number') return `Page ${page.id}`;
  return 'Curated page';
}

export interface CuratedPageEditorProps {
  page: ResearchStepSummary | DiscoverStepResponse;
  /** Optional server baseline for dirty comparison. When omitted, the initial page envelope is used. */
  baseline?: CuratedPageEnvelope;
  onSave: (stepId: number, envelope: CuratedPageEnvelope) => Promise<void>;
  /** When true, the editor renders a compact read-only preview without editing controls. */
  readOnly?: boolean;
  /** Optional tabs or navigation rendered between the header and the content. */
  tabs?: React.ReactNode;
  /** Optional override for the header bar title. Defaults to the page title. */
  headerTitle?: string;
  /** Called when the dirty state changes so the parent can enable/disable a global Save control. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Increment to trigger a save from the parent. */
  saveTrigger?: number;
  /** Initial deletion sets restored from a previous edit session (e.g. after switching tabs). */
  initialDeletedBlockIds?: string[];
  initialDeletedStructuredKeys?: string[];
  /** Called with the current working envelope and deletion state on every meaningful change.
   *  The parent can persist the deletion sets so revert remains available across tab switches. */
  onChange?: (payload: {
    envelope: CuratedPageEnvelope;
    dirty: boolean;
    deletedBlockIds: string[];
    deletedStructuredKeys: string[];
  }) => void;
}

export function CuratedPageEditor({
  page,
  baseline,
  onSave,
  readOnly = false,
  tabs,
  headerTitle,
  onDirtyChange,
  saveTrigger,
  initialDeletedBlockIds,
  initialDeletedStructuredKeys,
  onChange,
}: CuratedPageEditorProps) {
  const envelope = useMemo(() => normalizeEnvelope(page), [page]);
  const displayMarkdown = useMemo(() => buildEnvelopeMarkdown(envelope), [envelope]);
  const baseBlocks = useMemo(() => parseNarrativeBlocks(displayMarkdown), [displayMarkdown]);
  const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set(initialDeletedBlockIds ?? []));
  const [deletedStructuredKeys, setDeletedStructuredKeys] = useState<Set<string>>(new Set(initialDeletedStructuredKeys ?? []));
  const [showIndex, setShowIndex] = useState(true);
  const [plain, setPlain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusedDiagram, setFocusedDiagram] = useState<{ name: string; content: string } | null>(null);

  // Reset transient edit state only when the page identity changes, not on every envelope update.
  const pageIdRef = useRef('id' in page && typeof page.id === 'number' ? String(page.id) : JSON.stringify(page));
  useEffect(() => {
    const nextId = 'id' in page && typeof page.id === 'number' ? String(page.id) : JSON.stringify(page);
    if (nextId === pageIdRef.current) return;
    pageIdRef.current = nextId;
    setDeletedBlockIds(new Set());
    setDeletedStructuredKeys(new Set());
  }, [page]);

  // Restore deletion sets from the parent when they change (e.g. returning to an
  // already-mounted editor after switching tabs). Keep local state as source of
  // truth otherwise so revert/restore interactions stay responsive.
  const initialDeletionsRef = useRef({ blockIds: initialDeletedBlockIds ?? [], structuredKeys: initialDeletedStructuredKeys ?? [] });
  useEffect(() => {
    const nextBlockIds = initialDeletedBlockIds ?? [];
    const nextStructuredKeys = initialDeletedStructuredKeys ?? [];
    const prev = initialDeletionsRef.current;
    const same =
      nextBlockIds.length === prev.blockIds.length &&
      nextBlockIds.every((id, i) => id === prev.blockIds[i]) &&
      nextStructuredKeys.length === prev.structuredKeys.length &&
      nextStructuredKeys.every((k, i) => k === prev.structuredKeys[i]);
    if (same) return;
    initialDeletionsRef.current = { blockIds: nextBlockIds, structuredKeys: nextStructuredKeys };
    setDeletedBlockIds(new Set(nextBlockIds));
    setDeletedStructuredKeys(new Set(nextStructuredKeys));
  }, [initialDeletedBlockIds, initialDeletedStructuredKeys]);

  // Compare against the server baseline so that local envelope mutations
  // (copy/add graph, tables, diagrams, narrative) make the page dirty.
  const effectiveBaseline = baseline ?? envelope;

  const displayedBlocks = useMemo(() => {
    const deletedSubtreeIds = new Set<string>();
    for (let i = 0; i < baseBlocks.length; i++) {
      const b = baseBlocks[i];
      if (b.type !== 'heading' || !b.synthetic) continue;
      const parsed = parseSyntheticHeading(b.title);
      if (!parsed || !deletedStructuredKeys.has(structuredKey(parsed))) continue;
      for (const id of getSectionBlockIds(baseBlocks, b.id)) {
        deletedSubtreeIds.add(id);
      }
    }
    return baseBlocks.map((b) => {
      if (deletedBlockIds.has(b.id) || deletedSubtreeIds.has(b.id)) return { ...b, deleted: true };
      return { ...b, deleted: false };
    });
  }, [baseBlocks, deletedBlockIds, deletedStructuredKeys]);

  const workingEnvelope = useMemo(() => {
    const userMarkdown = buildUserNarrativeContent(displayedBlocks);
    return {
      ...envelope,
      narrative: userMarkdown,
      tables: envelope.tables.filter((t) => !deletedStructuredKeys.has(`table:${t.name}`)),
      diagrams: envelope.diagrams.filter((d) => !deletedStructuredKeys.has(`diagram:${d.name}`)),
      graph: deletedStructuredKeys.has('graph') ? { name: envelope.graph.name, nodes: [], edges: [] } : envelope.graph,
    };
  }, [envelope, displayedBlocks, deletedStructuredKeys]);

  const isDirty = useMemo(() => JSON.stringify(workingEnvelope) !== JSON.stringify(effectiveBaseline), [workingEnvelope, effectiveBaseline]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Report the working envelope and deletion sets to the parent so edits survive tab switches
  // while the revert/restore option remains available.
  const lastEmittedRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const serialized = JSON.stringify(workingEnvelope);
    if (serialized === lastEmittedRef.current) return;
    lastEmittedRef.current = serialized;
    onChange?.({
      envelope: workingEnvelope,
      dirty: isDirty,
      deletedBlockIds: Array.from(deletedBlockIds),
      deletedStructuredKeys: Array.from(deletedStructuredKeys),
    });
  }, [workingEnvelope, isDirty, deletedBlockIds, deletedStructuredKeys, onChange]);

  const viewMode = plain ? 'plain' : 'markdown';
  const pageTitle = useMemo(() => getPageTitle(page), [page]);

  const handleSave = useCallback(async () => {
    if (!page || !('id' in page) || typeof page.id !== 'number') return;
    setSaving(true);
    try {
      await onSave(page.id, workingEnvelope);
      setDeletedBlockIds(new Set());
      setDeletedStructuredKeys(new Set());
      toast.success('Saved curated page');
    } finally {
      setSaving(false);
    }
  }, [page, workingEnvelope, onSave]);

  const lastSaveTriggerRef = useRef(saveTrigger);
  useEffect(() => {
    if (saveTrigger != null && saveTrigger > 0 && saveTrigger !== lastSaveTriggerRef.current) {
      lastSaveTriggerRef.current = saveTrigger;
      void handleSave();
    }
  }, [saveTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = useCallback(() => {
    if (!displayMarkdown) return;
    navigator.clipboard.writeText(displayMarkdown).then(() => toast.success('Copied to clipboard'));
  }, [displayMarkdown]);

  const handleDownload = useCallback(() => {
    if (!displayMarkdown) return;
    downloadMarkdown(displayMarkdown, pageTitle);
  }, [displayMarkdown, pageTitle]);

  const toggleDelete = useCallback((id: string) => {
    setDeletedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const removeSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(displayedBlocks, id);
    setDeletedBlockIds((prev) => {
      const next = new Set(prev);
      for (const blockId of ids) {
        const b = displayedBlocks.find((bb: NarrativeBlock) => bb.id === blockId);
        if (b && !b.synthetic) next.add(blockId);
      }
      return next;
    });
  }, [displayedBlocks]);

  const addStructuredKey = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed) return;
    const key = structuredKey(parsed);
    setDeletedStructuredKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const removeStructuredKey = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed) return;
    const key = structuredKey(parsed);
    setDeletedStructuredKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const removeSectionOrBlock = useCallback((b: NarrativeBlock) => {
    if (b.synthetic) {
      addStructuredKey(b);
      return;
    }
    if (b.type === 'heading') {
      removeSection(b.id);
    } else {
      toggleDelete(b.id);
    }
  }, [removeSection, toggleDelete, addStructuredKey]);

  const restoreSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(displayedBlocks, id);
    setDeletedBlockIds((prev) => {
      const next = new Set(prev);
      for (const blockId of ids) next.delete(blockId);
      return next;
    });
  }, [displayedBlocks]);

  const restoreSectionOrBlock = useCallback((b: NarrativeBlock) => {
    if (b.synthetic) {
      removeStructuredKey(b);
      return;
    }
    if (b.type === 'heading') {
      restoreSection(b.id);
    } else {
      toggleDelete(b.id);
    }
  }, [restoreSection, toggleDelete, removeStructuredKey]);

  const openDiagramFocus = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed || parsed.kind !== 'diagram') return;
    const diagram = envelope.diagrams.find((d) => d.name === parsed.name);
    if (diagram && typeof diagram.content === 'string') {
      setFocusedDiagram({ name: diagram.name || parsed.name || 'Diagram', content: diagram.content });
      return;
    }
    // Fallback: extract the mermaid source from the block following the heading.
    const idx = displayedBlocks.findIndex((bb) => bb.id === b.id);
    const next = displayedBlocks[idx + 1];
    if (next && next.type === 'code' && next.language === 'mermaid') {
      const source = (next.edited ?? next.raw)
        .replace(/^```mermaid\n?/, '')
        .replace(/\n?```\s*$/, '');
      setFocusedDiagram({ name: parsed.name || 'Diagram', content: source });
    }
  }, [envelope.diagrams, displayedBlocks]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <EnvelopeControls
        title={pageTitle}
        headerTitle={headerTitle}
        showIndex={showIndex}
        onShowIndexChange={setShowIndex}
        plain={plain}
        onPlainChange={setPlain}
        onCopyText={handleCopy}
        onSaveMd={handleDownload}
        extraHeaderItems={
          readOnly ? undefined : (
            <>
              {saving && (
                <Loader2 className="h-3 w-3 animate-spin text-white/50" />
              )}
            </>
          )
        }
      />
      {tabs}
      <div className="flex-1 min-h-0 overflow-hidden p-2">
        <NarrativeViewer
          blocks={displayedBlocks}
          title="Sections"
          viewMode={viewMode}
          showIndex={showIndex}
          keyPrefix="curated"
          className="h-full"
          renderSidebarRowActions={(b) => {
            if (readOnly) return null;
            if (b.type === 'text') return null;
            const isDeleted = b.deleted;
            const parsed = parseSyntheticHeading(b.title);
            const isDiagram = parsed?.kind === 'diagram';
            return (
              <div className="flex items-center gap-0.5">
                {isDiagram && !isDeleted && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDiagramFocus(b);
                    }}
                    className="p-1 rounded text-white/40 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                    title="Focus diagram"
                  >
                    <Eye className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isDeleted) {
                      restoreSectionOrBlock(b);
                    } else {
                      removeSectionOrBlock(b);
                    }
                  }}
                  className={`p-1 rounded transition-colors ${
                    isDeleted
                      ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                      : 'text-white/40 hover:text-rose-400 hover:bg-rose-500/10'
                  }`}
                  title={isDeleted ? 'Restore' : 'Remove'}
                >
                  {isDeleted ? <Undo2 className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            );
          }}
        />
      </div>
      <Dialog open={focusedDiagram != null} onOpenChange={(open) => { if (!open) setFocusedDiagram(null); }}>
        <DialogContent className="w-[95vw] h-[90vh] max-w-none flex flex-col" showCloseButton>
          <DialogHeader className="shrink-0">
            <DialogTitle>{focusedDiagram?.name}</DialogTitle>
          </DialogHeader>
          {focusedDiagram && (
            <div className="flex-1 min-h-0 flex gap-3 overflow-hidden">
              <div className="flex-1 min-w-0 min-h-0 overflow-auto rounded-md border border-white/10 bg-[oklch(0.18_0_0)] p-2">
                <MermaidDiagram
                  content={focusedDiagram.content}
                  className="h-full border-0 bg-transparent"
                />
              </div>
              <div className="basis-[45%] min-w-[20rem] max-w-[50%] flex-shrink-0 flex flex-col min-h-0 rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70">
                  Diagram source
                </div>
                <pre className="flex-1 min-h-0 overflow-auto p-3 text-[12px] leading-relaxed font-mono text-white/80 whitespace-pre">
                  {focusedDiagram.content}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
