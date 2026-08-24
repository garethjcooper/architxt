'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Entity } from '@/lib/types';

interface EntityScopePanelProps {
  entities: Entity[];
  scopeEntityIds: string[];
  onRemove: (entityId: string) => void;
  onManage: () => void;
  loading?: boolean;
  className?: string;
}

function canonicalEntityId(entity: Entity): string {
  return `${entity.type_name}:${entity.entity_id}`;
}

export function EntityScopePanel({
  entities,
  scopeEntityIds,
  onRemove,
  onManage,
  loading,
  className,
}: EntityScopePanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const scopeSet = useMemo(() => new Set(scopeEntityIds), [scopeEntityIds]);

  const inScope = useMemo(() => {
    return entities
      .filter((e) => scopeSet.has(canonicalEntityId(e)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entities, scopeSet]);

  const isEmpty = inScope.length === 0;
  const canExpand = inScope.length > 0;

  return (
    <div
      className={cn(
        'border border-white/10 bg-[oklch(0.23_0_0)] rounded-md flex flex-col overflow-hidden',
        className
      )}
    >
      <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium truncate">Entity scope</span>
          {!loading && (
            <span className="text-[10px] text-emerald-200/70 bg-emerald-900/30 border border-emerald-500/20 rounded px-1.5 py-0.5 shrink-0">
              {inScope.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {canExpand && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded((prev) => !prev)}
              className="h-6 text-[10px] px-2 text-emerald-200/80 hover:text-emerald-100 hover:bg-emerald-900/20"
            >
              {isExpanded ? 'Hide' : 'Show'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onManage}
            className="h-6 text-[10px] px-2 text-emerald-200/80 hover:text-emerald-100 hover:bg-emerald-900/20"
          >
            Manage
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="flex-1 min-h-0 p-2">
          {loading ? (
            <div className="text-white/40 text-xs px-1 py-1">Loading scope...</div>
          ) : isEmpty ? (
            <div className="text-white/40 text-xs px-1 py-1">
              No entities in scope. Click Manage to add some.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
              {inScope.map((entity) => {
                const qid = canonicalEntityId(entity);
                const label = `${qid} ${entity.name}`;

                return (
                  <div
                    key={qid}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] border truncate max-w-[200px] bg-purple-800/15 text-purple-400 border-purple-700/20"
                    title={label}
                  >
                    <span className="truncate">{label}</span>
                    <button
                      onClick={() => onRemove(qid)}
                      className="ml-1 hover:opacity-70 transition-opacity shrink-0"
                      title="Remove from scope"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
