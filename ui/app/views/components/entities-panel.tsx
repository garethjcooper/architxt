'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Minus, Search, Server, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { Input } from '@/components/ui/input';
import { Panel, PanelContent, PanelHeader } from '@/app/workspace/_components/panel-layout';
import {
  colorForType,
} from '@/lib/graph/render-utils';
import { entityInfoApi, type EntityInfo } from '@/lib/api/client';
import {
  type DisplayNode,
  type DisplayEdge,
  backendNodeToDisplayNode,
  backendEdgeToDisplayEdge,
  isGroundedNode,
  isCandidateNode,
  isGroundedEdge,
  isCandidateEdge,
  getEdgeSortGroup,
} from '@/lib/contextual-graph/display';
import { contextualGraphApi } from '@/lib/api/client';
import type { View, ViewGraph, ViewLayout, ViewNode, ViewEdge } from '@/lib/types';

const logger = createLogger('EntitiesPanel');

type EdgeGroup = {
  key: string;
  sourceViewId: string;
  targetViewId: string;
  sourceRefId: string;
  targetRefId: string;
  sourceLabel: string;
  targetLabel: string;
  typeName: string | null;
  hindsightEdge?: DisplayEdge;
  edges: DisplayEdge[];
};

type EntityRow = {
  node: DisplayNode;
  viewId: string;
  typeName: string;
  groups: EdgeGroup[];
};

const KIND_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'on-canvas', label: 'View' },
] as const;

type KindFilter = (typeof KIND_FILTERS)[number]['value'];

function toEntityViewId(nodeId: string): string {
  return `entity-${nodeId}`;
}

function isEntityId(id: string): boolean {
  return id.startsWith('entity-');
}

function canonicalViewEdge(edge: ViewEdge): ViewEdge {
  const source = edge.source ?? '';
  const target = edge.target ?? '';
  const sourceRef = edge.source_ref_id ?? '';
  const targetRef = edge.target_ref_id ?? '';
  const a = [source, sourceRef].join('\0');
  const b = [target, targetRef].join('\0');
  if (a <= b) return edge;
  return {
    ...edge,
    source: target,
    target: source,
    source_ref_id: targetRef,
    target_ref_id: sourceRef,
  };
}

function stripEntityPrefix(id: string): string {
  return id.startsWith('entity-') ? id.slice('entity-'.length) : id;
}

function groupEdges(edges: DisplayEdge[], nodeById: Map<string, DisplayNode>): EdgeGroup[] {
  const rawGroups = new Map<string, DisplayEdge[]>();
  for (const edge of edges) {
    const key = getEdgeSortGroup(edge);
    let list = rawGroups.get(key);
    if (!list) {
      list = [];
      rawGroups.set(key, list);
    }
    list.push(edge);
  }

  const groups: EdgeGroup[] = [];
  for (const [key, members] of rawGroups) {
    const rep = members[0];
    const rawSourceId = toEntityViewId(rep.source_id);
    const rawTargetId = toEntityViewId(rep.target_id);
    const rawSourceRef = rep.source_id;
    const rawTargetRef = rep.target_id;
    const a = [rawSourceId, rawSourceRef].join('\0');
    const b = [rawTargetId, rawTargetRef].join('\0');
    const flipped = a > b;
    const [sourceViewId, targetViewId] = flipped
      ? [rawTargetId, rawSourceId]
      : [rawSourceId, rawTargetId];
    const [sourceRefId, targetRefId] = flipped
      ? [rawTargetRef, rawSourceRef]
      : [rawSourceRef, rawTargetRef];
    const [sourceLabel, targetLabel] = flipped
      ? [nodeById.get(rep.target_id)?.label || rep.target_id, nodeById.get(rep.source_id)?.label || rep.source_id]
      : [nodeById.get(rep.source_id)?.label || rep.source_id, nodeById.get(rep.target_id)?.label || rep.target_id];
    const typeName = rep.type;
    const hindsightEdge = members.find(
      (e) => e.id.startsWith('hindsight-') || e.properties?.provenance?.source === 'hindsight'
    );
    const edges = members
      .filter((e) => e !== hindsightEdge)
      .sort((a, b) => {
        const aLabel = a.label || a.type || a.id;
        const bLabel = b.label || b.type || b.id;
        return aLabel.localeCompare(bLabel);
      });
    groups.push({
      key,
      sourceViewId,
      targetViewId,
      sourceRefId,
      targetRefId,
      sourceLabel,
      targetLabel,
      typeName: hindsightEdge ? hindsightEdge.type : typeName,
      hindsightEdge,
      edges,
    });
  }
  return groups;
}

