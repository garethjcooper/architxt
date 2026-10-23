'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, FileText } from 'lucide-react';
import { cn, downloadMarkdown } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { Panel, PanelContent } from '@/app/workspace/_components/panel-layout';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { EvidenceModal } from '@/components/evidence-modal';
import {
  entityInfoApi,
  type EntityInfo,
  type MentalModelContent,
  type UnifiedEnvelope,
  type UnifiedNarrativeBlock,
  type GraphNode,
  type GraphEdge,
} from '@/lib/api/client';
import { buildEnvelopeMarkdown, graphToTableRows, rowsToMarkdownTable } from '@/lib/envelope-markdown';
import { buildNarrativeBlocks, type NarrativeBlock } from '@/components/narrative-blocks';
import { parseMentalModelContent } from '@/app/workspace/_components/model-content-utils';
import { resolveRepresentedEdges } from '@/lib/graph/view-edges';
import type { EdgeMergeMode } from '@/app/views/components/view-editor-options';
import type { View, ViewEdge, ViewNode } from '@/lib/types';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';

const logger = createLogger('DetailPanel');

const ENTITY_INFO_BATCH_SIZE = 100;

interface DetailPanelProps {
  serverId: number | null;
  bankId: string | null;
  activeView: View | null;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  edgeMergeMode?: EdgeMergeMode;
  onAddToPage?: (event: EnvelopeCopyEvent) => void;
}


function parseSyntheticHeading(title?: string): { kind: 'narrative' | 'table' | 'graph' | 'diagram'; name: string } | null {
  if (!title) return null;
  const trimmed = title.trim();
  const narrativeMatch = trimmed.match(/^Narrative:\s*(.+)$/i);
  if (narrativeMatch) return { kind: 'narrative', name: narrativeMatch[1].trim() };
  const graphMatch = trimmed.match(/^Graph(?::\s*(.+))?$/i);
  if (graphMatch) return { kind: 'graph', name: graphMatch[1]?.trim() || trimmed };
  const tableMatch = trimmed.match(/^Table:\s*(.+)$/i);
  if (tableMatch) return { kind: 'table', name: tableMatch[1].trim() };
  const diagramMatch = trimmed.match(/^Diagram:\s*(.+)$/i);
  if (diagramMatch) return { kind: 'diagram', name: diagramMatch[1].trim() };
  return null;
}

function buildBlocksFromEnvelope(envelope: UnifiedEnvelope): NarrativeBlock[] {
  const blocks: NarrativeBlock[] = [];
  let idCounter = 0;
  const nextId = () => `b${idCounter++}`;

  for (let i = 0; i < envelope.narratives.length; i++) {
    const n = envelope.narratives[i];
    const nBlocks = buildNarrativeBlocks(n, i);
    for (const b of nBlocks) {
      b.id = nextId();
    }
    blocks.push(...nBlocks);
  }

  for (const t of envelope.tables) {
    if (!t.rows || t.rows.length === 0) continue;
    const cols = t.columns?.length ? t.columns : Object.keys(t.rows[0]);
    const tableMd = rowsToMarkdownTable(cols, t.rows);
    blocks.push({
      id: nextId(),
      type: 'heading',
      raw: `## Table: ${t.name}\n\n`,
      level: 2,
      title: `Table: ${t.name}`,
      synthetic: true,
      __tableId: t.id,
    });
    blocks.push({
      id: nextId(),
      type: 'table',
      raw: tableMd + '\n\n',
      title: t.name,
    });
  }

  for (const d of envelope.diagrams) {
    const content = typeof d.content === 'string' ? d.content : JSON.stringify(d.content ?? null, null, 2);
    const title = `Diagram: ${d.name || d.type || 'Untitled'}`;
    blocks.push({
      id: nextId(),
      type: 'heading',
      raw: `## ${title}\n\n`,
      level: 2,
      title,
      synthetic: true,
      __diagramId: d.id,
    });
    blocks.push({
      id: nextId(),
      type: 'code',
      raw: `\`\`\`mermaid\n${content}\n\`\`\`\n\n`,
      title: 'mermaid',
      language: 'mermaid',
    });
  }

  if (envelope.graph?.nodes?.length || envelope.graph?.edges?.length) {
    const rawGraphJson = JSON.stringify(envelope.graph, null, 2);
    const headingText = envelope.graph.name?.trim() ? `Graph: ${envelope.graph.name.trim()}` : 'Graph';
    blocks.push({
      id: nextId(),
      type: 'heading',
      raw: `## ${headingText}\n\n`,
      level: 2,
      title: headingText,
      synthetic: true,
    });
    blocks.push({
      id: nextId(),
      type: 'code',
      raw: `\`\`\`json\n${rawGraphJson}\n\`\`\`\n\n`,
      title: 'json',
      language: 'json',
    });
  }

  return blocks;
}

