'use client';

import { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { QueryForm, type EntityLike, type EdgeLike } from '@/app/research/query-form';
import type { ResearchQueryOptions } from '@/app/research/use-research-session';
import { Panel, PanelHeader, PanelContent } from './panel-layout';

interface ReflectQueryPanelProps {
  query: string;
  cursor: number;
  setQuery: (q: string) => void;
  setCursor: (c: number) => void;
  onSubmit: (e?: React.FormEvent) => void;
  aqlEntities: EntityLike[];
  aqlEdges: EdgeLike[];
  loading: boolean;
  queryOptions: ResearchQueryOptions;
  onQueryOptionsChange: (opts: ResearchQueryOptions | ((prev: ResearchQueryOptions) => ResearchQueryOptions)) => void;
  style?: React.CSSProperties;
  className?: string;
}

export function ReflectQueryPanel({
  query,
  cursor,
  setQuery,
  setCursor,
  onSubmit,
  aqlEntities,
  aqlEdges,
  loading,
  queryOptions,
  onQueryOptionsChange,
  style,
  className,
}: ReflectQueryPanelProps) {
  const [showOptions, setShowOptions] = useState(false);

  return (
    <Panel className={className} style={style}>
      <PanelHeader
        title="Reflect"
        actions={
          <label className="flex items-center gap-2 text-[10px] text-white/70 cursor-pointer">
            <Switch
              checked={showOptions}
              onCheckedChange={setShowOptions}
              aria-label="Show query options"
            />
            <span>Options</span>
          </label>
        }
      />
      <PanelContent className="p-0">
        <div className="absolute inset-0 p-2">
          <QueryForm
            query={query}
            setQuery={setQuery}
            cursor={cursor}
            setCursor={setCursor}
            loading={loading}
            isRunning={loading}
            availableEntities={aqlEntities}
            availableEdges={aqlEdges}
            onSubmit={onSubmit}
            queryMode="reflect"
            selectedTemplateRoles={[]}
            setSelectedTemplateRoles={() => {}}
            availableTemplateRoles={[]}
            queryOptions={queryOptions}
            setQueryOptions={onQueryOptionsChange}
            availableMentalModels={[]}
            showOptions={showOptions}
          />
        </div>
      </PanelContent>
    </Panel>
  );
}
