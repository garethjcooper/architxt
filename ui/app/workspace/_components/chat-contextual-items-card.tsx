'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileText, Search, X } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { colorForType, getRoleScopeLabel, getRoleLabel, loadRoleScopeMap, type RoleScopeMaps } from '@/lib/contextual-graph/display';
import { type AgentChatQueryState, entityInfoApi, type EntityInfo } from '@/lib/api/client';
import { type ModelItem } from './attached-entities-panel';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import React from 'react';

const logger = createLogger('ChatContextualItemsCard');

export interface ChatContextualItemsCardProps {
  contextualItems?: AgentChatQueryState['contextual_items'] | null;
  createdAt?: string | null;
  serverId?: number | null;
  bankId?: string | null;
  onSelectModel: (entityId: string, item: ModelItem, openInNewTab?: boolean) => void;
}

interface FlatItem extends ModelItem {
  entityId: string;
  entityName: string;
  entityType: string | null;
  kind: string;
}

const KIND_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'nodes', label: 'Nodes' },
  { value: 'edges', label: 'Edges' },
] as const;

type KindFilter = (typeof KIND_FILTERS)[number]['value'];

const ROLE_SCOPE_ORDER: Record<string, number> = {
  sys_entity_summary: 0,
  sys_entity_capabilities: 1,
  sys_discovery: 2,
  sys_edge_context: 3,
};

function scopeOrder(role: string): number {
  return ROLE_SCOPE_ORDER[role] ?? 99;
}

function parseEntityType(entityId: string): string | null {
  if (!entityId || typeof entityId !== 'string') return null;
  const idx = entityId.indexOf(':');
  return idx > 0 ? entityId.slice(0, idx) : null;
}

function stripTypePrefix(id: string): string {
  if (!id) return id;
  const idx = id.indexOf(':');
  return idx > 0 ? id.slice(idx + 1) : id;
}

function resolveEntityName(entityInfoMap: Record<string, EntityInfo> | null, entityId: string): string {
  if (!entityInfoMap) return stripTypePrefix(entityId);
  const info = entityInfoMap[entityId];
  return info?.catalog?.name || info?.graph_node?.display_name || stripTypePrefix(entityId);
}