function emptyEnvelope(): UnifiedEnvelope {
  return { narratives: [], graph: { name: '', nodes: [], edges: [] }, tables: [], diagrams: [] };
}

function mergeEnvelopes(envelopes: UnifiedEnvelope[]): UnifiedEnvelope {
  const merged = emptyEnvelope();
  const narrativeIds = new Set<string>();
  const tableIds = new Set<string>();
  const diagramIds = new Set<string>();
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const env of envelopes) {
    if (!env) continue;
    for (const n of env.narratives || []) {
      const id = n.id || `${n.narrative_name || 'narrative'}-${Math.random().toString(36).slice(2, 9)}`;
      if (narrativeIds.has(id)) continue;
      narrativeIds.add(id);
      merged.narratives.push({ ...n, id });
    }
    for (const t of env.tables || []) {
      const id = t.id || t.name;
      if (id && tableIds.has(id)) continue;
      if (id) tableIds.add(id);
      merged.tables.push(t);
    }
    for (const d of env.diagrams || []) {
      const id = d.id || `${d.name}-${d.type}`;
      if (id && diagramIds.has(id)) continue;
      if (id) diagramIds.add(id);
      merged.diagrams.push(d);
    }
    const graph = env.graph;
    if (graph) {
      if (graph.name) {
        merged.graph.name = merged.graph.name || graph.name;
      }
      for (const node of graph.nodes || []) {
        if (node.id && nodeIds.has(node.id)) continue;
        if (node.id) nodeIds.add(node.id);
        merged.graph.nodes.push(node);
      }
      for (const edge of graph.edges || []) {
        const eid = edge.id || `${edge.from || ''}|${edge.to || ''}|${edge.type || ''}|${edge.label || ''}`;
        if (edgeIds.has(eid)) continue;
        edgeIds.add(eid);
        merged.graph.edges.push(edge);
      }
    }
  }

  return merged;
}

function contentToEnvelope(content: MentalModelContent | undefined): UnifiedEnvelope {
  if (!content) return emptyEnvelope();
  const parsed = parseMentalModelContent({
    found: content.found ?? true,
    content: content.content ?? null,
    envelope: content.envelope ?? undefined,
  });

  const graph = parsed.graph || { name: '', nodes: [], edges: [] };

  return {
    narratives: (parsed.narratives || []).map((n) => ({
      id: n.id || '',
      narrative_name: n.narrative_name || '',
      narrative: n.narrative || '',
      evidence: Array.isArray(n.evidence) ? n.evidence : [],
    })),
    tables: (parsed.tables || []).map((t: Record<string, unknown>) => ({
      id: typeof t.id === 'string' ? t.id : '',
      name: String(t.name ?? ''),
      columns: Array.isArray(t.columns) ? (t.columns as string[]) : [],
      rows: Array.isArray(t.rows) ? (t.rows as Record<string, any>[]) : [],
      evidence: Array.isArray(t.evidence) ? (t.evidence as string[]) : [],
    } as UnifiedEnvelope['tables'][number])),
    diagrams: (parsed.diagrams || []).map((d: Record<string, unknown>) => ({
      id: typeof d.id === 'string' ? d.id : '',
      name: String(d.name ?? ''),
      type: String(d.type ?? ''),
      content: typeof d.content === 'string' ? d.content : JSON.stringify(d.content ?? null, null, 2),
      evidence: Array.isArray(d.evidence) ? (d.evidence as string[]) : [],
    } as UnifiedEnvelope['diagrams'][number])),
    graph: {
      name: graph.name || '',
      nodes: (graph.nodes || []) as UnifiedEnvelope['graph']['nodes'],
      edges: (graph.edges || []) as UnifiedEnvelope['graph']['edges'],
    },
  };
}