function buildEntityRows(
  nodes: DisplayNode[],
  edges: DisplayEdge[],
  entityInfoMap: Record<string, EntityInfo> = {}
): EntityRow[] {
  const groundedNodes = nodes.filter((n) => isGroundedNode(n) && !isCandidateNode(n)).sort((a, b) => a.label.localeCompare(b.label));
  const nodeById = new Map(groundedNodes.map((n) => [n.id, n]));
  const groundedEdges = edges
    .filter((e) => isGroundedEdge(e) && !isCandidateEdge(e))
    .filter((e) => nodeById.has(e.source_id) && nodeById.has(e.target_id));
  const allGroups = groupEdges(groundedEdges, nodeById);

  const rows: EntityRow[] = [];
  for (const node of groundedNodes) {
    const viewId = toEntityViewId(node.id);
    const incidentGroups = allGroups.filter(
      (g) => g.sourceViewId === viewId || g.targetViewId === viewId
    );
    // Prefer the catalog type_name for colour/label alignment with the entity
    // list; fall back to the graph node type/id prefix if the catalog entry is
    // absent.
    const catalogTypeName = entityInfoMap[node.id]?.catalog?.type_name;
    const typeName = catalogTypeName || node.type || (node.id.includes(':') ? node.id.split(':')[0] : 'entity');
    rows.push({
      node,
      viewId,
      typeName,
      groups: incidentGroups,
    });
  }
  return rows;
}

function deriveCheckedState(
  row: EntityRow,
  checkedIds: Set<string>
): { checked: boolean; onCanvas: boolean } {
  const allEdgeIds = collectDescendantEdgeIds(row);
  const selectedEdges = allEdgeIds.filter((id) => checkedIds.has(id)).length;
  const entityExplicit = checkedIds.has(row.viewId);
  const onCanvas = entityExplicit || selectedEdges > 0;
  // Entity checkbox is a simple include/exclude toggle: checked whenever the
  // entity (or any of its edges) is on the canvas.
  return { checked: onCanvas, onCanvas };
}

function deriveGroupState(
  group: EdgeGroup,
  checkedIds: Set<string>
): { checked: boolean; indeterminate: boolean } {
  const allIds = collectGroupAllEdgeIds(group);
  const total = allIds.length;
  if (total === 0) return { checked: false, indeterminate: false };
  const selected = allIds.filter((id) => checkedIds.has(id)).length;
  return {
    checked: selected > 0,
    indeterminate: false,
  };
}

function collectContextualEdgeIds(group: EdgeGroup): string[] {
  return group.edges.map((e) => e.id);
}

function edgeIsChecked(edge: DisplayEdge, checkedIds: Set<string>): boolean {
  return checkedIds.has(edge.id);
}

function PanelCheckbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  title,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      title={title}
      className={cn(
        'relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors outline-none',
        checked || indeterminate
          ? 'border-accent-primary-bd bg-accent-primary-solid'
          : 'border-border-on-dark bg-surface-card hover:border-on-dark/50',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {checked && !indeterminate && <Check className="h-3.5 w-3.5 text-foreground-default" />}
      {!checked && indeterminate && <Minus className="h-3.5 w-3.5 text-foreground-default" />}
    </button>
  );
}

