'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Eye, Trash2, Undo2, Loader2, FileSearch, FileText, Plus } from 'lucide-react';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { parseNarrativeBlocks, getSectionBlockIds, buildNarrativeBlocks, type NarrativeBlock } from '@/components/narrative-blocks';
import { GraphViewModal } from '@/components/graph-view-modal';
import { TableFocusModal } from '@/components/table-focus-modal';
import { NarrativeFocusModal } from '@/components/narrative-focus-modal';
import { EvidenceModal } from '@/components/evidence-modal';
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

function structuredKey(parsed: NonNullable<ReturnType<typeof parseSyntheticHeading>>, tableId?: string, diagramId?: string): string {
  if (parsed.kind === 'graph') return 'graph';
  if (parsed.kind === 'narrative') return `narrative:${parsed.name || 'untitled'}`;
  if (parsed.kind === 'table' && tableId) return `table:${tableId}`;
  if (parsed.kind === 'diagram' && diagramId) return `diagram:${diagramId}`;
  return `${parsed.kind}:${parsed.name || 'untitled'}`;
}

function structuredIdKey(parsed: NonNullable<ReturnType<typeof parseSyntheticHeading>>, tableId?: string, diagramId?: string): string | null {
  if (parsed.kind === 'table' && tableId) return `table:${tableId}`;
  if (parsed.kind === 'diagram' && diagramId) return `diagram:${diagramId}`;
  return null;
}

function structuredNameKey(parsed: NonNullable<ReturnType<typeof parseSyntheticHeading>>): string | null {
  if (parsed.kind === 'table' || parsed.kind === 'diagram') return `${parsed.kind}:${parsed.name || 'untitled'}`;
  if (parsed.kind === 'graph') return 'graph';
  return null;
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
  /** Optional server id used to resolve evidence. */
  serverId?: number;
  /** Optional bank id used to resolve evidence. */
  bankId?: string;
  /** Optional override for the header bar title. Defaults to the page title. */
  headerTitle?: string;
  /** Whether the section index sidebar is shown. */
  showIndex?: boolean;
  /** Called when the section index visibility changes. */
  onShowIndexChange?: (showIndex: boolean) => void;
  /** Whether plain-text view is enabled. */
  plain?: boolean;
  /** Called when plain-text view is toggled. */
  onPlainChange?: (plain: boolean) => void;
  /** Controlled sidebar width in pixels. Passed through to NarrativeViewer. */
  sidebarWidth?: number;
  /** Called when the sidebar width changes. Passed through to NarrativeViewer. */
  onSidebarWidthChange?: (width: number) => void;
  /** Called when the dirty state changes so the parent can enable/disable a global Save control. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Called when the user wants to copy a section to a curated page via the target picker. */
  onRequestCopySection?: (event: EnvelopeCopyEvent) => void;
  /** Increment to trigger a save from the parent. */
  saveTrigger?: number;
  /** Initial deletion sets restored from a previous edit session (e.g. after switching tabs). */
  initialDeletedBlockIds?: string[];
  initialDeletedStructuredKeys?: string[];
  initialDeletedNarrativeIds?: string[];
  /** Called with the current working envelope and deletion state on every meaningful change.
   *  The parent can persist the deletion sets so revert remains available across tab switches. */
  onChange?: (payload: {
    envelope: CuratedPageEnvelope;
    dirty: boolean;
    deletedBlockIds: string[];
    deletedStructuredKeys: string[];
    deletedNarrativeIds: string[];
  }) => void;
}

