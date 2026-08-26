'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Save, Trash2, Undo2, Loader2, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { parseNarrativeBlocks, buildNarrativeContent, getSectionBlockIds, type NarrativeBlock } from '@/components/narrative-blocks';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
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
  /** Optional callback invoked when the user requests to add a section to another page. */
  onAddRequest?: (sectionMarkdown: string, sectionTitle?: string) => void;
  /** When true, the editor renders a compact read-only preview without editing controls. */
  readOnly?: boolean;
}

function isResearchStepSummary(page: ResearchStepSummary | DiscoverStepResponse): page is ResearchStepSummary {
  return 'id' in page;
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

export function CuratedPageEditor({ page, onSave, readOnly = false }: CuratedPageEditorProps) {
  const envelope = useMemo(() => normalizeEnvelope(page), [page]);
  const [blocks, setBlocks] = useState<NarrativeBlock[]>(() => parseNarrativeBlocks(envelope.synthesis.narrative));

  useEffect(() => {
    // Defer parsing to avoid cascading renders caused by synchronous setState.
    const id = requestAnimationFrame(() => {
      setBlocks(parseNarrativeBlocks(envelope.synthesis.narrative));
    });
    return () => cancelAnimationFrame(id);
  }, [envelope.synthesis.narrative]);

  const currentMarkdown = useMemo(() => buildNarrativeContent(blocks), [blocks]);
  const isDirty = useMemo(() => currentMarkdown !== envelope.synthesis.narrative, [currentMarkdown, envelope.synthesis.narrative]);
  const [saving, setSaving] = useState(false);
  const [showIndex, setShowIndex] = useState(true);
  const [plain, setPlain] = useState(true);
  const [controlsOpen, setControlsOpen] = useState(false);

  const viewMode = plain ? 'plain' : 'markdown';

  const handleSave = useCallback(async () => {
    if (!page || !('id' in page)) return;
    setSaving(true);
    try {
      await onSave(page.id, {
        synthesis: { narrative: currentMarkdown },
        canvas: envelope.canvas,
      });
    } finally {
      setSaving(false);
    }
  }, [page, currentMarkdown, envelope.canvas, onSave]);

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

  const header = (
    <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-purple-900/20 text-purple-300 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Curated page editor</span>
        {!readOnly && (
          <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
            <Switch
              checked={controlsOpen}
              onCheckedChange={(checked) => setControlsOpen(Boolean(checked))}
              size="sm"
            />
            Controls
          </label>
        )}
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2">
          {isDirty && <span className="text-[10px] text-white/50">Unsaved changes</span>}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!isDirty || saving}
            className="h-6 px-2 text-[11px] bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            <Save className="h-3 w-3" />
            Save
          </Button>
        </div>
      )}
    </div>
  );

  const handleCopyAll = useCallback(() => {
    if (!currentMarkdown) return;
    void navigator.clipboard.writeText(currentMarkdown).then(() => toast.success('Copied to clipboard'));
  }, [currentMarkdown]);

  const handleDownloadMd = useCallback(() => {
    if (!currentMarkdown || !isResearchStepSummary(page)) return;
    const date = new Date().toISOString().split('T')[0];
    const pageName = page.intent_text;
    const sanitized = (pageName || `page-${page.id}`).replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 50);
    const filename = `${sanitized}-${date}.md`;
    const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded as ${filename}`);
  }, [currentMarkdown, page]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {header}
      <div className="flex-1 min-h-0 overflow-hidden p-2 relative">
        {!readOnly && controlsOpen && (
          <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/75 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[220px]">
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch
                checked={showIndex}
                onCheckedChange={(checked) => setShowIndex(Boolean(checked))}
                size="sm"
              />
              Show index
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch
                checked={plain}
                onCheckedChange={(checked) => setPlain(Boolean(checked))}
                size="sm"
              />
              Plain text
            </label>
            <div className="h-px bg-white/10" />
            <button
              type="button"
              onClick={handleCopyAll}
              disabled={!currentMarkdown}
              className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy className="h-3 w-3" />
              Copy text
            </button>
            <button
              type="button"
              onClick={handleDownloadMd}
              disabled={!currentMarkdown}
              className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3 w-3" />
              Save .md
            </button>
          </div>
        )}
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
