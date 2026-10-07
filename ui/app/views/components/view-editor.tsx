'use client';

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef, memo } from 'react';
import { useTheme } from 'next-themes';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
  type Viewport,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StickyNote, Trash2, Sparkles, Clock } from 'lucide-react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { EdgeRoutingController, type EdgeRoutingControllerRef } from './edge-routing-controller';
import { resolveCollisions } from 'reactflow-edge-routing';
import { createLogger } from '@/lib/logger';
import { uuidv4 } from '@/lib/envelope-markdown';
import { AvoidedEdge, type AvoidedEdgeData } from './avoided-edge';
import { Button } from '@/components/ui/button';
import { colorForType } from '@/lib/graph/render-utils';
import type { View, ViewGraph, ViewLayout, ViewNode, ViewEdge, ViewTimelineSlice } from '@/lib/types';
import { viewsApi } from '@/lib/api/client';
import { DEFAULT_LAYOUT_OPTIONS, DEFAULT_ROUTING_TUNABLES, DEFAULT_NODE_TUNABLES } from './view-editor-options';
import type { LayoutOptions, RoutingTunables, NodeTunables, ElkAlgorithm, ElkDirection, ElkEdgeRouting, ElkCrossingMinimization, ElkGreedySwitch, BackgroundVariantOption, EntityNodeTextAlignH, EntityNodeTextAlignV } from './view-editor-options';
import { bundleViewEdges } from '@/lib/graph/view-edges';
import { cn } from '@/lib/utils';
import type { DisplayEdge } from '@/lib/contextual-graph/display';

const logger = createLogger('ViewEditor');
const elk = new ELK();


interface NodeDataBase {
  node: ViewNode;
  onChange?: (id: string, text: string) => void;
  showHandles?: boolean;
}

interface NoteNodeData extends NodeDataBase {}


function MultiHandle({ type, colorClass, enabled = true }: { type: 'source' | 'target'; colorClass: string; enabled?: boolean }) {
  return (
    <>
      {[
        Position.Top,
        Position.Bottom,
        Position.Left,
        Position.Right,
      ].map((position) => (
        <Handle
          key={position}
          type={type}
          position={position}
          className={`!w-2 !h-2 ${colorClass} ${enabled ? '' : '!opacity-0 !w-0 !h-0'}`}
        />
      ))}
    </>
  );
}

function stripEntityPrefix(id: string): string {
  return id.startsWith('entity-') ? id.slice('entity-'.length) : id;
}

