'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ResizeHandle } from '@/app/workspace/_components/panel-layout';
import { Loader2 } from 'lucide-react';
import { researchApi, viewsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import type { ViewNode, ViewEdge, ViewGraph } from '@/lib/types';
import { mermaidToGraph, mergeMermaidGraphs, type MermaidGraph, type MermaidNode, type MermaidEdge } from '@/lib/graph/mermaid-to-graph';
import { familyClass } from '@/lib/status-badge';
import { jaroWinkler } from '@/lib/string-similarity';
import { Input } from '@/components/ui/input';

interface AddToViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EnvelopeCopyEvent | null;
  serverId?: number;
  bankId?: string;
}

type GraphNode = {
  id: string;
  name?: string;
};

type ResolvedEntity = {
  id: number;
  db_id: number;
  entity_id: string;
  canonical_id?: string;
  name: string;
  type_name: string;
  canonical_reference?: string;
  matched_text: string;
  from_tag: boolean;
};

type ResolvedEdge = {
  input_index: number;
  id: string | null;
  from: string;
  to: string;
  type: string | null;
  label: string | null;
  detail: string | null;
  match_class: 'id' | 'full' | 'label' | 'partial' | 'evidence' | 'manual' | null;
  stage: 'id' | 'full' | 'label' | 'partial' | 'evidence' | 'no_endpoints' | 'no_type' | 'ambiguous_type' | 'no_label_match' | 'ambiguous_label' | 'ambiguous_evidence' | 'manual';
  reversed?: boolean;
  candidates: Array<{
    id: string;
    from: string;
    to: string;
    type: string | null;
    label: string | null;
    detail: string | null;
  }>;
};

function getSectionText(event: EnvelopeCopyEvent | null): string {
  if (!event) return '';
  return event.payload || '';
}

function parseGraphPayload(payload: string): { nodes: GraphNode[]; edges: unknown[] } | null {
  if (!payload.trim()) return null;
  try {
    const parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.edges)) {
      const nodes = Array.isArray(parsed.nodes)
        ? parsed.nodes
            .filter((n: unknown) => n && typeof n === 'object' && typeof (n as { id?: unknown }).id === 'string')
            .map((n: unknown) => ({ id: (n as { id: string }).id, name: typeof (n as { name?: unknown }).name === 'string' ? (n as { name: string }).name : undefined }))
        : [];
      return { nodes, edges: parsed.edges };
    }
  } catch {
    // ignore
  }
  return null;
}

function isGraphSection(event: EnvelopeCopyEvent | null): boolean {
  return event?.type === 'graph';
}

function sectionType(event: EnvelopeCopyEvent | null): 'graph' | 'tables' | 'diagrams' | 'narrative' {
  const t = event?.type;
  if (t === 'graph' || t === 'tables' || t === 'diagrams') return t;
  return 'narrative';
}

function typeLabel(event: EnvelopeCopyEvent | null): string {
  if (!event) return 'No section selected';
  switch (event.type) {
    case 'graph': return 'Graph nodes / edges';
    case 'tables': return 'Table entities';
    case 'diagrams': return 'Diagram nodes / edges';
    case 'narrative':
    default: return 'Narrative entities';
  }
}

function formatCandidate(candidate: ResolvedEdge['candidates'][number]): string {
  const parts = [candidate.from, '→', candidate.to];
  if (candidate.type) parts.push(`(${candidate.type})`);
  if (candidate.label) parts.push(`“${candidate.label}”`);
  return parts.join(' ');
}

function edgeKey(from: string, to: string, type: string | null, label: string | null): string {
  return `${from}::${to}::${type ?? ''}::${label ?? ''}`;
}

function prefixNodeId(id: string): string {
  return id.startsWith('entity-') ? id : `entity-${id}`;
}

function prefixEdgeId(id: string): string {
  return id.startsWith('edge-') ? id : `edge-${id}`;
}

function candidateSimilarity(edge: ResolvedEdge, candidate: ResolvedEdge['candidates'][number]): number {
  const inputTerms = [edge.type, edge.label].filter((s): s is string => Boolean(s)).map((s) => s.toLowerCase());
  const candidateTerms = [candidate.type, candidate.label].filter((s): s is string => Boolean(s)).map((s) => s.toLowerCase());
  if (inputTerms.length === 0 || candidateTerms.length === 0) return 0;

  let best = 0;
  for (const a of inputTerms) {
    for (const b of candidateTerms) {
      best = Math.max(best, jaroWinkler(a, b));
    }
  }
  return best;
}

