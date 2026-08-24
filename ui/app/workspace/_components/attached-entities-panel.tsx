'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronUp, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorForType } from '@/components/research-canvas';
import { EdgeListRow } from '@/lib/contextual-graph/display';
import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { MODEL_TAB_LABELS } from './model-content-utils';
import { type EntityInfo, type EntityInfoContextualRef, type Entity } from '@/lib/api/client';
import { type DisplayEdge, type DisplayNode, MODEL_ROLE_LABELS } from '@/lib/contextual-graph/display';

export interface ModelItem {
  key: string;
  label: string;
  extId: string;
  category: string;
  children?: Array<{ key: string; label: string; edgeContext?: EntityInfo['edge_contexts'][number] }>;
}

export interface AttachedEntitiesPanelProps {
  entityIds: string[];
  entityInfoMap: Record<string, EntityInfo> | null;
  edges?: DisplayEdge[];
  entities?: Entity[];
  contextualNodes?: DisplayNode[];
  loading: boolean;
  expandedEntityIds: Set<string>;
  selectedModel: { entityId: string; extId: string } | null;
  onToggleExpand: (entityId: string) => void;
  onSelectModel: (entityId: string, item: ModelItem) => void;
}

function getEntityModelItems(
  info: EntityInfo,
  entityInfoMap?: Record<string, EntityInfo> | null,
  entityNameById?: Map<string, string>,
  contextualNodeNameById?: Map<string, string>
): ModelItem[] {
  const resolveName = (entityId: string): string => {
    const infoName = entityInfoMap?.[entityId]?.catalog?.name || entityInfoMap?.[entityId]?.graph_node?.display_name;
    if (infoName) return infoName;
    const masterName = entityNameById?.get(entityId);
    if (masterName) return masterName;
    const nodeName = contextualNodeNameById?.get(entityId);
    if (nodeName) return nodeName;
    return entityId;
  };

  const items: ModelItem[] = [];

  info.contextual_refs.forEach((ref, i) => {
    if (!ref.ext_id) return;
    const roleLabel = MODEL_ROLE_LABELS[ref.role] || ref.role;
    const rolePrefix = ref.role.replace(/^sys_/, '').replace(/_/g, '-') + '-';
    const entityId = ref.ext_id.startsWith(rolePrefix) ? ref.ext_id.slice(rolePrefix.length) : ref.ext_id;
    const label = resolveName(entityId);
    items.push({
      key: `ctx-${ref.role}-${ref.ext_id || i}`,
      label,
      extId: ref.ext_id,
      category: roleLabel,
    });
  });

  info.derived_models.forEach((m) => {
    const extId = m.ext_id || String(m.id);
    items.push({
      key: `derived-${m.id || extId}`,
      label: m.name || extId,
      extId,
      category: MODEL_TAB_LABELS.derived_models,
    });
  });

  info.plain_models.forEach((m) => {
    const extId = m.ext_id || String(m.id);
    items.push({
      key: `plain-${m.id || extId}`,
      label: m.name || extId,
      extId,
      category: MODEL_TAB_LABELS.plain_models,
    });
  });

  // Group edge contexts by their backing mental-model ext_id so a single
  // system edge-context model can surface the many physical graph edges it
  // produced without collapsing into a merged global "Edges" group.
  // Keep hindsight contexts in the group so they can supply the parent row's
  // source → target label; only derived contexts are shown as child rows.
  const edgeContextsByExtId = new Map<string, EntityInfo['edge_contexts']>();
  for (const ctx of info.edge_contexts) {
    const extId = ctx.refs[0]?.ext_id;
    if (!extId) continue;
    if (!edgeContextsByExtId.has(extId)) edgeContextsByExtId.set(extId, []);
    edgeContextsByExtId.get(extId)!.push(ctx);
  }

  edgeContextsByExtId.forEach((contexts, extId) => {
    const hindsightCtx = contexts.find((c) => c.origin === 'hindsight');
    const derivedContexts = contexts.filter((c) => c.origin !== 'hindsight');

    let label: string;
    if (hindsightCtx) {
      const sourceLabel = resolveName(hindsightCtx.source_id);
      const targetLabel = resolveName(hindsightCtx.target_id);
      label = `${sourceLabel} → ${targetLabel}`;
    } else {
      label = extId;
    }

    items.push({
      key: `edge-${extId}`,
      label,
      extId,
      category: MODEL_TAB_LABELS.edge_contexts,
      children: derivedContexts.map((ctx) => ({
        key: `edge-child-${ctx.edge_id || `${ctx.source_id}-${ctx.target_id}`}`,
        label: `${ctx.source_id} → ${ctx.target_id}`,
        edgeContext: ctx,
      })),
    });
  });

  return items;
}

