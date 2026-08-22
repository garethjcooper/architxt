'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { type EntityInfoWithContent } from './model-content-utils';

interface EntityInfoCardProps {
  id: string;
  info: EntityInfoWithContent;
  onDetach?: () => void;
  origin?: 'scope' | 'manual' | 'derived';
}

function EntityInfoCard({ id, info, onDetach, origin = 'manual' }: EntityInfoCardProps) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 text-left">
          <div className="text-sm font-medium text-emerald-200 truncate">
            {info.catalog?.name || info.graph_node?.display_name || id}
          </div>
          <div className="text-xs text-white/50 truncate">{id}</div>
        </div>
        {onDetach && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-white/40 hover:text-white shrink-0"
            onClick={onDetach}
          >
            ×
          </Button>
        )}
      </div>

      {info.catalog?.description && (
        <div className="text-xs text-white/70 line-clamp-2">{info.catalog.description}</div>
      )}

      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
          {origin === 'scope' ? 'session scope' : origin === 'manual' ? 'attached' : 'derived'}
        </Badge>
        {info.contextual_refs.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.contextual_refs.length} refs
          </Badge>
        )}
        {info.derived_models.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.derived_models.length} derived
          </Badge>
        )}
        {info.plain_models.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.plain_models.length} plain
          </Badge>
        )}
        {info.edge_contexts.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.edge_contexts.length} edges
          </Badge>
        )}
      </div>
    </div>
  );
}

export { EntityInfoCard, type EntityInfoCardProps };
