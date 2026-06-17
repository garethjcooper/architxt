'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import type { DerivedMentalModel } from '@/lib/types/index';

type FieldKey = 'refresh_mode' | 'refresh_after_consolidation' | 'exclude_all_mental_models' | 'max_tokens';
type FieldValue = string | boolean | number;

interface ConfigFieldDef {
  key: FieldKey;
  label: string;
  kind: 'select' | 'boolean' | 'number';
  options: { value: FieldValue; label: string }[];
  defaultValue: FieldValue;
  min?: number;
  max?: number;
  step?: number;
}

interface FieldState {
  key: FieldKey;
  selectedValue: FieldValue;
  allSame: boolean;
  counts: Map<FieldValue, number>;
}

const FIELDS: ConfigFieldDef[] = [
  {
    key: 'refresh_mode',
    label: 'Refresh Mode',
    kind: 'select',
    options: [
      { value: 'full', label: 'Full' },
      { value: 'delta', label: 'Delta' },
    ],
    defaultValue: 'full',
  },
  {
    key: 'refresh_after_consolidation',
    label: 'Refresh After Consolidation',
    kind: 'boolean',
    options: [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ],
    defaultValue: false,
  },
  {
    key: 'exclude_all_mental_models',
    label: 'Exclude All Mental Models',
    kind: 'boolean',
    options: [
      { value: true, label: 'On' },
      { value: false, label: 'Off' },
    ],
    defaultValue: false,
  },
  {
    key: 'max_tokens',
    label: 'Max Tokens',
    kind: 'number',
    options: [],
    defaultValue: 2048,
    min: 1,
    max: 8192,
    step: 1,
  },
];

interface ManageDerivedModelConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  derived: DerivedMentalModel[];
  onApply: (patch: Partial<Pick<DerivedMentalModel, FieldKey>>) => void;
}

function fieldValue(d: DerivedMentalModel, fieldDef: ConfigFieldDef): FieldValue {
  return d[fieldDef.key] as FieldValue;
}

