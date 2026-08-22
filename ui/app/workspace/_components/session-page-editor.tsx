'use client';

import { useState, useEffect, useMemo, useRef, useCallback, forwardRef, useImperativeHandle, Fragment } from 'react';
import { Loader2, FileText, Undo2, Trash2, ArrowUp, ArrowDown, Save, Network, Table2, Shapes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  parseNarrativeBlocks,
  buildNarrativeContent,
  getSectionBlockIds,
  type NarrativeBlock,
} from '@/components/narrative-blocks';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { researchApi, type ResearchStepSummary, type GraphNode, type GraphEdge } from '@/lib/api/client';

function buildContent(blocks: NarrativeBlock[]): string {
  return buildNarrativeContent(blocks);
}

function buildBlocks(content: string | null | undefined): NarrativeBlock[] {
  if (!content) return [];
  return parseNarrativeBlocks(content);
}

export interface SessionPageEditorRef {
  appendBlocks: (markdown: string) => void;
  appendGraph: (nodes: GraphNode[], edges: GraphEdge[]) => void;
  appendTables: (tables: Array<{ name: string; columns?: string[]; rows: Record<string, any>[] }>) => void;
  appendDiagrams: (diagrams: Array<{ name: string; type: string; content: string }>) => void;
}

interface CanvasShape {
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  tables: Array<{ name: string; columns?: string[]; rows: Record<string, any>[] }>;
  diagrams: Array<{ name: string; type: string; content: string }>;
}

interface SessionPageEditorProps {
  step: ResearchStepSummary;
  onSaved?: (updated: ResearchStepSummary) => void;
  /** Optional key namespace so multiple session editors on the same page don't share React keys. */
  keyPrefix?: string;
}

function defaultCanvas(canvas: ResearchStepSummary['canvas']): CanvasShape {
  return {
    graph: canvas?.graph || { nodes: [], edges: [] },
    tables: canvas?.tables || [],
    diagrams: canvas?.diagrams || [],
  };
}

