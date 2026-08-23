'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { MODEL_TAB_LABELS } from './model-content-utils';
import { type EntityInfo } from '@/lib/api/client';

export interface ModelItem {
  key: string;
  label: string;
  extId: string;
  category: string;
  children?: Array<{ key: string; label: string }>;
}

export interface AttachedEntitiesPanelProps {
  entityIds: string[];
  entityInfoMap: Record<string, EntityInfo> | null;
  loading: boolean;
  expandedEntityIds: Set<string>;
  selectedModel: { entityId: string; extId: string } | null;
  onToggleExpand: (entityId: string) => void;
  onSelectModel: (entityId: string, item: ModelItem) => void;
}

function getEntityModelItems(info: EntityInfo): ModelItem[] {
  const items: ModelItem[] = [];

  info.contextual_refs.forEach((ref, i) => {
    if (!ref.ext_id) return;
    items.push({
      key: `ctx-${ref.role}-${ref.ext_id || i}`,
      label: ref.ext_id,
      extId: ref.ext_id,
      category: MODEL_TAB_LABELS.contextual_refs,
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
  const edgeContextsByExtId = new Map<string, EntityInfo['edge_contexts']>();
  for (const ctx of info.edge_contexts) {
    const extId = ctx.refs[0]?.ext_id;
    if (!extId) continue;
    if (!edgeContextsByExtId.has(extId)) edgeContextsByExtId.set(extId, []);
    edgeContextsByExtId.get(extId)!.push(ctx);
  }

  edgeContextsByExtId.forEach((contexts, extId) => {
    items.push({
      key: `edge-${extId}`,
      label: extId,
      extId,
      category: MODEL_TAB_LABELS.edge_contexts,
      children: contexts.map((ctx) => ({
        key: `edge-child-${ctx.edge_id || `${ctx.source_id}-${ctx.target_id}`}`,
        label: `${ctx.source_id} → ${ctx.target_id}`,
      })),
    });
  });

  return items;
}

export function AttachedEntitiesPanel({
  entityIds,
  entityInfoMap,
  loading,
  expandedEntityIds,
  selectedModel,
  onToggleExpand,
  onSelectModel,
}: AttachedEntitiesPanelProps) {
  const sortedIds = useMemo(() => {
    return [...entityIds].sort((a, b) => a.localeCompare(b));
  }, [entityIds]);

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
              const items = getEntityModelItems(info);
              const expanded = expandedEntityIds.has(entityId);
              const hasItems = items.length > 0;

              return (
                <div
                  key={entityId}
                  className="rounded-md border border-white/10 bg-black/20 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => onToggleExpand(entityId)}
                    className="w-full px-2.5 py-2 flex items-center gap-2 text-left hover:bg-white/5 transition-colors"
                    disabled={!hasItems}
                    title={hasItems ? (expanded ? 'Collapse' : 'Expand') : 'No attached models'}
                  >
                    <ChevronRight
                      className={cn(
                        'w-4 h-4 text-emerald-400/70 shrink-0 transition-transform',
                        expanded && 'rotate-90',
                        !hasItems && 'opacity-30'
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-emerald-200 truncate">
                        {info.catalog?.name || info.graph_node?.display_name || entityId}
                      </div>
                      <div className="text-xs text-white/50 truncate">{entityId}</div>
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
                            <button
                              type="button"
                              onClick={() => {
                                if (hasChildren) {
                                  toggleEdgeModelExpanded(item.key);
                                }
                                onSelectModel(entityId, item);
                              }}
                              className={cn(
                                'w-full text-left rounded px-2 py-1.5 text-[11px] transition-colors flex items-center gap-2',
                                isSelected
                                  ? 'bg-emerald-500/15 text-emerald-200'
                                  : 'text-white/70 hover:bg-white/5'
                              )}
                              title={`${item.category}: ${item.label}`}
                            >
                              {hasChildren && (
                                <ChevronRight
                                  className={cn(
                                    'w-3 h-3 text-emerald-400/70 shrink-0 transition-transform',
                                    edgeModelExpanded && 'rotate-90'
                                  )}
                                />
                              )}
                              <span className="text-[9px] uppercase tracking-wider text-white/40 shrink-0">
                                {item.category}
                              </span>
                              <span className="truncate min-w-0 flex-1">{item.label}</span>
                            </button>
                            {edgeModelExpanded && (
                              <div className="pl-5 pr-1 space-y-0.5">
                                {item.children!.map((child) => (
                                  <div
                                    key={child.key}
                                    className="text-[10px] text-white/50 truncate py-0.5"
                                    title={child.label}
                                  >
                                    {child.label}
                                  </div>
                                ))}
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
