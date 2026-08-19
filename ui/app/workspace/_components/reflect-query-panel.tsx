'use client';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AqlEditor, type EntityLike as AqlEntityLike, type EdgeLike as AqlEdgeLike } from '@/components/aql-editor';
import { Sparkles } from 'lucide-react';
import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { type EntityInfoWithContent } from './model-content-utils';

interface ReflectQueryPanelProps {
  query: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  attachedEntityIds: string[];
  entityInfoMap: Record<string, EntityInfoWithContent> | null;
  aqlEntities: AqlEntityLike[];
  aqlEdges: AqlEdgeLike[];
  onDetachEntity: (entityId: string) => void;
  disabled: boolean;
}

export function ReflectQueryPanel({
  query,
  onChange,
  onSubmit,
  attachedEntityIds,
  entityInfoMap,
  aqlEntities,
  aqlEdges,
  onDetachEntity,
  disabled,
}: ReflectQueryPanelProps) {
  return (
    <Panel className="flex-1">
      <PanelHeader title="Reflect query" />
      <PanelContent className="p-3">
        <div className="absolute inset-0 p-3 flex flex-col gap-2">
          <AqlEditor
            value={query}
            onChange={onChange}
            onSubmit={onSubmit}
            disabled={false}
            placeholder="Ask Reflect... Type [[ to reference an entity."
            availableEntities={aqlEntities}
            availableEdges={aqlEdges}
            includeEdges={false}
            className="flex-1 min-h-0 w-full rounded-lg border border-white/20 bg-transparent"
          />
          {attachedEntityIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachedEntityIds.map((id) => (
                <Badge
                  key={id}
                  variant="secondary"
                  className="gap-1 px-2 py-1 text-xs cursor-pointer hover:bg-white/20"
                  onClick={() => onDetachEntity(id)}
                  title="Click to remove"
                >
                  {entityInfoMap?.[id]?.graph_node?.display_name || id}
                  <span className="text-white/50">×</span>
                </Badge>
              ))}
            </div>
          )}
          <Button
            size="sm"
            className="gap-1.5 w-full"
            disabled={disabled}
            onClick={onSubmit}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Reflect
          </Button>
        </div>
      </PanelContent>
    </Panel>
  );
}