export const SessionPageEditor = forwardRef(function SessionPageEditor(
  { step, onSaved, keyPrefix = '' }: SessionPageEditorProps,
  ref: React.Ref<SessionPageEditorRef>
) {
  const [title, setTitle] = useState(step.intent_text || '');
  const [blocks, setBlocks] = useState<NarrativeBlock[]>(() => buildBlocks(step.synthesis?.narrative));
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [activeRangeIds, setActiveRangeIds] = useState<Set<string>>(new Set());
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const viewerRef = useRef<{ scrollToBlock: (id: string) => void } | null>(null);

  const [canvas, setCanvas] = useState<CanvasShape>(() => defaultCanvas(step.canvas));

  useImperativeHandle(ref, () => ({
    appendBlocks: (markdown: string) => {
      if (!markdown) return;
      const parsed = parseNarrativeBlocks(markdown);
      setBlocks((prev) => {
        const maxId = prev.reduce((max, b) => {
          const n = Number(b.id.replace(/^b/, ''));
          return Number.isNaN(n) ? max : Math.max(max, n);
        }, -1);
        const next = parsed.map((b, i) => ({ ...b, id: `b${maxId + 1 + i}` }));
        return [...prev, ...next];
      });
    },
    appendGraph: (nodes, edges) => {
      setCanvas((prev) => {
        const existingNodeIds = new Set(prev.graph.nodes.map((n) => n.id));
        const existingEdgeKeys = new Set(prev.graph.edges.map((e) => e.id));
        const newNodes = nodes.filter((n) => !existingNodeIds.has(n.id));
        const newEdges = edges.filter((e) => !existingEdgeKeys.has(e.id));
        if (newNodes.length === 0 && newEdges.length === 0) {
          toast.info('Graph data already present in this page');
          return prev;
        }
        return {
          ...prev,
          graph: {
            nodes: [...prev.graph.nodes, ...newNodes],
            edges: [...prev.graph.edges, ...newEdges],
          },
        };
      });
    },
    appendTables: (tables) => {
      setCanvas((prev) => {
        const existingNames = new Set((prev.tables ?? []).map((t) => t.name));
        const newTables = tables.filter((t) => !existingNames.has(t.name));
        if (newTables.length === 0) {
          toast.info('Table(s) already present in this page');
          return prev;
        }
        return { ...prev, tables: [...(prev.tables ?? []), ...newTables] };
      });
    },
    appendDiagrams: (diagrams) => {
      setCanvas((prev) => {
        const existingNames = new Set((prev.diagrams ?? []).map((d) => d.name));
        const newDiagrams = diagrams.filter((d) => !existingNames.has(d.name));
        if (newDiagrams.length === 0) {
          toast.info('Diagram(s) already present in this page');
          return prev;
        }
        return { ...prev, diagrams: [...(prev.diagrams ?? []), ...newDiagrams] };
      });
    },
  }));

  const originalTitle = useMemo(() => step.intent_text || '', [step.intent_text]);
  const originalContent = useMemo(() => step.synthesis?.narrative || '', [step.synthesis?.narrative]);
  const originalCanvas = useMemo(() => JSON.stringify(defaultCanvas(step.canvas)), [step.canvas]);
  const currentContent = useMemo(() => buildContent(blocks), [blocks]);
  const currentCanvas = useMemo(() => JSON.stringify(canvas), [canvas]);
  const hasChanges = useMemo(
    () => title !== originalTitle || currentContent !== originalContent || currentCanvas !== originalCanvas,
    [title, originalTitle, currentContent, originalContent, currentCanvas, originalCanvas]
  );

  useEffect(() => {
    setTitle(step.intent_text || '');
    setBlocks(buildBlocks(step.synthesis?.narrative));
    setCanvas(defaultCanvas(step.canvas));
    setActiveBlockId(null);
    setActiveRangeIds(new Set());
    setEditingBlockId(null);
  }, [step.id, step.intent_text, step.synthesis?.narrative, step.canvas]);

  const removedCount = useMemo(() => blocks.filter((b) => b.deleted).length, [blocks]);
  const tableCount = canvas.tables.length;
  const diagramCount = canvas.diagrams.length;
  const nodeCount = canvas.graph.nodes.length;
  const edgeCount = canvas.graph.edges.length;

  const toggleDelete = useCallback((id: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, deleted: !b.deleted } : b)));
  }, []);

  const removeSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(blocks, id);
    setBlocks((prev) => prev.map((b) => (ids.includes(b.id) ? { ...b, deleted: true } : b)));
  }, [blocks]);

  const restoreSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(blocks, id);
    setBlocks((prev) => prev.map((b) => (ids.includes(b.id) ? { ...b, deleted: false } : b)));
  }, [blocks]);

  const moveSection = useCallback((id: string, direction: 'up' | 'down') => {
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const ids = getSectionBlockIds(blocks, id);
    const firstIdx = idx;
    const lastIdx = blocks.findIndex((b, i) => i >= idx && ids.includes(b.id) && !ids.includes(blocks[i + 1]?.id));
    const rangeEnd = lastIdx === -1 ? idx + ids.length - 1 : lastIdx;
    if (direction === 'up' && firstIdx === 0) return;
    if (direction === 'down' && rangeEnd >= blocks.length - 1) return;

    const next = [...blocks];
    if (direction === 'up') {
      const prevBlock = next[firstIdx - 1];
      const prevSectionIds = getSectionBlockIds(next, prevBlock.id);
      const prevStart = firstIdx - prevSectionIds.length;
      const section = next.splice(firstIdx, ids.length);
      next.splice(prevStart, 0, ...section);
    } else {
      const nextBlock = next[rangeEnd + 1];
      const nextSectionIds = getSectionBlockIds(next, nextBlock.id);
      const section = next.splice(firstIdx, ids.length);
      next.splice(firstIdx + nextSectionIds.length, 0, ...section);
    }
    setBlocks(next);
  }, [blocks]);

  const handleSave = useCallback(async () => {
    if (!hasChanges) {
      toast.info('No changes to save');
      return;
    }
    setIsSaving(true);
    try {
      const updated = await researchApi.updateCuratedPage(step.id, {
        intent_text: title,
        synthesis: { narrative: currentContent },
        canvas,
      });
      toast.success('Page saved');
      onSaved?.({ ...step, intent_text: updated.intent_text ?? title, synthesis: updated.synthesis, canvas: updated.canvas });
    } catch (err: any) {
      toast.error(err.message || 'Save failed');
    } finally {
      setIsSaving(false);
    }
  }, [hasChanges, step, title, currentContent, canvas, onSaved]);

  const handleDiscard = useCallback(() => {
    setTitle(originalTitle);
    setBlocks(buildBlocks(originalContent));
    setCanvas(defaultCanvas(step.canvas));
    setActiveBlockId(null);
    setActiveRangeIds(new Set());
    setEditingBlockId(null);
  }, [originalTitle, originalContent, step.canvas]);

  const scrollToBlock = useCallback((id: string) => {
    setActiveBlockId(id);
    const rangeIds = getSectionBlockIds(blocks, id);
    setActiveRangeIds(new Set(rangeIds));
    viewerRef.current?.scrollToBlock(id);
  }, [blocks]);

  const startEditingBlock = useCallback((b: NarrativeBlock) => {
    const initialValue =
      b.type === 'heading'
        ? (b.edited ?? b.raw).replace(/^#{1,6}\s+/, '').replace(/\n$/, '')
        : (b.edited ?? b.raw).replace(/\n$/, '');
    setEditValue(initialValue);
    setEditingBlockId(b.id);
    setActiveBlockId(b.id);
    setActiveRangeIds(new Set([b.id]));
  }, []);

  const finishEditingBlock = useCallback((b: NarrativeBlock) => {
    const edited = b.type === 'heading'
      ? `${'#'.repeat(b.level ?? 1)} ${editValue}\n`
      : `${editValue}\n`;
    setBlocks((prev) => prev.map((bb) => (bb.id === b.id ? { ...bb, edited } : bb)));
    setEditingBlockId(null);
  }, [editValue]);

  const visibleBlocks = useMemo(() => {
    return showRemoved ? blocks : blocks.filter((b) => !b.deleted);
  }, [blocks, showRemoved]);

  const renderSidebarRowActions = useCallback((b: NarrativeBlock) => {
    const isHeading = b.type === 'heading';
    return (
      <Fragment>
        <button
          onClick={(e) => { e.stopPropagation(); moveSection(b.id, 'up'); }}
          className="p-0.5 rounded text-white/40 hover:text-white hover:bg-white/10"
          title="Move up"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); moveSection(b.id, 'down'); }}
          className="p-0.5 rounded text-white/40 hover:text-white hover:bg-white/10"
          title="Move down"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); isHeading ? (b.deleted ? restoreSection(b.id) : removeSection(b.id)) : toggleDelete(b.id); }}
          className={`p-0.5 rounded transition-colors ${
            b.deleted
              ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
              : 'text-white/40 hover:text-red-400 hover:bg-red-500/20'
          }`}
          title={b.deleted ? 'Restore' : isHeading ? 'Remove section' : 'Remove block'}
        >
          {b.deleted ? <Undo2 className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
        </button>
      </Fragment>
    );
  }, [moveSection, removeSection, restoreSection, toggleDelete]);

  const renderBlockActions = useCallback((b: NarrativeBlock) => {
    return (
      <Fragment>
        {b.edited && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setBlocks((prev) => prev.map((bb) => (bb.id === b.id ? { ...bb, edited: undefined } : bb)));
            }}
            className="p-0.5 rounded text-white/30 hover:text-blue-400 hover:bg-blue-500/10"
            title="Revert to original"
          >
            <Undo2 className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); startEditingBlock(b); }}
          className="p-0.5 rounded text-white/30 hover:text-blue-400 hover:bg-blue-500/10"
          title="Edit block"
        >
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </Fragment>
    );
  }, [startEditingBlock]);

  const renderEditingBlock = useCallback((b: NarrativeBlock) => {
    return (
      <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
        <textarea
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
              e.preventDefault();
              finishEditingBlock(b);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditingBlockId(null);
            }
          }}
          className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-[13px] text-white/90 font-mono leading-relaxed resize-none focus:outline-none focus:border-blue-500/50"
          rows={Math.min(10, editValue.split('\n').length + 1)}
          spellCheck={false}
          autoFocus
        />
        <div className="flex justify-end gap-1.5">
          <button
            onClick={() => setEditingBlockId(null)}
            className="text-[10px] px-2 py-0.5 rounded text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => finishEditingBlock(b)}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors"
          >
            Ctrl+Enter to save
          </button>
        </div>
      </div>
    );
  }, [editValue, finishEditingBlock]);

  const header = (
    <Fragment>
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-3 shrink-0">
        <FileText className="w-4 h-4 text-emerald-300 shrink-0" />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Page title"
          className="flex-1 h-8 text-sm bg-black/20 border-white/10"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleDiscard}
          disabled={!hasChanges || isSaving}
          className="h-8 text-xs gap-1"
        >
          <Undo2 className="w-3 h-3" />
          Reset
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="h-8 text-xs gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
        >
          {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
          <Save className="w-3 h-3" />
          Save
        </Button>
      </div>
      <div className="px-3 py-1.5 border-b border-white/10 flex items-center justify-between shrink-0">
        <p className="text-[11px] text-white/40 flex items-center gap-2">
          <span>{blocks.length - removedCount} of {blocks.length} blocks visible</span>
          {removedCount > 0 && <span className="text-amber-400">({removedCount} removed)</span>}
          {nodeCount > 0 && <span className="flex items-center gap-0.5"><Network className="h-3 w-3" /> {nodeCount} nodes</span>}
          {tableCount > 0 && <span className="flex items-center gap-0.5"><Table2 className="h-3 w-3" /> {tableCount} tables</span>}
          {diagramCount > 0 && <span className="flex items-center gap-0.5"><Shapes className="h-3 w-3" /> {diagramCount} diagrams</span>}
        </p>
        <button
          onClick={() => setShowRemoved((v) => !v)}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
            showRemoved
              ? 'border-amber-500/30 text-amber-400 hover:border-amber-500/50'
              : 'border-white/10 text-white/40 hover:text-white/60'
          }`}
        >
          {showRemoved ? 'Hide removed' : 'Show removed'}
        </button>
      </div>
    </Fragment>
  );

  return (
    <NarrativeViewer
      ref={viewerRef}
      blocks={visibleBlocks}
      title="Sections"
      activeBlockId={activeBlockId}
      activeRangeIds={activeRangeIds}
      viewMode="plain"
      showIndex={true}
      keyPrefix={keyPrefix}
      header={header}
      editingBlockId={editingBlockId ?? undefined}
      renderEditingBlock={renderEditingBlock}
      renderSidebarRowActions={renderSidebarRowActions}
      renderBlockActions={renderBlockActions}
      onBlockClick={(b) => {
        if (editingBlockId !== b.id) {
          scrollToBlock(b.id);
        }
      }}
      className="min-h-0"
    />
  );
});