function collectGroupToggleIds(group: EdgeGroup): string[] {
  // For hindsight-backed groups, the group header toggles only the hindsight
  // edge. Contextual child edges are added individually via their own checkboxes.
  if (group.hindsightEdge) return [group.hindsightEdge.id];
  return collectContextualEdgeIds(group);
}

function collectGroupAllEdgeIds(group: EdgeGroup): string[] {
  const ids: string[] = [];
  if (group.hindsightEdge) ids.push(group.hindsightEdge.id);
  ids.push(...collectContextualEdgeIds(group));
  return ids;
}

function collectDescendantEdgeIds(row: EntityRow): string[] {
  const ids: string[] = [];
  for (const group of row.groups) {
    ids.push(...collectGroupAllEdgeIds(group));
  }
  return ids;
}

function buildViewGraph(
  rows: EntityRow[],
  checkedIds: Set<string>,
  activeView: View,
  entityInfoMap: Record<string, EntityInfo> = {}
): { graph: ViewGraph; layout: ViewLayout } {
  const selectedEdgeIds = new Set<string>();
  const explicitEntityIds = new Set<string>();
  for (const id of checkedIds) {
    if (isEntityId(id)) explicitEntityIds.add(id);
    else selectedEdgeIds.add(id);
  }

  // Any entity incident to a selected edge (contextual or hindsight) must be on the canvas.
  const impliedEntityIds = new Set<string>();
  for (const row of rows) {
    const hasSelectedEdge = row.groups.some(
      (g) =>
        (g.hindsightEdge && selectedEdgeIds.has(g.hindsightEdge.id)) ||
        g.edges.some((e) => selectedEdgeIds.has(e.id))
    );
    if (hasSelectedEdge) impliedEntityIds.add(row.viewId);
  }

  const entityIdsOnCanvas = new Set([...explicitEntityIds, ...impliedEntityIds]);

  const existingNodeMap = new Map(activeView.graph.nodes.map((n) => [n.id, n]));
  const existingEdgeMap = new Map(activeView.graph.edges.map((e) => [e.id, e]));

  const nodeById = new Map(rows.map((r) => [r.node.id, r.node]));

  const nextNodes: ViewNode[] = activeView.graph.nodes.filter((n) => n.type !== 'entity');

  // Preserve existing entity nodes that are still selected, updating metadata.
  for (const id of entityIdsOnCanvas) {
    const existing = existingNodeMap.get(id);
    const canonicalId = stripEntityPrefix(id);
    const displayNode = nodeById.get(canonicalId);
    if (!displayNode) continue;

    const catalogTypeName = entityInfoMap[canonicalId]?.catalog?.type_name;
    const entityType = catalogTypeName || displayNode.type;

    const base: ViewNode = {
      id,
      type: 'entity',
      ref_id: canonicalId,
      label: displayNode.label,
      name: displayNode.label,
      entity_type: entityType,
      properties: displayNode.properties,
    };

    if (existing && existing.type === 'entity') {
      nextNodes.push({
        ...existing,
        label: base.label,
        name: base.name,
        // Always overwrite entity_type so node colours stay in sync with the
        // catalog type_name even if the existing view node was created before
        // the catalog type was available.
        entity_type: base.entity_type,
        ref_id: base.ref_id,
        properties: base.properties,
      });
    } else {
      nextNodes.push({ ...base, style: {} });
    }
  }

  const nextEdges: ViewEdge[] = activeView.graph.edges.filter(
    (e) => !e.source?.startsWith('entity-') && !e.target?.startsWith('entity-')
  );
  const addedEdgeIds = new Set(nextEdges.map((e) => e.id));

  // Only emit selected edges whose endpoint entities are still on the canvas.
  // This removes orphan edges when an entity is unselected.
  const entityIdAllowed = new Set(entityIdsOnCanvas);

  for (const row of rows) {
    for (const group of row.groups) {
      // Emit the hindsight edge whenever it is explicitly selected, even if
      // contextual child edges are also selected.
      const hindsightSelected = group.hindsightEdge && selectedEdgeIds.has(group.hindsightEdge.id);
      if (
        hindsightSelected &&
        group.hindsightEdge &&
        !addedEdgeIds.has(group.hindsightEdge.id) &&
        entityIdAllowed.has(group.sourceViewId) &&
        entityIdAllowed.has(group.targetViewId)
      ) {
        addedEdgeIds.add(group.hindsightEdge.id);
        const edge = group.hindsightEdge;
        const existing = existingEdgeMap.get(edge.id);
        const base: ViewEdge = {
          id: edge.id,
          source: group.sourceViewId,
          target: group.targetViewId,
          label: edge.label || edge.type || edge.id,
          edge_type: edge.type || undefined,
          ref_id: edge.id,
          source_ref_id: group.sourceRefId,
          target_ref_id: group.targetRefId,
          properties: edge.properties,
        };
        if (existing) {
          nextEdges.push(canonicalViewEdge({ ...existing, ...base }));
        } else {
          nextEdges.push(canonicalViewEdge(base));
        }
      }
      for (const edge of group.edges) {
        if (!selectedEdgeIds.has(edge.id)) continue;
        if (addedEdgeIds.has(edge.id)) continue;
        if (!entityIdAllowed.has(group.sourceViewId) || !entityIdAllowed.has(group.targetViewId)) continue;
        addedEdgeIds.add(edge.id);
        const existing = existingEdgeMap.get(edge.id);
        const base: ViewEdge = {
          id: edge.id,
          source: group.sourceViewId,
          target: group.targetViewId,
          label: edge.label || edge.type || edge.id,
          edge_type: edge.type || undefined,
          ref_id: edge.id,
          source_ref_id: group.sourceRefId,
          target_ref_id: group.targetRefId,
          properties: edge.properties,
        };
        if (existing) {
          nextEdges.push(canonicalViewEdge({ ...existing, ...base }));
        } else {
          nextEdges.push(canonicalViewEdge(base));
        }
      }
    }
  }

  const nextPositions: ViewLayout['positions'] = { ...activeView.layout.positions };
  let addedIndex = 0;
  for (const id of entityIdsOnCanvas) {
    if (!nextPositions[id]) {
      const col = addedIndex % 10;
      const row = Math.floor(addedIndex / 10);
      nextPositions[id] = { x: 120 + col * 160, y: 120 + row * 100, parent: null };
      addedIndex += 1;
    }
  }

  const layout: ViewLayout = {
    ...activeView.layout,
    positions: nextPositions,
  };

  return { graph: { nodes: nextNodes, edges: nextEdges }, layout };
}

