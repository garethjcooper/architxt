'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, FileText, ExternalLink, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { colorForType } from '@/lib/graph/render-utils';

import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { Input } from '@/components/ui/input';
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
  kind: string;
}

const KIND_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'nodes', label: 'Nodes' },
  { value: 'edges', label: 'Edges' },
] as const;

type KindFilter = (typeof KIND_FILTERS)[number]['value'];

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
  filterText?: string;
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
      kind: 'node',
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
      kind: 'node',
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
      kind: 'node',
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

    // Count only physical edges produced by the edge-context model. The
    // undirected skeleton edge that hosts the model ref has cge_type === null
    // and is excluded, matching the manager page's childCount behavior.
    const physicalEdgeIds = new Set(
      contexts
        .filter((c) => c.edge_type !== null)
        .map((c) => c.edge_id),
    );

    items.push({
      key: `edge-${extId}`,
      scopeLabel: 'EDGE',
      roleLabel: firstRefRole ? getRoleLabel(firstRefRole, labelMap) : undefined,
      title,
      extId,
      edgeCount: physicalEdgeIds.size,
      kind: 'edge',
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
  const [filterText, setFilterText] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

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
    const rawQuery = filterText.trim().toLowerCase();
    const tokens = rawQuery ? rawQuery.split(/\s+/).filter(Boolean) : [];
    const matchesQuery = (haystack: string) => {
      if (tokens.length === 0) return true;
      const h = haystack.toLowerCase();
      return tokens.every((t) => h.includes(t));
    };

    return entityIds
      .map((entityId) => {
        const info = entityInfoMap?.[entityId];
        const allItems = info ? getEntityModelItems(info, entityInfoMap, entityNameById, contextualNodeNameById, modelContentCache, roleMaps) : [];
        const node = contextualNodes.find((n) => n.id === entityId);
        const displayName = info?.catalog?.name || info?.graph_node?.display_name || node?.label || entityId;

        const groupMatches = matchesQuery(`${displayName} ${entityId}`);
        let filteredItems = groupMatches
          ? allItems
          : allItems.filter((item) =>
              matchesQuery(
                `${item.title} ${item.extId} ${item.scopeLabel} ${item.roleLabel || ''}`,
              ),
            );

        if (kindFilter !== 'all') {
          filteredItems = filteredItems.filter((item) => item.kind === (kindFilter === 'nodes' ? 'node' : 'edge'));
        }

        return { entityId, info, items: filteredItems, allItemCount: allItems.length, displayName, hasItems: filteredItems.length > 0 };
      })
      .filter((row) => row.hasItems)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [entityIds, entityInfoMap, entityNameById, contextualNodeNameById, contextualNodes, modelContentCache, roleMaps, filterText, kindFilter]);

  const totalItemCount = entityIds.length > 0
    ? entityIds.reduce((sum, entityId) => {
        const info = entityInfoMap?.[entityId];
        if (!info) return sum;
        const allItems = getEntityModelItems(info, entityInfoMap, entityNameById, contextualNodeNameById, modelContentCache, roleMaps);
        return sum + allItems.length;
      }, 0)
    : 0;
  const visibleItemCount = visibleRows.reduce((sum, row) => sum + row.items.length, 0);

  const count = entityIds.length > 0 ? `${totalItemCount} (${visibleItemCount})` : undefined;

  return (
    <Panel className="flex-1">
      <PanelHeader
        title="Contextual data"
        count={count}
        actions={
          <div className="flex items-center gap-1">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setKindFilter(f.value)}
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
      <div className="px-2 py-1 border-b border-border-default bg-surface-card shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
          <Input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search..."
            className="h-7 pl-7 pr-7 text-xs rounded-full bg-surface-card border-2 border-border-default text-foreground-default placeholder:text-foreground-placeholder focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle"
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
                  <p>{filterText.trim() ? 'No matching contextual data.' : 'No contextual models attached yet.'}</p>
                </div>
              ) : (
                visibleRows.map(({ entityId, info, items, allItemCount, displayName, hasItems }) => {
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
                          {allItemCount !== items.length && (
                            <span className="text-foreground-faint"> / {allItemCount}</span>
                          )}
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
                                    {item.edgeCount}
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