const NoteNode = memo(function NoteNode({
  data,
  selected,
}: {
  data: NoteNodeData;
  selected?: boolean;
}) {
  const { node, onChange, showHandles } = data;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(node.text || '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = text.trim();
    if (onChange && trimmed !== (node.text || '')) {
      onChange(node.id, trimmed);
    }
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            setText(node.text || '');
            setEditing(false);
          }
        }}
        className="rounded-md border border-accent-primary-bd bg-surface-panel px-2 py-1.5 text-sm min-w-[120px] max-w-[240px] min-h-[40px] resize-none outline-none"
        style={{ color: 'var(--foreground-default)' }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm max-w-[240px] min-w-[80px] whitespace-pre-wrap cursor-text relative ${
        selected
          ? 'border-accent-primary-bd bg-surface-card'
          : 'border-border-default bg-surface-panel'
      } ${status === 'removed' ? 'opacity-60 border-dashed' : ''} ${status === 'added' ? 'animate-pulse' : ''}`}
      style={{
        color: 'var(--foreground-default)',
        borderColor: selected ? 'var(--accent-primary-bd)' : 'var(--border-default)',
      }}
      onDoubleClick={() => {
        setText(node.text || '');
        setEditing(true);
      }}
    >
      <MultiHandle type="target" colorClass="!bg-accent-primary" enabled={showHandles !== false} />
      <MultiHandle type="source" colorClass="!bg-accent-primary" enabled={showHandles !== false} />
      {node.text || 'Note'}
    </div>
  );
});

const GroupNode = memo(function GroupNode({ data, selected }: { data: { node: ViewNode; showHandles?: boolean }; selected?: boolean }) {
  const { node, showHandles } = data;
  return (
    <div
      className={`rounded-lg border-2 px-4 py-3 text-sm min-w-[160px] min-h-[100px] relative ${
        selected ? 'border-accent-primary-bd' : ''
      }`}
      style={{
        color: 'var(--foreground-default)',
        backgroundColor: 'var(--surface-inset)',
        borderStyle: 'dashed',
        borderColor: selected ? 'var(--accent-primary-bd)' : 'var(--border-default)',
      }}
    >
      <MultiHandle type="target" colorClass="!bg-foreground-subtle" enabled={showHandles !== false} />
      <MultiHandle type="source" colorClass="!bg-foreground-subtle" enabled={showHandles !== false} />
      <span className="text-xs font-medium text-foreground-subtle">{node.label || 'Group'}</span>
    </div>
  );
});

const ShapeNode = memo(function ShapeNode({ data, selected }: { data: { node: ViewNode; showHandles?: boolean }; selected?: boolean }) {
  const shape = data.node.shape || 'rectangle';
  const label = data.node.label || 'Shape';
  const showHandles = data.showHandles;
  return (
    <div
      className={`flex items-center justify-center text-xs font-medium text-foreground-default relative ${
        shape === 'circle' ? 'rounded-full w-16 h-16' : 'rounded-md w-20 h-12'
      }`}
      style={{
        backgroundColor: data.node.style?.backgroundColor || 'var(--surface-card)',
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: selected ? 'var(--accent-primary-bd)' : data.node.style?.borderColor || 'var(--border-default)',
      }}
    >
      <MultiHandle type="target" colorClass="!bg-foreground-subtle" enabled={showHandles !== false} />
      &nbsp;
      <MultiHandle type="source" colorClass="!bg-foreground-subtle" enabled={showHandles !== false} />
      {label}
    </div>
  );
});

interface EntityNodeData {
  node: ViewNode;
  showNodeIds?: boolean;
  showHandles?: boolean;
  showNodeColorBar?: boolean;
  minWidth?: number;
  minHeight?: number;
  textAlignH?: EntityNodeTextAlignH;
  textAlignV?: EntityNodeTextAlignV;
}

function entityTypeForNode(node: ViewNode): string | undefined {
  return node.entity_type;
}

function canonicalRefForNode(node: ViewNode): string | undefined {
  const raw = node.ref_id || node.id;
  if (!raw) return undefined;
  return raw.startsWith('entity-') ? raw.slice('entity-'.length) : raw;
}

function canonicalIdForNode(node: ViewNode): string | undefined {
  const ref = canonicalRefForNode(node);
  if (!ref) return undefined;
  if (ref.includes(':')) {
    return ref.split(':').slice(1).join(':');
  }
  return ref;
}

const EntityNode = memo(function EntityNode({ data, selected }: { data: EntityNodeData; selected?: boolean }) {
  const { node, showNodeIds = true, showHandles, showNodeColorBar = true, minWidth = DEFAULT_NODE_TUNABLES.entityNodeMinWidth, minHeight = DEFAULT_NODE_TUNABLES.entityNodeMinHeight, textAlignH = DEFAULT_NODE_TUNABLES.entityNodeTextAlignH, textAlignV = DEFAULT_NODE_TUNABLES.entityNodeTextAlignV } = data;
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const typeName = entityTypeForNode(node);
  const sideColor = colorForType(typeName);
  const canonicalRef = canonicalRefForNode(node);
  const bgColor = isDark
    ? selected
    ? 'oklch(0.23 0 0)'
    : 'oklch(0.21 0 0)'
    : selected
    ? 'oklch(1 0 0)'
    : 'oklch(0.97 0 0)';
  const fgColor = isDark ? 'oklch(0.92 0 0)' : 'oklch(0.25 0 0)';
  const borderColor = selected ? 'var(--accent-primary-bd)' : isDark ? 'oklch(1 0 0 / 10%)' : 'oklch(0 0 0 / 10%)';
  const justifyClass =
    textAlignV === 'top'
      ? 'justify-start'
      : textAlignV === 'bottom'
        ? 'justify-end'
        : 'justify-center';
  const textAlignClass =
    textAlignH === 'left'
      ? 'text-left'
      : textAlignH === 'right'
        ? 'text-right'
        : 'text-center';
  const textPaddingClass = textAlignH === 'left' ? 'pl-1' : '';

  return (
    <div
      className={`rounded-md border px-3 py-3 text-sm max-w-[320px] relative flex flex-col ${justifyClass} ${textAlignClass}`}
      style={{
        color: fgColor,
        backgroundColor: bgColor,
        borderColor,
        minWidth,
        minHeight,
      }}
      title={`${node.label || node.id}${typeName ? ` (${typeName})` : ''}`}
    >
      <div
        className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-md', !showNodeColorBar && 'hidden')}
        style={{ backgroundColor: sideColor }}
        aria-hidden="true"
      />
      <MultiHandle type="target" colorClass="!bg-accent-primary" enabled={showHandles !== false} />
      <MultiHandle type="source" colorClass="!bg-accent-primary" enabled={showHandles !== false} />
      {showNodeIds && (
        <div className={cn('text-xs font-medium text-foreground-subtle mb-0.5 tracking-wide truncate font-mono', textPaddingClass)}>
          {canonicalRef || typeName || 'Entity'}
        </div>
      )}
      <div className={cn('font-medium leading-snug line-clamp-3', textPaddingClass)}>{node.label || node.id}</div>
    </div>
  );
});

function edgeRoutingToType(routing: ElkEdgeRouting): 'straight' | 'step' | 'smoothstep' {
  switch (routing) {
    case 'ORTHOGONAL':
      return 'step';
    case 'SPLINES':
      return 'smoothstep';
    case 'POLYLINE':
    default:
      return 'straight';
  }
}

interface ViewEditorProps {
  view: View;
  serverId: number;
  bankId: string;
  layoutOptions: LayoutOptions;
  routingTunables: RoutingTunables;
  nodeTunables?: NodeTunables;
  showEdgeLabels?: boolean;
  showNodeIds?: boolean;
  showHandles?: boolean;
  showNodeColorBar?: boolean;
  backgroundVariant?: BackgroundVariantOption;
  topK?: number;
  onChange?: (updates: { graph?: ViewGraph; layout?: ViewLayout }) => void;
  saving?: boolean;
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  onSelectionChange?: (state: { nodeIds: string[]; edgeIds: string[] }) => void;
  contextualEdges?: DisplayEdge[];
}


type HistoryEntry = {
  graph: ViewGraph;
  layout: ViewLayout;
};

const MAX_HISTORY_SIZE = 100;

function isEqualHistory(a: HistoryEntry, b: HistoryEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ViewEditorHandle {
  addNote: () => void;
  deleteSelectedNotes: () => void;
  getSelectedItem: () => { kind: 'node' | 'edge'; id: string } | null;
  runAutoLayout: () => void;
  undo: () => void;
  redo: () => void;
  toggleTimeline: () => void;
  clearTimeline: () => Promise<void>;
  canDeleteNotes: boolean;
  autoLayouting: boolean;
  canUndo: boolean;
  canRedo: boolean;
  getNodes: () => Node[];
  getEdges: () => Edge[];
}



// Simple deterministic offset so parallel (unbundled) edges don't overlap exactly.
const PATH_OFFSET_STEP = 16;
function pathOffsetsForEdge(edgeId: string): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < edgeId.length; i++) {
    hash = edgeId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const n = Math.abs(hash);
  const offset = ((n % 5) - 2) * PATH_OFFSET_STEP;
  return { x: offset, y: offset };
}

function getPolylinePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  edgeId: string,
  routing: ElkEdgeRouting
): string {
  if (routing === 'SPLINES') {
    const midX = (sourceX + targetX) / 2;
    return `M ${sourceX},${sourceY} C ${midX},${sourceY} ${midX},${targetY} ${targetX},${targetY}`;
  }

  if (routing === 'POLYLINE') {
    return `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  }

  const { x: ox, y: oy } = pathOffsetsForEdge(edgeId);
  const midX = (sourceX + targetX) / 2 + ox;
  const midY = (sourceY + targetY) / 2 + oy;
  return `M ${sourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`;
}


function edgeColorForType(edgeType?: string | null): string {
  return colorForType(edgeType || 'edge');
}


