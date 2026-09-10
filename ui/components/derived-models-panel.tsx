'use client';

import { useCallback, useMemo, useState } from 'react';
import type { DerivedMentalModel, MentalModel } from '@/lib/types/index';
import { Skeleton } from '@/components/ui/skeleton';
import { Settings2, Activity, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useMultiSelect } from '@/hooks/useMultiSelect';

interface DerivedModelsPanelProps {
  model: MentalModel;
  derived: DerivedMentalModel[];
  loading?: boolean;
  onConfigure?: (derived: DerivedMentalModel[]) => void;
  onHealth: (derived: DerivedMentalModel[]) => void;
  className?: string;
}

export function DerivedModelsPanel({
  model,
  derived,
  loading = false,
  onConfigure,
  onHealth,
  className,
}: DerivedModelsPanelProps) {
  const [search, setSearch] = useState('');
  const {
    toggleSelection,
    isSelected,
    setSelected,
    selectionCount,
  } = useMultiSelect(derived);

  const filteredDerived = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return derived;
    return derived.filter((d) => {
      const entity = d.derived_entity;
      const idText = (d.ext_id || entity.entity_id || '').toLowerCase();
      const nameText = (d.name || '').toLowerCase();
      const entityText = `${entity.entity_id} ${entity.name}`.toLowerCase();
      const tokensText = String(d.max_tokens ?? '').toLowerCase();
      return idText.includes(q) || nameText.includes(q) || entityText.includes(q) || tokensText.includes(q);
    });
  }, [derived, search]);

  const visibleIds = useMemo(() => filteredDerived.map((d) => d.id), [filteredDerived]);

  const isAllVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => isSelected(id));
  const isSomeVisibleSelected = visibleIds.length > 0 && visibleIds.some((id) => isSelected(id)) && !isAllVisibleSelected;

  const toggleAllVisible = useCallback(() => {
    setSelected((prevSelected) => {
      const next = new Set(prevSelected);
      if (visibleIds.every((id) => next.has(id))) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [setSelected, visibleIds]);

  const rows = useMemo(() => filteredDerived.map((d) => ({ key: d.id, data: d })), [filteredDerived]);

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="px-3 py-2 border-b border-white/10 bg-badge-entity-bg/50 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-badge-entity-fg">Derived Instances</h3>
          <p className="text-[10px] text-badge-entity-fg/70">
            {selectionCount > 0 ? `${selectionCount} selected · ` : ''}
            {derived.length} total{search.trim() ? ` · ${filteredDerived.length} shown` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40 pointer-events-none" />
            <Input
              type="search"
              placeholder="Search instances..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 pl-8 pr-2 bg-black/20 border-white/10 text-white/80 placeholder:text-white/40 text-xs"
            />
          </div>
          <Button
            onClick={() => onHealth(derived.filter((d) => isSelected(d.id)))}
            disabled={selectionCount === 0}
            title="Check Hindsight content health"
            className="h-7 px-2 text-xs bg-purple-600 hover:bg-badge-entity-fg text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Activity className="h-3.5 w-3.5" />
            Health
          </Button>
          {onConfigure && (
            <Button
              onClick={() => onConfigure(derived.filter((d) => isSelected(d.id)))}
              disabled={selectionCount === 0}
              className="h-7 px-2 text-xs bg-purple-600 hover:bg-badge-entity-fg text-white disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Config
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <Table className="w-full caption-bottom text-sm table-fixed">
          <TableHeader>
            <TableRow className="border-b border-white/10 hover:bg-transparent">
              <TableHead className="w-8 py-1.5 px-3">
                <Checkbox checked={isAllVisibleSelected} data-indeterminate={isSomeVisibleSelected || undefined} onCheckedChange={toggleAllVisible} />
              </TableHead>
              <TableHead className="w-[22%] text-xs uppercase text-white/60 font-medium py-1.5 px-3">ID</TableHead>
              <TableHead className="w-[20%] text-xs uppercase text-white/60 font-medium py-1.5 px-3">Name</TableHead>
              <TableHead className="w-16 text-xs uppercase text-white/60 font-medium py-1.5 px-3">Refresh</TableHead>
              <TableHead className="w-14 text-xs uppercase text-white/60 font-medium py-1.5 px-3">After</TableHead>
              <TableHead className="w-14 text-xs uppercase text-white/60 font-medium py-1.5 px-3">Exclude</TableHead>
              <TableHead className="w-16 text-xs uppercase text-white/60 font-medium py-1.5 px-3">Tokens</TableHead>
              <TableHead className="text-xs uppercase text-white/60 font-medium py-1.5 px-3">Entity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i} className="border-b border-white/5">
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-4" /></TableCell>
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-8" /></TableCell>
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-10" /></TableCell>
                  <TableCell className="py-1.5 px-3"><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-xs text-white/50">
                  {search.trim() ? 'No derived instances match your search.' : 'No derived instances. Add entities to this template to generate them.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const selected = isSelected(row.data.id);
                const d = row.data;
                const entity = d.derived_entity;

                return (
                  <TableRow
                    key={row.key}
                    onClick={() => toggleSelection(row.data.id)}
                    className={`border-b border-white/5 transition-colors cursor-pointer ${
                      selected ? 'bg-purple-900/20' : 'hover:bg-white/5'
                    }`}
                  >
                    <TableCell className="py-1.5 px-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleSelection(row.data.id)}
                      />
                    </TableCell>
                    <TableCell
                      className="py-1.5 px-3 font-mono text-xs truncate"
                      title={d.ext_id || entity.entity_id}
                    >
                      {d.ext_id || entity.entity_id}
                    </TableCell>
                    <TableCell
                      className="py-1.5 px-3 text-xs text-white/80 truncate"
                      title={d.name || '-'}
                    >
                      {d.name || '-'}
                    </TableCell>
                    <TableCell className="py-1.5 px-3 text-xs">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border bg-slate-700/40 text-white/80 border-slate-600">
                        {d.refresh_mode === 'delta' ? 'Delta' : 'Full'}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 px-3 text-xs">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                          d.refresh_after_consolidation
                            ? 'bg-accent-primary-fg/15 text-accent-primary-fg border-accent-secondary-bd'
                            : 'bg-slate-700/40 text-white/60 border-slate-600'
                        }`}
                      >
                        {d.refresh_after_consolidation ? 'ON' : 'OFF'}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 px-3 text-xs">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                          d.exclude_all_mental_models
                            ? 'bg-accent-primary-fg/15 text-accent-primary-fg border-accent-secondary-bd'
                            : 'bg-slate-700/40 text-white/60 border-slate-600'
                        }`}
                      >
                        {d.exclude_all_mental_models ? 'ON' : 'OFF'}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5 px-3 text-xs">
                      <span className="text-white/60">
                        {d.max_tokens}
                      </span>
                    </TableCell>
                    <TableCell
                      className="py-1.5 px-3 text-xs text-white/60 truncate"
                      title={`${entity.entity_id} — ${entity.name}`}
                    >
                      {entity.entity_id} — {entity.name}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
