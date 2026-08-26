'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { Trash2, Undo2, Save, Loader2 } from 'lucide-react';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { parseNarrativeBlocks, buildUserNarrativeContent, getSectionBlockIds, type NarrativeBlock } from '@/components/narrative-blocks';
import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge } from '@/lib/api/client';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
import { cn, downloadMarkdown } from '@/lib/utils';
import { toast } from 'sonner';

export type CuratedPageEnvelope = {
  synthesis: { narrative: string };
  canvas?: {
    graph: { nodes: GraphNode[]; edges: GraphEdge[] };
    tables?: Array<{ name: string; columns: string[]; rows: Record<string, unknown>[] }>;
    diagrams?: Array<{ name: string; type: string; content: string }>;
  };
};

export function normalizeEnvelope(page: ResearchStepSummary | DiscoverStepResponse): CuratedPageEnvelope {
  const canvas = page.canvas ?? { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] };
  return {
    synthesis: { narrative: page.synthesis?.narrative ?? '' },
    canvas: {
      graph: canvas.graph ?? { nodes: [], edges: [] },
      tables: canvas.tables ?? [],
      diagrams: canvas.diagrams ?? [],
    },
  };
}

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
  const displayMarkdown = useMemo(() => buildEnvelopeMarkdown(page), [page]);
  const baseBlocks = useMemo(() => parseNarrativeBlocks(displayMarkdown), [displayMarkdown]);
  const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set());
  const [showIndex, setShowIndex] = useState(true);
  const [plain, setPlain] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset transient edit state when the page itself changes.
  useEffect(() => {
    setDeletedBlockIds(new Set());
  }, [page]);

  // Compare against the server baseline so that local envelope mutations
  // (copy/add graph, tables, diagrams, narrative) make the page dirty.
  const effectiveBaseline = baseline ?? envelope;
  const displayedBlocks = useMemo(() => {
    return baseBlocks.map((b) => (deletedBlockIds.has(b.id) ? { ...b, deleted: true } : { ...b, deleted: false }));
  }, [baseBlocks, deletedBlockIds]);

  const userMarkdown = useMemo(() => buildUserNarrativeContent(displayedBlocks), [displayedBlocks]);
  const baselineDirty = useMemo(() => {
    const canvas = envelope.canvas ?? { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] };
    const baseCanvas = effectiveBaseline.canvas ?? { graph: { nodes: [], edges: [] }, tables: [], diagrams: [] };
    const narrativeChanged = userMarkdown !== (effectiveBaseline.synthesis.narrative ?? '');
    const graphChanged = JSON.stringify(canvas.graph) !== JSON.stringify(baseCanvas.graph);
    const tablesChanged = JSON.stringify(canvas.tables) !== JSON.stringify(baseCanvas.tables);
    const diagramsChanged = JSON.stringify(canvas.diagrams) !== JSON.stringify(baseCanvas.diagrams);
    return narrativeChanged || graphChanged || tablesChanged || diagramsChanged;
  }, [envelope, effectiveBaseline, userMarkdown]);
  const isDirty = userMarkdown !== envelope.synthesis.narrative || baselineDirty;
  const viewMode = plain ? 'plain' : 'markdown';
  const pageTitle = useMemo(() => getPageTitle(page), [page]);

  const handleSave = useCallback(async () => {
    if (!page || !('id' in page) || typeof page.id !== 'number') return;
    setSaving(true);
    try {
      // Save the full envelope: narrative edits plus any structured canvas data
      // (graph/tables/diagrams) that was applied via envelope-aware copy/add.
      await onSave(page.id, { synthesis: { narrative: userMarkdown }, canvas: envelope.canvas });
      setDeletedBlockIds(new Set());
      toast.success('Saved curated page');
    } finally {
      setSaving(false);
    }
  }, [page, userMarkdown, onSave, envelope.canvas]);

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

  const removeSectionOrBlock = useCallback((b: NarrativeBlock) => {
    if (b.synthetic) return;
    if (b.type === 'heading') {
      removeSection(b.id);
    } else {
      toggleDelete(b.id);
    }
  }, [removeSection, toggleDelete]);

  const restoreSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(displayedBlocks, id);
    setDeletedBlockIds((prev) => {
      const next = new Set(prev);
      for (const blockId of ids) next.delete(blockId);
      return next;
    });
  }, [displayedBlocks]);

  const restoreSectionOrBlock = useCallback((b: NarrativeBlock) => {
    if (b.synthetic) return;
    if (b.type === 'heading') {
      restoreSection(b.id);
    } else {
      toggleDelete(b.id);
    }
  }, [restoreSection, toggleDelete]);

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
            if (b.synthetic) return null;
            if (b.type === 'text') return null;
            return (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (b.deleted) {
                    restoreSectionOrBlock(b);
                  } else {
                    removeSectionOrBlock(b);
                  }
                }}
                className={`p-1 rounded transition-colors ${
                  b.deleted
                    ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                    : 'text-white/40 hover:text-rose-400 hover:bg-rose-500/10'
                }`}
                title={b.deleted ? 'Restore' : 'Remove'}
              >
                {b.deleted ? <Undo2 className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
              </button>
            );
          }}
        />
      </div>
    </div>
  );
}