export function AttachedEntitiesPanel({
  entityIds,
  entityInfoMap,
  edges = [],
  entities = [],
  contextualNodes = [],
  loading,
  expandedEntityIds,
  selectedModel,
  onToggleExpand,
  onSelectModel,
}: AttachedEntitiesPanelProps) {
  const sortedIds = useMemo(() => {
    return [...entityIds].sort((a, b) => a.localeCompare(b));
  }, [entityIds]);

  const edgeById = useMemo(() => {
    const map = new Map<string, DisplayEdge>();
    for (const edge of edges) map.set(edge.id, edge);
    return map;
  }, [edges]);

  const entityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const entity of entities) {
      if (entity.entity_id && entity.name) map.set(entity.entity_id, entity.name);
    }
    return map;
  }, [entities]);

  const contextualNodeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of contextualNodes) {
      if (node.id && node.label) map.set(node.id, node.label);
    }
    return map;
  }, [contextualNodes]);

  // Track which edge-context model rows are expanded to show child edges.
  const [expandedEdgeModelKeys, setExpandedEdgeModelKeys] = useState<Set<string>>(new Set());

  const toggleEdgeModelExpanded = (key: string) => {
    setExpandedEdgeModelKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Panel className="flex-1">
      <PanelHeader
        title="Contextual data"
        count={entityIds.length > 0 ? entityIds.length : undefined}
      />
      <PanelContent className="p-0">
        <div className="absolute inset-0 overflow-y-auto p-2 space-y-1">
          {entityIds.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40 text-sm px-6 text-center gap-3">
              <div className="flex items-center gap-2 text-white/50">
                <FileText className="w-5 h-5" />
                <span>Contextual data</span>
              </div>
              <p className="text-xs max-w-md">
                Check entities in the Entity scope panel to load their contextual graph data here.
              </p>
            </div>
          ) : loading ? (
            <div className="h-full flex items-center justify-center text-white/40 text-xs">Loading entity info…</div>
          ) : entityInfoMap ? (
            sortedIds.map((entityId) => {
              const info = entityInfoMap[entityId];
              if (!info) return null;
              const items = getEntityModelItems(info, entityInfoMap, entityNameById, contextualNodeNameById);
              const expanded = expandedEntityIds.has(entityId);
              const hasItems = items.length > 0;

              const typeName = info.catalog?.type_name || (entityId.includes(':') ? entityId.split(':')[0] : undefined);
              const color = colorForType(typeName);

              return (
                <div
                  key={entityId}
                  className="rounded border border-white/5 bg-black/20 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => onToggleExpand(entityId)}
                    className="w-full px-2 py-1.5 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
                    disabled={!hasItems}
                    title={hasItems ? (expanded ? 'Collapse' : 'Expand') : 'No attached models'}
                    style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                  >
                    <ChevronRight
                      className={cn(
                        'w-4 h-4 text-white/40 shrink-0 transition-transform',
                        expanded && 'rotate-90',
                        !hasItems && 'opacity-30'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-white/90 truncate">
                        {info.catalog?.name || info.graph_node?.display_name || entityId}
                      </div>
                      <div className="text-[10px] text-white/50 font-mono truncate">{entityId}</div>
                    </div>
                    {hasItems && (
                      <span className="text-[10px] text-white/40 px-1.5 py-0.5 rounded border border-white/10 bg-white/5">
                        {items.length}
                      </span>
                    )}
                  </button>

                  {expanded && hasItems && (
                    <div className="border-t border-white/10 px-1 py-1 space-y-0.5">
                      {items.map((item) => {
                        const isSelected = selectedModel?.entityId === entityId && selectedModel?.extId === item.extId;
                        const hasChildren = item.children && item.children.length > 0;
                        const edgeModelExpanded = hasChildren && expandedEdgeModelKeys.has(item.key);
                        return (
                          <div key={item.key} className="space-y-0.5">
                            <div
                              className={cn(
                                'flex items-center gap-1 rounded px-2 py-1.5 text-[11px] transition-colors group',
                                isSelected ? 'bg-emerald-500/15' : 'hover:bg-white/5'
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => onSelectModel(entityId, item)}
                                className={cn(
                                  'flex-1 text-left flex items-center gap-2 min-w-0',
                                  isSelected ? 'text-emerald-200' : 'text-white/70'
                                )}
                                title={`${item.category}: ${item.label}`}
                              >
                                <span className="text-[9px] uppercase tracking-wider text-white/40 shrink-0">
                                  {item.category}
                                </span>
                                <span className="truncate min-w-0 flex-1">{item.label}</span>
                              </button>

                              {hasChildren && (
                                <button
                                  type="button"
                                  onClick={() => toggleEdgeModelExpanded(item.key)}
                                  className="shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                                  title={edgeModelExpanded ? 'Collapse edges' : 'Expand edges'}
                                >
                                  {edgeModelExpanded ? (
                                    <ChevronUp className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                            {edgeModelExpanded && (
                              <div className="pl-5 pr-1 space-y-1 py-1">
                                {item.children!.map((child) => {
                                  const ctx = child.edgeContext;
                                  if (!ctx) return (
                                    <div
                                      key={child.key}
                                      className="text-[10px] text-white/50 truncate py-0.5"
                                      title={child.label}
                                    >
                                      {child.label}
                                    </div>
                                  );

                                  const backingEdge = edgeById.get(ctx.edge_id);

                                  const edge: import('@/lib/contextual-graph/display').DisplayEdge = {
                                    id: ctx.edge_id,
                                    source_id: ctx.source_id,
                                    target_id: ctx.target_id,
                                    type: ctx.edge_type,
                                    labels: [],
                                    label: child.label,
                                    detail: backingEdge?.detail || backingEdge?.label || ctx.edge_id,
                                    properties: {},
                                    modelRefs: [],
                                  };

                                  const sourceInfo = entityInfoMap?.[ctx.source_id];
                                  const targetInfo = entityInfoMap?.[ctx.target_id];
                                  const sourceLabel =
                                    sourceInfo?.catalog?.name ||
                                    sourceInfo?.graph_node?.display_name ||
                                    entityNameById.get(ctx.source_id) ||
                                    contextualNodeNameById.get(ctx.source_id) ||
                                    ctx.source_id;
                                  const targetLabel =
                                    targetInfo?.catalog?.name ||
                                    targetInfo?.graph_node?.display_name ||
                                    entityNameById.get(ctx.target_id) ||
                                    contextualNodeNameById.get(ctx.target_id) ||
                                    ctx.target_id;

                                  return (
                                    <EdgeListRow
                                      key={child.key}
                                      edge={edge}
                                      sourceLabel={sourceLabel}
                                      targetLabel={targetLabel}
                                      onClick={() => onSelectModel(entityId, item)}
                                    />
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
          ) : null}
        </div>
      </PanelContent>
    </Panel>
  );
}