function stageDescription(stage: ResolvedEdge['stage']): string {
  switch (stage) {
    case 'no_endpoints': return 'no edge with these endpoints';
    case 'no_type': return 'endpoints exist, but not this type';
    case 'ambiguous_type': return 'multiple edges of this type; add label';
    case 'no_label_match': return 'label not found on matching edges';
    case 'ambiguous_label': return 'multiple edges share this label';
    case 'ambiguous_evidence': return 'evidence overlap tied or absent';
    case 'manual': return 'selected manually from candidates';
    default: return stage;
  }
}

function stageLabel(stage: ResolvedEdge['stage']): string {
  switch (stage) {
    case 'no_endpoints': return 'no endpoints';
    case 'no_type': return 'no type';
    case 'ambiguous_type': return 'ambiguous type';
    case 'no_label_match': return 'no label';
    case 'ambiguous_label': return 'ambiguous label';
    case 'ambiguous_evidence': return 'ambiguous evidence';
    case 'manual': return 'manual';
    default: return stage;
  }
}

function MatchBadge({ edge }: { edge: ResolvedEdge }) {
  const resolved = edge.match_class != null;
  const family = resolved ? 'success' : 'danger';
  const label = resolved ? edge.match_class : stageLabel(edge.stage);
  return (
    <span className={familyClass[family]} title={stageDescription(edge.stage)}>
      {label}
    </span>
  );
}

