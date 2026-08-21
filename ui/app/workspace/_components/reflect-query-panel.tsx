'use client';

import { QueryForm, type EntityLike, type EdgeLike } from '@/app/research/query-form';
import type { ResearchQueryOptions } from '@/app/research/use-research-session';

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
  return (
    <div className={className} style={style}>
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
      />
    </div>
  );
}
