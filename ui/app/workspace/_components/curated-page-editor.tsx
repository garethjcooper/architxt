'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Eye, Trash2, Undo2, Loader2 } from 'lucide-react';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { parseNarrativeBlocks, getSectionBlockIds, buildNarrativeBlocks, type NarrativeBlock } from '@/components/narrative-blocks';
import { GraphViewModal } from '@/components/graph-view-modal';
import { TableFocusModal } from '@/components/table-focus-modal';
import { NarrativeFocusModal } from '@/components/narrative-focus-modal';
import { DiagramFocusModal } from '@/components/diagram-focus-modal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { DiscoverStepResponse, ResearchStepSummary, UnifiedNarrativeBlock } from '@/lib/api/client';
import { buildEnvelopeMarkdown, normalizeEnvelope } from '@/lib/envelope-markdown';
import { downloadMarkdown } from '@/lib/utils';
import { toast } from 'sonner';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';

function parseSyntheticHeading(title?: string): { kind: 'graph' | 'table' | 'diagram' | 'narrative'; name?: string } | null {
  if (!title) return null;
  const trimmed = title.trim();
  const narrativeMatch = trimmed.match(/^Narrative:\s*(.+)$/i);
  if (narrativeMatch) return { kind: 'narrative', name: narrativeMatch[1].trim() };
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
  if (parsed.kind === 'narrative') return `narrative:${parsed.name || 'untitled'}`;
  return `${parsed.kind}:${parsed.name || 'untitled'}`;
}