function toReactFlow(
  view: View,
  layoutOptions: LayoutOptions,
  nodeTunables: NodeTunables,
  showEdgeLabels: boolean,
  showNodeIds: boolean,
  showHandles: boolean,
  showNodeColorBar: boolean,
  topK: number | undefined,
  contextualEdgesById: Map<string, DisplayEdge>
): { nodes: Node[]; edges: Edge[] } {
  const positions = view.layout?.positions || {};

  // Build degree map over the full (unfiltered) graph so top-K ranking is stable.
  const rawEdges = view.graph?.edges || [];
  const degree = new Map<string, number>();
  for (const e of rawEdges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  // Detect nodes that have no saved position at all. Give them a deterministic
  // fallback grid so they (and their edges) remain visible instead of stacking
  // at the origin and creating orphan-looking edges.
  const fallbackGridCols = 6;
  const fallbackCellWidth = 180;
  const fallbackCellHeight = 80;
  let fallbackCount = 0;

  let nodes: Node[] = [];
  for (let i = 0; i < (view.graph?.nodes || []).length; i++) {
    const n = view.graph!.nodes[i];
    const saved = positions[n.id];
    const hasSavedPosition = saved && (saved.x !== 0 || saved.y !== 0);
    let pos = saved || { x: 0, y: 0 };
    if (!hasSavedPosition) {
      fallbackCount++;
      const col = fallbackCount % fallbackGridCols;
      const row = Math.floor(fallbackCount / fallbackGridCols);
      pos = { x: col * fallbackCellWidth, y: row * fallbackCellHeight };
    }
    nodes.push({
      id: n.id,
      type: n.type,
      position: { x: pos.x, y: pos.y },
      parentId: pos.parent || undefined,
      data: {
        node: n,
        showHandles,
        showNodeIds,
        showNodeColorBar,
        minWidth: nodeTunables.entityNodeMinWidth,
        minHeight: nodeTunables.entityNodeMinHeight,
        textAlignH: nodeTunables.entityNodeTextAlignH,
        textAlignV: nodeTunables.entityNodeTextAlignV,
        onChange: undefined as undefined | ((id: string, text: string) => void),
      },
      style: n.style,
    });
  }

  // Apply visual-only top-K filter by node degree. The saved graph is untouched.
  const totalNodeCount = nodes.length;
  const effectiveTopK = topK === undefined || topK <= 0 || topK >= totalNodeCount ? undefined : topK;
  let visibleNodeIds = new Set(nodes.map((n) => n.id));
  if (effectiveTopK !== undefined) {
    const ranked = [...nodes].sort((a, b) => {
      const da = degree.get(a.id) || 0;
      const db = degree.get(b.id) || 0;
      if (db !== da) return db - da;
      return String(a.id).localeCompare(String(b.id));
    });
    const keep = new Set(ranked.slice(0, effectiveTopK).map((n) => n.id));
    nodes = nodes.filter((n) => keep.has(n.id));
    visibleNodeIds = keep;
  }

  // Drop any edge whose endpoint node is not in the rendered set. This prevents
  // drawing edges to filtered/removed/missing nodes that look orphaned.
  const filteredEdges = rawEdges.filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target));
  const droppedEdges = rawEdges.length - filteredEdges.length;

  const bundledEdges = bundleViewEdges(filteredEdges, layoutOptions.edgeMergeMode);

  // In 'all' mode, parallel edges between the same node pair would perfectly
  // overlap and look like one thick line. Assign each parallel edge an index
  // and a dominant direction so the renderer can fan them out.
  const parallelGroups = new Map<string, (typeof bundledEdges)[number][]>();
  if (layoutOptions.edgeMergeMode === 'all') {
    for (const e of bundledEdges) {
      const key = [e.source, e.target].sort().join('|');
      const list = parallelGroups.get(key) || [];
      list.push(e);
      parallelGroups.set(key, list);
    }
  }
  const allModeDirection: 'horizontal' | 'vertical' = ['LEFT', 'RIGHT'].includes(layoutOptions.direction) ? 'horizontal' : 'vertical';

  const edgeType = 'avoided';
  const maxBundledCount = Math.max(1, ...bundledEdges.map((e) => e.bundledCount || 1));

  const nodeById = new Map(view.graph?.nodes?.map((n) => [n.id, n]) ?? []);

  const edges = bundledEdges.map((e) => {
    const count = e.bundledCount || 1;
    const thickness =
      maxBundledCount > 1
        ? Math.max(1.5, 1 + Math.sqrt((count - 1) / (maxBundledCount - 1)) * 7)
        : 1.5;
    const group = layoutOptions.edgeMergeMode === 'all' ? parallelGroups.get([e.source, e.target].sort().join('|')) : undefined;
    const parallelIndex = group ? group.indexOf(e) : 0;
    const parallelTotal = group ? group.length : 1;
    const baseColor = edgeColorForType(layoutOptions.edgeMergeMode === 'full' ? 'grounded' : e.edge_type);

    // Some canonical/hindsight edges have source/target flipped relative to the
    // original contextual-graph direction. Detect that and put the arrowhead on
    // the correct end without changing the rendered line geometry.
    const contextualEdge = contextualEdgesById.get(e.id);
    const originalSource = contextualEdge?.source_id;
    const originalTarget = contextualEdge?.target_id;
    const needsFlippedArrow =
      layoutOptions.edgeMergeMode === 'all' &&
      contextualEdge != null &&
      (originalSource !== stripEntityPrefix(e.source) || originalTarget !== stripEntityPrefix(e.target));
    const arrowMarker = {
      type: MarkerType.ArrowClosed,
      width: 10,
      height: 10,
      color: baseColor,
    };

    let edgeLabel: string | undefined;
    if (showEdgeLabels) {
      if (count > 1) {
        edgeLabel = e.bidirectional ? `↔ ${count}` : String(count);
      } else if (layoutOptions.edgeMergeMode === 'full') {
        edgeLabel = undefined;
      } else if (!e.canonicalOnly && e.edge_type !== 'hindsight') {
        edgeLabel = e.label || e.edge_type || undefined;
      } else {
        // Fallback to resolved node names for canonical-only / hindsight edges.
        // Use original direction when the visual endpoints were flipped.
        const visualSource = needsFlippedArrow && originalSource ? originalSource : e.source;
        const visualTarget = needsFlippedArrow && originalTarget ? originalTarget : e.target;
        const sourceLabel = nodeById.get(visualSource)?.label || nodeById.get(visualSource)?.name || visualSource;
        const targetLabel = nodeById.get(visualTarget)?.label || nodeById.get(visualTarget)?.name || visualTarget;
        edgeLabel = `${sourceLabel} → ${targetLabel}`;
      }
    }

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: edgeType,
      style: {
        stroke: baseColor,
        strokeWidth: thickness,
        opacity: 0.85,
        strokeDasharray: e.canonicalOnly ? '5,5' : undefined,
      },
      markerEnd: !needsFlippedArrow && (e.bidirectional || count === 1) ? arrowMarker : undefined,
      markerStart: needsFlippedArrow || e.bidirectional ? arrowMarker : undefined,
      label: edgeLabel,
      labelStyle: { fill: 'var(--foreground-subtle)', fontSize: 10 },
      data: {
        ...e,
        routing: layoutOptions.edgeRouting,
        ...(layoutOptions.edgeMergeMode === 'all' && parallelTotal > 1
          ? { parallelIndex, parallelTotal, parallelDirection: allModeDirection }
          : {}),
      },
    } as Edge;
  });


  return { nodes, edges };
}

