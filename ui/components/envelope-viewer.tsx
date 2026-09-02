'use client';

import { useCallback, useMemo, useState } from 'react';
import { NarrativeViewer } from './narrative-viewer';
import { buildEnvelopeMarkdown, formatPropertiesCompact, normalizeEnvelopeFromNullable, parseMarkdownTable } from '@/lib/envelope-markdown';
import { EnvelopeControls } from './envelope-controls';
import { toast } from 'sonner';
import { downloadMarkdown } from '@/lib/utils';
import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge, UnifiedEnvelope } from '@/lib/api/client';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import { NarrativeFocusModal } from './narrative-focus-modal';
import { TableFocusModal } from './table-focus-modal';
import { GraphViewModal } from './graph-view-modal';
import { DiagramViewModal } from './diagram-view-modal';
import type { NarrativeBlock } from './narrative-blocks';

export type { EnvelopeCopyEvent };

export interface EnvelopeViewerProps {
  /** Envelope to render. */
  envelope: ResearchStepSummary | DiscoverStepResponse | null;
  /** Human-readable title used for the section index and downloads. */
  title?: string;
  /** Optional override for the header bar title. Defaults to title. */
  headerTitle?: string;
  /** Optional count badge shown in the header. */
  count?: number;
  /** Called when a copy action is requested. When omitted, the viewer copies/downloads directly. */
  onCopy?: (event: EnvelopeCopyEvent) => void;
  /** Optional callback to add structured or narrative content to a curated page. May receive a single event or an array of events for whole-document decomposition. */
  onAddToPage?: (event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => void;
  /** Optional label for the add-to-page action. */
  addToPageLabel?: string;
  /** Optional key namespace passed through to NarrativeViewer. */
  keyPrefix?: string;
  /** Optional extra className for the outer container. */
  className?: string;
  /** Optional tabs or navigation rendered between the header and the content. */
  tabs?: React.ReactNode;
  /** Whether the left-hand section index sidebar is shown. */
  showIndex?: boolean;
  /** Whether the floating data-controls panel is available. */
  showControls?: boolean;
  /** Initial rendering mode for the narrative. */
  defaultViewMode?: 'plain' | 'markdown';
  /** Name used for downloaded file names. */
  sessionName?: string;
}

export function EnvelopeViewer({
  envelope,
  title = 'Preview',
  count,
  onCopy,
  keyPrefix,
  className = '',
  showIndex = false,
  showControls = false,
  defaultViewMode = 'markdown',
  sessionName,
  onAddToPage,
  addToPageLabel,
  tabs,
  headerTitle,
}: EnvelopeViewerProps) {
  const markdown = useMemo(() => buildEnvelopeMarkdown(envelope ?? null), [envelope]);
  const [showIndexState, setShowIndexState] = useState(showIndex);
  const [plain, setPlain] = useState(defaultViewMode === 'plain');

  const viewMode = plain ? 'plain' : 'markdown';
  const effectiveSessionName = sessionName ?? title;

  const titleLabel = useMemo(() => {
    if (!envelope) return title;
    if ('intent_text' in envelope && typeof (envelope as any).intent_text === 'string') return (envelope as any).intent_text;
    return title;
  }, [envelope, title]);

  const normalized = useMemo(() => normalizeEnvelopeFromNullable(envelope), [envelope]);

  const [focus, setFocus] = useState<
    | { kind: 'narrative'; name: string; content: string }
    | { kind: 'table'; table: UnifiedEnvelope['tables'][number] }
    | { kind: 'diagram'; name: string; content: string }
    | { kind: 'graph'; graph: { name?: string | null; nodes: GraphNode[]; edges: GraphEdge[] }; title?: string }
    | null
  >(null);

  const parseSyntheticHeading = useCallback((heading?: string): { kind: 'graph' | 'table' | 'diagram'; name?: string } | null => {
    if (!heading) return null;
    const trimmed = heading.trim();
    const graphMatch = trimmed.match(/^Graph(?::\s*(.+))?$/i);
    if (graphMatch) return { kind: 'graph', name: graphMatch[1]?.trim() };
    const tableMatch = trimmed.match(/^Table:\s*(.+)$/i);
    if (tableMatch) return { kind: 'table', name: tableMatch[1].trim() };
    const diagramMatch = trimmed.match(/^Diagram:\s*(.+)$/i);
    if (diagramMatch) return { kind: 'diagram', name: diagramMatch[1].trim() };
    return null;
  }, []);

  const handleFocusSection = useCallback((block: NarrativeBlock, _markdown: string, resolvedEvent: EnvelopeCopyEvent | null) => {
    const parsed = parseSyntheticHeading(block.title);
    if (parsed?.kind === 'graph' || resolvedEvent?.type === 'graph') {
      setFocus({ kind: 'graph', graph: normalized.graph, title: parsed?.name ?? normalized.graph.name ?? titleLabel });
      return;
    }
    if (parsed?.kind === 'table' || resolvedEvent?.type === 'tables') {
      const tableName = parsed?.name;
      const table = tableName ? normalized.tables.find((t) => t.name === tableName) : normalized.tables[0];
      if (table) {
        setFocus({ kind: 'table', table });
      }
      return;
    }
    if (parsed?.kind === 'diagram' || resolvedEvent?.type === 'diagrams') {
      const diagramName = parsed?.name;
      const diagram = diagramName ? normalized.diagrams.find((d) => d.name === diagramName) : normalized.diagrams[0];
      if (diagram && typeof diagram.content === 'string') {
        setFocus({ kind: 'diagram', name: diagram.name || diagramName || 'Diagram', content: diagram.content });
      }
      return;
    }
    setFocus({ kind: 'narrative', name: block.title || 'Narrative', content: resolvedEvent?.payload || _markdown });
  }, [normalized, parseSyntheticHeading, titleLabel]);

  const structuredItems = useMemo(() => {
    if (!normalized) return undefined;
    const items: NonNullable<React.ComponentPropsWithoutRef<typeof EnvelopeControls>['structuredItems']> = {};
    const graph = normalized.graph;
    if (graph && ((graph.nodes?.length ?? 0) > 0 || (graph.edges?.length ?? 0) > 0)) {
      items.graph = {
        payload: JSON.stringify(graph, null, 2),
        label: titleLabel,
      };
    }
    const tables = normalized.tables;
    if (tables && tables.length > 0) {
      items.tables = {
        payload: JSON.stringify(tables, null, 2),
        label: titleLabel,
      };
    }
    const diagrams = normalized.diagrams;
    if (diagrams && diagrams.length > 0) {
      items.diagrams = {
        payload: JSON.stringify(diagrams, null, 2),
        label: titleLabel,
      };
    }
    return Object.keys(items).length > 0 ? items : undefined;
  }, [normalized, titleLabel]);

  const handleCopyStructured = useCallback(
    (type: 'graph' | 'tables' | 'diagrams', payload: string, label?: string) => {
      onCopy?.({ type, payload, label });
    },
    [onCopy]
  );

  const handleAddStructured = useCallback(
    (type: 'graph' | 'tables' | 'diagrams', payload: string, label?: string) => {
      onAddToPage?.({ type, payload, label });
    },
    [onAddToPage]
  );

  const handleCopy = () => {
    if (!markdown) return;
    if (onCopy) {
      onCopy({ type: 'narrative', payload: markdown, label: effectiveSessionName });
      return;
    }
    navigator.clipboard.writeText(markdown).then(() => toast.success('Copied to clipboard'));
  };

  const handleSave = () => {
    if (!markdown) return;
    if (onCopy) {
      onCopy({ type: 'narrative', payload: markdown, label: effectiveSessionName });
      return;
    }
    downloadMarkdown(markdown, effectiveSessionName);
  };

  const handleCopySection = onCopy
    ? (event: EnvelopeCopyEvent) => onCopy(event)
    : undefined;

  const handleAddSection = onAddToPage
    ? (event: EnvelopeCopyEvent) => onAddToPage(event)
    : undefined;

  const resolveSectionCopy = useCallback(
    (heading: string, _level: number, contentMarkdown: string): EnvelopeCopyEvent | null => {
      const trimmed = heading.trim();

      // Graph is rendered as a synthetic section; use the canonical envelope.graph.
      const graphHeadingMatch = trimmed.match(/^Graph(?::\s*(.+))?$/i);
      if (graphHeadingMatch) {
        const graph = normalized?.graph;
        if (graph && ((graph.nodes?.length ?? 0) > 0 || (graph.edges?.length ?? 0) > 0)) {
          return {
            type: 'graph',
            payload: JSON.stringify(graph, null, 2),
            label: graphHeadingMatch[1]?.trim() || titleLabel,
          };
        }
      }

      // Tables are rendered as "Table: <name>" headings; map back to envelope.tables by name.
      const tableHeadingMatch = trimmed.match(/^Table:\s*(.+)$/i);
      if (tableHeadingMatch) {
        const tableName = tableHeadingMatch[1].trim();
        const table = normalized?.tables?.find((t) => t.name === tableName);
        if (table) {
          return { type: 'tables', payload: JSON.stringify([table], null, 2), label: table.name };
        }
      }

      // Markdown tables inside narrative that do not correspond to an envelope
      // table are promoted to JSON table data when copied.
      const parsed = parseMarkdownTable(contentMarkdown);
      if (parsed) {
        return {
          type: 'tables',
          payload: JSON.stringify([{ name: trimmed || 'Table', columns: parsed.columns, rows: parsed.rows }], null, 2),
          label: trimmed || 'Table',
        };
      }

      // Diagrams are rendered as "Diagram: <name>" headings; map back to envelope.diagrams by name.
      const diagramHeadingMatch = trimmed.match(/^Diagram:\s*(.+)$/i);
      if (diagramHeadingMatch) {
        const diagramName = diagramHeadingMatch[1].trim();
        const diagram = normalized?.diagrams?.find((d) => d.name === diagramName);
        if (diagram) {
          return { type: 'diagrams', payload: JSON.stringify([diagram], null, 2), label: diagram.name };
        }
      }

      return null;
    },
    [normalized]
  );

  const handleCopyWholeDocument = useCallback(
    (events: EnvelopeCopyEvent[]) => {
      if (onCopy) {
        events.forEach((event) => onCopy(event));
        return;
      }
      if (onAddToPage) {
        onAddToPage(events);
        return;
      }
    },
    [onCopy, onAddToPage]
  );

  return (
    <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${className}`}>
      {showControls && (
        <EnvelopeControls
          title={title}
          headerTitle={headerTitle}
          count={count}
          showIndex={showIndexState}
          onShowIndexChange={setShowIndexState}
          plain={plain}
          onPlainChange={setPlain}
          onCopyText={handleCopy}
          onSaveMd={handleSave}
        />
      )}
      {tabs}
      <div className="flex-1 min-h-0 overflow-hidden p-2 relative">
        <NarrativeViewer
          content={markdown}
          title="Sections"
          viewMode={viewMode}
          showIndex={showIndexState}
          onCopySection={handleCopySection}
          onAddToPage={handleAddSection}
          resolveSectionCopy={resolveSectionCopy}
          onCopyWholeDocument={handleCopyWholeDocument}
          addToPageLabel={addToPageLabel}
          keyPrefix={keyPrefix}
          className="h-full"
          onFocusSection={handleFocusSection}
        />
      </div>
      {focus?.kind === 'narrative' && (
        <NarrativeFocusModal
          open
          onOpenChange={() => setFocus(null)}
          name={focus.name}
          content={focus.content}
          readOnly
        />
      )}
      {focus?.kind === 'table' && (
        <TableFocusModal
          open
          onOpenChange={() => setFocus(null)}
          table={focus.table}
          readOnly
        />
      )}
      {focus?.kind === 'diagram' && (
        <DiagramViewModal
          open
          onOpenChange={() => setFocus(null)}
          name={focus.name}
          content={focus.content}
        />
      )}
      {focus?.kind === 'graph' && (
        <GraphViewModal
          open
          onOpenChange={() => setFocus(null)}
          graph={focus.graph}
          title={focus.title}
          readOnly
        />
      )}
    </div>
  );
}