function collectNodeEnvelopes(
  info: EntityInfo | undefined,
  contentMap: Record<string, { found: boolean; error?: string; mental_model?: MentalModelContent }>,
): UnifiedEnvelope[] {
  if (!info) return [];
  const result: UnifiedEnvelope[] = [];

  const addByExtId = (extId: string | undefined) => {
    if (!extId) return;
    const entry = contentMap[extId];
    if (entry?.found && entry.mental_model) {
      result.push(contentToEnvelope(entry.mental_model));
    }
  };

  for (const ref of info.contextual_refs || []) addByExtId(ref.ext_id);
  for (const model of info.derived_models || []) addByExtId(model.ext_id);
  for (const model of info.plain_models || []) addByExtId(model.ext_id);

  return result;
}

function buildNodeDetailEnvelope(
  infoMap: Record<string, EntityInfo>,
  selectedNodeIds: string[],
  contentMap: Record<string, { found: boolean; error?: string; mental_model?: MentalModelContent }>,
): UnifiedEnvelope {
  const envelopes: UnifiedEnvelope[] = [];
  for (const id of selectedNodeIds) {
    const info = infoMap[id];
    if (info) envelopes.push(...collectNodeEnvelopes(info, contentMap));
  }
  return mergeEnvelopes(envelopes);
}

function buildEdgePropertiesEnvelope(
  selectedEdges: ViewEdge[],
  nodeByViewId: Map<string, ViewNode>,
): UnifiedEnvelope {
  if (!selectedEdges.length) return emptyEnvelope();

  const rows: Record<string, unknown>[] = [];
  const evidence = new Set<string>();

  for (const edge of selectedEdges) {
    const sourceNode = nodeByViewId.get(edge.source);
    const targetNode = nodeByViewId.get(edge.target);
    const from = edge.source_ref_id || sourceNode?.ref_id || edge.source;
    const to = edge.target_ref_id || targetNode?.ref_id || edge.target;
    const props = edge.properties || {};
    const label = String(props.label || edge.label || '');
    const detail = String(props.detail || '');
    const frequency = String(props.frequency || '');
    const edgeEvidence = Array.isArray(props.evidence) ? props.evidence : [];
    for (const id of edgeEvidence) evidence.add(String(id));

    rows.push({
      from,
      from_name: sourceNode?.name || sourceNode?.label || from,
      to,
      to_name: targetNode?.name || targetNode?.label || to,
      type: edge.edge_type || edge.type || '',
      label,
      detail,
      frequency,
      evidence: edgeEvidence,
      properties: props,
    });
  }

  return {
    narratives: [],
    tables: rows.length
      ? [{
          name: `Edges (${rows.length})`,
          columns: ['from_name', 'to_name', 'from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence', 'properties'],
          rows,
          evidence: Array.from(evidence),
        }]
      : [],
    diagrams: [],
    graph: { name: '', nodes: [], edges: [] },
  };
}

function buildGraphTableEnvelope(graph: UnifiedEnvelope['graph'], edgeColumnFilter?: string[]): UnifiedEnvelope {
  if (!graph?.edges?.length) return emptyEnvelope();
  const { edgeColumns, edgeRows } = graphToTableRows(graph, edgeColumnFilter);
  return {
    narratives: [],
    tables: [{ name: `Graph edges (${edgeRows.length})`, columns: edgeColumns, rows: edgeRows, evidence: [] }],
    diagrams: [],
    graph: { name: '', nodes: [], edges: [] },
  };
}

