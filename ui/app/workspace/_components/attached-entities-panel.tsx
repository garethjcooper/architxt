'use client';

import { useMemo } from 'react';
import { ChevronRight, FileText, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorForType } from '@/components/research-canvas';

import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { MODEL_TAB_LABELS } from './model-content-utils';
import { type EntityInfo, type Entity } from '@/lib/api/client';
import { type DisplayNode, MODEL_ROLE_LABELS } from '@/lib/contextual-graph/display';

export interface ModelItem {
  key: string;
  label: string;
  extId: string;
  category: string;
  edgeCount?: number;
}

export interface AttachedEntitiesPanelProps {
  entityIds: string[];
  entityInfoMap: Record<string, EntityInfo> | null;
  entities?: Entity[];
  contextualNodes?: DisplayNode[];
  loading: boolean;
  expandedEntityIds: Set<string>;
  selectedModel: { entityId: string; extId: string } | null;
  onToggleExpand: (entityId: string) => void;
  onSelectModel: (entityId: string, item: ModelItem, openInNewTab?: boolean) => void;
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

  // Surface each edge-context mental model as a single simple row showing the
  // source → target scope. The individual physical edges are now rendered in
  // the narrative markdown, so they no longer need a child group here.
  const edgeContextsByExtId = new Map<string, EntityInfo['edge_contexts']>();
  for (const ctx of info.edge_contexts) {
    const extId = ctx.refs[0]?.ext_id;
    if (!extId) continue;
    if (!edgeContextsByExtId.has(extId)) edgeContextsByExtId.set(extId, []);
    edgeContextsByExtId.get(extId)!.push(ctx);
  }

  edgeContextsByExtId.forEach((contexts, extId) => {
    const hindsightCtx = contexts.find((c) => c.origin === 'hindsight');

    let label: string;
    if (hindsightCtx) {
      const sourceLabel = resolveName(hindsightCtx.source_id);
      const targetLabel = resolveName(hindsightCtx.target_id);
      label = `${sourceLabel} → ${targetLabel}`;
    } else {
      const scopePart = extId.startsWith('edge-ctx-') ? extId.slice('edge-ctx-'.length) : extId;
      const [sourceId, targetId] = scopePart.split('|');
      const sourceLabel = sourceId ? resolveName(sourceId) : extId;
      const targetLabel = targetId ? resolveName(targetId) : '';
      label = targetLabel ? `${sourceLabel} → ${targetLabel}` : sourceLabel;
    }

    items.push({
      key: `edge-${extId}`,
      label,
      extId,
      category: MODEL_TAB_LABELS.edge_contexts,
      edgeCount: contexts.length,
    });
  });

  return items;
}

export function AttachedEntitiesPanel({
  entityIds,
  entityInfoMap,
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
                        return (
                          <div
                            key={item.key}
                            className={cn(
                              'flex items-center gap-2 rounded px-2 py-1.5 text-[11px] transition-colors',
                              isSelected ? 'bg-emerald-500/15 text-emerald-200' : 'text-white/70 hover:bg-white/5'
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectModel(entityId, item)}
                              className="flex-1 text-left flex items-center gap-2 min-w-0"
                              title={`${item.category}: ${item.label}`}
                            >
                              <span className="text-[9px] uppercase tracking-wider text-white/40 shrink-0">
                                {item.category}
                              </span>
                              <span className="truncate min-w-0 flex-1">{item.label}</span>
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectModel(entityId, item, true);
                              }}
                              className="shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-white/40 hover:text-white hover:bg-white/10"
                              title="Open in new tab"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </button>
                            {item.edgeCount !== undefined && item.edgeCount > 0 && (
                              <span
                                className="text-[9px] text-white/50 px-1 py-0.5 rounded border border-white/10 bg-white/5 shrink-0"
                                title={`${item.edgeCount} physical edge${item.edgeCount === 1 ? '' : 's'} in this edge context`}
                              >
                                {item.edgeCount} edge{item.edgeCount === 1 ? '' : 's'}
                              </span>
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