export interface EntitiesPanelProps {
  serverId: number | null;
  bankId: string | null;
  activeView: View | null;
  onChange?: (update: { graph: ViewGraph; layout: ViewLayout }) => void;
  findTarget?: { id: string; kind: 'node' | 'edge' } | null;
  onFindComplete?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function EntitiesPanel({ serverId, bankId, activeView, onChange, findTarget, onFindComplete, style, className }: EntitiesPanelProps) {
  const [loading, setLoading] = useState(false);
  const [loadingEntityInfo, setLoadingEntityInfo] = useState(false);
  const [nodes, setNodes] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);
  const [entityInfoMap, setEntityInfoMap] = useState<Record<string, EntityInfo>>({});
  const [filterText, setFilterText] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(new Set());
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const emitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rows = useMemo(() => buildEntityRows(nodes, edges, entityInfoMap), [nodes, edges, entityInfoMap]);

  // Derive the checked set from the active view graph whenever the view changes.
  useEffect(() => {
    if (!activeView) {
      setCheckedIds(new Set());
      return;
    }
    const next = new Set<string>();
    for (const n of activeView.graph.nodes) {
      if (n.type === 'entity' && n.id) next.add(n.id);
    }
    for (const e of activeView.graph.edges) {
      if (e.id && (e.source?.startsWith('entity-') || e.target?.startsWith('entity-'))) {
        next.add(e.id);
      }
    }
    setCheckedIds(next);
  }, [activeView?.id, activeView?.graph.nodes.length, activeView?.graph.edges.length]);

