'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { GitCompare, Settings } from 'lucide-react';

interface BankSettingsDivergence {
  retain_mission_differs: boolean;
  observations_mission_differs: boolean;
  reflect_mission_differs: boolean;
  retain_extraction_mode_differs: boolean;
  retain_chunk_size_differs: boolean;
  entities_allow_free_form_differs: boolean;
  disposition_differs: boolean;
}

interface BankSettingsValues {
  retain_mission: string;
  observations_mission: string;
  reflect_mission: string;
  retain_extraction_mode: string;
  retain_chunk_size: number;
  entities_allow_free_form: boolean;
  disposition: { empathy: number; literalism: number; skepticism: number };
}

interface BankSettingsSyncRowProps {
  arch?: BankSettingsValues;
  hindsight?: BankSettingsValues;
  divergence?: BankSettingsDivergence;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  showCheckbox?: boolean;
  showCompare?: boolean;
  onCompare?: () => void;
}

const FIELD_META: { label: string; key: keyof BankSettingsDivergence }[] = [
  { label: 'retain', key: 'retain_mission_differs' },
  { label: 'observations', key: 'observations_mission_differs' },
  { label: 'reflect', key: 'reflect_mission_differs' },
  { label: 'mode', key: 'retain_extraction_mode_differs' },
  { label: 'chunk', key: 'retain_chunk_size_differs' },
  { label: 'free form', key: 'entities_allow_free_form_differs' },
  { label: 'disposition', key: 'disposition_differs' },
];

function BankSettingsDivergenceBadges({ divergence }: { divergence?: BankSettingsDivergence }) {
  if (!divergence) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {FIELD_META.map((f) => {
        const differs = divergence[f.key];
        const color = differs
          ? 'bg-diff-differ-bg text-diff-differ-fg border-diff-differ-bd'
          : 'bg-diff-match-bg text-diff-match-fg border-diff-match-bd';
        return (
          <span key={f.label} className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${color}`}>
            {f.label}
          </span>
        );
      })}
    </div>
  );
}

export default function BankSettingsSyncRow({
  arch,
  hindsight,
  divergence,
  isSelected,
  onSelect,
  showCheckbox = true,
  showCompare,
  onCompare,
}: BankSettingsSyncRowProps) {
  return (
    <div className={`px-3 py-2 border-b border-border-subtle hover:bg-surface-card transition-colors ${isSelected ? 'bg-on-dark/[0.04]' : ''}`}>
      <div className="flex items-start gap-2">
        {showCheckbox && (
          <div className="pt-0.5 shrink-0">
            <Checkbox checked={isSelected} onCheckedChange={(checked) => onSelect(checked === true)} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Settings className="h-3.5 w-3.5 text-foreground-faint" />
            <span className="text-xs font-semibold text-foreground-default">Bank Settings</span>
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11px]">
            {arch && (
              <span className="text-foreground-subtle flex-1 truncate" title="architxt master bank settings">
                architxt: <span className="text-foreground-faint">chunk {arch.retain_chunk_size} • {arch.retain_extraction_mode}</span>
              </span>
            )}
            {hindsight && (
              <span className="text-foreground-subtle flex-1 truncate" title="hindsight bank settings">
                Bank: <span className="text-foreground-faint">chunk {hindsight.retain_chunk_size} • {hindsight.retain_extraction_mode}</span>
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2">
            <BankSettingsDivergenceBadges divergence={divergence} />
            {showCompare && divergence && (
              <button
                onClick={(e) => { e.stopPropagation(); onCompare?.(); }}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-card border border-border-default text-foreground-subtle hover:bg-surface-panel hover:text-foreground-muted transition-colors shrink-0 mt-1"
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
