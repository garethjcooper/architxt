'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { GitCompare, Sparkles } from 'lucide-react';

interface MentalModelDivergence {
  name_differs: boolean;
  source_query_differs: boolean;
  tags_differs: boolean;
  max_tokens_differs: boolean;
  refresh_mode_differs: boolean;
  refresh_after_consolidation_differs: boolean;
  exclude_all_mental_models_differs: boolean;
  exclude_mental_model_list_differs: boolean;
  tags_match_mode_differs: boolean;
}

interface MentalModelValues {
  ext_id: string;
  name?: string | null;
  source_query?: string | null;
  is_derived?: boolean;
}

interface MentalModelSyncRowProps {
  ext_id: string;
  arch?: MentalModelValues;
  hindsight?: MentalModelValues;
  divergence?: MentalModelDivergence;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  showCheckbox?: boolean;
  showCompare?: boolean;
  onCompare?: () => void;
}

function MentalModelDivergenceBadges({
  divergence,
  isDerived,
}: {
  divergence?: MentalModelDivergence;
  isDerived?: boolean;
}) {
  if (!divergence) return null;

  const allFields = [
    { label: 'name', key: 'name_differs', supported: !isDerived },
    { label: 'query', key: 'source_query_differs', supported: !isDerived },
    { label: 'tags', key: 'tags_differs', supported: !isDerived },
    { label: 'tokens', key: 'max_tokens_differs', supported: true },
    { label: 'mode', key: 'refresh_mode_differs', supported: true },
    { label: 'after', key: 'refresh_after_consolidation_differs', supported: true },
    { label: 'exclude', key: 'exclude_all_mental_models_differs', supported: true },
    { label: 'ex list', key: 'exclude_mental_model_list_differs', supported: !isDerived },
    { label: 'match', key: 'tags_match_mode_differs', supported: !isDerived },
  ];

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {allFields.map((f) => {
        const differs = (divergence as any)[f.key];
        const color = f.supported
          ? differs
            ? 'bg-red-500/15 text-red-300 border-red-500/25'
            : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
          : 'bg-white/[0.06] text-white/30 border-white/10';
        return (
          <span key={f.label} className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${color}`}>
            {f.label}
          </span>
        );
      })}
    </div>
  );
}

export default function MentalModelSyncRow({
  ext_id,
  arch,
  hindsight,
  divergence,
  isSelected,
  onSelect,
  showCheckbox = true,
  showCompare,
  onCompare,
}: MentalModelSyncRowProps) {
  const archName = arch?.name ?? null;
  const hindName = hindsight?.name ?? null;

  return (
    <div className={`px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors ${isSelected ? 'bg-white/[0.04]' : ''}`}>
      <div className="flex items-start gap-2">
        {showCheckbox && (
          <div className="pt-0.5 shrink-0">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelect(checked === true)}
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-white/60 truncate" title={ext_id}>{ext_id}</span>
            {arch?.is_derived && (
              <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border bg-indigo-500/10 text-indigo-300 border-indigo-500/20 shrink-0" title="Derived from template">
                <Sparkles className="h-3 w-3" />
                derived
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11px]">
            {archName && (
              <span className="text-white/40 flex-1 truncate" title={archName}>
                architxt: <span className="text-white/60">{archName}</span>
              </span>
            )}
            {hindName && (
              <span className="text-white/40 flex-1 truncate" title={hindName}>
                Bank: <span className="text-white/60">{hindName}</span>
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2">
            <MentalModelDivergenceBadges divergence={divergence} isDerived={arch?.is_derived} />
            {showCompare && divergence && (
              <button
                onClick={(e) => { e.stopPropagation(); onCompare?.(); }}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors shrink-0 mt-1"
                title="Compare"
              >
                <GitCompare className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
