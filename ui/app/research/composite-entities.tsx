'use client';

import type { GraphNode } from '@/lib/api/client';
import { formatEntityToken } from './query-tokens';

export type EntityTab = 'entities' | 'tags' | 'global';

export interface CompositeEntitiesProps {
  entityTab: EntityTab;
  entities: Array<GraphNode & { inScope?: boolean }>;
  globalEntities: GraphNode[];
  bankTags: Array<{ tag: string; count: number }>;
  tagsLoading: boolean;
  onInsertToken: (token: string) => void;
}

export function CompositeEntities(props: CompositeEntitiesProps) {
  const {
    entityTab,
    entities,
    globalEntities,
    bankTags,
    tagsLoading,
    onInsertToken,
  } = props;

  const visibleEntities: Array<GraphNode & { inScope?: boolean }> = entityTab === 'entities'
    ? entities
    : entityTab === 'global'
      ? globalEntities
      : [];

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="overflow-y-auto px-3 py-2 space-y-1 min-h-0 flex-1">
        {entityTab === 'tags' ? (
          tagsLoading ? (
            <p className="text-xs text-white/40">Loading tags...</p>
          ) : bankTags.length > 0 ? (
            bankTags.map((t) => (
              <div
                key={t.tag}
                className="flex items-center gap-1.5 rounded border border-white/5 bg-black/20 px-2 py-1.5 min-h-[2.8125rem]"
              >
                <span
                  className="inline-flex truncate max-w-[150px] px-2.5 py-1 rounded-full text-[10px] border bg-orange-400/20 text-orange-300 border-orange-400/30"
                  title={t.tag}
                >
                  {t.tag}
                </span>
                <span className="text-[10px] text-white/50 font-mono ml-auto">
                  {t.count.toLocaleString()}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-white/40">No tags found.</p>
          )
        ) : visibleEntities.length > 0 ? (
          visibleEntities.map((entity) => {
            const inScope = entity.inScope ?? true;
            return (
              <button
                key={entity.id}
                type="button"
                onDoubleClick={() => onInsertToken(formatEntityToken(entity.label || entity.id, entity.id, entity.type))}
                className={`w-full flex items-center gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors ${
                  inScope
                    ? 'border-white/5 bg-black/20 hover:bg-white/5'
                    : 'border-white/5 bg-black/10 opacity-60 hover:bg-white/5 hover:opacity-80'
                }`}
              >
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <div className="text-xs text-white/90 truncate">{entity.label}</div>
                  <div className="text-[10px] text-white/50 font-mono truncate">
                    {entity.type ? `${entity.type}:${entity.id}` : entity.id}
                  </div>
                </div>
                {!inScope && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white/50 shrink-0">
                    referenced
                  </span>
                )}
              </button>
            );
          })
        ) : (
          <p className="text-xs text-white/40">No {entityTab === 'entities' ? 'selected' : entityTab === 'global' ? 'global' : 'tags'} entities.</p>
        )}
      </div>
    </div>
  );
}