const ViewEditorInner = forwardRef<ViewEditorHandle, ViewEditorProps>(function ViewEditorInner(props, ref) {
  const {
    view,
    serverId,
    bankId,
    layoutOptions,
    routingTunables,
    nodeTunables = DEFAULT_NODE_TUNABLES,
    showEdgeLabels = true,
    showNodeIds = true,
    showHandles = true,
    showNodeColorBar = true,
    backgroundVariant = 'dots',
    topK,
    onChange,
    saving,
    onHistoryChange,
    onSelectionChange,
  } = props;
  const { fitView, setViewport } = useReactFlow();
  const { resolvedTheme } = useTheme();
  const [autoLayouting, setAutoLayouting] = useState(false);
  const nodeTypes = useMemo(
    () => ({
      note: NoteNode,
      group: GroupNode,
      shape: ShapeNode,
      entity: EntityNode,
    }),
    []
  );
  const edgeTypes = useMemo(
    () => ({
      avoided: AvoidedEdge,
    }),
    []
  );
  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'avoided',
    }),
    []
  );
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(0);
  const viewportSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notifyHistory = useCallback(() => {
    onHistoryChange?.({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1,
    });
  }, [onHistoryChange]);

  useEffect(() => {
    historyRef.current = [{ graph: view.graph, layout: view.layout }];
    historyIndexRef.current = 0;
    notifyHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id]);

  const pushHistory = useCallback((entry: HistoryEntry) => {
    if (isHistoryMode) return;
    const current = historyRef.current[historyIndexRef.current];
    if (!current || isEqualHistory(entry, current)) return;

    const next = historyRef.current.slice(0, historyIndexRef.current + 1);
    next.push(entry);
    if (next.length > MAX_HISTORY_SIZE) {
      next.shift();
      historyIndexRef.current = next.length - 1;
    } else {
      historyIndexRef.current = next.length - 1;
    }
    historyRef.current = next;
    notifyHistory();
  }, [notifyHistory]);

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0 || !onChange) return;
    historyIndexRef.current -= 1;
    const entry = historyRef.current[historyIndexRef.current];
    onChange({ graph: entry.graph, layout: entry.layout });
    notifyHistory();
  }, [onChange, notifyHistory]);

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1 || !onChange) return;
    historyIndexRef.current += 1;
    const entry = historyRef.current[historyIndexRef.current];
    onChange({ graph: entry.graph, layout: entry.layout });
    notifyHistory();
  }, [onChange, notifyHistory]);
  const [showTimeline, setShowTimeline] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySnapshot, setHistorySnapshot] = useState<{ graph: ViewGraph; layout: ViewLayout } | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const historyAbortRef = useRef<AbortController | null>(null);

  const effectiveView = useMemo(() => {
    return showTimeline && historySnapshot ? { ...view, graph: historySnapshot.graph, layout: historySnapshot.layout } : view;
  }, [view, showTimeline, historySnapshot]);

  const isHistoryMode = showTimeline && historyIndex >= 0;

  const contextualEdgesById = useMemo(() => {
    const map = new Map<string, DisplayEdge>();
    for (const edge of props.contextualEdges || []) {
      map.set(edge.id, edge);
    }
    return map;
  }, [props.contextualEdges]);

  const initial = useMemo(() => toReactFlow(effectiveView, layoutOptions, nodeTunables, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, topK, contextualEdgesById), [effectiveView, layoutOptions, nodeTunables, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, topK, contextualEdgesById]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  const connectorType: 'orthogonal' | 'polyline' | 'bezier' =
    layoutOptions.edgeRouting === 'SPLINES'
      ? 'bezier'
      : layoutOptions.edgeRouting === 'POLYLINE'
      ? 'polyline'
      : 'orthogonal';

  const edgeRoutingRef = useRef<EdgeRoutingControllerRef | null>(null);

  const isLargeView = (view.graph?.nodes?.length || 0) >= 150 || (view.graph?.edges?.length || 0) >= 600;

  const routingOptions = useMemo(
    () => ({
      connectorType,
      autoBestSideConnection: true,
      ...routingTunables,
      shouldSplitEdgesNearHandle: !isLargeView,
      realTimeRouting: false,
      // For very dense views, let libavoid skip work when a straight line is free.
      routeOnlyWhenBlocked: isLargeView,
      // Slightly larger spacing for large views helps routes converge faster.
      edgeToEdgeSpacing: isLargeView ? Math.max(routingTunables.edgeToEdgeSpacing, 24) : routingTunables.edgeToEdgeSpacing,
      edgeToNodeSpacing: isLargeView ? Math.max(routingTunables.edgeToNodeSpacing, 24) : routingTunables.edgeToNodeSpacing,
    }),
    [connectorType, routingTunables, isLargeView]
  );

  useEffect(() => {
    edgeRoutingRef.current?.resetRouting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutOptions.edgeRouting, routingTunables]);

  // Recompute routes after node positions have committed to the DOM. This fixes
  // the auto-layout race where resetRouting() was called before React Flow had
  // applied the newly computed positions.
  const positionsHash = useMemo(
    () => nodes.map((n) => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)}`).join('|'),
    [nodes]
  );
  const prevPositionsHashRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevPositionsHashRef.current === positionsHash) return;
    prevPositionsHashRef.current = positionsHash;
    if (!positionsHash) return;
    const frame = requestAnimationFrame(() => {
      edgeRoutingRef.current?.resetRouting();
    });
    return () => cancelAnimationFrame(frame);
  }, [positionsHash]);

  useEffect(() => {
    const { nodes: nextNodes, edges: nextEdges } = toReactFlow(effectiveView, layoutOptions, nodeTunables, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, topK, contextualEdgesById);
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, [effectiveView, layoutOptions, nodeTunables, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, topK, contextualEdgesById, setNodes, setEdges]);

  // Edge merge mode / edge routing style changes should be reflected immediately
  // without resetting node positions. Rebuild edges from the current nodes so
  // manual drags are preserved.
  const edgeMergeModeRef = useRef(layoutOptions.edgeMergeMode);
  const edgeRoutingRef2 = useRef(layoutOptions.edgeRouting);
  useEffect(() => {
    const mergeChanged = edgeMergeModeRef.current !== layoutOptions.edgeMergeMode;
    const routingChanged = edgeRoutingRef2.current !== layoutOptions.edgeRouting;
    edgeMergeModeRef.current = layoutOptions.edgeMergeMode;
    edgeRoutingRef2.current = layoutOptions.edgeRouting;
    if (!mergeChanged && !routingChanged) return;
    const { edges: nextEdges } = toReactFlow(
      {
        ...effectiveView,
        layout: {
          ...effectiveView.layout,
          positions: Object.fromEntries(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y, parent: n.parentId || null }])),
        },
      },
      layoutOptions,
      nodeTunables,
      showEdgeLabels,
      showNodeIds,
      showHandles,
      showNodeColorBar,
      topK,
      contextualEdgesById
    );
    setEdges(nextEdges);
    edgeRoutingRef.current?.resetRouting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutOptions, nodeTunables, showNodeColorBar, effectiveView, topK, nodes, setEdges]);



  const initialFitDone = useRef(false);
  const nodesInitialized = useNodesInitialized();
  useEffect(() => {
    if (initialFitDone.current || !nodesInitialized || nodes.length === 0) return;
    initialFitDone.current = true;
    const savedViewport = view.layout?.viewport;
    if (savedViewport && savedViewport.zoom != null) {
      const frame = requestAnimationFrame(() => {
        setViewport(savedViewport, { duration: 300 });
      });
      return () => cancelAnimationFrame(frame);
    }
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 300, includeHiddenNodes: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodesInitialized, nodes.length, fitView, setViewport, view.layout?.viewport]);

  const buildHistoryEntry = useCallback(
    (nextNodes: Node[], nextEdges: Edge[], nextLayout?: ViewLayout): HistoryEntry => {
      const graphNodes: ViewNode[] = nextNodes.map((n) => {
        const viewNode = (n.data as { node: ViewNode }).node;
        return {
          ...viewNode,
          position: undefined,
          parentId: undefined,
        };
      });
      const graphEdges = nextEdges.flatMap((e) => {
        const data = (e.data || {}) as ViewEdge & {
          bundledEdges?: ViewEdge[];
          bundledCount?: number;
          routing?: ElkEdgeRouting;
        };
        const { bundledEdges, bundledCount, bidirectional, id, source, target, routing, ...rest } = data;
        const representative: ViewEdge = {
          id: e.id,
          source: e.source,
          target: e.target,
          ...rest,
        };
        if (bundledEdges && bundledEdges.length > 0) {
          return [representative, ...bundledEdges];
        }
        return [representative];
      });
      const positions = nextLayout?.positions ?? { ...view.layout?.positions };
      for (const n of nextNodes) {
        positions[n.id] = {
          x: n.position.x,
          y: n.position.y,
          parent: n.parentId || null,
        };
      }
      const layout: ViewLayout = {
        positions,
        viewport: nextLayout?.viewport ?? view.layout?.viewport ?? { x: 0, y: 0, zoom: 1 },
        controls: { layoutOptions, routingTunables, nodeTunables: nodeTunables ?? DEFAULT_NODE_TUNABLES, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, backgroundVariant, topK },
      };
      return { graph: { nodes: graphNodes, edges: graphEdges }, layout };
    },
    [view.layout, layoutOptions, routingTunables, nodeTunables, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, backgroundVariant, topK]
  );

  const emitGraph = useCallback(
    (nextNodes: Node[], nextEdges: Edge[]) => {
      if (!onChange) return;
      const graphNodes: ViewNode[] = nextNodes.map((n) => {
        const viewNode = (n.data as { node: ViewNode }).node;
        return {
          ...viewNode,

          position: undefined,
          parentId: undefined,
        };
      });
      const graphEdges = nextEdges.flatMap((e) => {
        const data = (e.data || {}) as ViewEdge & {
          bundledEdges?: ViewEdge[];
          bundledCount?: number;
          routing?: ElkEdgeRouting;
        };
        const { bundledEdges, bundledCount, bidirectional, id, source, target, routing, ...rest } = data;
        const representative: ViewEdge = {
          id: e.id,
          source: e.source,
          target: e.target,
          ...rest,
        };
        if (bundledEdges && bundledEdges.length > 0) {
          return [representative, ...bundledEdges];
        }
        return [representative];
      });
      onChange({ graph: { nodes: graphNodes, edges: graphEdges } });
    },
    [onChange]
  );

  const emitLayout = useCallback(
    (nextNodes: Node[], viewport?: Viewport) => {
      if (!onChange) return;
      const nextPositions = { ...view.layout?.positions };
      for (const n of nextNodes) {
        nextPositions[n.id] = {
          x: n.position.x,
          y: n.position.y,
          parent: n.parentId || null,
        };
      }
      const layout: ViewLayout = {
        positions: nextPositions,
        viewport: viewport || view.layout?.viewport || { x: 0, y: 0, zoom: 1 },
        controls: {
          layoutOptions,
          routingTunables,
          nodeTunables: nodeTunables ?? DEFAULT_NODE_TUNABLES,
          showEdgeLabels,
          showNodeIds,
          showHandles,
          backgroundVariant,
          topK,
        },
      };
      onChange({ layout });
    },
    [onChange, view, layoutOptions, routingTunables, nodeTunables, showEdgeLabels, showNodeIds, showHandles, showNodeColorBar, backgroundVariant, topK]
  );

  const addNode = useCallback(
    (type: 'note' | 'group' | 'shape') => {
      const id = `${type}-${uuidv4()}`;
      const offset = nodes.length * 20;
      const position = { x: 120 + offset, y: 100 + offset };

      const viewNode: ViewNode =
        type === 'note'
          ? { id, type: 'note', text: 'New note' }
          : type === 'group'
          ? { id, type: 'group', label: 'Group' }
          : { id, type: 'shape', label: 'Shape', shape: 'rectangle' };

      const newNode: Node = {
        id,
        type,
        position,
        data: { node: viewNode },
      };

      const next = [...nodes, newNode];
      setNodes(next);
      pushHistory(buildHistoryEntry(next, edges));
      emitGraph(next, edges);
    },
    [nodes, edges, setNodes, emitGraph, buildHistoryEntry, pushHistory]
  );

  const handleNoteTextChange = useCallback(
    (id: string, text: string) => {
      const next = nodes.map((n) => {
        if (n.id !== id) return n;
        const data = n.data as { node: ViewNode };
        return { ...n, data: { ...data, node: { ...data.node, text } } };
      });
      setNodes(next);
      pushHistory(buildHistoryEntry(next, edges));
      emitGraph(next, edges);
    },
    [nodes, edges, setNodes, emitGraph, buildHistoryEntry, pushHistory]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const id = `edge-${uuidv4()}`;
      const next = addEdge(
        { ...connection, id, type: 'smoothstep', style: { stroke: 'var(--foreground-subtle)', strokeWidth: 1, opacity: 0.85 } },
        edges
      );
      setEdges(next);
      pushHistory(buildHistoryEntry(nodes, next));
      emitGraph(nodes, next);
    },
    [edges, setEdges, emitGraph, nodes, buildHistoryEntry, pushHistory]
  );

  const deleteSelection = useCallback(() => {
    const selectedNodeIds = new Set(
      nodes.filter((n) => n.selected).map((n) => n.id)
    );
    const selectedEdgeIds = new Set(edges.filter((e) => e.selected).map((e) => e.id));

    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) return;

    const nextNodes = nodes.filter((n) => !selectedNodeIds.has(n.id));
    const nextEdges = edges.filter(
      (e) =>
        !selectedEdgeIds.has(e.id) &&
        !selectedNodeIds.has(e.source) &&
        !selectedNodeIds.has(e.target)
    );

    setNodes(nextNodes);
    setEdges(nextEdges);
    pushHistory(buildHistoryEntry(nextNodes, nextEdges));
    emitGraph(nextNodes, nextEdges);
  }, [nodes, edges, setNodes, setEdges, emitGraph, buildHistoryEntry, pushHistory]);

  const runAutoLayout = useCallback(async () => {
    if (!onChange) return;
    setAutoLayouting(true);
    try {
      const children = nodes.map((n) => ({
        id: n.id,
        width: 160,
        height: 60,
      }));

      const isLarge = (nodes.length || 0) >= 150 || (edges.length || 0) >= 600;

      const baseLayoutOptions: Record<string, string> = {
        'elk.algorithm': layoutOptions.algorithm,
        'elk.direction': layoutOptions.direction,
        'elk.spacing.nodeNode': String(routingTunables.elkNodeNodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(routingTunables.elkNodeNodeBetweenLayers),
        // For dense global views we let libavoid own edge routing; skip ELK edge routing to avoid worker timeouts.
        'elk.layered.edgeRouting': isLarge ? 'NONE' : layoutOptions.edgeRouting,
        'elk.layered.spacing.edgeEdgeBetweenLayers': String(routingTunables.elkEdgeEdgeBetweenLayers),
        'elk.layered.spacing.edgeNodeBetweenLayers': String(routingTunables.elkEdgeNodeBetweenLayers),
        'org.eclipse.elk.layered.crossingMinimization.strategy': isLarge ? 'NONE' : layoutOptions.crossingMinimization,
        'org.eclipse.elk.layered.crossingMinimization.greedySwitch.type': isLarge ? 'OFF' : layoutOptions.greedySwitch,
      };
      if (isLarge) {
        // Give the ELK worker a generous timeout on large graphs and make it deterministic/cheaper.
        baseLayoutOptions['org.eclipse.elk.core.options.EdgeRouting'] = 'NONE';
        baseLayoutOptions['org.eclipse.elk.common.priorityMethod'] = 'DUMMY';
        baseLayoutOptions['org.eclipse.elk.common.randomSeed'] = '42';
      }

      const elkGraph = {
        id: 'root',
        layoutOptions: baseLayoutOptions,
        children,
        edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
      };
      const layout = await elk.layout(elkGraph);

      const positionMap = new Map<string, { x: number; y: number }>();
      for (const child of layout.children || []) {
        positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
      }

      const nextNodes = nodes.map((n) => {
        const pos = positionMap.get(n.id);
        return pos ? { ...n, position: pos } : n;
      });
      setNodes(nextNodes);

      const nextPositions = { ...view.layout?.positions };
      for (const child of layout.children || []) {
        nextPositions[child.id] = {
          x: child.x ?? 0,
          y: child.y ?? 0,
          parent: null,
        };
      }
      const nextLayout: ViewLayout = {
        positions: nextPositions,
        viewport: view.layout?.viewport || { x: 0, y: 0, zoom: 1 },
      };

      pushHistory(buildHistoryEntry(nextNodes, edges, nextLayout));

      onChange({ layout: nextLayout });

      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 300 });
      });
    } catch (err) {
      logger.error('Auto-layout failed', { error: err });
    } finally {
      setAutoLayouting(false);
    }
  }, [nodes, edges, onChange, view, fitView, layoutOptions, routingTunables, setNodes]);

  const handleNodeDragStop = useCallback(
    (_event: any, _node: Node, movedNodes: Node[]) => {
      const resolved = resolveCollisions(movedNodes, { margin: 8 });
      const resolvedMap = new Map(resolved.map((n) => [n.id, n.position]));

      let nextNodes: Node[] = [];
      setNodes((currentNodes) => {
        nextNodes = currentNodes.map((n) => {
          const pos = resolvedMap.get(n.id);
          return pos ? { ...n, position: pos } : n;
        });
        return nextNodes;
      });

      // Defer emitLayout just past the current render so we don't call parent
      // setState during ViewEditorInner's render, but emit the same positions
      // we committed to local state rather than the raw React Flow movedNodes.
      queueMicrotask(() => {
        pushHistory(buildHistoryEntry(nextNodes, edges));
        emitLayout(nextNodes);
      });
    },
    [emitLayout, setNodes]
  );

  const handleNodeDragStopAndReset = useCallback(
    (...args: [any, Node, Node[]]) => {
      handleNodeDragStop(...args);
      edgeRoutingRef.current?.resetRouting();
    },
    [handleNodeDragStop]
  );

  const selectedElementsCount = useMemo(
    () => nodes.filter((n) => n.selected).length + edges.filter((e) => e.selected).length,
    [nodes, edges]
  );

  const toggleTimeline = useCallback(() => {
    setShowTimeline((prev) => !prev);
    initialFitDone.current = false;
  }, []);

  const exitHistory = useCallback(() => {
    historyAbortRef.current?.abort();
    historyAbortRef.current = null;
    setHistoryLoading(false);
    setHistorySnapshot(null);
    setHistoryIndex(-1);
    setShowTimeline(false);
  }, []);

  const clearTimeline = useCallback(async () => {
    if (!serverId || !bankId || !view?.id) return;
    await viewsApi.clearTimeline(serverId, bankId, view.id);
    exitHistory();
  }, [serverId, bankId, view?.id, exitHistory]);

  useEffect(() => {
    const selectedNodeIds = nodes.filter((n) => n.selected).map((n) => n.id);
    const selectedEdgeIds = edges.filter((e) => e.selected).map((e) => e.id);
    onSelectionChange?.({ nodeIds: selectedNodeIds, edgeIds: selectedEdgeIds });
  }, [nodes, edges, onSelectionChange]);

  useImperativeHandle(
    ref,
    (): ViewEditorHandle => ({
      addNote: () => addNode('note'),
      deleteSelectedNotes: deleteSelection,
      getSelectedItem: () => {
        const selectedNode = nodes.find((n) => n.selected);
        if (selectedNode) return { kind: 'node', id: selectedNode.id };
        const selectedEdge = edges.find((e) => e.selected);
        if (selectedEdge) return { kind: 'edge', id: selectedEdge.id };
        return null;
      },
      get runAutoLayout() {
        return runAutoLayout;
      },
      undo,
      redo,
      toggleTimeline,
      clearTimeline,
      get canDeleteNotes() {
        return selectedElementsCount > 0;
      },
      get autoLayouting() {
        return autoLayouting;
      },
      get canUndo() {
        return historyIndexRef.current > 0;
      },
      get canRedo() {
        return historyIndexRef.current < historyRef.current.length - 1;
      },
      getNodes: () => nodes,
      getEdges: () => edges,
    }),
    [
      addNode,
      deleteSelection,
      nodes,
      edges,
      runAutoLayout,
      selectedElementsCount,
      autoLayouting,
      undo,
      redo,
      toggleTimeline,
      clearTimeline,
    ]
  );
  const loadHistorySlice = useCallback(
    async (index: number) => {
      if (!serverId || !bankId || !view?.id || !view.timeline || index < 0 || index >= view.timeline.length) {
        return;
      }
      const slice = view.timeline[index];
      if (!slice?.snapshot_id) return;
      historyAbortRef.current?.abort();
      const controller = new AbortController();
      historyAbortRef.current = controller;
      setHistoryLoading(true);
      try {
        const snapshot = await viewsApi.getTimelineSnapshot(serverId, bankId, view.id, slice.snapshot_id);
        if (controller.signal.aborted) return;
        setHistorySnapshot(snapshot);
        setHistoryIndex(index);
      } catch (err) {
        logger.error('Failed to load timeline snapshot', { error: (err as Error).message });
      } finally {
        if (!controller.signal.aborted) {
          setHistoryLoading(false);
        }
      }
    },
    [serverId, bankId, view]
  );

  const goHistoryPrev = useCallback(() => {
    if (!view?.timeline || view.timeline.length === 0) return;
    const nextIndex = historyIndex >= 0 ? Math.max(0, historyIndex - 1) : view.timeline.length - 1;
    loadHistorySlice(nextIndex);
  }, [historyIndex, view, loadHistorySlice]);

  const goHistoryNext = useCallback(() => {
    if (!view?.timeline || historyIndex < 0 || historyIndex >= view.timeline.length - 1) return;
    loadHistorySlice(historyIndex + 1);
  }, [historyIndex, view, loadHistorySlice]);

  useEffect(() => {
    if (!showTimeline) {
      exitHistory();
      return;
    }
    if (view?.timeline?.length && historyIndex < 0) {
      loadHistorySlice(view.timeline.length - 1);
    }
  }, [showTimeline, view, historyIndex, loadHistorySlice, exitHistory]);

  // Re-fit the view whenever the timeline snapshot changes so the historical
  // graph is visible even if its saved positions lie outside the current
  // viewport.
  useEffect(() => {
    if (!showTimeline || !historySnapshot || nodes.length === 0) {
      return;
    }
    initialFitDone.current = false;
    const frame = requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 300, includeHiddenNodes: false });
      initialFitDone.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [showTimeline, historySnapshot, nodes.length, fitView]);

  // Re-run ELK layout when ELK-related tunables change, so the spacing sliders
  // feel live. Debounce so dragging a slider doesn't thrash the worker.
  const elkTunablesHash = useMemo(
    () =>
      [
        routingTunables.elkNodeNodeSpacing,
        routingTunables.elkNodeNodeBetweenLayers,
        routingTunables.elkEdgeEdgeBetweenLayers,
        routingTunables.elkEdgeNodeBetweenLayers,
      ].join(':'),
    [routingTunables]
  );
  const prevElkHashRef = useRef<string>(elkTunablesHash);
  useEffect(() => {
    if (prevElkHashRef.current === elkTunablesHash) return;
    prevElkHashRef.current = elkTunablesHash;
    if (autoLayouting) return;
    const timer = setTimeout(() => {
      runAutoLayout();
    }, 400);
    return () => clearTimeout(timer);
  }, [elkTunablesHash, autoLayouting, runAutoLayout]);

  const handleViewportChange = useCallback(
    (viewport: Viewport) => {
      if (!onChange) return;
      if (viewportSaveTimeoutRef.current) {
        clearTimeout(viewportSaveTimeoutRef.current);
      }
      viewportSaveTimeoutRef.current = setTimeout(() => {
        viewportSaveTimeoutRef.current = null;
        onChange({
          layout: {
            ...view.layout,
            viewport,
          },
        });
      }, 300);
    },
    [onChange, view]
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const editingNode = target?.closest('.react-flow__node textarea') || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (editingNode) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }
      if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      ) {
        deleteSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteSelection, undo, redo]);

  const nodesWithHandlers = useMemo(() => {
    return nodes.map((n) => {
      if (n.type === 'note') {
        return {
          ...n,
          data: { ...n.data, onChange: handleNoteTextChange },
        };
      }
      return n;
    });
  }, [nodes, handleNoteTextChange]);

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <div className="flex flex-1 min-h-0 bg-surface-inset" style={{ minHeight: 0 }}>
        <div className="flex-1 min-h-0 h-full relative">
          {saving && true && (
            <div className="absolute top-2 left-2 z-10 text-xs text-foreground-subtle bg-surface-panel/80 px-2 py-1 rounded border border-border-default">
              Saving…
            </div>
          )}
          <EdgeRoutingController nodes={nodes} edges={edges} options={routingOptions} ref={edgeRoutingRef} />
          <ReactFlow
            nodes={nodesWithHandlers}
            edges={edges}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              edgeRoutingRef.current?.updateRoutingOnNodesChange(changes);
            }}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={handleNodeDragStopAndReset}
            onMoveEnd={(_e, viewport) => handleViewportChange(viewport)}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={true}
            nodesConnectable={true}
            elementsSelectable={true}
            panOnDrag
            selectionKeyCode={'Shift'}
            multiSelectionKeyCode={'Meta'}
            zoomOnScroll
            minZoom={0.05}
            maxZoom={4}
            onlyRenderVisibleElements={false}
            className="text-foreground-default h-full"
            colorMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
            deleteKeyCode={null}
          >
            {backgroundVariant !== 'off' && (
              <Background
                color="var(--border-subtle)"
                gap={16}
                size={backgroundVariant === 'cross' ? 6 : 1}
                variant={
                  backgroundVariant === 'lines'
                    ? BackgroundVariant.Lines
                    : backgroundVariant === 'cross'
                    ? BackgroundVariant.Cross
                    : BackgroundVariant.Dots
                }
              />
            )}
            <Controls />
            <MiniMap
              nodeColor={() => 'var(--accent-primary-solid)'}
              maskColor="rgba(0,0,0,0.5)"
              className="bg-surface-card border border-border-default"
            />
          </ReactFlow>
        </div>

        {showTimeline && (
          <div className="w-72 border-l border-border-default bg-surface-panel flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
              <span className="text-xs font-medium text-foreground-default">Timeline</span>
              <div className="flex items-center gap-2">
                {Array.isArray(view.timeline) && view.timeline.length > 0 && (
                  <button
                    type="button"
                    onClick={clearTimeline}
                    className="text-[10px] text-destructive hover:text-destructive-foreground"
                  >
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowTimeline(false)}
                  className="text-[10px] text-foreground-subtle hover:text-foreground-default"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
              {historyLoading && (
                <div className="text-xs text-foreground-subtle p-2">Loading snapshot…</div>
              )}
              {(!view.timeline || !Array.isArray(view.timeline) || view.timeline.length === 0) && !historyLoading && (
                <div className="text-xs text-foreground-subtle p-2">No history yet.</div>
              )}
              {Array.isArray(view.timeline) && view.timeline.map((slice, idx) => {
                const isActive = historyIndex === idx;
                return (
                  <button
                    key={slice.id}
                    type="button"
                    onClick={() => loadHistorySlice(idx)}
                    className={cn(
                      'w-full text-left px-2 py-1.5 rounded text-[11px]',
                      isActive ? 'bg-accent-primary-bg text-accent-primary-fg' : 'hover:bg-surface-card text-foreground-muted'
                    )}
                  >
                    <div className="font-medium">{slice.summary}</div>
                    <div className="text-[10px] opacity-80">{new Date(slice.at).toLocaleString()}</div>
                    {slice.details && (
                      <div className="text-[10px] mt-0.5 flex gap-2">
                        {typeof slice.details.added_nodes === 'number' && (
                          <span>+{slice.details.added_nodes}</span>
                        )}
                        {typeof slice.details.updated_nodes === 'number' && (
                          <span>~{slice.details.updated_nodes}</span>
                        )}
                        {typeof slice.details.removed_nodes === 'number' && (
                          <span>-{slice.details.removed_nodes}</span>
                        )}
                        {typeof slice.details.added_edges === 'number' && (
                          <span>+{slice.details.added_edges} edges</span>
                        )}
                        {typeof slice.details.updated_edges === 'number' && (
                          <span>~{slice.details.updated_edges} edges</span>
                        )}
                        {typeof slice.details.removed_edges === 'number' && (
                          <span>-{slice.details.removed_edges} edges</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="px-2 py-2 border-t border-border-default flex items-center justify-between">
              <button
                type="button"
                onClick={goHistoryPrev}
                disabled={historyIndex <= 0}
                className="text-[11px] px-2 py-1 rounded bg-surface-card text-foreground-muted disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={goHistoryNext}
                disabled={historyIndex < 0 || historyIndex >= (view.timeline?.length ?? 0) - 1}
                className="text-[11px] px-2 py-1 rounded bg-surface-card text-foreground-muted disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
});


const ViewEditor = forwardRef<ViewEditorHandle, ViewEditorProps>(function ViewEditor(props, ref) {
  return (
    <ReactFlowProvider>
      <ViewEditorInner {...props} ref={ref} />
    </ReactFlowProvider>
  );
});

export default ViewEditor;