function viewEdgeToGraphEdge(edge: ViewEdge, nodeByViewId: Map<string, ViewNode>): { edge: GraphEdge; sourceNode?: ViewNode; targetNode?: ViewNode } | null {
  const sourceNode = nodeByViewId.get(edge.source);
  const targetNode = nodeByViewId.get(edge.target);
  const sourceRef = edge.source_ref_id || sourceNode?.ref_id;
  const targetRef = edge.target_ref_id || targetNode?.ref_id;
  if (!sourceRef || !targetRef) return null;
  return {
    edge: {
      id: edge.id,
      from: sourceRef,
      to: targetRef,
      type: edge.edge_type || edge.type || '',
      label: edge.label || '',
      detail: edge.properties?.detail || '',
      properties: edge.properties,
      evidence: Array.isArray(edge.properties?.evidence) ? edge.properties.evidence : [],
    },
    sourceNode,
    targetNode,
  };
}

function buildEdgeFallbackEnvelope(
  selectedEdges: ViewEdge[],
  nodeByViewId: Map<string, ViewNode>,
): UnifiedEnvelope {
  const graphNodes: GraphNode[] = [];
  const graphEdges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  for (const edge of selectedEdges) {
    const converted = viewEdgeToGraphEdge(edge, nodeByViewId);
    if (!converted) continue;
    graphEdges.push(converted.edge);

    const addNode = (ref: string, viewNode?: ViewNode) => {
      if (nodeIds.has(ref)) return;
      nodeIds.add(ref);
      graphNodes.push({
        id: ref,
        name: viewNode?.name || viewNode?.label || ref,
        label: viewNode?.label || '',
        type: viewNode?.entity_type || '',
      });
    };

    addNode(converted.edge.from, converted.sourceNode);
    addNode(converted.edge.to, converted.targetNode);
  }

  if (!graphEdges.length) return emptyEnvelope();

  const graph = { name: '', nodes: graphNodes, edges: graphEdges };
  const { edgeColumns, edgeRows } = graphToTableRows(graph);
  return {
    narratives: [],
    tables: [{ name: `Edges (${edgeRows.length})`, columns: edgeColumns, rows: edgeRows, evidence: [] }],
    diagrams: [],
    graph: { name: '', nodes: [], edges: [] },
  };
}