export function ManageDerivedModelConfigDialog({
  isOpen,
  onClose,
  derived,
  onApply,
}: ManageDerivedModelConfigDialogProps) {
  const [fieldStates, setFieldStates] = useState<Record<FieldKey, FieldState>>(
    {} as Record<FieldKey, FieldState>
  );

  useEffect(() => {
    if (!isOpen || derived.length === 0) return;

    setFieldStates((prev) => {
      const next: Partial<Record<FieldKey, FieldState>> = {};
      for (const fieldDef of FIELDS) {
        const current = prev[fieldDef.key];
        const counts = new Map<FieldValue, number>();
        for (const d of derived) {
          const value = fieldValue(d, fieldDef);
          counts.set(value, (counts.get(value) || 0) + 1);
        }

        let selectedValue = fieldDef.defaultValue;
        let maxCount = -1;
        const ties: FieldValue[] = [];
        for (const [value, count] of counts.entries()) {
          if (count > maxCount) {
            maxCount = count;
            selectedValue = value;
            ties.length = 0;
            ties.push(value);
          } else if (count === maxCount) {
            ties.push(value);
          }
        }
        if (ties.length > 1) {
          selectedValue = current?.selectedValue ?? fieldDef.defaultValue;
        }

        next[fieldDef.key] = {
          key: fieldDef.key,
          selectedValue,
          allSame: counts.size <= 1,
          counts,
        };
      }
      return next as Record<FieldKey, FieldState>;
    });
  }, [isOpen, derived]);

  const handleToggle = (fieldDef: ConfigFieldDef, nextValue: FieldValue) => {
    setFieldStates((prev) => ({
      ...prev,
      [fieldDef.key]: {
        ...prev[fieldDef.key],
        selectedValue: nextValue,
      },
    }));
  };

  const handleSwitchToggle = (fieldDef: ConfigFieldDef) => {
    setFieldStates((prev) => {
      const current = prev[fieldDef.key];
      return {
        ...prev,
        [fieldDef.key]: {
          ...current,
          selectedValue: !current?.selectedValue,
        },
      };
    });
  };

  const handleSave = () => {
    const patch: Partial<Pick<DerivedMentalModel, FieldKey>> = {};
    if (fieldStates.refresh_mode) {
      const changed = derived.some((d) => d.refresh_mode !== fieldStates.refresh_mode!.selectedValue);
      if (changed) {
        patch.refresh_mode = fieldStates.refresh_mode.selectedValue as 'full' | 'delta';
      }
    }
    if (fieldStates.refresh_after_consolidation) {
      const changed = derived.some(
        (d) => d.refresh_after_consolidation !== !!fieldStates.refresh_after_consolidation!.selectedValue
      );
      if (changed) {
        patch.refresh_after_consolidation = !!fieldStates.refresh_after_consolidation.selectedValue;
      }
    }
    if (fieldStates.exclude_all_mental_models) {
      const changed = derived.some(
        (d) => d.exclude_all_mental_models !== !!fieldStates.exclude_all_mental_models!.selectedValue
      );
      if (changed) {
        patch.exclude_all_mental_models = !!fieldStates.exclude_all_mental_models.selectedValue;
      }
    }
    if (fieldStates.max_tokens) {
      const changed = derived.some(
        (d) => d.max_tokens !== Number(fieldStates.max_tokens!.selectedValue)
      );
      if (changed) {
        patch.max_tokens = Number(fieldStates.max_tokens.selectedValue);
      }
    }

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    onApply(patch);
    toast.success(
      `Configuration updated for ${derived.length} derived instance${derived.length === 1 ? '' : 's'}`
    );
    onClose();
  };

  const renderFieldRow = (fieldDef: ConfigFieldDef) => {
    const state = fieldStates[fieldDef.key];
    if (!state) return null;

    const selectedLabel = fieldDef.options.find((o) => o.value === state.selectedValue)?.label ??
      (fieldDef.kind === 'number' ? String(state.selectedValue) : '-');
    const impactedCount = derived.filter((d) => fieldValue(d, fieldDef) !== state.selectedValue).length;

    let statusText: string;
    if (state.allSame) {
      statusText = `Same on all ${derived.length} instances`;
    } else {
      const selectedCount = state.counts.get(state.selectedValue) || 0;
      const differentCount = derived.length - selectedCount;
      statusText = `${selectedLabel} selected — ${selectedCount} match, ${differentCount} different`;
    }

    return (
      <div
        key={fieldDef.key}
        className="flex items-center justify-between py-3 px-3 rounded border border-white/10 bg-white/[0.02]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Settings2 className="w-4 h-4 text-white/40 shrink-0" />
          <div>
            <p className="text-sm font-medium text-white/90">{fieldDef.label}</p>
            <p className="text-xs text-white/50">{statusText}</p>
            {impactedCount === 0 ? (
              <p className="text-xs text-emerald-400 mt-0.5">
                All {derived.length} instance{derived.length === 1 ? '' : 's'} match
              </p>
            ) : (
              <p className="text-xs text-emerald-400 mt-0.5">
                Will change {impactedCount} instance{impactedCount === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {fieldDef.kind === 'select' ? (
            <div className="flex items-center gap-1">
              {fieldDef.options.map((option) => {
                const active = state.selectedValue === option.value;
                return (
                  <button
                    key={String(option.value)}
                    onClick={() => handleToggle(fieldDef, option.value)}
                    className={`px-2.5 py-1 rounded text-xs border transition-all ${
                      active
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800/50 border-slate-700 text-white/60 hover:bg-slate-700/50'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : fieldDef.kind === 'number' ? (
            <Input
              type="number"
              min={fieldDef.min}
              max={fieldDef.max}
              step={fieldDef.step}
              value={state.selectedValue as number}
              onChange={(e) => {
                const value = e.target.value === '' ? fieldDef.defaultValue : Number(e.target.value);
                handleToggle(fieldDef, value);
              }}
              className="w-24 h-8 text-xs bg-slate-800/50 border-slate-700 text-white placeholder:text-white/40 focus:border-emerald-400 focus:ring-emerald-400/30"
            />
          ) : (
            <Switch
              checked={!!state.selectedValue}
              onCheckedChange={() => handleSwitchToggle(fieldDef)}
            />
          )}
        </div>
      </div>
    );
  };

  const hasChanges = useMemo(() => {
    return FIELDS.some(
      (fieldDef) =>
        derived.some((d) => fieldValue(d, fieldDef) !== fieldStates[fieldDef.key]?.selectedValue)
    );
  }, [fieldStates, derived]);

  if (derived.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!w-[25vw] !max-w-none max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Configure Derived Instances</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {derived.length} derived instance{derived.length === 1 ? '' : 's'} selected
          </p>
        </DialogHeader>

        <div className="space-y-3 overflow-y-auto flex-1 py-2">
          {FIELDS.map((fieldDef) => renderFieldRow(fieldDef))}
        </div>

        <div className="flex justify-end gap-2 pt-6 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges}
            className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
