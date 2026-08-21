'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Panel, PanelHeader, PanelContent } from './panel-layout';
import { colorForType } from '@/components/research-canvas';
import type { Entity } from '@/lib/types';

interface EntityScopePanelProps {
  entities: Entity[];
  scopeEntityIds: string[];
  onToggle: (entityId: string, inScope: boolean) => void;
  loading?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

function canonicalEntityId(entity: Entity): string {
  return `${entity.type_name}:${entity.entity_id}`;
}

export function EntityScopePanel({
  entities,
  scopeEntityIds,
  onToggle,
  loading,
  style,
  className,
}: EntityScopePanelProps) {
  const [search, setSearch] = useState('');
  const scopeSet = useMemo(() => new Set(scopeEntityIds), [scopeEntityIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.entity_id.toLowerCase().includes(q) ||
        e.type_name.toLowerCase().includes(q)
    );
  }, [entities, search]);

  return (
    <Panel className={cn('flex-1', className)} style={style}>
      <PanelHeader title="Entity scope" count={scopeEntityIds.length} />
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          <div className="px-2 py-2 border-b border-white/10 shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
              <Input
                placeholder="Filter entities..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 text-xs bg-black/20 border-white/10 pl-7"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
            {loading ? (
              <div className="text-white/40 text-xs px-2 py-2">Loading entities…</div>
            ) : filtered.length === 0 ? (
              <div className="text-white/40 text-xs px-2 py-2">
                {entities.length === 0 ? 'No entities in the Architxt app list.' : 'No entities match your filter.'}
              </div>
            ) : (
              filtered.map((entity) => {
                const id = canonicalEntityId(entity);
                const inScope = scopeSet.has(id);
                const color = colorForType(entity.type_name);
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex items-center gap-2 rounded border px-2 py-1.5 text-xs cursor-pointer transition-colors',
                      inScope
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-black/20 border-white/5 hover:bg-white/5'
                    )}
                    title={id}
                  >
                    <Checkbox
                      checked={inScope}
                      onCheckedChange={(checked) => onToggle(id, checked === true)}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: color }}
                        />
                        <span className="truncate font-medium text-white/90">{entity.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate text-white/50">{entity.entity_id}</span>
                        <Badge variant="outline" className="text-[9px] h-3 px-1 border-white/20 text-white/50 shrink-0">
                          {entity.type_name}
                        </Badge>
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
