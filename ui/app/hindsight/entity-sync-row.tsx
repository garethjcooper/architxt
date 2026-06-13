'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { GitCompare } from 'lucide-react';

interface ValueMismatch {
  entity_id: string;
  arch: string;
  hind: string;
}

interface TypeDivergence {
  id_differs: boolean;
  name_differs: boolean;
  description_differs: boolean;
  arch_count: number;
  hind_count: number;
  missing_in_arch: string[];
  missing_in_hind: string[];
  name_mismatches: ValueMismatch[];
  orphan_names?: string[];
  synced_fields?: string[];
}

interface TypeValues {
  type_name: string;
  count: number;
  description?: string;
  values: { entity_id: string; name: string; description?: string }[];
}

interface EntitySyncRowProps {
  ext_id: string;
  arch?: TypeValues;
  hindsight?: TypeValues;
  divergence?: TypeDivergence;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  showCheckbox?: boolean;
  showCompare?: boolean;
  onCompare?: () => void;
}

function TypeDivergenceBadges({ divergence }: { divergence?: TypeDivergence }) {
  if (!divergence) return null;

  const fields = divergence.synced_fields || ['id', 'name', 'desc'];

  const fieldMeta = fields.map((key) => {
    if (key === 'id') return { label: 'id', differs: divergence.id_differs };
    if (key === 'name') return { label: 'name', differs: divergence.name_differs };
    if (key === 'description') return { label: 'desc', differs: divergence.description_differs };
    return { label: key, differs: false };
  });

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {fieldMeta.map((f) => {
        const color = f.differs
          ? 'bg-red-500/15 text-red-300 border-red-500/25'
          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25';
        return (
          <span key={f.label} className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${color}`}>
            {f.label}
          </span>
        );
      })}
    </div>
  );
}

export default function EntitySyncRow({
  ext_id,
  arch,
  hindsight,
  divergence,
  isSelected,
  onSelect,
  showCheckbox = true,
  showCompare,
  onCompare,
}: EntitySyncRowProps) {
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
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-white/60 truncate" title={ext_id}>{ext_id}</span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11px]">
            {arch && (
              <span className="text-white/40 flex-1 truncate" title={arch.description || undefined}>
                architxt: <span className="text-white/60">{arch.count} values</span>
                {arch.description && <span className="text-white/20 ml-1">• {arch.description}</span>}
              </span>
            )}
            {hindsight && (
              <span className="text-white/40 flex-1 truncate" title={hindsight.description || undefined}>
                Bank: <span className="text-white/60">{hindsight.count} values</span>
                {hindsight.description && <span className="text-white/20 ml-1">• {hindsight.description}</span>}
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2">
            <TypeDivergenceBadges divergence={divergence} />
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
