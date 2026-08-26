'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Trash2, Undo2, Save, Loader2 } from 'lucide-react';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { parseNarrativeBlocks, buildNarrativeContent, getSectionBlockIds, type NarrativeBlock } from '@/components/narrative-blocks';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export type CuratedPageEnvelope = {
  synthesis: { narrative: string };
  canvas: {
    graph: { nodes: unknown[]; edges: unknown[] };
    tables?: Array<{ name: string; columns?: string[]; rows: Record<string, unknown>[] }>;
    diagrams?: Array<{ name: string; type: string; content: string }>;
  };
};

export interface CuratedPageEditorProps {
  page: ResearchStepSummary | DiscoverStepResponse;
  pages?: ResearchStepSummary[];
  onSave: (stepId: number, envelope: CuratedPageEnvelope) => Promise<void>;
  /** When true, the editor renders a compact read-only preview without editing controls. */
  readOnly?: boolean;
}

function normalizeEnvelope(page: ResearchStepSummary | DiscoverStepResponse): CuratedPageEnvelope {
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

function sanitizeFilenameBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9\\-_]/g, '_').slice(0, 50);
}

function downloadMarkdown(markdown: string, title: string) {
  const date = new Date().toISOString().split('T')[0];
  const filename = `${sanitizeFilenameBase(title)}-${date}.md`;
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Downloaded as ${filename}`);
}

export function CuratedPageEditor({ page, onSave, readOnly = false }: CuratedPageEditorProps) {
  const envelope = useMemo(() => normalizeEnvelope(page), [page]);
  const [blocks, setBlocks] = useState<NarrativeBlock[]>(() => parseNarrativeBlocks(envelope.synthesis.narrative));
  const [showIndex, setShowIndex] = useState(true);
  const [plain, setPlain] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setBlocks(parseNarrativeBlocks(envelope.synthesis.narrative));
    });
    return () => cancelAnimationFrame(id);
  }, [envelope.synthesis.narrative]);

  const currentMarkdown = useMemo(() => buildNarrativeContent(blocks), [blocks]);
  const isDirty = currentMarkdown !== envelope.synthesis.narrative;
  const viewMode = plain ? 'plain' : 'markdown';
  const pageTitle = useMemo(() => getPageTitle(page), [page]);

  const handleSave = useCallback(async () => {
    if (!page || !('id' in page) || typeof page.id !== 'number') return;
    setSaving(true);
    try {
      await onSave(page.id, {
        synthesis: { narrative: currentMarkdown },
        canvas: envelope.canvas,
      });
      toast.success('Saved curated page');
    } finally {
      setSaving(false);
    }
  }, [page, currentMarkdown, envelope.canvas, onSave]);

  const handleCopy = useCallback(() => {
    if (!currentMarkdown) return;
    navigator.clipboard.writeText(currentMarkdown).then(() => toast.success('Copied to clipboard'));
  }, [currentMarkdown]);

  const handleDownload = useCallback(() => {
    if (!currentMarkdown) return;
    downloadMarkdown(currentMarkdown, pageTitle);
  }, [currentMarkdown, pageTitle]);

  const toggleDelete = useCallback((id: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, deleted: !b.deleted } : b)));
  }, []);

  const removeSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(blocks, id);
    setBlocks((prev) => prev.map((b) => (ids.includes(b.id) ? { ...b, deleted: true } : b)));
  }, [blocks]);

  const removeSectionOrBlock = useCallback((b: NarrativeBlock) => {
    if (b.type === 'heading') {
      removeSection(b.id);
    } else {
      toggleDelete(b.id);
    }
  }, [removeSection, toggleDelete]);

  const restoreSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(blocks, id);
    setBlocks((prev) => prev.map((b) => (ids.includes(b.id) ? { ...b, deleted: false } : b)));
  }, [blocks]);

  const restoreSectionOrBlock = useCallback((b: NarrativeBlock) => {
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
          blocks={blocks}
          title="Sections"
          viewMode={viewMode}
          showIndex={showIndex}
          keyPrefix="curated"
          className="h-full"
          renderSidebarRowActions={(b) => {
            if (readOnly) return null;
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

export function buildCuratedPagePreview(page: ResearchStepSummary): string {
  return buildEnvelopeMarkdown(page);
}
