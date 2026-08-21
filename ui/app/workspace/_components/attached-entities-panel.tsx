'use client';

import { useMemo } from 'react';
import { FileText } from 'lucide-react';
import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { EntityInfoCard } from './entity-info-card';
import { type EntityInfoWithContent } from './model-content-utils';

export interface AttachedEntitiesPanelProps {
  entityIds: string[];
  entityInfoMap: Record<string, EntityInfoWithContent> | null;
  loading: boolean;
  expandedEntityIds: Set<string>;
  selectedModelKeys: Record<string, string | null>;
  scopeEntityIds?: string[];
  manuallyAttachedIds?: string[];
  onDetach: (entityId: string) => void;
  onToggleExpand: (entityId: string) => void;
  onSelectModel: (entityId: string, key: string) => void;
}

export function AttachedEntitiesPanel({
  entityIds,
  entityInfoMap,
  loading,
  expandedEntityIds,
  selectedModelKeys,
  scopeEntityIds = [],
  manuallyAttachedIds = [],
  onDetach,
  onToggleExpand,
  onSelectModel,
}: AttachedEntitiesPanelProps) {
  const scopeSet = useMemo(() => new Set(scopeEntityIds), [scopeEntityIds]);
  const manualSet = useMemo(() => new Set(manuallyAttachedIds), [manuallyAttachedIds]);

  const sortedIds = useMemo(() => {
    return [...entityIds].sort((a, b) => {
      const aScope = scopeSet.has(a) ? 2 : manualSet.has(a) ? 1 : 0;
      const bScope = scopeSet.has(b) ? 2 : manualSet.has(b) ? 1 : 0;
      if (aScope !== bScope) return bScope - aScope;
      return a.localeCompare(b);
    });
  }, [entityIds, scopeSet, manualSet]);

  return (
    <Panel className="flex-1">
      <PanelHeader
        title="Contextual data"
        count={entityIds.length > 0 ? entityIds.length : undefined}
      />
      <PanelContent className="p-0">
        <div className="absolute inset-0 overflow-y-auto p-3 space-y-2">
          {entityIds.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-white/40 text-sm px-6 text-center gap-3">
              <div className="flex items-center gap-2 text-white/50">
                <FileText className="w-5 h-5" />
                <span>Contextual data</span>
              </div>
              <p className="text-xs max-w-md">
                Type an entity id with [[...]] in the Reflect query to attach it, or set session scope to see model content here.
              </p>
            </div>
          ) : loading ? (
            <div className="h-full flex items-center justify-center text-white/40 text-xs">Loading entity info…</div>
          ) : entityInfoMap ? (
            sortedIds.map((id) => {
              const info = entityInfoMap[id];
              if (!info) return null;
              return (
                <EntityInfoCard
                  key={id}
                  id={id}
                  info={info}
                  onDetach={() => onDetach(id)}
                  expanded={expandedEntityIds.has(id)}
                  onToggleExpand={() => onToggleExpand(id)}
                  selectedModelKey={selectedModelKeys[id] ?? null}
                  onSelectModel={(key) => onSelectModel(id, key)}
                  origin={scopeSet.has(id) ? 'scope' : manualSet.has(id) ? 'manual' : 'derived'}
                />
              );
            })
          ) : null}
        </div>
      </PanelContent>
    </Panel>
  );
}
