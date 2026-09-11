'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { GitCompare, AlertTriangle } from 'lucide-react';
import { familyClass } from '@/lib/status-badge';

interface DirectiveDivergence {
  name_differs: boolean;
  statement_differs: boolean;
  priority_differs: boolean;
  is_active_differs: boolean;
  tags_differs: boolean;
}

interface DirectiveValues {
  id?: number;
  ext_id: string;
  name?: string | null;
  statement?: string | null;
  priority?: number;
  is_active?: boolean;
  tags?: string[];
}

interface DirectiveSyncRowProps {
  ext_id: string;
  arch?: DirectiveValues;
  hindsight?: DirectiveValues;
  divergence?: DirectiveDivergence;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  showCheckbox?: boolean;
  showCompare?: boolean;
  onCompare?: () => void;
  onPush?: () => void;
  onPull?: () => void;
}

function DirectiveDivergenceBadges({ divergence }: { divergence?: DirectiveDivergence }) {
  if (!divergence) return null;

  const fields = [
    { label: 'name', differs: divergence.name_differs },
    { label: 'statement', differs: divergence.statement_differs },
    { label: 'priority', differs: divergence.priority_differs },
    { label: 'active', differs: divergence.is_active_differs },
    { label: 'tags', differs: divergence.tags_differs },
  ];

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {fields.map((f) => {
        const color = f.differs
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

export default function DirectiveSyncRow({
  ext_id,
  arch,
  hindsight,
  divergence,
  isSelected,
  onSelect,
  showCheckbox = true,
  showCompare,
  onCompare,
  onPush,
  onPull,
}: DirectiveSyncRowProps) {
  const archStatement = arch?.statement ?? null;
  const archName = arch?.name ?? null;
  const archActive = arch?.is_active ?? null;
  const hindName = hindsight?.name ?? null;
  const isBankOnly = !arch && !!hindsight;
  const isArchOnly = !!arch && !hindsight;
  const isOutOfSync = !!divergence;
  const cannotPush = isArchOnly && archActive === false;

  // Use architxt name as the primary label when this is an architxt-only
  // or shared row; otherwise fall back to the bank name.
  const primaryName = archName || hindName || null;
  const shortId = ext_id.slice(0, 7);

  return (
    <div className={`px-3 py-2 border-b border-border-subtle hover:bg-surface-card transition-colors ${isSelected ? 'bg-on-dark/[0.04]' : ''}`}>
      <div className="flex items-start gap-2">
        {showCheckbox && (
          <div className="pt-0.5 shrink-0">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelect(checked === true)}
              disabled={cannotPush}
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {primaryName && (
              <span className="text-xs font-medium text-foreground-default truncate" title={primaryName}>{primaryName}</span>
            )}
            <span className="text-[10px] font-mono text-foreground-subtle truncate" title={ext_id}>{shortId}</span>
            {cannotPush && (
              <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-accent-tertiary-bg border border-accent-tertiary-bd text-accent-tertiary-fg" title="Inactive directives cannot be pushed to Hindsight">
                <AlertTriangle className="h-3 w-3" />
                inactive
              </span>
            )}
            {isBankOnly && onPull && (
              <button
                onClick={(e) => { e.stopPropagation(); onPull(); }}
                className={`${familyClass.entity} text-[10px] px-1.5 py-0.5 hover:opacity-80 transition-colors shrink-0`}
              >
                Pull
              </button>
            )}
            {(isArchOnly || isOutOfSync) && onPush && !cannotPush && (
              <button
                onClick={(e) => { e.stopPropagation(); onPush(); }}
                className="text-[10px] px-1.5 py-0.5 rounded bg-diff-match-bg border border-diff-match-bd text-diff-match-fg hover:bg-accent-primary-bg-hover transition-colors shrink-0"
              >
                Push
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11px]">
            {archStatement && (
              <span className="text-foreground-subtle flex-1 truncate" title={archStatement}>
                architxt: <span className="text-foreground-faint">{archStatement}</span>
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2">
            <DirectiveDivergenceBadges divergence={divergence} />
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