function ChatContextualItemsCardImpl({ contextualItems, createdAt, serverId, bankId, onSelectModel }: ChatContextualItemsCardProps) {
  const [roleMaps, setRoleMaps] = useState<RoleScopeMaps>({ roleScopeMap: {}, roleLabelMap: {} });
  const [entityInfoMap, setEntityInfoMap] = useState<Record<string, EntityInfo> | null>(null);
  const [filterText, setFilterText] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  const queryState = useMemo(() => {
    if (!contextualItems || contextualItems.length === 0) return null;
    return { contextual_items: contextualItems, created_at: createdAt ?? new Date().toISOString() };
  }, [contextualItems, createdAt]);

  useEffect(() => {
    loadRoleScopeMap().then(setRoleMaps).catch(() => {
      // ignore; helpers fall back to role-id formatting
    });
  }, []);

  useEffect(() => {
    const items = queryState?.contextual_items ?? [];
    if (items.length === 0 || !serverId || !bankId) {
      // Defer reset to avoid synchronous setState in effect body.
      const timeout = setTimeout(() => setEntityInfoMap(null), 0);
      return () => clearTimeout(timeout);
    }

    const ids = new Set<string>();
    items.forEach((item) => {
      if (item.entity_id) ids.add(item.entity_id);
      if (item.source_id) ids.add(item.source_id);
      if (item.target_id) ids.add(item.target_id);
    });

    const idList = Array.from(ids);

    let cancelled = false;
    const load = async () => {
      if (idList.length === 0) {
        setEntityInfoMap({});
        return;
      }
      try {
        const BATCH_SIZE = 100;
        const batches: string[][] = [];
        for (let i = 0; i < idList.length; i += BATCH_SIZE) {
          batches.push(idList.slice(i, i + BATCH_SIZE));
        }
        const results = await Promise.all(
          batches.map((batch) => entityInfoApi.info(serverId, bankId, batch, false)),
        );
        if (cancelled) return;
        const merged: Record<string, EntityInfo> = {};
        for (const res of results) {
          if (res.entities) {
            Object.assign(merged, res.entities);
          }
        }
        setEntityInfoMap(merged);
      } catch (err) {
        if (cancelled) return;
        logger.error('Failed to load entity info for contextual items', err);
        toast.error('Failed to load entity names');
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [queryState, serverId, bankId]);

  const flatItems = useMemo((): FlatItem[] => {
    const items = queryState?.contextual_items ?? [];
    if (items.length === 0) return [];

    const seenExtIds = new Set<string>();
    const result: FlatItem[] = [];

    items.forEach((item) => {
      const extId = item.ext_id;
      if (seenExtIds.has(extId)) return;
      seenExtIds.add(extId);

      const scope = getRoleScopeLabel(item.role, roleMaps.roleScopeMap);
      const roleLabel = getRoleLabel(item.role, roleMaps.roleLabelMap);
      const sourceId = item.source_id || '';
      const targetId = item.target_id || '';
      const entityId = item.entity_id || sourceId || extId;
      let entityName: string;
      let entityType: string | null = null;

      if (sourceId && targetId) {
        const sourceName = resolveEntityName(entityInfoMap, sourceId);
        const targetName = resolveEntityName(entityInfoMap, targetId);
        const sourceKey = stripTypePrefix(sourceId);
        const targetKey = stripTypePrefix(targetId);
        entityName = sourceKey <= targetKey ? `${sourceName} ↔ ${targetName}` : `${targetName} ↔ ${sourceName}`;
        entityType = parseEntityType(targetId) || parseEntityType(sourceId);
      } else if (entityId) {
        entityName = resolveEntityName(entityInfoMap, entityId);
        entityType = parseEntityType(entityId);
      } else {
        entityName = item.name;
      }

      result.push({
        key: `${item.kind || item.role}-${extId}-${item.entity_id || ''}-${sourceId}-${targetId}`,
        scopeLabel: scope,
        roleLabel,
        title: item.name,
        extId,
        edgeCount: 0,
        entityId,
        entityName,
        entityType,
        kind: item.kind || '',
      });
    });

    return result.sort((a, b) => {
      const scopeDiff = scopeOrder(a.roleLabel || '') - scopeOrder(b.roleLabel || '');
      if (scopeDiff !== 0) return scopeDiff;
      return a.title.localeCompare(b.title);
    });
  }, [queryState, roleMaps, entityInfoMap]);

  const filteredFlatItems = useMemo(() => {
    let items = flatItems;

    if (kindFilter === 'nodes') {
      items = items.filter((item) => item.kind !== 'edge_context' && Boolean(item.entityId));
    } else if (kindFilter === 'edges') {
      items = items.filter((item) => item.kind === 'edge_context');
    }

    const rawQuery = filterText.trim().toLowerCase();
    const tokens = rawQuery ? rawQuery.split(/\\s+/).filter(Boolean) : [];
    if (tokens.length === 0) return items;
    return items.filter((item) => {
      const text = `${item.entityName} ${item.entityId} ${item.scopeLabel} ${item.roleLabel || ''} ${item.title}`.toLowerCase();
      return tokens.every((t) => text.includes(t));
    });
  }, [flatItems, filterText, kindFilter]);

  const listParentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredFlatItems.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 38,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();

  if ((queryState?.contextual_items?.length ?? 0) === 0) return null;

  return (
    <div className="rounded border border-border-default bg-surface-card overflow-hidden">
      <div className="px-3 py-2 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0 gap-3">
        <span className="text-sm font-medium truncate">Contextual data</span>
        <div className="flex items-center gap-2 shrink-0">
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
          <Badge variant="outline" className="text-xs font-mono text-accent-primary-fg bg-surface-inset border-accent-primary-bd px-2 py-0.5 rounded">
            {flatItems.length} ({filteredFlatItems.length})
          </Badge>
        </div>
      </div>
      <div className="px-2 py-1">
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
      <div ref={listParentRef} className="max-h-64 overflow-y-auto p-1.5 bg-surface-inset">
        {filteredFlatItems.length === 0 ? (
          <div className="h-24 flex flex-col items-center justify-center text-foreground-subtle text-xs px-4 text-center gap-2">
            <FileText className="w-4 h-4" />
            <span>{filterText.trim() ? 'No matching contextual items.' : 'No contextual models attached to the identified entities.'}</span>
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
            {virtualItems.map((virtualItem) => {
              const item = filteredFlatItems[virtualItem.index];
              const color = colorForType(item.entityType);
              return (
                <div
                  key={item.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  className="flex items-center gap-2 rounded border border-border-subtle bg-surface-card px-2 py-1.5 text-[11px] hover:bg-surface-hover transition-colors absolute inset-x-0"
                  style={{
                    top: 0,
                    transform: `translateY(${virtualItem.start}px)`,
                    borderLeftColor: color,
                    borderLeftWidth: 3,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onSelectModel(item.entityId, item)}
                    className="flex-1 text-left flex flex-col gap-0.5 min-w-0"
                    title={`${item.entityName} \u00b7 ${item.scopeLabel} \u00b7 ${item.roleLabel || '-'} \u00b7 ${item.title}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-foreground-default truncate">{item.entityName}</span>
                      <span className="text-[9px] uppercase tracking-wider text-foreground-subtle shrink-0">{item.scopeLabel}</span>
                      {item.roleLabel && (
                        <span className="text-[9px] uppercase tracking-wider text-accent-primary-fg/80 shrink-0">
                          {item.roleLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-foreground-faint font-mono truncate">{item.entityId}</span>
                      <span className="text-[10px] text-foreground-subtle truncate flex-1">{item.title}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectModel(item.entityId, item, true);
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
    </div>
  );
}

export const ChatContextualItemsCard = React.memo(ChatContextualItemsCardImpl);
