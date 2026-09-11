'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorForType } from '@/lib/graph/render-utils';

import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { type EntityInfo, type Entity } from '@/lib/api/client';
import {
  type DisplayNode,
  getRoleScopeLabel,
  getRoleLabel,
  loadRoleScopeMap,
  type RoleScopeMaps,
} from '@/lib/contextual-graph/display';
import { type ModelContentCacheEntry } from './model-content-utils';

export interface ModelItem {
  key: string;
  scopeLabel: string;
  roleLabel?: string;
  title: string;
  extId: string;
  edgeCount: number;
}

function countModelEdges(contentCache: Record<string, ModelContentCacheEntry> | undefined, extId: string): number | undefined {
  const cached = contentCache?.[extId];
  if (!cached || cached.loading || cached.envelope === undefined) return undefined;
  return cached.envelope?.graph?.edges?.length ?? 0;
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
  modelContentCache?: Record<string, ModelContentCacheEntry>;
}

function getEntityModelItems(
  info: EntityInfo,
  entityInfoMap?: Record<string, EntityInfo> | null,
  entityNameById?: Map<string, string>,
  contextualNodeNameById?: Map<string, string>,
  contentCache?: Record<string, ModelContentCacheEntry>,
  roleMaps?: RoleScopeMaps,
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
  const scopeMap = roleMaps?.roleScopeMap;
  const labelMap = roleMaps?.roleLabelMap;

  // Attached contextual model refs on the graph node.
  info.contextual_refs.forEach((ref, i) => {
    if (!ref.ext_id) return;
    const rolePrefix = ref.role.replace(/^sys_/, '').replace(/_/g, '-') + '-';
    const entityId = ref.ext_id.startsWith(rolePrefix) ? ref.ext_id.slice(rolePrefix.length) : ref.ext_id;
    const title = ref.name || resolveName(entityId);
    items.push({
      key: `ctx-${ref.role}-${ref.ext_id || i}`,
      scopeLabel: getRoleScopeLabel(ref.role, scopeMap),
      roleLabel: getRoleLabel(ref.role, labelMap),
      title,
      extId: ref.ext_id,
      edgeCount: 0,
    });
  });

  // Template-derived mental models linked to the catalog entity.
  info.derived_models.forEach((m) => {
    const extId = m.ext_id || String(m.id);
    items.push({
      key: `derived-${m.id || extId}`,
      scopeLabel: m.template_role ? getRoleScopeLabel(m.template_role, scopeMap) : 'DERIVED',
      roleLabel: m.template_role ? getRoleLabel(m.template_role, labelMap) : undefined,
      title: m.name || extId,
      extId,
      edgeCount: 0,
    });
  });

  // Plain mental models linked to the catalog entity.
  info.plain_models.forEach((m) => {
    const extId = m.ext_id || String(m.id);
    items.push({
      key: `plain-${m.id || extId}`,
      scopeLabel: 'PLAIN',
      roleLabel: m.template_role ? getRoleLabel(m.template_role, labelMap) : undefined,
      title: m.name || extId,
      extId,
      edgeCount: 0,
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

    let title: string;
    if (hindsightCtx) {
      const sourceLabel = resolveName(hindsightCtx.source_id);
      const targetLabel = resolveName(hindsightCtx.target_id);
      title = `${sourceLabel} → ${targetLabel}`;
    } else {
      const scopePart = extId.startsWith('edge-ctx-') ? extId.slice('edge-ctx-'.length) : extId;
      const [sourceId, targetId] = scopePart.split('|');
      const sourceLabel = sourceId ? resolveName(sourceId) : extId;
      const targetLabel = targetId ? resolveName(targetId) : '';
      title = targetLabel ? `${sourceLabel} → ${targetLabel}` : sourceLabel;
    }

    const firstRefRole = contexts[0]?.refs[0]?.role;

    items.push({
      key: `edge-${extId}`,
      scopeLabel: 'EDGE',
      roleLabel: firstRefRole ? getRoleLabel(firstRefRole, labelMap) : undefined,
      title,
      extId,
      edgeCount: countModelEdges(contentCache, extId) ?? contexts.length,
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
  modelContentCache,
}: AttachedEntitiesPanelProps) {
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

  const [roleMaps, setRoleMaps] = useState<RoleScopeMaps>({ roleScopeMap: {}, roleLabelMap: {} });

  useEffect(() => {
    loadRoleScopeMap().then(setRoleMaps).catch(() => {
      // ignore; helpers fall back to role-id formatting
    });
  }, []);

  const visibleRows = useMemo(() => {
    return entityIds
      .map((entityId) => {
        const info = entityInfoMap?.[entityId];
        const items = info ? getEntityModelItems(info, entityInfoMap, entityNameById, contextualNodeNameById, modelContentCache, roleMaps) : [];
        const node = contextualNodes.find((n) => n.id === entityId);
        const displayName = info?.catalog?.name || info?.graph_node?.display_name || node?.label || entityId;
        return { entityId, info, items, displayName, hasItems: items.length > 0 };
      })
      .filter((row) => row.hasItems)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [entityIds, entityInfoMap, entityNameById, contextualNodeNameById, contextualNodes, modelContentCache, roleMaps]);

  return (
    <Panel className="flex-1">
      <PanelHeader
        title="Contextual data"
        count={entityIds.length > 0 ? visibleRows.length : undefined}
      />
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {entityIds.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-foreground-subtle text-sm px-6 text-center gap-3">
                <div className="flex items-center gap-2 text-foreground-subtle">
                  <FileText className="w-5 h-5" />
                  <span>Contextual data</span>
                </div>
                <p className="text-xs max-w-md">
                  Select a server and bank to load contextual graph data.
                </p>
              </div>
            ) : loading ? (
              <div className="h-full flex items-center justify-center text-foreground-subtle text-xs">Loading entity info…</div>
            ) : entityInfoMap ? (
              visibleRows.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-foreground-subtle text-xs px-6 text-center gap-2">
                  <p>No contextual models attached yet.</p>
                </div>
              ) : (
                visibleRows.map(({ entityId, info, items, displayName, hasItems }) => {
                  const expanded = expandedEntityIds.has(entityId);
                  const typeName = info?.catalog?.type_name || (entityId.includes(':') ? entityId.split(':')[0] : undefined);
                  const color = colorForType(typeName);

                  return (
                    <div
                      key={entityId}
                      className="rounded border border-border-subtle bg-surface-inset overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => onToggleExpand(entityId)}
                        className="w-full px-2 py-1.5 flex items-center gap-2 text-left hover:bg-surface-card transition-colors"
                        title={expanded ? 'Collapse' : 'Expand'}
                        style={{ borderLeftColor: color, borderLeftWidth: 3 }}
                      >
                        {expanded ? (
                          <ChevronUp className={cn('w-4 h-4 text-foreground-subtle shrink-0')} />
                        ) : (
                          <ChevronDown className={cn('w-4 h-4 text-foreground-subtle shrink-0')} />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-foreground-default truncate">
                            {displayName}
                          </div>
                          <div className="text-[10px] text-foreground-subtle font-mono truncate">{entityId}</div>
                        </div>
                        <span className="text-[10px] text-foreground-subtle px-1.5 py-0.5 rounded border border-border-default bg-surface-card">
                          {items.length}
                        </span>
                      </button>

                      {expanded && hasItems && (
                        <div className="border-t border-border-default px-1 py-1 space-y-0.5">
                          {items.map((item) => {
                            const isSelected = selectedModel?.entityId === entityId && selectedModel?.extId === item.extId;
                            return (
                              <div
                                key={item.key}
                                className={cn(
                                  'flex items-center gap-2 rounded px-2 py-1.5 text-[11px] transition-colors',
                                  isSelected ? 'bg-accent-primary-bg text-accent-primary-fg' : 'text-foreground-faint hover:bg-surface-card'
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelectModel(entityId, item)}
                                  className="flex-1 text-left flex items-center gap-2 min-w-0"
                                  title={`${item.scopeLabel} · ${item.roleLabel || '-'} · ${item.title}`}
                                >
                                  <span className="text-[9px] uppercase tracking-wider text-foreground-subtle shrink-0">
                                    {item.scopeLabel}
                                  </span>
                                  {item.roleLabel && (
                                    <span className="text-[9px] uppercase tracking-wider text-accent-primary-fg/80 shrink-0">
                                      {item.roleLabel}
                                    </span>
                                  )}
                                  <span className="truncate min-w-0 flex-1">{item.title}</span>
                                </button>
                                {item.edgeCount !== undefined && item.edgeCount > 0 && (
                                  <span
                                    className="text-[9px] text-foreground-subtle px-1 py-0.5 rounded border border-border-default bg-surface-card shrink-0"
                                    title={`${item.edgeCount} physical edge${item.edgeCount === 1 ? '' : 's'} in this edge context`}
                                  >
                                    {item.edgeCount} edge{item.edgeCount === 1 ? '' : 's'}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectModel(entityId, item, true);
                                  }}
                                  className="shrink-0 h-5 w-5 inline-flex items-center justify-center rounded text-foreground-subtle hover:text-foreground-default hover:bg-surface-panel ml-1"
                                  title="Open in new tab"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )
            ) : null}
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