export function CuratedPageEditor({
  page,
  baseline,
  onSave,
  readOnly = false,
  tabs,
  serverId,
  bankId,
  headerTitle,
  onDirtyChange,
  saveTrigger,
  initialDeletedBlockIds,
  initialDeletedStructuredKeys,
  initialDeletedNarrativeIds,
  onChange,
  showIndex: showIndexProp,
  onShowIndexChange,
  plain: plainProp,
  onPlainChange,
  sidebarWidth,
  onSidebarWidthChange,
  onRequestCopySection,
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
  // Tag synthetic table/diagram blocks with their envelope ids so identity is stable
  // across name collisions and rename edits.
  const taggedStructuredBlocks = useMemo(() => {
    const nameToTableId = new Map(envelope.tables.map((t) => [t.name, t.id]));
    const nameToDiagramId = new Map(envelope.diagrams.map((d) => [d.name, d.id]));
    return structuredBlocks.map((b) => {
      const parsed = parseSyntheticHeading(b.title);
      if (!parsed) return b;
      if (parsed.kind === 'table' && parsed.name) {
        const id = nameToTableId.get(parsed.name);
        if (id) return { ...b, __tableId: id };
      }
      if (parsed.kind === 'diagram' && parsed.name) {
        const id = nameToDiagramId.get(parsed.name);
        if (id) return { ...b, __diagramId: id };
      }
      return b;
    });
  }, [structuredBlocks, envelope.tables, envelope.diagrams]);
  const baseBlocks = useMemo(() => {
    const all = [...narrativeBlocks, ...taggedStructuredBlocks];
    // Renumber ids so the combined tree is stable across renders.
    return all.map((b, i) => ({ ...b, id: `b${i}` }));
  }, [narrativeBlocks, taggedStructuredBlocks]);
  const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set(initialDeletedBlockIds ?? []));
  // Deleted structured section ids replace name-based keys. We keep the name key
  // only for legacy data that lacks ids and for the singleton graph.
  const [deletedStructuredKeys, setDeletedStructuredKeys] = useState<Set<string>>(new Set(initialDeletedStructuredKeys ?? []));
  const [showIndex, setShowIndex] = useState(showIndexProp ?? true);
  const [plain, setPlain] = useState(plainProp ?? false);

  useEffect(() => {
    if (showIndexProp !== undefined) setShowIndex(showIndexProp);
  }, [showIndexProp]);

  useEffect(() => {
    if (plainProp !== undefined) setPlain(plainProp);
  }, [plainProp]);

  const effectiveShowIndex = onShowIndexChange ? (showIndexProp ?? true) : showIndex;
  const effectivePlain = onPlainChange ? (plainProp ?? false) : plain;

  const handleShowIndexChange = useCallback((checked: boolean) => {
    if (onShowIndexChange) {
      onShowIndexChange(checked);
    } else {
      setShowIndex(checked);
    }
  }, [onShowIndexChange]);

  const handlePlainChange = useCallback((checked: boolean) => {
    if (onPlainChange) {
      onPlainChange(checked);
    } else {
      setPlain(checked);
    }
  }, [onPlainChange]);

  const [saving, setSaving] = useState(false);
  const [focusedDiagram, setFocusedDiagram] = useState<{ block: NarrativeBlock; name: string; content: string } | null>(null);
  const [focusedGraph, setFocusedGraph] = useState<{ block: NarrativeBlock; name?: string } | null>(null);
  const [focusedTable, setFocusedTable] = useState<{ block: NarrativeBlock; name: string } | null>(null);
  const [focusedNarrativeIndex, setFocusedNarrativeIndex] = useState<number | null>(null);
  const [evidenceModal, setEvidenceModal] = useState<{ memoryIds: string[]; label: string } | null>(null);

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

  // Deleted narrative ids are tracked separately from structured keys
  // because narratives are an ordered array, not keyed by name.
  const [deletedNarrativeIds, setDeletedNarrativeIds] = useState<Set<string>>(new Set(initialDeletedNarrativeIds ?? []));

  const displayedBlocks = useMemo(() => {
    const deletedSubtreeIds = new Set<string>();
    for (let i = 0; i < baseBlocks.length; i++) {
      const b = baseBlocks[i];
      if (b.type !== 'heading' || !b.synthetic) continue;
      const parsed = parseSyntheticHeading(b.title);
      if (!parsed || !isStructuredKey(parsed)) continue;
      const key = structuredKey(parsed, b.__tableId, b.__diagramId);
      if (!deletedStructuredKeys.has(key)) {
        // Legacy fallback: older deletion sets or envelopes without ids used name keys.
        const nameKey = structuredNameKey(parsed);
        if (!nameKey || !deletedStructuredKeys.has(nameKey)) continue;
      }
      for (const id of getSectionBlockIds(baseBlocks, b.id)) {
        deletedSubtreeIds.add(id);
      }
    }
    return baseBlocks.map((b) => {
      if (deletedBlockIds.has(b.id) || deletedSubtreeIds.has(b.id)) return { ...b, deleted: true };
      if (b.__narrativeId && deletedNarrativeIds.has(b.__narrativeId)) return { ...b, deleted: true };
      return { ...b, deleted: false };
    });
  }, [baseBlocks, deletedBlockIds, deletedStructuredKeys, deletedNarrativeIds]);

  const workingEnvelope = useMemo(() => {
    const kept = (envelope.narratives ?? []).filter((n) => n.id && !deletedNarrativeIds.has(n.id));
    return {
      ...envelope,
      narratives: kept,
      tables: envelope.tables.filter((t) => {
        if (t.id) {
          const idKey = `table:${t.id}`;
          if (deletedStructuredKeys.has(idKey)) return false;
        }
        // Legacy name-key fallback.
        return !deletedStructuredKeys.has(`table:${t.name}`);
      }),
      diagrams: envelope.diagrams.filter((d) => {
        if (d.id) {
          const idKey = `diagram:${d.id}`;
          if (deletedStructuredKeys.has(idKey)) return false;
        }
        return !deletedStructuredKeys.has(`diagram:${d.name}`);
      }),
      graph: deletedStructuredKeys.has('graph') ? { name: envelope.graph.name, nodes: [], edges: [] } : envelope.graph,
    };
  }, [envelope, deletedNarrativeIds, deletedStructuredKeys]);

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
      deletedNarrativeIds: Array.from(deletedNarrativeIds),
    });
  }, [workingEnvelope, isDirty, deletedBlockIds, deletedStructuredKeys, deletedNarrativeIds, onChange]);

  const viewMode = effectivePlain ? 'plain' : 'markdown';
  const pageTitle = useMemo(() => getPageTitle(page), [page]);

  const handleSave = useCallback(async () => {
    if (!page || !('id' in page) || typeof page.id !== 'number') return;
    setSaving(true);
    try {
      await onSave(page.id, workingEnvelope);
      setDeletedBlockIds(new Set());
      setDeletedStructuredKeys(new Set());
      setDeletedNarrativeIds(new Set());
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
    const key = structuredKey(parsed, b.__tableId, b.__diagramId);
    const nameKey = structuredNameKey(parsed);
    setDeletedStructuredKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      // Also remove any legacy name-key entry if present so the new canonical key wins.
      if (nameKey && nameKey !== key) next.delete(nameKey);
      return next;
    });
  }, []);

  const removeStructuredKey = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed || !isStructuredKey(parsed)) return;
    const key = structuredKey(parsed, b.__tableId, b.__diagramId);
    const nameKey = structuredNameKey(parsed);
    setDeletedStructuredKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      if (nameKey) next.delete(nameKey);
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
    if (b.__narrativeId) {
      setDeletedNarrativeIds((prev) => {
        const next = new Set(prev);
        next.add(b.__narrativeId!);
        return next;
      });
      return;
    }
    if (b.type === 'heading') {
      if (parsed?.kind === 'narrative') {
        const name = parsed.name;
        const prefixName = name ? `Narrative: ${name}` : undefined;
        const idx = name ? envelope.narratives.findIndex((n) => {
          const trimmed = n.narrative_name?.trim() ?? '';
          return trimmed === name || (prefixName && trimmed === prefixName);
        }) : -1;
        if (idx >= 0) {
          setDeletedNarrativeIds((prev) => {
            const next = new Set(prev);
            next.add(envelope.narratives[idx].id ?? `legacy-${idx}`);
            return next;
          });
          return;
        }
      }
      removeSection(b.id);
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
    if (b.__narrativeId) {
      setDeletedNarrativeIds((prev) => {
        const next = new Set(prev);
        next.delete(b.__narrativeId!);
        return next;
      });
      return;
    }
    if (b.type === 'heading') {
      if (parsed?.kind === 'narrative') {
        const name = parsed.name;
        const prefixName = name ? `Narrative: ${name}` : undefined;
        const idx = name ? envelope.narratives.findIndex((n) => {
          const trimmed = n.narrative_name?.trim() ?? '';
          return trimmed === name || (prefixName && trimmed === prefixName);
        }) : -1;
        if (idx >= 0) {
          setDeletedNarrativeIds((prev) => {
            const next = new Set(prev);
            next.delete(envelope.narratives[idx].id ?? `legacy-${idx}`);
            return next;
          });
          return;
        }
      }
      restoreSection(b.id);
    } else {
      toggleDelete(b.id);
    }
  }, [restoreSection, toggleDelete, removeStructuredKey, envelope.narratives]);

  const openDiagramFocus = useCallback((b: NarrativeBlock) => {
    const parsed = parseSyntheticHeading(b.title);
    if (!parsed || parsed.kind !== 'diagram') return;
    const diagram = b.__diagramId
      ? envelope.diagrams.find((d) => d.id === b.__diagramId)
      : envelope.diagrams.find((d) => d.name === parsed.name);
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
    const table = b.__tableId
      ? envelope.tables.find((t) => t.id === b.__tableId)
      : envelope.tables.find((t) => t.name === parsed.name);
    if (!table) return;
    setFocusedTable({ block: b, name: table.name });
  }, [envelope.tables]);

  const resolveSectionEvidence = useCallback((heading: string, narrativeId?: string, tableId?: string, diagramId?: string): string[] => {
    if (narrativeId) {
      const narrative = envelope.narratives.find((n) => n.id === narrativeId);
      if (narrative) return narrative.evidence ?? [];
    }
    if (tableId) {
      const table = envelope.tables.find((t) => t.id === tableId);
      if (table) return table.evidence ?? [];
    }
    if (diagramId) {
      const diagram = envelope.diagrams.find((d) => d.id === diagramId);
      if (diagram) return diagram.evidence ?? [];
    }
    const parsed = parseSyntheticHeading(heading);
    if (!parsed) return [];
    switch (parsed.kind) {
      case 'narrative': {
        const prefixName = `Narrative: ${parsed.name}`;
        const narrative = envelope.narratives?.find((n) => {
          const trimmed = n.narrative_name?.trim() ?? '';
          return trimmed === parsed.name || trimmed === prefixName;
        });
        return narrative?.evidence ?? [];
      }
      case 'table': {
        const table = envelope.tables?.find((t) => t.name === parsed.name);
        return table?.evidence ?? [];
      }
      case 'diagram': {
        const diagram = envelope.diagrams?.find((d) => d.name === parsed.name);
        return diagram?.evidence ?? [];
      }
      case 'graph': {
        const edges = envelope.graph?.edges ?? [];
        return Array.from(new Set(edges.flatMap((e) => e.evidence ?? [])));
      }
      default:
        return [];
    }
  }, [envelope]);

  const handleShowEvidence = useCallback((memoryIds: string[], label: string) => {
    setEvidenceModal({ memoryIds, label });
  }, []);

  const makeSectionCopyEvent = useCallback((b: NarrativeBlock): EnvelopeCopyEvent | null => {
    const parsed = parseSyntheticHeading(b.title);
    if (parsed?.kind === 'table') {
      const table = b.__tableId
        ? envelope.tables.find((t) => t.id === b.__tableId)
        : envelope.tables.find((t) => t.name === parsed.name);
      if (!table) return null;
      return {
        type: 'tables',
        payload: JSON.stringify([table]),
        label: table.name || b.title || 'Table',
        evidence: table.evidence ?? [],
        id: table.id,
      };
    }
    if (parsed?.kind === 'diagram') {
      const diagram = b.__diagramId
        ? envelope.diagrams.find((d) => d.id === b.__diagramId)
        : envelope.diagrams.find((d) => d.name === parsed.name);
      if (!diagram) return null;
      return {
        type: 'diagrams',
        payload: JSON.stringify([diagram]),
        label: diagram.name || b.title || 'Diagram',
        evidence: diagram.evidence ?? [],
        id: diagram.id,
      };
    }
    if (parsed?.kind === 'graph') {
      return {
        type: 'graph',
        payload: JSON.stringify(envelope.graph),
        label: envelope.graph.name || b.title || 'Graph',
        evidence: Array.from(new Set((envelope.graph.edges ?? []).flatMap((e) => e.evidence ?? []))),
      };
    }
    // narrative / text
    const ids = getSectionBlockIds(displayedBlocks, b.id);
    const markdown = displayedBlocks
      .filter((bb) => ids.includes(bb.id))
      .map((bb) => bb.edited ?? bb.raw)
      .join('');
    return {
      type: 'narrative',
      payload: markdown,
      label: b.title || 'Section',
      evidence: resolveSectionEvidence(b.title ?? '', b.__narrativeId, b.__tableId, b.__diagramId),
      id: b.__narrativeId,
    };
  }, [envelope, displayedBlocks, resolveSectionEvidence]);

  const openNarrativeFocus = useCallback((b: NarrativeBlock) => {
    if (b.__narrativeId) {
      const idx = envelope.narratives.findIndex((n) => n.id === b.__narrativeId);
      if (idx >= 0) {
        setFocusedNarrativeIndex(idx);
        return;
      }
    }
    const parsed = parseSyntheticHeading(b.title);
    if (parsed?.kind === 'narrative' && parsed.name) {
      const prefixName = `Narrative: ${parsed.name}`;
      const idx = envelope.narratives.findIndex((n) => {
        const trimmed = n.narrative_name?.trim() ?? '';
        return trimmed === parsed.name || trimmed === prefixName;
      });
      if (idx >= 0) {
        setFocusedNarrativeIndex(idx);
        return;
      }
    }
    setFocusedNarrativeIndex(b.__narrativeIdx ?? 0);
  }, [envelope.narratives]);

  const applyFocusedDiagram = useCallback((ev: EnvelopeCopyEvent) => {
    if (!focusedDiagram) return;
    const block = focusedDiagram.block;
    const parsed = parseSyntheticHeading(block.title);
    if (!parsed || parsed.kind !== 'diagram') return;
    const oldName = parsed.name;
    const payload = JSON.parse(ev.payload);
    const updated = payload[0];
    const newName = updated?.name?.trim() || oldName || focusedDiagram.name;
    const newContent = updated?.content ?? focusedDiagram.content;
    const updatedDiagrams = [...envelope.diagrams];
    const targetId = block.__diagramId;
    const diagramIndex = targetId
      ? updatedDiagrams.findIndex((d) => d.id === targetId)
      : updatedDiagrams.findIndex((d) => d.name === oldName);
    if (diagramIndex >= 0) {
      const existingEvidence = updatedDiagrams[diagramIndex].evidence ?? [];
      updatedDiagrams[diagramIndex] = { ...updatedDiagrams[diagramIndex], id: updatedDiagrams[diagramIndex].id || crypto.randomUUID(), name: newName, content: newContent, evidence: existingEvidence };
    } else {
      updatedDiagrams.push({ id: crypto.randomUUID(), name: newName, type: 'flowchart', content: newContent, evidence: [] });
    }

    // If the section was deleted under an old key, migrate the deletion to the canonical id key.
    const nextDeletedKeys = new Set(deletedStructuredKeys);
    if (targetId) {
      const idKey = `diagram:${targetId}`;
      if (nextDeletedKeys.has(idKey)) {
        const newId = updatedDiagrams[diagramIndex >= 0 ? diagramIndex : updatedDiagrams.length - 1].id!;
        if (newId !== targetId) {
          nextDeletedKeys.delete(idKey);
          nextDeletedKeys.add(`diagram:${newId}`);
        }
      }
    } else if (oldName && oldName !== newName && nextDeletedKeys.has(`diagram:${oldName}`)) {
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
      deletedNarrativeIds: Array.from(deletedNarrativeIds),
    });
  }, [focusedDiagram, envelope, effectiveBaseline, deletedBlockIds, deletedStructuredKeys, deletedNarrativeIds, onChange]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <EnvelopeControls
        title={pageTitle}
        headerTitle={headerTitle}
        showIndex={effectiveShowIndex}
        onShowIndexChange={handleShowIndexChange}
        plain={effectivePlain}
        onPlainChange={handlePlainChange}
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
          showIndex={effectiveShowIndex}
          sidebarWidth={sidebarWidth}
          onSidebarWidthChange={onSidebarWidthChange}
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
            const evidenceIds = resolveSectionEvidence(b.title ?? '', b.__narrativeId, b.__tableId, b.__diagramId);
            return (
              <div className="flex items-center gap-0.5 max-w-0 overflow-hidden group-hover/copy:max-w-fit focus-within:max-w-fit transition-[max-width]">
                {evidenceIds.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShowEvidence(evidenceIds, b.title || 'Section');
                    }}
                    className="p-1 rounded text-foreground-subtle hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
                    title="Evidence"
                    aria-label="Evidence"
                  >
                    <FileSearch className="h-3 w-3" />
                  </button>
                )}
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
                {onRequestCopySection && !isDeleted && canFocus && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const event = makeSectionCopyEvent(b);
                      if (event) onRequestCopySection(event);
                    }}
                    className="p-1 rounded text-foreground-subtle hover:text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
                    title="Copy section to page"
                    aria-label="Copy section to page"
                  >
                    <Plus className="h-3 w-3" />
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
              const newDiagrams = parsed.map((d: any) => ({ ...d, id: crypto.randomUUID(), evidence: d.evidence ?? [] }));
              if (newDiagrams.length === 0) return;
              const nextEnvelope = { ...envelope, diagrams: [...envelope.diagrams, ...newDiagrams] };
              onChange?.({
                envelope: nextEnvelope,
                dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
                deletedBlockIds: Array.from(deletedBlockIds),
                deletedStructuredKeys: Array.from(deletedStructuredKeys),
                deletedNarrativeIds: Array.from(deletedNarrativeIds),
              });
            } else if (ev.type === 'tables') {
              const parsed = JSON.parse(ev.payload);
              const newTables = parsed.map((t: any) => ({ ...t, id: crypto.randomUUID() }));
              if (newTables.length === 0) return;
              const nextEnvelope = { ...envelope, tables: [...envelope.tables, ...newTables] };
              onChange?.({
                envelope: nextEnvelope,
                dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
                deletedBlockIds: Array.from(deletedBlockIds),
                deletedStructuredKeys: Array.from(deletedStructuredKeys),
                deletedNarrativeIds: Array.from(deletedNarrativeIds),
              });
            }
          });
        }}
      />
      <TableFocusModal
        open={focusedTable != null}
        onOpenChange={(open) => { if (!open) setFocusedTable(null); }}
        table={
          (focusedTable?.block.__tableId
            ? envelope.tables.find((t) => t.id === focusedTable.block.__tableId)
            : envelope.tables.find((t) => t.name === focusedTable?.name)) ?? { name: focusedTable?.name ?? '', columns: [], rows: [] }
        }
        onApply={(ev) => {
          const parsed = JSON.parse(ev.payload);
          const updated = parsed[0];
          if (!updated) return;
          const block = focusedTable!.block;
          const oldName = focusedTable!.name;
          const newName = updated.name;
          const targetId = block.__tableId;
          const tableIndex = targetId
            ? envelope.tables.findIndex((t) => t.id === targetId)
            : envelope.tables.findIndex((t) => t.name === oldName);
          const nextTables = [...envelope.tables];
          if (tableIndex >= 0) {
            const existing = nextTables[tableIndex];
            nextTables[tableIndex] = {
              ...existing,
              ...updated,
              id: existing.id || crypto.randomUUID(),
              evidence: existing.evidence ?? updated.evidence ?? [],
            };
          } else {
            nextTables.push({ ...updated, id: crypto.randomUUID() });
          }
          const nextDeletedKeys = new Set(deletedStructuredKeys);
          if (targetId) {
            const idKey = `table:${targetId}`;
            if (nextDeletedKeys.has(idKey)) {
              const newId = nextTables[tableIndex >= 0 ? tableIndex : nextTables.length - 1].id!;
              if (newId !== targetId) {
                nextDeletedKeys.delete(idKey);
                nextDeletedKeys.add(`table:${newId}`);
              }
            }
          } else if (oldName !== newName && nextDeletedKeys.has(`table:${oldName}`)) {
            nextDeletedKeys.delete(`table:${oldName}`);
            nextDeletedKeys.add(`table:${newName}`);
          }
          const nextEnvelope = { ...envelope, tables: nextTables };
          onChange?.({
            envelope: nextEnvelope,
            dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
            deletedBlockIds: Array.from(deletedBlockIds),
            deletedStructuredKeys: Array.from(nextDeletedKeys),
            deletedNarrativeIds: Array.from(deletedNarrativeIds),
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
          const targetNarrative = focusedNarrativeIndex != null ? envelope.narratives[focusedNarrativeIndex] : undefined;
          const targetId = targetNarrative?.id;
          const nextNarratives: UnifiedNarrativeBlock[] =
            existing.length > 0
              ? existing.map((n) => (n.id && targetId && n.id === targetId
                ? { id: n.id, narrative_name: parsed.name, narrative: parsed.content, evidence: n.evidence ?? [] }
                : n))
              : [{ narrative_name: parsed.name, narrative: parsed.content, evidence: [] }];
          const nextEnvelope = { ...envelope, narratives: nextNarratives };
          onChange?.({
            envelope: nextEnvelope,
            dirty: JSON.stringify(nextEnvelope) !== JSON.stringify(effectiveBaseline),
            deletedBlockIds: Array.from(deletedBlockIds),
            deletedStructuredKeys: Array.from(deletedStructuredKeys),
            deletedNarrativeIds: Array.from(deletedNarrativeIds),
          });
        }}
      />
      <EvidenceModal
        open={evidenceModal != null}
        onOpenChange={(open) => { if (!open) setEvidenceModal(null); }}
        sectionTitle={evidenceModal?.label ?? ''}
        serverId={serverId}
        bankId={bankId}
        memoryIds={evidenceModal?.memoryIds ?? []}
      />
    </div>
  );
}
