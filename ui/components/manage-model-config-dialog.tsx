'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mentalModelsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import type { MentalModel } from '@/lib/types/index';

interface ManageModelConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModelIds: number[];
  models: MentalModel[];
  onConfigUpdated: () => void;
}

type FieldKey = 'refresh_mode' | 'refresh_after_consolidation' | 'exclude_all_mental_models' | 'tags_match_mode' | 'max_tokens';
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
    key: 'tags_match_mode',
    label: 'Tags Match',
    kind: 'select',
    options: [
      { value: 'all_strict', label: 'All Strict' },
      { value: 'any_strict', label: 'Any Strict' },
      { value: 'all', label: 'All' },
      { value: 'any', label: 'Any' },
      { value: 'exact', label: 'Exact' },
    ],
    defaultValue: 'all_strict',
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

interface FieldState {
  key: FieldKey;
  selectedValue: FieldValue;
  allSame: boolean;
  counts: Map<FieldValue, number>;
}

export function ManageModelConfigDialog({
  isOpen,
  onClose,
  selectedModelIds,
  models,
  onConfigUpdated,
}: ManageModelConfigDialogProps) {
  const [fieldStates, setFieldStates] = useState<Record<FieldKey, FieldState>>({} as Record<FieldKey, FieldState>);
  const [enabled, setEnabled] = useState<Record<FieldKey, boolean>>({} as Record<FieldKey, boolean>);
  const [loading, setLoading] = useState(false);

  const selectedModels = useMemo(
    () => models.filter((m) => selectedModelIds.includes(m.id)),
    [models, selectedModelIds]
  );

  useEffect(() => {
    if (!isOpen || selectedModels.length === 0) return;

    const next: Partial<Record<FieldKey, FieldState>> = {};

    for (const fieldDef of FIELDS) {
      const counts = new Map<FieldValue, number>();
      for (const model of selectedModels) {
        const value = (model[fieldDef.key] ?? fieldDef.defaultValue) as FieldValue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }

      // Pick the selected value: majority wins, default on tie or no values
      let selectedValue = fieldDef.defaultValue;
      let maxCount = -1;
      let ties: FieldValue[] = [];

      for (const [value, count] of counts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          selectedValue = value;
          ties = [value];
        } else if (count === maxCount) {
          ties.push(value);
        }
      }

      if (ties.length > 1) {
        selectedValue = fieldDef.defaultValue;
      }

      next[fieldDef.key] = {
        key: fieldDef.key,
        selectedValue,
        allSame: counts.size <= 1,
        counts,
      };
    }

    setFieldStates(next as Record<FieldKey, FieldState>);
    const defaultEnabled = selectedModels.length === 1;
    const nextEnabled: Record<FieldKey, boolean> = {} as Record<FieldKey, boolean>;
    for (const f of FIELDS) {
      nextEnabled[f.key] = defaultEnabled;
    }
    setEnabled(nextEnabled);
  }, [isOpen, selectedModels]);

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
      const nextValue = !current?.selectedValue;
      return {
        ...prev,
        [fieldDef.key]: {
          ...current,
          selectedValue: nextValue,
        },
      };
    });
  };

  const toggleFieldEnabled = (fieldDef: ConfigFieldDef, checked: boolean) => {
    setEnabled((prev) => ({ ...prev, [fieldDef.key]: checked }));
  };

  const allEnabled = useMemo(() => FIELDS.every((f) => enabled[f.key]), [enabled]);

  const toggleAllEnabled = (checked: boolean) => {
    const next: Record<FieldKey, boolean> = {} as Record<FieldKey, boolean>;
    for (const f of FIELDS) {
      next[f.key] = checked;
    }
    setEnabled(next);
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      const config: {
        refresh_mode?: 'full' | 'delta';
        refresh_after_consolidation?: boolean;
        exclude_all_mental_models?: boolean;
        tags_match_mode?: 'all_strict' | 'any_strict' | 'all' | 'any' | 'exact';
        max_tokens?: number;
      } = {};
      let impactedCount = 0;

      for (const fieldDef of FIELDS) {
        if (!enabled[fieldDef.key]) continue;

        const state = fieldStates[fieldDef.key];
        if (!state) continue;

        const impacted = selectedModels.filter(
          (m) => (m[fieldDef.key] ?? fieldDef.defaultValue) !== state.selectedValue
        ).length;

        if (impacted > 0) {
          impactedCount += impacted;
          if (fieldDef.key === 'refresh_mode') {
            config.refresh_mode = state.selectedValue as 'full' | 'delta';
          } else if (fieldDef.key === 'refresh_after_consolidation') {
            config.refresh_after_consolidation = state.selectedValue as boolean;
          } else if (fieldDef.key === 'exclude_all_mental_models') {
            config.exclude_all_mental_models = state.selectedValue as boolean;
          } else if (fieldDef.key === 'tags_match_mode') {
            config.tags_match_mode = state.selectedValue as 'all_strict' | 'any_strict' | 'all' | 'any' | 'exact';
          } else if (fieldDef.key === 'max_tokens') {
            config.max_tokens = state.selectedValue as number;
          }
        }
      }

      if (Object.keys(config).length === 0) {
        toast.info('No fields selected to save');
        onClose();
        return;
      }

      const response = await mentalModelsApi.batchUpdateConfig(selectedModelIds, config);

      const entitiesUpdated = response?.entities_updated ?? 0;
      toast.success(
        `Updated configuration for ${selectedModelIds.length} mental model(s) — ${impactedCount} changed` +
        (entitiesUpdated > 0 ? `, ${entitiesUpdated} derived instance override(s) aligned` : '')
      );
      onConfigUpdated();
      onClose();
    } catch (err) {
      toast.error('Failed to update configuration');
    } finally {
      setLoading(false);
    }
  };

  const renderFieldRow = (fieldDef: ConfigFieldDef) => {
    const state = fieldStates[fieldDef.key];
    if (!state) return null;

    const selectedLabel = fieldDef.options.find((o) => o.value === state.selectedValue)?.label ??
      (fieldDef.kind === 'number' ? String(state.selectedValue) : '-');
    const impactedCount = selectedModels.filter(
      (m) => (m[fieldDef.key] ?? fieldDef.defaultValue) !== state.selectedValue
    ).length;

    let statusText: string;
    if (state.allSame) {
      statusText = `Same on all ${selectedModels.length} models`;
    } else {
      const selectedCount = state.counts.get(state.selectedValue) || 0;
      const differentCount = selectedModels.length - selectedCount;
      statusText = `${selectedLabel} selected — ${selectedCount} match, ${differentCount} different`;
    }

    const isFieldEnabled = enabled[fieldDef.key] ?? false;

    return (
      <div
        key={fieldDef.key}
        className={`flex items-center justify-between py-3 px-3 rounded border border-white/10 bg-white/[0.02] transition-opacity ${
          isFieldEnabled ? '' : 'opacity-50'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Checkbox
            checked={isFieldEnabled}
            onCheckedChange={(checked) => toggleFieldEnabled(fieldDef, checked === true)}
            className="shrink-0"
          />
          <Settings2 className={`w-4 h-4 shrink-0 ${isFieldEnabled ? 'text-white/40' : 'text-white/20'}`} />
          <div>
            <p className="text-sm font-medium text-white/90">{fieldDef.label}</p>
            <p className="text-xs text-white/50">{statusText}</p>
            {impactedCount === 0 ? (
              <p className="text-xs text-emerald-400 mt-0.5">
                All {selectedModels.length} model{selectedModels.length === 1 ? '' : 's'} match
              </p>
            ) : (
              <p className="text-xs text-emerald-400 mt-0.5">
                Will change {impactedCount} model{impactedCount === 1 ? '' : 's'}
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
                    onClick={() => isFieldEnabled && handleToggle(fieldDef, option.value)}
                    disabled={!isFieldEnabled}
                    className={`px-2.5 py-1 rounded text-xs border transition-all ${
                      active
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800/50 border-slate-700 text-white/60 hover:bg-slate-700/50'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
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
              disabled={!isFieldEnabled}
              onChange={(e) => {
                const value = e.target.value === '' ? fieldDef.defaultValue : Number(e.target.value);
                handleToggle(fieldDef, value);
              }}
              className="w-24 h-8 text-xs bg-slate-800/50 border-slate-700 text-white placeholder:text-white/40 focus:border-emerald-400 focus:ring-emerald-400/30 disabled:opacity-40 disabled:cursor-not-allowed"
            />
          ) : (
            <Switch
              checked={!!state.selectedValue}
              disabled={!isFieldEnabled}
              onCheckedChange={() => isFieldEnabled && handleSwitchToggle(fieldDef)}
            />
          )}
        </div>
      </div>
    );
  };

  const hasChanges = useMemo(() => {
    return FIELDS.some((fieldDef) => {
      if (!enabled[fieldDef.key]) return false;
      const state = fieldStates[fieldDef.key];
      if (!state) return false;
      return selectedModels.some(
        (m) => (m[fieldDef.key] ?? fieldDef.defaultValue) !== state.selectedValue
      );
    });
  }, [fieldStates, selectedModels, enabled]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!w-[25vw] !max-w-none max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Model Configuration</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {selectedModelIds.length} mental model(s) selected
          </p>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2 px-3 rounded border border-white/10 bg-white/[0.03]">
          <Checkbox
            id="select-all-config"
            checked={allEnabled}
            onCheckedChange={(checked) => toggleAllEnabled(checked === true)}
          />
          <label htmlFor="select-all-config" className="text-xs text-white/70 cursor-pointer select-none">
            Select / deselect all fields
          </label>
        </div>

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
            disabled={loading || !hasChanges}
            className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
