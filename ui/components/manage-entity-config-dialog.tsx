'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { entitiesApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { CaseMatchToggle } from './case-match-toggle';
import type { Entity, EntityType } from '@/lib/types/index';

interface ManageEntityConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedEntityIds: number[];
  entities: Entity[];
  entityTypes: EntityType[];
  onConfigUpdated: () => void;
}

type FieldKey = 'type_id' | 'case_match' | 'word_boundary_match';
type FieldValue = number | string;

interface FieldState {
  key: FieldKey;
  selectedValue: FieldValue;
  allSame: boolean;
  counts: Map<FieldValue, number>;
}

export function ManageEntityConfigDialog({
  isOpen,
  onClose,
  selectedEntityIds,
  entities,
  entityTypes,
  onConfigUpdated,
}: ManageEntityConfigDialogProps) {
  const [fieldStates, setFieldStates] = useState<Record<FieldKey, FieldState>>({} as Record<FieldKey, FieldState>);
  const [enabled, setEnabled] = useState<Record<FieldKey, boolean>>({} as Record<FieldKey, boolean>);
  const [loading, setLoading] = useState(false);

  const selectedEntities = useMemo(
    () => entities.filter((e) => selectedEntityIds.includes(e.id)),
    [entities, selectedEntityIds]
  );

  const typeIdDefault = entityTypes[0]?.id ?? 0;

  const fields = useMemo(
    () => [
      {
        key: 'type_id' as const,
        label: 'Entity Type',
        kind: 'type',
        defaultValue: typeIdDefault,
        helper: 'Change the type for all selected entities',
      },
      {
        key: 'case_match' as const,
        label: 'Case-Sensitive Match',
        kind: 'toggle',
        onLabel: 'ON',
        offLabel: 'OFF',
        defaultValue: 'insensitive',
        helper: 'OFF = insensitive, ON = exact case',
      },
      {
        key: 'word_boundary_match' as const,
        label: 'Respect Word Boundaries',
        kind: 'toggle',
        onLabel: 'ON',
        offLabel: 'OFF',
        defaultValue: 'boundaries',
        helper: 'OFF = substring match, ON = whole-word match',
      },
    ],
    [typeIdDefault]
  );

  useEffect(() => {
    if (!isOpen || selectedEntities.length === 0) return;

    const next: Partial<Record<FieldKey, FieldState>> = {};

    for (const fieldDef of fields) {
      const counts = new Map<FieldValue, number>();
      for (const entity of selectedEntities) {
        const value = (entity[fieldDef.key] ?? fieldDef.defaultValue) as FieldValue;
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
    const defaultEnabled = selectedEntities.length === 1;
    const nextEnabled: Record<FieldKey, boolean> = {} as Record<FieldKey, boolean>;
    for (const f of fields) {
      nextEnabled[f.key] = defaultEnabled;
    }
    setEnabled(nextEnabled);
  }, [isOpen, selectedEntities, fields]);

  const handleSelectToggle = (fieldKey: FieldKey, nextValue: FieldValue) => {
    setFieldStates((prev) => ({
      ...prev,
      [fieldKey]: {
        ...prev[fieldKey],
        selectedValue: nextValue,
      },
    }));
  };

  const handleBoolToggle = (fieldKey: FieldKey, checked: boolean) => {
    setFieldStates((prev) => {
      const current = prev[fieldKey];
      if (!current) return prev;

      const nextValue =
        fieldKey === 'case_match'
          ? (checked ? 'sensitive' : 'insensitive')
          : (checked ? 'boundaries' : 'no-boundaries');

      return {
        ...prev,
        [fieldKey]: {
          ...current,
          selectedValue: nextValue,
        },
      };
    });
  };

  const toggleFieldEnabled = (fieldKey: FieldKey, checked: boolean) => {
    setEnabled((prev) => ({ ...prev, [fieldKey]: checked }));
  };

  const allEnabled = useMemo(() => fields.every((f) => enabled[f.key]), [fields, enabled]);

  const toggleAllEnabled = (checked: boolean) => {
    const next: Record<FieldKey, boolean> = {} as Record<FieldKey, boolean>;
    for (const f of fields) {
      next[f.key] = checked;
    }
    setEnabled(next);
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      const config: {
        type_id?: number;
        case_match?: 'insensitive' | 'sensitive';
        word_boundary_match?: 'boundaries' | 'no-boundaries';
      } = {};

      for (const fieldDef of fields) {
        if (!enabled[fieldDef.key]) continue;
        const state = fieldStates[fieldDef.key];
        if (!state) continue;

        const impacted = selectedEntities.filter(
          (e) => (e[fieldDef.key] ?? fieldDef.defaultValue) !== state.selectedValue
        ).length;

        if (impacted === 0) continue;

        if (fieldDef.key === 'type_id') {
          config.type_id = state.selectedValue as number;
        } else if (fieldDef.key === 'case_match') {
          config.case_match = state.selectedValue as 'insensitive' | 'sensitive';
        } else if (fieldDef.key === 'word_boundary_match') {
          config.word_boundary_match = state.selectedValue as 'boundaries' | 'no-boundaries';
        }
      }

      if (Object.keys(config).length === 0) {
        toast.info('No fields selected to save');
        onClose();
        return;
      }

      const response = await entitiesApi.batchUpdateConfig(selectedEntityIds, config);
      toast.success(
        `Updated configuration for ${selectedEntityIds.length} entit${selectedEntityIds.length === 1 ? 'y' : 'ies'} — ${response.entities_updated} changed`
      );
      onConfigUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update configuration');
    } finally {
      setLoading(false);
    }
  };

  const renderFieldRow = (fieldDef: (typeof fields)[number]) => {
    const state = fieldStates[fieldDef.key];
    if (!state) return null;

    const impactedCount = selectedEntities.filter(
      (e) => (e[fieldDef.key] ?? fieldDef.defaultValue) !== state.selectedValue
    ).length;

    let statusText: string;
    if (state.allSame) {
      statusText = `Same on all ${selectedEntities.length} entit${selectedEntities.length === 1 ? 'y' : 'ies'}`;
    } else {
      const selectedCount = state.counts.get(state.selectedValue) || 0;
      const differentCount = selectedEntities.length - selectedCount;
      const selectedLabel =
        fieldDef.kind === 'type'
          ? entityTypes.find((t) => t.id === state.selectedValue)?.type_name ?? 'Unknown'
          : state.selectedValue === 'sensitive' || state.selectedValue === 'boundaries'
          ? fieldDef.onLabel
          : fieldDef.offLabel;
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
            onCheckedChange={(checked) => toggleFieldEnabled(fieldDef.key, checked === true)}
            className="shrink-0"
          />
          <Settings2 className={`w-4 h-4 shrink-0 ${isFieldEnabled ? 'text-white/40' : 'text-white/20'}`} />
          <div>
            <Label className="text-sm font-medium text-white/90">{fieldDef.label}</Label>
            <p className="text-xs text-white/50">{statusText}</p>
            <p className="text-[10px] text-white/40">{fieldDef.helper}</p>
            {impactedCount > 0 && (
              <p className="text-xs text-emerald-400 mt-0.5">
                Will change {impactedCount} entit{impactedCount === 1 ? 'y' : 'ies'}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {fieldDef.kind === 'type' ? (
            <select
              value={state.selectedValue as number}
              disabled={!isFieldEnabled}
              onChange={(e) => handleSelectToggle(fieldDef.key, Number(e.target.value))}
              className="h-8 rounded-md border border-white/10 bg-surface-card px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {entityTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.type_name}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-white/50">{fieldDef.offLabel}</span>
              <CaseMatchToggle
                checked={
                  fieldDef.key === 'case_match'
                    ? state.selectedValue === 'sensitive'
                    : state.selectedValue === 'boundaries'
                }
                onChange={(checked) => handleBoolToggle(fieldDef.key, checked)}
              />
              <span className="text-xs text-emerald-400">{fieldDef.onLabel}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  const hasActiveUpdateField = useMemo(() => {
    return fields.some((fieldDef) => {
      if (!enabled[fieldDef.key]) return false;
      const state = fieldStates[fieldDef.key];
      if (!state) return false;
      return true;
    });
  }, [fieldStates, enabled, fields]);

  const hasChanges = useMemo(() => {
    return fields.some((fieldDef) => {
      if (!enabled[fieldDef.key]) return false;
      const state = fieldStates[fieldDef.key];
      if (!state) return false;
      return selectedEntities.some(
        (e) => (e[fieldDef.key] ?? fieldDef.defaultValue) !== state.selectedValue
      );
    });
  }, [fieldStates, selectedEntities, enabled, fields]);

  const totalImpactedDocs = useMemo(() => {
    const ids = new Set(selectedEntityIds);
    return entities
      .filter((e) => ids.has(e.id) && (e.usage_count ?? 0) > 0)
      .reduce((sum, e) => sum + (e.usage_count ?? 0), 0);
  }, [selectedEntityIds, entities]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">Manage Entity Configuration</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {selectedEntityIds.length} entit{selectedEntityIds.length === 1 ? 'y' : 'ies'} selected
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
          {fields.map((fieldDef) => renderFieldRow(fieldDef))}
        </div>

        {totalImpactedDocs > 0 && hasChanges && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-900/20 border border-amber-500/30">
            <svg className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-xs text-amber-300">
              {selectedEntityIds.length === 1
                ? `This entity is referenced in ${totalImpactedDocs} document${totalImpactedDocs !== 1 ? 's' : ''}. If any of these documents have already been synced to Hindsight, the updated entity name/ID may cause a mismatch on the next sync.`
                : `These entities are referenced in ${totalImpactedDocs} document${totalImpactedDocs !== 1 ? 's' : ''}. If any of these documents have already been synced to Hindsight, the updated entity name/ID may cause a mismatch on the next sync.`}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !hasActiveUpdateField}
            className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
