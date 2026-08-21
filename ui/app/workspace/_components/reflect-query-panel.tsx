'use client';

import { Button } from '@/components/ui/button';
import { AqlEditor, type EntityLike as AqlEntityLike, type EdgeLike as AqlEdgeLike } from '@/components/aql-editor';
import { Sparkles } from 'lucide-react';
import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { cn } from '@/lib/utils';

interface ReflectQueryPanelProps {
  query: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  aqlEntities: AqlEntityLike[];
  aqlEdges: AqlEdgeLike[];
  disabled: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function ReflectQueryPanel({
  query,
  onChange,
  onSubmit,
  aqlEntities,
  aqlEdges,
  disabled,
  style,
  className,
}: ReflectQueryPanelProps) {
  return (
    <Panel className={cn('flex-1', className)} style={style}>
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