export function DetailPanel({
  serverId,
  bankId,
  activeView,
  selectedNodeIds,
  selectedEdgeIds,
  edgeMergeMode = 'full',
  onAddToPage,
}: DetailPanelProps) {
  const [contentMap, setContentMap] = useState<
    Record<string, { found: boolean; error?: string; mental_model?: MentalModelContent }>
  >({});
  const [infoMap, setInfoMap] = useState<Record<string, EntityInfo>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIndex, setShowIndex] = useState(false);
  const [plain, setPlain] = useState(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!panelRef.current) return;
    const el = panelRef.current;
    const update = () => setPanelWidth(el.clientWidth);
    update();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    observer?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  const edgeColumnFilter = useMemo(() => {
    const base = ['from_name', 'to_name', 'type', 'label', 'detail'];
    if (panelWidth < 900) return base;
    if (panelWidth < 1200) return [...base, 'from', 'to', 'properties'];
    return [...base, 'from', 'to', 'properties', 'evidence'];
  }, [panelWidth]);

  const stickyRef = useRef<{
    envelope: UnifiedEnvelope;
    summary: string;
  } | null>(null);
  const lastViewIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (lastViewIdRef.current !== activeView?.id) {
      stickyRef.current = null;
      lastViewIdRef.current = activeView?.id;
    }
  }, [activeView?.id]);

  const nodeByViewId = useMemo(() => {
    if (!activeView) return new Map<string, ViewNode>();
    return new Map(activeView.graph.nodes.map((n) => [n.id, n]));
  }, [activeView]);

  const selectedNodes = useMemo(() => {
    if (!activeView) return [];
    return selectedNodeIds.map((id) => nodeByViewId.get(id)).filter(Boolean) as ViewNode[];
  }, [activeView, selectedNodeIds, nodeByViewId]);

  const selectedEdges = useMemo(() => {
    if (!activeView) return [];
    return resolveRepresentedEdges(activeView.graph.edges, selectedEdgeIds, edgeMergeMode);
  }, [activeView, selectedEdgeIds, edgeMergeMode]);

  const entityIdsToFetch = useMemo(() => {
    const ids = new Set<string>();
    for (const node of selectedNodes) {
      if (node.ref_id) ids.add(node.ref_id);
    }
    for (const edge of selectedEdges) {
      const sourceRef = edge.source_ref_id || nodeByViewId.get(edge.source)?.ref_id;
      const targetRef = edge.target_ref_id || nodeByViewId.get(edge.target)?.ref_id;
      if (sourceRef) ids.add(sourceRef);
      if (targetRef) ids.add(targetRef);
    }
    return Array.from(ids).filter(Boolean);
  }, [selectedNodes, selectedEdges, nodeByViewId]);

  const loadInfo = useCallback(async () => {
    if (!serverId || !bankId || entityIdsToFetch.length === 0) {
      setInfoMap({});
      setContentMap({});
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const mergedEntities: Record<string, EntityInfo> = {};
      const mergedContent: Record<string, { found: boolean; error?: string; mental_model?: MentalModelContent }> = {};

      for (let i = 0; i < entityIdsToFetch.length; i += ENTITY_INFO_BATCH_SIZE) {
        if (controller.signal.aborted) return;
        const batch = entityIdsToFetch.slice(i, i + ENTITY_INFO_BATCH_SIZE);
        const edgeIdsForBatch = selectedEdges.length > 0
          ? selectedEdges
              .filter((e) => {
                const sourceRef = e.source_ref_id || nodeByViewId.get(e.source)?.ref_id;
                const targetRef = e.target_ref_id || nodeByViewId.get(e.target)?.ref_id;
                return sourceRef && targetRef && (batch.includes(sourceRef) || batch.includes(targetRef));
              })
              .map((e) => e.id)
              .filter(Boolean) as string[]
          : undefined;
        if (controller.signal.aborted) return;
        const result = await entityInfoApi.info(serverId, bankId, batch, true, edgeIdsForBatch);
        if (controller.signal.aborted) return;
        Object.assign(mergedEntities, result.entities || {});
        Object.assign(mergedContent, result.content || {});
      }

      if (controller.signal.aborted) return;
      setInfoMap(mergedEntities);
      setContentMap(mergedContent);
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to load entity info for detail panel', { error: err, serverId, bankId, entityIds: entityIdsToFetch });
      setError(`Failed to load details: ${message}`);
      toast.error(`Failed to load details: ${message}`);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [serverId, bankId, entityIdsToFetch]);

  useEffect(() => {
    const run = async () => {
      try {
        await loadInfo();
      } catch {
        // errors are handled inside loadInfo
      }
    };
    run();
  }, [loadInfo]);

  const baseEnvelope = useMemo<UnifiedEnvelope>(() => {
    const hasSelection = selectedNodeIds.length > 0 || selectedEdgeIds.length > 0;
    if (!hasSelection) {
      return stickyRef.current?.envelope ?? emptyEnvelope();
    }

    let result: UnifiedEnvelope;
    if (selectedNodes.length > 0) {
      const nodeIds = selectedNodes.map((n) => n.ref_id).filter(Boolean) as string[];
      result = buildNodeDetailEnvelope(infoMap, nodeIds, contentMap);
    } else {
      // For edge selections, render the stored contextual-graph edge properties
      // directly. Each ViewEdge carries the full cge_properties of the underlying
      // contextual-graph edge, so there is no need to reverse-match mental-model
      // table rows by endpoint/label signatures.
      result = buildEdgePropertiesEnvelope(selectedEdges, nodeByViewId);
    }

    // If no mental-model content came back for a selection, fall back to a
    // readable table built from the selected view edges themselves. This covers
    // grounded/hindsight-only edges and merged bundles that have no contextual
    // mental-model attached yet.
    const hasModelContent =
      result.narratives.length > 0 ||
      result.tables.length > 0 ||
      result.diagrams.length > 0 ||
      (result.graph?.edges?.length ?? 0) > 0 ||
      (result.graph?.nodes?.length ?? 0) > 0;

    if (selectedEdges.length > 0 && !hasModelContent) {
      result = buildEdgeFallbackEnvelope(selectedEdges, nodeByViewId);
    }

    const parts: string[] = [];
    if (selectedNodeIds.length > 0) {
      parts.push(`${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'}`);
    }
    if (selectedEdgeIds.length > 0) {
      parts.push(`${selectedEdgeIds.length} edge${selectedEdgeIds.length === 1 ? '' : 's'}`);
    }
    const summary = parts.join(', ');

    if (result.narratives.length > 0 || result.tables.length > 0 || result.diagrams.length > 0 || (result.graph?.edges?.length ?? 0) > 0) {
      // Only remember a non-empty detail; a selection with no content won't wipe
      // the previous detail.
      stickyRef.current = {
        envelope: result,
        summary,
      };
    }

    return result;
  }, [selectedNodes, selectedEdges, selectedNodeIds, selectedEdgeIds, infoMap, contentMap, nodeByViewId]);

  // Re-generate the graph-derived edge table whenever the panel width changes,
  // even when the cached selection hasn't changed.
  const envelope = useMemo<UnifiedEnvelope>(() => {
    const base = baseEnvelope;
    const hasModelTables = base.tables && base.tables.length > 0;
    if (!hasModelTables && base.graph?.edges?.length) {
      return mergeEnvelopes([buildGraphTableEnvelope(base.graph, edgeColumnFilter), base]);
    }
    return base;
  }, [baseEnvelope, edgeColumnFilter]);

  const markdown = useMemo(() => buildEnvelopeMarkdown(envelope), [envelope]);
  const hasContent = markdown.trim().length > 0;

  const displaySummary = stickyRef.current?.summary ?? '';

  const handleCopyText = useCallback(() => {
    if (!markdown) return;
    navigator.clipboard.writeText(markdown).then(() => toast.success('Copied to clipboard'));
  }, [markdown]);

  const handleSaveMd = useCallback(() => {
    if (!markdown) return;
    downloadMarkdown(markdown, displaySummary ? `detail-${displaySummary}` : 'detail');
  }, [markdown, displaySummary]);

  const headerTitle = displaySummary ? `Detail — ${displaySummary}` : 'Detail';

  const [evidenceModal, setEvidenceModal] = useState<{ open: boolean; label: string; memoryIds: string[] } | null>(null);

  const handleShowEvidence = useCallback((memoryIds: string[], label: string) => {
    setEvidenceModal({ open: true, label, memoryIds });
  }, [setEvidenceModal]);

  const blocks = useMemo(() => buildBlocksFromEnvelope(envelope), [envelope]);

  const resolveSectionEvidence = useCallback((heading: string, narrativeId?: string, tableId?: string, diagramId?: string): string[] => {
    if (narrativeId) {
      const n = envelope.narratives.find((nn) => nn.id === narrativeId);
      return n?.evidence ?? [];
    }
    if (tableId) {
      const t = envelope.tables.find((tt) => tt.id === tableId);
      return t?.evidence ?? [];
    }
    if (diagramId) {
      const d = envelope.diagrams.find((dd) => dd.id === diagramId);
      return d?.evidence ?? [];
    }
    const parsed = parseSyntheticHeading(heading);
    if (parsed?.kind === 'narrative') {
      const n = envelope.narratives.find((nn) => nn.narrative_name === parsed.name || nn.id === parsed.name);
      return n?.evidence ?? [];
    }
    if (parsed?.kind === 'table') {
      const t = envelope.tables.find((tt) => tt.name === parsed.name);
      return t?.evidence ?? [];
    }
    if (parsed?.kind === 'diagram') {
      const d = envelope.diagrams.find((dd) => dd.name === parsed.name);
      return d?.evidence ?? [];
    }
    if (parsed?.kind === 'graph') {
      return Array.from(new Set((envelope.graph?.edges ?? []).flatMap((e) => e.evidence ?? [])));
    }
    return [];
  }, [envelope]);

  const resolveSectionCopy = useCallback((heading: string, _level: number, _contentMarkdown: string, tableId?: string, diagramId?: string): EnvelopeCopyEvent | null => {
    const parsed = parseSyntheticHeading(heading);
    if (parsed?.kind === 'table') {
      const table = tableId ? envelope.tables.find((t) => t.id === tableId) : envelope.tables.find((t) => t.name === parsed.name);
      if (!table) return null;
      return {
        type: 'tables',
        payload: JSON.stringify([table]),
        label: table.name || heading,
        evidence: table.evidence ?? [],
        id: table.id,
      };
    }
    if (parsed?.kind === 'diagram') {
      const diagram = diagramId ? envelope.diagrams.find((d) => d.id === diagramId) : envelope.diagrams.find((d) => d.name === parsed.name);
      if (!diagram) return null;
      return {
        type: 'diagrams',
        payload: JSON.stringify([diagram]),
        label: diagram.name || heading,
        evidence: diagram.evidence ?? [],
        id: diagram.id,
      };
    }
    if (parsed?.kind === 'graph') {
      return {
        type: 'graph',
        payload: JSON.stringify(envelope.graph),
        label: envelope.graph?.name || heading,
        evidence: Array.from(new Set((envelope.graph?.edges ?? []).flatMap((e) => e.evidence ?? []))),
      };
    }
    return null;
  }, [envelope]);

  const handleAddToPage = useCallback(
    (event: EnvelopeCopyEvent) => {
      onAddToPage?.(event);
    },
    [onAddToPage]
  );

  return (
    <Panel ref={panelRef} className="min-h-0 h-full flex flex-col">
      <EnvelopeControls
        title="Detail"
        headerTitle={headerTitle}
        showIndex={showIndex}
        onShowIndexChange={setShowIndex}
        plain={plain}
        onPlainChange={setPlain}
        onCopyText={handleCopyText}
        onSaveMd={handleSaveMd}
      />
      <PanelContent className="p-2 flex-1 min-h-0 overflow-hidden">
        {loading && !hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-foreground-subtle gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-xs">Loading details…</span>
          </div>
        ) : error && !hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-foreground-subtle gap-2 p-3 text-center">
            <span className="text-xs text-red-500">{error}</span>
          </div>
        ) : !hasContent ? (
          <div className="flex flex-col items-center justify-center h-full text-foreground-faint text-sm px-6 text-center gap-2">
            <FileText className="h-8 w-8 opacity-50" />
            <p>No detail content available for the current selection.</p>
          </div>
        ) : (
          <NarrativeViewer
            blocks={blocks}
            title="Sections"
            showIndex={showIndex}
            viewMode={plain ? 'plain' : 'markdown'}
            className="h-full"
            resolveSectionEvidence={resolveSectionEvidence}
            onShowEvidence={handleShowEvidence}
            resolveSectionCopy={resolveSectionCopy}
            onAddToPage={handleAddToPage}
          />
        )}
      </PanelContent>
      {evidenceModal?.open && (
        <EvidenceModal
          open={evidenceModal.open}
          onOpenChange={(open) => {
            if (!open) setEvidenceModal(null);
          }}
          sectionTitle={evidenceModal.label}
          serverId={serverId}
          bankId={bankId}
          memoryIds={evidenceModal.memoryIds}
        />
      )}
    </Panel>
  );
}