function isStructuredKey(parsed: NonNullable<ReturnType<typeof parseSyntheticHeading>>): boolean {
  return parsed.kind !== 'narrative';
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
  const narrativeBlocks = useMemo(() => {
    return (envelope.narratives ?? []).flatMap((n, i) => buildNarrativeBlocks(n, i));
  }, [envelope.narratives]);
  const structuredMarkdown = useMemo(() => buildEnvelopeMarkdown({
    narratives: [],
    graph: envelope.graph,
    tables: envelope.tables,
    diagrams: envelope.diagrams,
  } as CuratedPageEnvelope), [envelope.graph, envelope.tables, envelope.diagrams]);
  const structuredBlocks = useMemo(() => parseNarrativeBlocks(structuredMarkdown, { attachNarrativeIdx: false }), [structuredMarkdown]);
  const baseBlocks = useMemo(() => {
    const all = [...narrativeBlocks, ...structuredBlocks];
    // Renumber ids so the combined tree is stable across renders.
    return all.map((b, i) => ({ ...b, id: `b${i}` }));
  }, [narrativeBlocks, structuredBlocks]);
  const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set(initialDeletedBlockIds ?? []));
  const [deletedStructuredKeys, setDeletedStructuredKeys] = useState<Set<string>>(new Set(initialDeletedStructuredKeys ?? []));
  const [showIndex, setShowIndex] = useState(true);
  const [plain, setPlain] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusedDiagram, setFocusedDiagram] = useState<{ block: NarrativeBlock; name: string; content: string } | null>(null);
  const [focusedGraph, setFocusedGraph] = useState<{ block: NarrativeBlock; name?: string } | null>(null);
  const [focusedTable, setFocusedTable] = useState<{ block: NarrativeBlock; name: string } | null>(null);
  const [focusedNarrativeIndex, setFocusedNarrativeIndex] = useState<number | null>(null);

  // Reset transient edit state only when the page identity changes, not on every envelope update.
  const pageIdRef = useRef('id' in page && typeof page.id === 'number' ? String(page.id) : JSON.stringify(page));
  useEffect(() => {
    const nextId = 'id' in page && typeof page.id === 'number' ? String(page.id) : JSON.stringify(page);
    if (nextId === pageIdRef.current) return;
    pageIdRef.current = nextId;
    setDeletedBlockIds(new Set());
    setDeletedStructuredKeys(new Set());
    setFocusedNarrativeIndex(null);
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
      if (!parsed || !isStructuredKey(parsed) || !deletedStructuredKeys.has(structuredKey(parsed))) continue;
      for (const id of getSectionBlockIds(baseBlocks, b.id)) {
        deletedSubtreeIds.add(id);
      }
    }
    return baseBlocks.map((b) => {
      if (deletedBlockIds.has(b.id) || deletedSubtreeIds.has(b.id)) return { ...b, deleted: true };
      return { ...b, deleted: false };
    });
  }, [baseBlocks, deletedBlockIds, deletedStructuredKeys]);

  // Deleted narrative indices are tracked separately from structured keys
  // because narratives are an ordered array, not keyed by name.
  const [deletedNarrativeIndices, setDeletedNarrativeIndices] = useState<Set<number>>(new Set());

  const workingEnvelope = useMemo(() => {
    const kept = (envelope.narratives ?? []).filter((_, i) => !deletedNarrativeIndices.has(i));
    return {
      ...envelope,
      narratives: kept,
      tables: envelope.tables.filter((t) => !deletedStructuredKeys.has(`table:${t.name}`)),
      diagrams: envelope.diagrams.filter((d) => !deletedStructuredKeys.has(`diagram:${d.name}`)),
      graph: deletedStructuredKeys.has('graph') ? { name: envelope.graph.name, nodes: [], edges: [] } : envelope.graph,
    };
  }, [envelope, deletedNarrativeIndices, deletedStructuredKeys]);

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
      setDeletedNarrativeIndices(new Set());
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
    if (!parsed || !isStructuredKey(parsed)) return;
    const key = structuredKey(parsed);
    setDeletedStructuredKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const removeStructuredKey = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed || !isStructuredKey(parsed)) return;
    const key = structuredKey(parsed);
    setDeletedStructuredKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const restoreSection = useCallback((id: string) => {
    const ids = getSectionBlockIds(displayedBlocks, id);
    setDeletedBlockIds((prev) => {
      const next = new Set(prev);
      for (const blockId of ids) next.delete(blockId);
      return next;
    });
  }, [displayedBlocks]);

  const removeSectionOrBlock = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (b.synthetic && parsed?.kind !== 'narrative') {
      addStructuredKey(b);
      return;
    }
    if (b.type === 'heading') {
      if (parsed?.kind === 'narrative') {
        const name = parsed.name;
        const idx = name ? envelope.narratives.findIndex((n) => n.narrative_name?.trim() === name) : -1;
        if (idx >= 0) {
          setDeletedNarrativeIndices((prev) => {
            const next = new Set(prev);
            next.add(idx);
            return next;
          });
          return;
        }
      }
      if (b.__narrativeIdx !== undefined) {
        setDeletedNarrativeIndices((prev) => {
          const next = new Set(prev);
          next.add(b.__narrativeIdx!);
          return next;
        });
      } else {
        removeSection(b.id);
      }
    } else {
      toggleDelete(b.id);
    }
  }, [removeSection, toggleDelete, addStructuredKey, envelope.narratives]);

  const restoreSectionOrBlock = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (b.synthetic && parsed?.kind !== 'narrative') {
      removeStructuredKey(b);
      return;
    }
    if (b.type === 'heading') {
      if (parsed?.kind === 'narrative') {
        const name = parsed.name;
        const idx = name ? envelope.narratives.findIndex((n) => n.narrative_name?.trim() === name) : -1;
        if (idx >= 0) {
          setDeletedNarrativeIndices((prev) => {
            const next = new Set(prev);
            next.delete(idx);
            return next;
          });
          return;
        }
      }
      if (b.__narrativeIdx !== undefined) {
        setDeletedNarrativeIndices((prev) => {
          const next = new Set(prev);
          next.delete(b.__narrativeIdx!);
          return next;
        });
      } else {
        restoreSection(b.id);
      }
    } else {
      toggleDelete(b.id);
    }
  }, [restoreSection, toggleDelete, removeStructuredKey, envelope.narratives]);

  const openDiagramFocus = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed || parsed.kind !== 'diagram') return;
    const diagram = envelope.diagrams.find((d) => d.name === parsed.name);
    if (diagram && typeof diagram.content === 'string') {
      setFocusedDiagram({ block: b, name: diagram.name || parsed.name || 'Diagram', content: diagram.content });
      return;
    }
    // Fallback: extract the mermaid source from the block following the heading.
    const idx = displayedBlocks.findIndex((bb) => bb.id === b.id);
    const next = displayedBlocks[idx + 1];
    if (next && next.type === 'code' && next.language === 'mermaid') {
      const source = (next.edited ?? next.raw)
        .replace(/^```mermaid\n?/, '')
        .replace(/\n?```\s*$/, '');
      setFocusedDiagram({ block: b, name: parsed.name || 'Diagram', content: source });
    }
  }, [envelope.diagrams, displayedBlocks]);

  const openGraphFocus = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed || parsed.kind !== 'graph') return;
    const name = envelope.graph.name || parsed.name || 'Graph';
    setFocusedGraph({ block: b, name });
  }, [envelope.graph]);

  const openTableFocus = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed || parsed.kind !== 'table') return;
    const table = envelope.tables.find((t) => t.name === parsed.name);
    if (!table) return;
    setFocusedTable({ block: b, name: table.name });
  }, [envelope.tables]);

  const openNarrativeFocus = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (parsed?.kind === 'narrative' && parsed.name) {
      const idx = envelope.narratives.findIndex((n) => n.narrative_name?.trim() === parsed.name);
      if (idx >= 0) {
        setFocusedNarrativeIndex(idx);
        return;
      }
    }
    setFocusedNarrativeIndex(b.__narrativeIdx ?? 0);
  }, [envelope.narratives]);

  const applyFocusedDiagram = useCallback((ev: EnvelopeCopyEvent) => {
    if (!focusedDiagram) return;
    const parsed = parseSyntheticHeading(focusedDiagram.block.title);
    if (!parsed || parsed.kind !== 'diagram') return;
    const oldName = parsed.name;
    const payload = JSON.parse(ev.payload);
    const updated = payload[0];
    const newName = updated?.name?.trim() || oldName || focusedDiagram.name;
    const newContent = updated?.content ?? focusedDiagram.content;
    const updatedDiagrams = [...envelope.diagrams];
    const diagramIndex = updatedDiagrams.findIndex((d) => d.name === oldName);
    if (diagramIndex >= 0) {
      updatedDiagrams[diagramIndex] = { ...updatedDiagrams[diagramIndex], name: newName, content: newContent };
    } else {
      updatedDiagrams.push({ name: newName, type: 'flowchart', content: newContent });
    }

    // If the name changed, update the synthetic heading key so the section isn't orphaned.
    const nextDeletedKeys = new Set(deletedStructuredKeys);
    if (oldName && oldName !== newName && nextDeletedKeys.has(`diagram:${oldName}`)) {
      nextDeletedKeys.delete(`diagram:${oldName}`);
      nextDeletedKeys.add(`diagram:${newName}`);
    }

    const nextEnvelope = { ...envelope, diagrams: updatedDiagrams };
    setFocusedDiagram(null);
    onChange?.({
      envelope: nextEnvelope,
      dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
      deletedBlockIds: Array.from(deletedBlockIds),
      deletedStructuredKeys: Array.from(nextDeletedKeys),
    });
  }, [focusedDiagram, envelope, effectiveBaseline, deletedBlockIds, deletedStructuredKeys, onChange]);

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
                <Loader2 className="h-3 w-3 animate-spin text-foreground-subtle" />
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
            const isDeleted = b.deleted;
            const isText = b.type === 'text';
            const parsed = parseSyntheticHeading(b.title);
            const isDiagram = parsed?.kind === 'diagram';
            const isGraph = parsed?.kind === 'graph';
            const isTable = parsed?.kind === 'table';
            const isNarrative = b.type === 'heading' && (!b.synthetic || parsed?.kind === 'narrative');
            const canFocus = isText || isNarrative || isDiagram || isGraph || isTable;
            return (
              <div className="flex items-center gap-0.5 opacity-0 group-hover/copy:opacity-100 focus-within:opacity-100 transition-opacity">
                {canFocus && !isDeleted && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isGraph) {
                        openGraphFocus(b);
                      } else if (isTable) {
                        openTableFocus(b);
                      } else if (isNarrative || isText) {
                        openNarrativeFocus(b);
                      } else {
                        openDiagramFocus(b);
                      }
                    }}
                    className="p-1 rounded text-foreground-subtle hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
                    title={isGraph ? 'Focus graph' : isTable ? 'Focus table' : isNarrative || isText ? 'Focus narrative' : 'Focus diagram'}
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
                      ? 'text-accent-primary-fg hover:text-accent-primary-fg hover:bg-accent-primary-bg'
                      : 'text-foreground-subtle hover:text-destructive-fg hover:bg-destructive-bg'
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
      <DiagramFocusModal
        open={focusedDiagram != null}
        onOpenChange={(open) => { if (!open) setFocusedDiagram(null); }}
        name={focusedDiagram?.name ?? ''}
        content={focusedDiagram?.content ?? ''}
        onApply={applyFocusedDiagram}
      />
      <GraphViewModal
        open={focusedGraph != null}
        onOpenChange={(open) => { if (!open) setFocusedGraph(null); }}
        graph={envelope.graph}
        title={focusedGraph?.name}
        onApply={(events) => {
          events.forEach((ev) => {
            if (ev.type === 'diagrams') {
              const parsed = JSON.parse(ev.payload);
              const existingNames = new Set(envelope.diagrams.map((d) => d.name));
              const newDiagrams = parsed.filter((d: { name: string }) => !existingNames.has(d.name));
              if (newDiagrams.length === 0) return;
              const nextEnvelope = { ...envelope, diagrams: [...envelope.diagrams, ...newDiagrams] };
              onChange?.({
                envelope: nextEnvelope,
                dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
                deletedBlockIds: Array.from(deletedBlockIds),
                deletedStructuredKeys: Array.from(deletedStructuredKeys),
              });
            } else if (ev.type === 'tables') {
              const parsed = JSON.parse(ev.payload);
              const existingNames = new Set(envelope.tables.map((t) => t.name));
              const newTables = parsed.filter((t: { name: string }) => !existingNames.has(t.name));
              if (newTables.length === 0) return;
              const nextEnvelope = { ...envelope, tables: [...envelope.tables, ...newTables] };
              onChange?.({
                envelope: nextEnvelope,
                dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
                deletedBlockIds: Array.from(deletedBlockIds),
                deletedStructuredKeys: Array.from(deletedStructuredKeys),
              });
            }
          });
        }}
      />
      <TableFocusModal
        open={focusedTable != null}
        onOpenChange={(open) => { if (!open) setFocusedTable(null); }}
        table={envelope.tables.find((t) => t.name === focusedTable?.name) ?? { name: focusedTable?.name ?? '', columns: [], rows: [] }}
        onApply={(ev) => {
          const parsed = JSON.parse(ev.payload);
          const updated = parsed[0];
          if (!updated) return;
          const oldName = focusedTable!.name;
          const newName = updated.name;
          const tableIndex = envelope.tables.findIndex((t) => t.name === oldName);
          const nextTables = [...envelope.tables];
          if (tableIndex >= 0) {
            nextTables[tableIndex] = updated;
          } else {
            nextTables.push(updated);
          }
          const nextDeletedKeys = new Set(deletedStructuredKeys);
          if (oldName !== newName && nextDeletedKeys.has(`table:${oldName}`)) {
            nextDeletedKeys.delete(`table:${oldName}`);
            nextDeletedKeys.add(`table:${newName}`);
          }
          const nextEnvelope = { ...envelope, tables: nextTables };
          onChange?.({
            envelope: nextEnvelope,
            dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
            deletedBlockIds: Array.from(deletedBlockIds),
            deletedStructuredKeys: Array.from(nextDeletedKeys),
          });
        }}
      />
      <NarrativeFocusModal
        open={focusedNarrativeIndex != null}
        onOpenChange={(open) => { if (!open) setFocusedNarrativeIndex(null); }}
        name={focusedNarrativeIndex != null ? (envelope.narratives[focusedNarrativeIndex]?.narrative_name || '') : ''}
        content={focusedNarrativeIndex != null ? (envelope.narratives[focusedNarrativeIndex]?.narrative || '') : ''}
        onApply={(ev) => {
          const parsed = JSON.parse(ev.payload);
          const existing = envelope.narratives ?? [];
          const idx = focusedNarrativeIndex ?? 0;
          const nextNarratives: UnifiedNarrativeBlock[] =
            existing.length > 0
              ? existing.map((n, i) => (i === idx ? { narrative_name: parsed.name, narrative: parsed.content } : n))
              : [{ narrative_name: parsed.name, narrative: parsed.content }];
          const nextEnvelope = { ...envelope, narratives: nextNarratives };
          onChange?.({
            envelope: nextEnvelope,
            dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
            deletedBlockIds: Array.from(deletedBlockIds),
            deletedStructuredKeys: Array.from(deletedStructuredKeys),
          });
        }}
      />
    </div>
  );
}
