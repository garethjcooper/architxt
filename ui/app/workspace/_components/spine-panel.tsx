'use client';

import { Input } from '@/components/ui/input';
import { EntityListRow, type DisplayNode } from '@/lib/contextual-graph/display';
import { PanelHeader, Panel, PanelContent } from './panel-layout';

interface SpinePanelProps {
  entities: DisplayNode[];
  search: string;
  onSearchChange: (value: string) => void;
}

export function SpinePanel({ entities, search, onSearchChange }: SpinePanelProps) {
  return (
    <Panel className="flex-1">
      <PanelHeader title="Entity spine" count={entities.length} />
      <PanelContent className="p-0">
        <div className="absolute inset-0 overflow-y-auto">
          <div className="p-2">
            <Input
              placeholder="Filter entities..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 text-xs bg-surface-inset border-border-default mb-2"
            />
            <div className="space-y-1 opacity-60">
              {entities.map((entity) => (
                <EntityListRow
                  key={entity.id}
                  node={entity}
                  active={false}
                  onClick={() => {}}
                />
              ))}
            </div>
          </div>
        </div>
      </PanelContent>
    </Panel>
  );
}
