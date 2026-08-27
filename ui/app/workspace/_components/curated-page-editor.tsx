'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Trash2, Undo2, Save, Loader2 } from 'lucide-react';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { parseNarrativeBlocks, buildUserNarrativeContent, getSectionBlockIds, type NarrativeBlock } from '@/components/narrative-blocks';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';
import { buildEnvelopeMarkdown, normalizeEnvelope } from '@/lib/envelope-markdown';
import { cn, downloadMarkdown } from '@/lib/utils';
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
}

export function CuratedPageEditor({ page, baseline, onSave, readOnly = false }: CuratedPageEditorProps) {
  const envelope = useMemo(() => normalizeEnvelope(page), [page]);
  const displayMarkdown = useMemo(() => buildEnvelopeMarkdown(envelope), [envelope]);
  const baseBlocks = useMemo(() => parseNarrativeBlocks(displayMarkdown), [displayMarkdown]);
  const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set());
  const [deletedStructuredKeys, setDeletedStructuredKeys] = useState<Set<string>>(new Set());
  const [showIndex, setShowIndex] = useState(true);
  const [plain, setPlain] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset transient edit state when the page itself changes.
  useEffect(() => {
    setDeletedBlockIds(new Set());
    setDeletedStructuredKeys(new Set());
  }, [page]);

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

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <EnvelopeControls
        title={pageTitle}
        showIndex={showIndex}
        onShowIndexChange={setShowIndex}
        plain={plain}
        onPlainChange={setPlain}
        onCopyText={handleCopy}
        onSaveMd={handleDownload}
        extraHeaderItems={
          readOnly ? undefined : (
            <>
              {isDirty && (
                <span className="text-[10px] text-white/50 hidden sm:inline">Unsaved changes</span>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || saving}
                className={cn(
                  'h-6 px-2 rounded text-[11px] flex items-center gap-1 transition-colors',
                  isDirty
                    ? 'bg-purple-600 hover:bg-purple-500 text-white'
                    : 'bg-white/10 text-white/50 cursor-not-allowed'
                )}
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" />}
                <Save className="h-3 w-3" />
                Save
              </button>
            </>
          )
        }
      />
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
            return (
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
            );
          }}
        />
      </div>
    </div>
  );
}