function ClosestCandidates({
  edge,
  edges,
  selectedCandidateId,
  onSelectCandidate,
  onClearCandidate,
}: {
  edge: ResolvedEdge;
  edges: ResolvedEdge[];
  selectedCandidateId: string | null;
  onSelectCandidate: (candidateId: string) => void;
  onClearCandidate: () => void;
}) {
  if (edge.match_class != null || edge.candidates.length === 0) return <span className="text-foreground-muted">—</span>;

  const resolvedKeys = new Set(
    edges.filter((e) => e.match_class != null).map((e) => edgeKey(e.from, e.to, e.type, e.label))
  );
  const scored = edge.candidates
    .filter((candidate) => !resolvedKeys.has(edgeKey(candidate.from, candidate.to, candidate.type, candidate.label)))
    .map((candidate) => ({ candidate, score: candidateSimilarity(edge, candidate) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return <span className="text-foreground-muted">—</span>;

  return (
    <select
      value={selectedCandidateId ?? ''}
      onChange={(e) => {
        const value = e.target.value;
        if (value) onSelectCandidate(value);
        else onClearCandidate();
      }}
      className="w-full h-7 rounded-md border border-border-default bg-surface-card px-2 text-xs text-foreground-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none truncate"
    >
      <option value="">None selected</option>
      {scored.map(({ candidate, score }) => (
        <option key={`candidate-${edge.input_index}-${candidate.id}`} value={candidate.id}>
          {formatCandidate(candidate)} · {score.toFixed(2)}
        </option>
      ))}
    </select>
  );
}

function NodesTable({
  nodes,
  selected,
  onToggle,
  onToggleAll,
  allSelected,
}: {
  nodes: ResolvedEntity[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  allSelected: boolean;
}) {
  return (
    <div className="rounded-md border border-on-dark/[0.08] flex flex-col h-full overflow-hidden">
      <div className="px-3 py-1.5 bg-accent-primary-bg border-b border-accent-primary-bd text-xs font-medium text-foreground-default flex items-center justify-between shrink-0">
        <span>Nodes</span>
        <span className="text-xs font-mono text-accent-secondary-fg bg-surface-inset border border-accent-secondary-bd px-2 py-0.5 rounded">
          {selected.size}/{nodes.length}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Table className="text-xs table-fixed">
          <TableHeader>
            <TableRow className="border-b border-border-default bg-surface-card">
              <TableHead className="w-12 py-2 px-4">
                <Checkbox checked={allSelected} onCheckedChange={onToggleAll} />
              </TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left">id</TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left">name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node, idx) => {
              const resolvable = node.canonical_id != null && node.db_id != null;
              const isSelected = selected.has(node.entity_id);
              return (
                <TableRow
                  key={`node-${node.canonical_id || node.entity_id}-${idx}`}
                  className={`border-b border-border-subtle transition-colors ${
                    isSelected ? 'bg-accent-primary-bg' : resolvable ? 'hover:bg-surface-card' : 'opacity-50 cursor-not-allowed'
                  }`}
                >
                  <TableCell className="py-1.5 px-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      disabled={!resolvable}
                      onCheckedChange={() => onToggle(node.entity_id)}
                    />
                  </TableCell>
                  <TableCell className="py-1.5 px-4 text-xs text-foreground-default truncate font-mono" title={node.canonical_id || node.entity_id}>
                    {node.canonical_id || node.entity_id}
                  </TableCell>
                  <TableCell className="py-1.5 px-4 text-xs text-foreground-subtle truncate" title={node.name}>
                    {node.name || '-'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function EdgesTable({
  edges,
  selectedCandidates,
  onSelectCandidate,
  onClearCandidate,
  selected,
  resolvable,
  onToggle,
  onToggleAll,
  allSelected,
}: {
  edges: ResolvedEdge[];
  selectedCandidates: Record<number, string>;
  onSelectCandidate: (inputIndex: number, candidateId: string) => void;
  onClearCandidate: (inputIndex: number) => void;
  selected: Set<number>;
  resolvable: Set<number>;
  onToggle: (inputIndex: number) => void;
  onToggleAll: () => void;
  allSelected: boolean;
}) {
  return (
    <div className="rounded-md border border-on-dark/[0.08] flex flex-col h-full overflow-hidden">
      <div className="px-3 py-1.5 bg-accent-primary-bg border-b border-accent-primary-bd text-xs font-medium text-foreground-default flex items-center justify-between shrink-0">
        <span>Edges</span>
        <span className="text-xs font-mono text-accent-secondary-fg bg-surface-inset border border-accent-secondary-bd px-2 py-0.5 rounded">
          {selected.size}/{edges.length}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Table className="text-xs table-fixed">
          <TableHeader>
            <TableRow className="border-b border-border-default bg-surface-card">
              <TableHead className="w-12 py-2 px-4">
                <Checkbox checked={allSelected} onCheckedChange={onToggleAll} />
              </TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-[10%]">from</TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-[10%]">to</TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-[8%]">type</TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-[20%]">label</TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-[12%]">match</TableHead>
              <TableHead className="text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-[40%]">closest</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {edges.map((edge, idx) => {
              const noCandidates = edge.match_class == null && edge.candidates.length === 0;
              const edgeResolvable = resolvable.has(edge.input_index);
              const manual = selectedCandidates[edge.input_index] != null;
              const displayEdge: ResolvedEdge = manual
                ? { ...edge, match_class: 'manual', stage: 'manual' }
                : edge;
              const isSelected = selected.has(edge.input_index);

              return (
                <TableRow
                  key={`edge-${edge.input_index}-${idx}`}
                  className={`border-b border-border-subtle transition-colors ${
                    isSelected ? 'bg-accent-primary-bg' : edgeResolvable ? 'hover:bg-surface-card' : 'opacity-50 cursor-not-allowed'
                    }`}
                    >
                    <TableCell className="py-1.5 px-4" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={isSelected}
                      disabled={!edgeResolvable}
                      onCheckedChange={() => onToggle(edge.input_index)}
                    />
                    </TableCell>
                  <TableCell className="py-1.5 px-4 text-xs text-foreground-default truncate font-mono" title={edge.from}>{edge.from}</TableCell>
                  <TableCell className="py-1.5 px-4 text-xs text-foreground-default truncate font-mono" title={edge.to}>{edge.to}</TableCell>
                  <TableCell className="py-1.5 px-4 text-xs text-foreground-muted font-mono truncate" title={edge.type || undefined}>{edge.type || '-'}</TableCell>
                  <TableCell className="py-1.5 px-4 text-xs text-foreground-subtle whitespace-normal" title={edge.label || undefined}>{edge.label || '-'}</TableCell>
                  <TableCell className="py-1.5 px-4 text-xs text-foreground-subtle">
                    <MatchBadge edge={displayEdge} />
                  </TableCell>
                  <TableCell className="py-1.5 px-4">
                    {!noCandidates && (
                      <ClosestCandidates
                        edge={edge}
                        edges={edges}
                        selectedCandidateId={selectedCandidates[edge.input_index] ?? null}
                        onSelectCandidate={(candidateId) => onSelectCandidate(edge.input_index, candidateId)}
                        onClearCandidate={() => onClearCandidate(edge.input_index)}
                      />
                    )}
                    {noCandidates && <span className="text-foreground-muted">—</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

async function parseDiagramsPayload(text: string): Promise<{ nodes: MermaidNode[]; edges: MermaidEdge[] } | null> {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    const diagrams = Array.isArray(parsed) ? parsed : [parsed];
    const graphs: (MermaidGraph | null)[] = [];
    for (const diagram of diagrams) {
      if (diagram && typeof diagram === 'object' && typeof diagram.content === 'string') {
        const graph = await mermaidToGraph(diagram.content);
        if (graph) graphs.push(graph);
      }
    }
    if (graphs.length === 0) return null;
    const validGraphs = graphs.filter((g): g is MermaidGraph => g != null);
    return mergeMermaidGraphs(validGraphs);
  } catch {
    return null;
  }
}

function buildResolvePayload(
  event: EnvelopeCopyEvent | null,
  graph: { nodes: any[]; edges: any[] } | null,
  text: string,
  serverId: number,
  bankId: string,
): { server_id: number; bank_id: string; section_type: 'graph' | 'tables' | 'diagrams' | 'narrative'; graph?: { nodes?: any[]; edges: any[] }; text?: string } {
  const base = { server_id: serverId, bank_id: bankId, section_type: sectionType(event) };
  if (isGraphSection(event)) {
    const parsedGraph = parseGraphPayload(text);
    return { ...base, graph: { nodes: parsedGraph?.nodes, edges: parsedGraph?.edges ?? [] } };
  }
  if (event?.type === 'diagrams' && graph) {
    return { ...base, section_type: 'graph', graph };
  }
  return { ...base, text };
}

export function AddToViewModal({ open, onOpenChange, event, serverId, bankId }: AddToViewModalProps) {
  const [nodes, setNodes] = useState<ResolvedEntity[]>([]);
  const [edges, setEdges] = useState<ResolvedEdge[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<Record<number, string>>({});
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [selectedEdges, setSelectedEdges] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewName, setViewName] = useState('');
  const [creating, setCreating] = useState(false);

  const sourceLabel = event?.label || 'Section';
  const label = useMemo(() => typeLabel(event), [event]);
  const text = useMemo(() => getSectionText(event), [event]);

  useEffect(() => {
    if (!open || !text) {
      setNodes([]);
      setEdges([]);
      setError(null);
      setLoading(false);
      setSelectedCandidates({});
      setSelectedNodes(new Set());
      setSelectedEdges(new Set());
      setViewName('');
      setCreating(false);
      return;
    }

    if (typeof serverId !== 'number' || serverId <= 0 || !bankId) {
      setError('Server and bank must be selected to resolve entities');
      setLoading(false);
      return;
    }

    const validServerId = serverId;
    const validBankId = bankId;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNodes([]);
    setEdges([]);
    setSelectedCandidates({});
    setSelectedNodes(new Set());
    setSelectedEdges(new Set());
    setViewName(event?.label ? `${event.label} view` : '');
    setCreating(false);

    async function run() {
      const diagramGraph = event?.type === 'diagrams' ? await parseDiagramsPayload(text) : null;
      const payload = buildResolvePayload(event, diagramGraph, text, validServerId, validBankId);

      try {
        const res = await researchApi.resolveGraph(payload);
        if (cancelled) return;
        if (!res.success) {
          setError(res.error || 'Resolution failed');
          toast.error(`Failed to resolve: ${res.error}`);
          return;
        }
        const resolvedNodes = (res.nodes ?? []) as ResolvedEntity[];
        const resolvedEdges = (res.edges ?? []) as ResolvedEdge[];
        setNodes(resolvedNodes);
        setEdges(resolvedEdges);
        setSelectedNodes(new Set(resolvedNodes.filter((n) => n.canonical_id != null && n.db_id != null).map((n) => n.entity_id)));
        setSelectedEdges(new Set(resolvedEdges.filter((e) => e.match_class != null).map((e) => e.input_index)));
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        toast.error(`Failed to resolve: ${message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [open, text, event, serverId, bankId]);

  const [leftWidth, setLeftWidth] = useState(25);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startWidth = leftWidth;
    const containerWidth = container.clientWidth;

    const onMove = (moveEvent: MouseEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const newWidth = startWidth + (deltaPx / containerWidth) * 100;
      setLeftWidth(Math.min(Math.max(newWidth, 15), 60));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleSelectCandidate = (inputIndex: number, candidateId: string) => {
    setSelectedCandidates((prev) => ({ ...prev, [inputIndex]: candidateId }));
    setSelectedEdges((prev) => new Set(prev).add(inputIndex));
  };

  const handleClearCandidate = (inputIndex: number) => {
    setSelectedCandidates((prev) => {
      const next = { ...prev };
      delete next[inputIndex];
      return next;
    });
    setSelectedEdges((prev) => {
      const next = new Set(prev);
      next.delete(inputIndex);
      return next;
    });
  };

  const resolvableNodeIds = useMemo(
    () => new Set(nodes.filter((n) => n.canonical_id != null && n.db_id != null).map((n) => n.entity_id)),
    [nodes]
  );
  const selectedNodeCanonicalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of nodes) {
      if (selectedNodes.has(node.entity_id) && node.canonical_id) {
        ids.add(node.canonical_id);
      }
    }
    return ids;
  }, [nodes, selectedNodes]);
  const resolvableEdgeIndices = useMemo(
    () => new Set(edges.filter((e) => {
      const matched = e.match_class != null || selectedCandidates[e.input_index] != null;
      const endpointsSelected = selectedNodeCanonicalIds.has(e.from) && selectedNodeCanonicalIds.has(e.to);
      return matched && endpointsSelected;
    }).map((e) => e.input_index)),
    [edges, selectedCandidates, selectedNodeCanonicalIds]
  );

  // Keep selectedEdges in sync with resolvableEdgeIndices: auto-select newly resolvable edges
  // (e.g., when a node is reselected) and deselect edges that are no longer resolvable.
  const prevResolvableRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const current = resolvableEdgeIndices;
    const prev = prevResolvableRef.current;
    setSelectedEdges((prevSelected) => {
      const next = new Set(prevSelected);
      for (const idx of prevSelected) {
        if (!current.has(idx)) next.delete(idx);
      }
      for (const idx of current) {
        if (!prev.has(idx)) next.add(idx);
      }
      return next;
    });
    prevResolvableRef.current = new Set(current);
  }, [resolvableEdgeIndices]);

  const allNodesSelected =
    resolvableNodeIds.size > 0 && [...resolvableNodeIds].every((id) => selectedNodes.has(id));
  const allEdgesSelected =
    resolvableEdgeIndices.size > 0 && [...resolvableEdgeIndices].every((idx) => selectedEdges.has(idx));

  const toggleNode = (id: string) => {
    if (!resolvableNodeIds.has(id)) return;
    setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllNodes = () => {
    setSelectedNodes(allNodesSelected ? new Set() : new Set(resolvableNodeIds));
  };
  const toggleEdge = (inputIndex: number) => {
    if (!resolvableEdgeIndices.has(inputIndex)) return;
    setSelectedEdges((prev) => {
      const next = new Set(prev);
      if (next.has(inputIndex)) next.delete(inputIndex);
      else next.add(inputIndex);
      return next;
    });
  };
  const toggleAllEdges = () => {
    setSelectedEdges(allEdgesSelected ? new Set() : new Set(resolvableEdgeIndices));
  };

  const resolvedEdgeCount = edges.filter((e) => e.match_class != null || selectedCandidates[e.input_index] != null).length;
  const canCreate =
    !creating &&
    viewName.trim().length > 0 &&
    selectedNodes.size > 0 &&
    selectedEdges.size > 0 &&
    typeof serverId === 'number' &&
    serverId > 0 &&
    !!bankId;

  const handleCreateView = async () => {
    if (!canCreate) return;
    const nodeByEntityId = new Map(nodes.map((n) => [n.entity_id, n]));
    const selectedNodeList = Array.from(selectedNodes)
      .map((entityId) => nodeByEntityId.get(entityId))
      .filter((n): n is ResolvedEntity => n != null && n.canonical_id != null);
    const nodeIdSet = new Set(selectedNodeList.map((n) => prefixNodeId(n.canonical_id!)));

    const selectedEdgeList = edges.filter((e) => {
      if (!selectedEdges.has(e.input_index)) return false;
      const candidateId = selectedCandidates[e.input_index];
      const edgeId = candidateId ?? e.id;
      if (!edgeId) return false;
      // Both endpoints must be selected and resolved.
      return nodeIdSet.has(prefixNodeId(e.from)) && nodeIdSet.has(prefixNodeId(e.to));
    });

    const viewNodes: ViewNode[] = selectedNodeList.map((n) => {
      const refId = n.canonical_id!;
      const displayName = n.name || refId;
      const viewId = prefixNodeId(refId);
      return {
        id: viewId,
        ref_id: refId,
        type: 'entity' as const,
        name: displayName,
        label: displayName,
        entity_type: n.type_name || 'entity',
        properties: {
          display_name: displayName,
          aliases: [displayName, refId],
        },
        style: {},
      };
    });

    const viewEdges: ViewEdge[] = selectedEdgeList.map((e) => {
      const candidateId = selectedCandidates[e.input_index];
      const edgeRefId = candidateId ?? e.id!;
      const viewEdgeId = prefixEdgeId(edgeRefId);
      const sourceId = prefixNodeId(e.from);
      const targetId = prefixNodeId(e.to);
      const label = e.label || '';
      const edgeType = e.type || '';
      return {
        id: viewEdgeId,
        ref_id: edgeRefId,
        source: sourceId,
        target: targetId,
        source_ref_id: e.from,
        target_ref_id: e.to,
        type: edgeType || undefined,
        edge_type: edgeType || undefined,
        label: label || undefined,
        properties: {
          directed: true,
          label,
          detail: e.detail || '',
        },
        style: {},
        canonicalOnly: false,
        parallelIndex: 1,
        parallelTotal: 1,
        parallelDirection: 'horizontal',
      };
    });

    const graph: ViewGraph = { nodes: viewNodes, edges: viewEdges };

    setCreating(true);
    try {
      await viewsApi.create(serverId, bankId, {
        name: viewName.trim(),
        diagram_type: 'flowchart',
        graph,
      });
      toast.success(`Created view “${viewName.trim()}” · ${viewNodes.length} node${viewNodes.length === 1 ? '' : 's'} · ${viewEdges.length} edge${viewEdges.length === 1 ? '' : 's'}`);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to create view: ${message}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Add to view</DialogTitle>
          <div className="text-xs text-foreground-subtle">
            {sourceLabel ? `${label} from “${sourceLabel}”` : label}
          </div>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar -mx-6 px-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-foreground-subtle py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              Resolving…
            </div>
          )}
          {!loading && error && (
            <div className="text-sm text-destructive-fg py-4">
              Could not resolve: {error}
            </div>
          )}
          {!loading && !error && nodes.length === 0 && edges.length === 0 && (
            <div className="text-sm text-foreground-subtle py-4">
              No resolved entities found.
            </div>
          )}
          {!loading && !error && (nodes.length > 0 || edges.length > 0) && (
            <div ref={containerRef} className="flex h-full">
              {nodes.length > 0 && (
                <div className="min-w-0 flex flex-col h-full" style={{ width: `${leftWidth}%` }}>
                  <NodesTable
                    nodes={nodes}
                    selected={selectedNodes}
                    onToggle={toggleNode}
                    onToggleAll={toggleAllNodes}
                    allSelected={allNodesSelected}
                  />
                </div>
              )}
              {nodes.length > 0 && edges.length > 0 && (
                <ResizeHandle
                  direction="vertical"
                  onMouseDown={handleResizeStart}
                  onDoubleClick={() => setLeftWidth(25)}
                  title="Drag to resize node/edge panes; double-click to reset"
                />
              )}
              {edges.length > 0 && (
                <div className="flex-1 min-w-0 flex flex-col h-full">
                  <EdgesTable
                    edges={edges}
                    selectedCandidates={selectedCandidates}
                    onSelectCandidate={handleSelectCandidate}
                    onClearCandidate={handleClearCandidate}
                    selected={selectedEdges}
                    resolvable={resolvableEdgeIndices}
                    onToggle={toggleEdge}
                    onToggleAll={toggleAllEdges}
                    allSelected={allEdgesSelected}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="text-[11px] text-foreground-subtle pt-2 border-t border-border-subtle flex items-center justify-between gap-4">
          <span>
            {loading
              ? 'Resolving…'
              : `${nodes.length} node${nodes.length === 1 ? '' : 's'} · ${resolvedEdgeCount}/${edges.length} resolved edge${edges.length === 1 ? '' : 's'}`}
          </span>
          {!loading && (nodes.length > 0 || edges.length > 0) && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="View name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canCreate) {
                    e.preventDefault();
                    void handleCreateView();
                  }
                }}
                className="h-7 w-56 text-xs"
              />
              <Button
                size="sm"
                disabled={!canCreate}
                onClick={() => void handleCreateView()}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    Creating…
                  </>
                ) : (
                  'Create view'
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