  const loadData = useCallback(async () => {
    if (!serverId || !bankId) {
      setNodes([]);
      setEdges([]);
      setEntityInfoMap({});
      return;
    }
    setLoading(true);
    try {
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
      ]);
      const nextNodes = nodesData.map(backendNodeToDisplayNode);
      setNodes(nextNodes);
      setEdges(edgesData.map(backendEdgeToDisplayEdge));

      // Load catalog type_name for every grounded node so entity colours match
      // the entity list elsewhere in the app.
      setLoadingEntityInfo(true);
      const groundedIds = nextNodes.filter((n) => isGroundedNode(n) && !isCandidateNode(n)).map((n) => n.id);
      const merged: Record<string, EntityInfo> = {};
      const BATCH = 100;
      for (let i = 0; i < groundedIds.length; i += BATCH) {
        try {
          const result = await entityInfoApi.info(serverId, bankId, groundedIds.slice(i, i + BATCH), false);
          Object.assign(merged, result.entities || {});
        } catch (err: unknown) {
          logger.error('Failed to load entity info batch', { error: err, serverId, bankId, batchIndex: i / BATCH });
        }
      }
      setEntityInfoMap(merged);
    } catch (err: unknown) {
      logger.error('Failed to load entities panel data', { error: err, serverId, bankId });
      toast.error(`Failed to load entities: ${String(err instanceof Error ? err.message : String(err))}`);
      setNodes([]);
      setEdges([]);
      setEntityInfoMap({});
    } finally {
      setLoading(false);
      setLoadingEntityInfo(false);
    }
  }, [serverId, bankId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle Find requests from the view editor: locate the item, expand its
  // parents, scroll it into view, flash a highlight, then clear the target.
  useEffect(() => {
    if (!findTarget) return;

    let foundElementId: string | null = null;
    const targetId = findTarget.id;

    if (findTarget.kind === 'node') {
      // The editor prefixes entity ids with 'entity-' for React Flow node ids;
      // the panel rows store the raw entity id.
      const normalizedTargetId = targetId.startsWith('entity-') ? targetId.slice('entity-'.length) : targetId;
      const row = rows.find((r) => r.node.id === normalizedTargetId);
      if (row) {
        setExpandedEntityIds((prev) => {
          const next = new Set(prev);
          next.add(row.viewId);
          return next;
        });
        foundElementId = `entity-row-${row.viewId}`;
      }
    } else {
      // Find the row and group that contains this edge.
      for (const row of rows) {
        for (const group of row.groups) {
          const inGroup =
            group.hindsightEdge?.id === targetId || group.edges.some((e) => e.id === targetId);
          if (inGroup) {
            setExpandedEntityIds((prev) => {
              const next = new Set(prev);
              next.add(row.viewId);
              return next;
            });
            setExpandedGroupKeys((prev) => {
              const next = new Set(prev);
              next.add(group.key);
              return next;
            });
            foundElementId = `edge-row-${targetId}`;
            break;
          }
        }
        if (foundElementId) break;
      }
    }

    if (!foundElementId) {
      onFindComplete?.();
      return;
    }

    // Wait for expansion to render, then scroll and highlight.
    setHighlightId(foundElementId);
    const scrollToTarget = () => {
      const el = panelRef.current?.querySelector(`[data-find-id="${foundElementId}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    // Use a short timeout so React can commit the expanded rows/groups first.
    const scrollTimeout = setTimeout(scrollToTarget, 50);
    const raf = requestAnimationFrame(scrollToTarget);

    const timeout = setTimeout(() => {
      setHighlightId((current) => (current === foundElementId ? null : current));
      onFindComplete?.();
    }, 1500);

    return () => {
      clearTimeout(scrollTimeout);
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [findTarget, rows, onFindComplete]);

  // Emit graph changes back to the view after the user toggles a checkbox.
  useEffect(() => {
    if (!activeView || !onChange) return;

    if (emitTimeoutRef.current) {
      clearTimeout(emitTimeoutRef.current);
    }

    emitTimeoutRef.current = setTimeout(() => {
      const { graph, layout } = buildViewGraph(rows, checkedIds, activeView, entityInfoMap);
      const signature = JSON.stringify({ graph, layout });
      if (signature === lastEmittedRef.current) return;
      lastEmittedRef.current = signature;
      onChange({ graph, layout });
    }, 150);

    return () => {
      if (emitTimeoutRef.current) clearTimeout(emitTimeoutRef.current);
    };
  }, [rows, checkedIds, activeView, entityInfoMap, onChange]);

  const filteredRows = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const matches = (text: string) => tokens.every((t) => text.toLowerCase().includes(t));
    return rows
      .map((row) => {
        const entityMatches = matches(`${row.node.label} ${row.node.id} ${row.typeName}`);
        const matchingGroups = entityMatches
          ? row.groups
          : row.groups.filter((g) =>
              matches(`${g.sourceLabel} ${g.targetLabel} ${g.typeName || ''}`)
            );
        const expandedGroups = matchingGroups.map((g) => {
          const groupMatches = entityMatches || matches(`${g.sourceLabel} ${g.targetLabel} ${g.typeName || ''}`);
          const matchingEdges = groupMatches
            ? g.edges
            : g.edges.filter((e) => matches(`${e.label || ''} ${e.type || ''} ${e.id}`));
          return { ...g, edges: matchingEdges };
        });
        const visibleGroups = expandedGroups.filter((g) => g.edges.length > 0 || !!g.hindsightEdge);
        return { ...row, groups: visibleGroups };
      })
      .filter((row) => row.groups.length > 0 || matches(`${row.node.label} ${row.node.id} ${row.typeName}`))
      .filter((row) => {
        if (kindFilter === 'all') return true;
        return deriveCheckedState(row, checkedIds).onCanvas;
      });
  }, [rows, filterText, kindFilter, checkedIds]);

  const toggleEntity = useCallback((row: EntityRow) => {
    setCheckedIds((prev) => {
      const { onCanvas } = deriveCheckedState(row, prev);
      const next = new Set(prev);
      if (onCanvas) {
        // Uncheck: remove the entity and all of its child edges (contextual and hindsight).
        next.delete(row.viewId);
        for (const id of collectDescendantEdgeIds(row)) next.delete(id);
      } else {
        // Check: add the entity only.
        next.add(row.viewId);
      }
      return next;
    });
  }, []);

  const toggleGroup = useCallback((row: EntityRow, group: EdgeGroup) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      const { checked } = deriveGroupState(group, prev);
      if (checked) {
        // Off: remove all edges in the group (hindsight and contextual children).
        for (const id of collectGroupToggleIds(group)) next.delete(id);
      } else {
        // On: add the whole group.
        for (const id of collectGroupToggleIds(group)) next.add(id);
      }
      return next;
    });
  }, []);

  const toggleEdge = useCallback((edge: DisplayEdge, group: EdgeGroup) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(edge.id)) {
        next.delete(edge.id);
      } else {
        next.add(edge.id);
        // Adding a contextual edge also adds its parent hindsight edge so the
        // pair relationship is visible on canvas.
        const hindsightId = group.hindsightEdge?.id;
        if (hindsightId) next.add(hindsightId);
      }
      return next;
    });
  }, []);

  const toggleEntityExpanded = useCallback((viewId: string) => {
    setExpandedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(viewId)) next.delete(viewId);
      else next.add(viewId);
      return next;
    });
  }, []);

  const toggleGroupExpanded = useCallback((key: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const totalEntities = rows.length;
  const visibleEntities = filteredRows.length;
  const selectedEntities = rows.filter((r) => checkedIds.has(r.viewId)).length;
  const totalEdges = edges.length;
  const selectedEdges = edges.filter((e) => checkedIds.has(e.id)).length;

  const countLabel = totalEntities > 0
    ? `${totalEntities} (${selectedEntities}) entities · ${totalEdges} (${selectedEdges}) edges`
    : undefined;
  const disabled = loading || loadingEntityInfo || !serverId || !bankId || !activeView;
  const noActiveView = !activeView;

  return (
    <Panel className={cn('flex-1 min-h-0', className)} style={style}>
      <PanelHeader
        title="Entities"
        count={countLabel}
        actions={
          <div className="flex items-center gap-1">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setKindFilter(f.value)}
                disabled={disabled}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  kindFilter === f.value
                    ? 'bg-accent-secondary-bg border-accent-secondary-bd text-accent-secondary-fg'
                    : 'bg-surface-card border-border-default text-foreground-subtle hover:bg-surface-panel'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="px-2 py-1.5 border-b border-border-default bg-surface-card shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search entities, edges…"
            className="h-7 pl-7 pr-7 text-xs rounded-md bg-surface-card border border-border-default text-foreground-default placeholder:text-foreground-placeholder focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle"
            disabled={disabled}
          />
          {filterText && (
            <button
              type="button"
              onClick={() => setFilterText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground-faint"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          <div ref={panelRef} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
            {!serverId || !bankId ? (
              <div className="h-full flex flex-col items-center justify-center text-foreground-faint text-sm px-6 text-center gap-2">
                <Server className="h-8 w-8 opacity-50" />
                <p>Select a server and bank to load entities.</p>
              </div>
            ) : loading ? (
              <div className="h-full flex flex-col items-center justify-center text-foreground-faint text-sm gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p>Loading entities…</p>
              </div>
            ) : noActiveView ? (
              <div className="h-full flex flex-col items-center justify-center text-foreground-faint text-sm px-6 text-center gap-2">
                <Users className="h-8 w-8 opacity-50" />
                <p>Open or create a view to select entities for the canvas.</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-foreground-faint text-sm px-6 text-center gap-2">
                <Users className="h-8 w-8 opacity-50" />
                <p>No grounded entities found for this bank.</p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-foreground-faint text-sm px-6 text-center gap-2">
                <Users className="h-8 w-8 opacity-50" />
                <p>No matching entities or edges.</p>
              </div>
            ) : (
              filteredRows.map((row) => {
                const { checked, onCanvas } = deriveCheckedState(row, checkedIds);
                const entityExpanded = expandedEntityIds.has(row.viewId);
                const entityColor = colorForType(row.typeName);

                return (
                  <div
                    key={row.viewId}
                    data-find-id={`entity-row-${row.viewId}`}
                    className={cn(
                      'rounded border border-border-subtle bg-surface-inset overflow-hidden',
                      highlightId === `entity-row-${row.viewId}` && 'find-highlight'
                    )}
                  >
                    <div
                      className="w-full px-2 py-1.5 flex items-center gap-2 text-left hover:bg-surface-card transition-colors"
                      style={{ borderLeftColor: entityColor, borderLeftWidth: 3 }}
                    >
                      <PanelCheckbox
                        checked={checked}
                        onChange={() => toggleEntity(row)}
                        disabled={disabled}
                        title={onCanvas ? 'Remove entity and all its edges from canvas' : 'Add entity to canvas'}
                      />
                      <button
                        type="button"
                        onClick={() => toggleEntityExpanded(row.viewId)}
                        className="shrink-0 text-foreground-subtle hover:text-foreground-default"
                        title={entityExpanded ? 'Collapse' : 'Expand'}
                      >
                        {entityExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-foreground-default truncate">{row.node.label}</div>
                        <div className="text-[10px] text-foreground-subtle font-mono truncate">{row.node.id}</div>
                      </div>
                      <span className="text-[10px] text-foreground-subtle px-1.5 py-0.5 rounded border border-border-default bg-surface-card shrink-0">
                        {row.groups.reduce((sum, g) => sum + collectGroupAllEdgeIds(g).length, 0)}
                      </span>
                    </div>

                    {entityExpanded && row.groups.length > 0 && (
                      <div className="border-t border-border-default px-1 py-1 space-y-0.5">
                        {row.groups.map((group) => {
                          const groupExpanded = expandedGroupKeys.has(group.key);
                          const { checked: groupChecked } = deriveGroupState(group, checkedIds);
                          const groupColor = colorForType(
                            group.hindsightEdge?.type || group.typeName || 'edge'
                          );
                          const groupSecondary = group.hindsightEdge
                            ? group.hindsightEdge.label || group.hindsightEdge.detail || group.hindsightEdge.type || group.hindsightEdge.id
                            : null;

                          return (
                            <div
                              key={group.key}
                              data-find-id={group.hindsightEdge ? `edge-row-${group.hindsightEdge.id}` : undefined}
                              className={cn(
                                'rounded overflow-hidden',
                                group.hindsightEdge && highlightId === `edge-row-${group.hindsightEdge.id}` && 'find-highlight'
                              )}
                            >
                              <div
                                className="flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-card transition-colors"
                                style={{ borderLeftColor: groupColor, borderLeftWidth: 2 }}
                              >
                                <PanelCheckbox
                                  checked={groupChecked}
                                  onChange={() => toggleGroup(row, group)}
                                  disabled={disabled}
                                  title={groupChecked ? 'Remove group from canvas' : 'Add group to canvas'}
                                />
                                <button
                                  type="button"
                                  onClick={() => toggleGroupExpanded(group.key)}
                                  className="shrink-0 text-foreground-subtle hover:text-foreground-default"
                                  title={groupExpanded ? 'Collapse' : 'Expand'}
                                >
                                  {groupExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                </button>
                                <div className="min-w-0 flex-1 flex flex-col justify-center">
                                  <div className="text-[11px] text-foreground-default truncate">
                                    {group.hindsightEdge?.label || (
                                      <>
                                        {group.sourceLabel} <span className="text-foreground-faint">→</span> {group.targetLabel}
                                      </>
                                    )}
                                    {group.edges.length === 0 && group.hindsightEdge && (
                                      <span className="ml-1 text-[9px] text-foreground-subtle">(hindsight)</span>
                                    )}
                                  </div>
                                  {groupSecondary && (
                                    <div className="text-[10px] text-foreground-subtle font-mono truncate" title={groupSecondary}>
                                      {groupSecondary}
                                    </div>
                                  )}
                                </div>
                                <span className="text-[9px] text-foreground-subtle px-1 py-0.5 rounded border border-border-default bg-surface-card shrink-0">
                                  {group.edges.length}
                                </span>
                              </div>

                              {groupExpanded && (
                                <div className="pl-5 pr-1 py-0.5 space-y-0.5">
                                  {group.edges.map((edge) => {
                                    const edgeChecked = edgeIsChecked(edge, checkedIds);
                                    const edgeColor = colorForType(edge.type || 'edge');
                                    const secondary = edge.label || edge.type || edge.id;

                                    return (
                                      <div
                                        key={edge.id}
                                        data-find-id={`edge-row-${edge.id}`}
                                        className={cn(
                                          'flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-card transition-colors',
                                          highlightId === `edge-row-${edge.id}` && 'find-highlight'
                                        )}
                                        style={{ borderLeftColor: edgeColor, borderLeftWidth: 2 }}
                                      >
                                        <PanelCheckbox
                                          checked={edgeChecked}
                                          onChange={() => toggleEdge(edge, group)}
                                          disabled={disabled}
                                          title={edgeChecked ? 'Remove edge from canvas' : 'Add edge to canvas'}
                                        />
                                        <div className="min-w-0 flex-1">
                                          <div className="text-[11px] text-foreground-default truncate">
                                            {group.sourceLabel} <span className="text-foreground-faint">→</span> {group.targetLabel}
                                          </div>
                                          <div className="text-[10px] text-foreground-subtle font-mono truncate">{secondary}</div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
