'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { mentalModelsApi } from '@/lib/api/client';
import type {
  MentalModel,
  DerivedMentalModel,
  Entity,
  MentalModelEntityOverrides,
} from '@/lib/types/index';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { DerivedModelsPanel } from '@/components/derived-models-panel';
import { ManageDerivedModelConfigDialog } from '@/components/manage-derived-model-config-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';

const inputFocusStyle = {
  '--tw-ring-color': 'rgb(52, 211, 153)',
  '--tw-ring-opacity': '0.4',
} as React.CSSProperties;

const inputClass =
  '!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2';

const ENTITY_NAME_PLACEHOLDER = '{entity-name}';
const ENTITY_ID_PLACEHOLDER = '{entity-id}';

export interface BaseConfig {
  ext_id: string | null;
  name: string | null;
  source_query: string | null;
  refresh_mode: 'full' | 'delta';
  refresh_after_consolidation: boolean;
  exclude_all_mental_models: boolean;
  max_tokens: number;
}

interface ModelDetailsDialogProps {
  model: MentalModel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

function substitutePlaceholders(template: string | null, entity: Entity): string {
  if (!template) return '';
  return template
    .replaceAll(ENTITY_NAME_PLACEHOLDER, entity.name ?? '')
    .replaceAll(ENTITY_ID_PLACEHOLDER, entity.entity_id ?? '');
}

function parseMaxTokens(value: string, fallback: number): number {
  const n = Number(value.trim());
  if (Number.isInteger(n) && n >= 1 && n <= 8192) return n;
  return fallback;
}

function buildBaseConfig(
  model: MentalModel,
  local: Partial<BaseConfig> = {}
): BaseConfig {
  return {
    ext_id: local.ext_id ?? model.ext_id ?? null,
    name: local.name ?? model.name ?? null,
    source_query: local.source_query ?? model.source_query ?? null,
    refresh_mode: local.refresh_mode ?? model.refresh_mode ?? 'full',
    refresh_after_consolidation:
      local.refresh_after_consolidation ?? model.refresh_after_consolidation ?? false,
    exclude_all_mental_models:
      local.exclude_all_mental_models ?? model.exclude_all_mental_models ?? false,
    max_tokens: local.max_tokens ?? model.max_tokens ?? 2048,
  };
}

function buildDerivedRow(
  entity: Entity,
  model: MentalModel,
  baseConfig: BaseConfig
): DerivedMentalModel {
  const overrides = entity.overrides ?? {};
  return {
    id: -(entity.id),
    ext_id: substitutePlaceholders(baseConfig.ext_id, entity),
    name: substitutePlaceholders(baseConfig.name, entity),
    source_query: substitutePlaceholders(baseConfig.source_query, entity),
    refresh_mode: overrides.refresh_mode ?? baseConfig.refresh_mode,
    refresh_after_consolidation:
      overrides.refresh_after_consolidation ?? baseConfig.refresh_after_consolidation,
    exclude_all_mental_models:
      overrides.exclude_all_mental_models ?? baseConfig.exclude_all_mental_models,
    exclude_mental_model_list: null,
    max_tokens: overrides.max_tokens ?? baseConfig.max_tokens,
    tags_match_mode: model.tags_match_mode,
    is_template: false,
    is_derived: true,
    derived_entity: entity,
    tags: [],
    entities: [],
    created_at: model.created_at,
    updated_at: model.updated_at,
  };
}

function buildDerivedRows(model: MentalModel, baseConfig: BaseConfig): DerivedMentalModel[] {
  return (model.entities ?? []).map((entity) => buildDerivedRow(entity, model, baseConfig));
}

export function ModelDetailsDialog({ model, open, onOpenChange, onUpdated }: ModelDetailsDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState(model.name ?? '');
  const [sourceQuery, setSourceQuery] = useState(model.source_query ?? '');
  const [refreshMode, setRefreshMode] = useState<'full' | 'delta'>(model.refresh_mode ?? 'full');
  const [refreshAfterConsolidation, setRefreshAfterConsolidation] = useState(
    model.refresh_after_consolidation ?? false
  );
  const [excludeAll, setExcludeAll] = useState(model.exclude_all_mental_models ?? false);
  const [excludeList, setExcludeList] = useState(model.exclude_mental_model_list ?? '');
  const [maxTokens, setMaxTokens] = useState(model.max_tokens?.toString() ?? '2048');
  const [maxTokensError, setMaxTokensError] = useState<string | null>(null);
  const [tagsMatchMode, setTagsMatchMode] = useState<
    'all_strict' | 'any_strict' | 'all' | 'any' | 'exact'
  >(model.tags_match_mode ?? 'all_strict');
  const [isTemplate, setIsTemplate] = useState(model.is_template ?? false);
  const [derived, setDerived] = useState<DerivedMentalModel[]>(() =>
    buildDerivedRows(model, buildBaseConfig(model))
  );
  const [selectedDerived, setSelectedDerived] = useState<DerivedMentalModel[]>([]);
  const [derivedConfigOpen, setDerivedConfigOpen] = useState(false);
  const [confirmTemplateOffOpen, setConfirmTemplateOffOpen] = useState(false);

  const baseConfig: BaseConfig = useMemo(
    () => ({
      ext_id: model.ext_id,
      name: name.trim() || null,
      source_query: sourceQuery.trim() || null,
      refresh_mode: refreshMode,
      refresh_after_consolidation: refreshAfterConsolidation,
      exclude_all_mental_models: excludeAll,
      max_tokens: parseMaxTokens(maxTokens, model.max_tokens ?? 2048),
    }),
    [model.ext_id, name, sourceQuery, refreshMode, refreshAfterConsolidation, excludeAll, maxTokens, model.max_tokens]
  );

  const derivedRef = useRef(derived);
  derivedRef.current = derived;

  const baseConfigRef = useRef(baseConfig);
  baseConfigRef.current = baseConfig;

  // When the modal opens, reset all local state from the model.
  useEffect(() => {
    if (!open || !model) return;
    setName(model.name ?? '');
    setSourceQuery(model.source_query ?? '');
    setRefreshMode(model.refresh_mode ?? 'full');
    setRefreshAfterConsolidation(model.refresh_after_consolidation ?? false);
    setExcludeAll(model.exclude_all_mental_models ?? false);
    setExcludeList(model.exclude_mental_model_list ?? '');
    setMaxTokens(model.max_tokens?.toString() ?? '2048');
    setMaxTokensError(null);
    setTagsMatchMode(model.tags_match_mode ?? 'all_strict');
    setIsTemplate(model.is_template ?? false);
    setDerived(buildDerivedRows(model, buildBaseConfig(model)));
    setSelectedDerived([]);
    setDerivedConfigOpen(false);
  }, [open]);

  // If entities are added/removed while the modal is open, rebuild derived
  // rows. Existing rows are preserved so live edits survive; new entities
  // inherit the current template form values.
  useEffect(() => {
    if (!open || !model) return;
    setDerived((prev) => {
      const existingById = new Map(prev.map((d) => [d.derived_entity.id, d]));
      const next: DerivedMentalModel[] = [];
      for (const entity of model.entities ?? []) {
        const existing = existingById.get(entity.id);
        next.push(existing ?? buildDerivedRow(entity, model, baseConfigRef.current));
      }
      return next;
    });
  }, [model.entities, open]);

  const baselineDerived = useMemo(
    () => buildDerivedRows(model, buildBaseConfig(model)),
    [model]
  );

  const derivedChanged = useMemo(() => {
    if (derived.length !== baselineDerived.length) return true;
    for (let i = 0; i < derived.length; i++) {
      const a = derived[i];
      const b = baselineDerived[i];
      if (
        a.refresh_mode !== b.refresh_mode ||
        a.refresh_after_consolidation !== b.refresh_after_consolidation ||
        a.exclude_all_mental_models !== b.exclude_all_mental_models ||
        a.max_tokens !== b.max_tokens ||
        a.ext_id !== b.ext_id ||
        a.name !== b.name ||
        a.source_query !== b.source_query
      ) {
        return true;
      }
    }
    return false;
  }, [derived, baselineDerived]);

  const parsedMaxTokens = parseMaxTokens(maxTokens, model.max_tokens ?? 2048);

  const hasChanges =
    name !== (model.name ?? '') ||
    sourceQuery !== (model.source_query ?? '') ||
    refreshMode !== (model.refresh_mode ?? 'full') ||
    refreshAfterConsolidation !== (model.refresh_after_consolidation ?? false) ||
    excludeAll !== (model.exclude_all_mental_models ?? false) ||
    excludeList !== (model.exclude_mental_model_list ?? '') ||
    parsedMaxTokens !== (model.max_tokens ?? 2048) ||
    tagsMatchMode !== (model.tags_match_mode ?? 'all_strict') ||
    isTemplate !== (model.is_template ?? false) ||
    derivedChanged;

  const templateValidation = useMemo(() => {
    if (!isTemplate) return null;
    if (!/\{entity-(id|name)\}/.test(model.ext_id ?? '')) {
      return 'Template mode requires {entity-id} or {entity-name} to be present in External ID at a minimum. Name or Source Query can also use entity tags.';
    }
    return null;
  }, [isTemplate, model.ext_id]);

  const willDisableTemplateOnSave =
    model.is_template === true && isTemplate === false && (model.entities?.length ?? 0) > 0;

  const updateDerivedPlaceholders = (nextBaseConfig: BaseConfig) => {
    setDerived((prev) =>
      prev.map((d) => ({
        ...d,
        ext_id: substitutePlaceholders(nextBaseConfig.ext_id, d.derived_entity),
        name: substitutePlaceholders(nextBaseConfig.name, d.derived_entity),
        source_query: substitutePlaceholders(nextBaseConfig.source_query, d.derived_entity),
      }))
    );
  };

  const handleNameChange = (value: string) => {
    setName(value);
    updateDerivedPlaceholders({
      ...baseConfig,
      name: value.trim() || null,
    });
  };

  const handleSourceQueryChange = (value: string) => {
    setSourceQuery(value);
    updateDerivedPlaceholders({
      ...baseConfig,
      source_query: value.trim() || null,
    });
  };

  const handleRefreshModeChange = (value: 'full' | 'delta') => {
    setRefreshMode(value);
    setDerived((prev) => prev.map((d) => ({ ...d, refresh_mode: value })));
  };

  const handleRefreshAfterConsolidationChange = (value: boolean) => {
    setRefreshAfterConsolidation(value);
    setDerived((prev) => prev.map((d) => ({ ...d, refresh_after_consolidation: value })));
  };

  const handleExcludeAllChange = (value: boolean) => {
    setExcludeAll(value);
    setDerived((prev) => prev.map((d) => ({ ...d, exclude_all_mental_models: value })));
  };

  const handleMaxTokensChange = (value: string) => {
    setMaxTokens(value);
    const parsed = parseMaxTokens(value, model.max_tokens ?? 2048);
    setMaxTokensError(
      Number(value.trim()) === parsed ? null : 'Max tokens must be an integer between 1 and 8192'
    );
    setDerived((prev) => prev.map((d) => ({ ...d, max_tokens: parsed })));
  };

  const handleIsTemplateChange = (value: boolean) => {
    setIsTemplate(value);
    if (value && derived.length === 0) {
      setDerived(buildDerivedRows(model, baseConfig));
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !sourceQuery.trim()) {
      toast.error('Name and Source Query are required');
      return;
    }
    const parsed = parseMaxTokens(maxTokens, model.max_tokens ?? 2048);
    if (Number(maxTokens.trim()) !== parsed) {
      toast.error('Max tokens must be an integer between 1 and 8192');
      setMaxTokensError('Max tokens must be an integer between 1 and 8192');
      return;
    }
    if (willDisableTemplateOnSave) {
      setConfirmTemplateOffOpen(true);
      return;
    }
    await executeSave();
  };

  const executeSave = async () => {
    if (!name.trim() || !sourceQuery.trim()) {
      toast.error('Name and Source Query are required');
      return;
    }
    const parsed = parseMaxTokens(maxTokens, model.max_tokens ?? 2048);
    if (Number(maxTokens.trim()) !== parsed) {
      toast.error('Max tokens must be an integer between 1 and 8192');
      setMaxTokensError('Max tokens must be an integer between 1 and 8192');
      return;
    }
    setIsSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (name.trim() !== (model.name ?? '')) updates.name = name.trim();
      if (sourceQuery.trim() !== (model.source_query ?? '')) updates.source_query = sourceQuery.trim();
      if (refreshMode !== (model.refresh_mode ?? 'full')) updates.refresh_mode = refreshMode;
      if (refreshAfterConsolidation !== (model.refresh_after_consolidation ?? false)) {
        updates.refresh_after_consolidation = refreshAfterConsolidation;
      }
      if (excludeAll !== (model.exclude_all_mental_models ?? false)) updates.exclude_all_mental_models = excludeAll;
      if (parsed !== (model.max_tokens ?? 2048)) updates.max_tokens = parsed;
      const nextExcludeList = excludeList.trim();
      const currentExcludeList = model.exclude_mental_model_list ?? '';
      if (nextExcludeList !== currentExcludeList) {
        updates.exclude_mental_model_list = nextExcludeList || null;
      }
      if (tagsMatchMode !== (model.tags_match_mode ?? 'all_strict')) updates.tags_match_mode = tagsMatchMode;
      if (isTemplate !== (model.is_template ?? false)) updates.is_template = isTemplate;

      if (Object.keys(updates).length > 0) {
        await mentalModelsApi.update(model.id, updates);
        toast.success('Mental model updated');
      }

      if (isTemplate && derived.length > 0) {
        for (const d of derived) {
          await mentalModelsApi.batchUpdateEntityOverrides(model.id, [d.derived_entity.id], {
            refresh_mode: d.refresh_mode,
            refresh_after_consolidation: d.refresh_after_consolidation,
            exclude_all_mental_models: d.exclude_all_mental_models,
            max_tokens: d.max_tokens,
          });
        }
        toast.success('Derived instance settings updated');
      }

      onUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setIsSaving(false);
    }
  };

  const formBody = (
    <div className="flex flex-col gap-6">
      {/* Editable Fields */}
      <div className="space-y-6 shrink-0">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label className="text-xs uppercase text-white/50 font-medium">Entity Template</Label>
            <p className="text-[10px] text-white/40">Derive one mental model per related entity</p>
            {templateValidation && (
              <p className="text-[10px] text-red-400 mt-0.5">{templateValidation}</p>
            )}
          </div>
          <Switch checked={isTemplate} onCheckedChange={handleIsTemplateChange} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="mm-detail-ext-id" className="text-xs uppercase text-white/50 font-medium">
              External ID
            </Label>
            <p id="mm-detail-ext-id" className="text-sm text-white font-mono truncate">
              {model.ext_id || '-'}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mm-detail-name" className="text-xs uppercase text-white/50 font-medium">
              Name *
            </Label>
            <Input
              id="mm-detail-name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Display name"
              className={inputClass}
              style={inputFocusStyle}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mm-detail-source-query" className="text-xs uppercase text-white/50 font-medium">
            Source Query *
          </Label>
          <Textarea
            id="mm-detail-source-query"
            value={sourceQuery}
            onChange={(e) => handleSourceQueryChange(e.target.value)}
            placeholder="Query used to source this model"
            className={inputClass}
            style={{ ...inputFocusStyle, minHeight: '80px' }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="mm-detail-refresh-mode" className="text-xs uppercase text-white/50 font-medium">
              Refresh Mode
            </Label>
            <select
              id="mm-detail-refresh-mode"
              value={refreshMode}
              onChange={(e) => handleRefreshModeChange(e.target.value as 'full' | 'delta')}
              className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
            >
              <option value="full">Full</option>
              <option value="delta">Delta</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mm-detail-tags-match-mode" className="text-xs uppercase text-white/50 font-medium">
              Tags Match
            </Label>
            <select
              id="mm-detail-tags-match-mode"
              value={tagsMatchMode}
              onChange={(e) => setTagsMatchMode(e.target.value as 'all_strict' | 'any_strict' | 'all' | 'any' | 'exact')}
              className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
            >
              <option value="all_strict">All Strict</option>
              <option value="any_strict">Any Strict</option>
              <option value="all">All</option>
              <option value="any">Any</option>
              <option value="exact">Exact</option>
            </select>
            <p className="text-[10px] text-white/40">How tags on this model must match document tags</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center justify-between border border-white/10 rounded-lg p-3">
            <div className="space-y-0.5">
              <Label className="text-xs uppercase text-white/50 font-medium">Refresh after consolidation</Label>
              <p className="text-[10px] text-white/40">Run a refresh once consolidation completes</p>
            </div>
            <Switch
              checked={refreshAfterConsolidation}
              onCheckedChange={handleRefreshAfterConsolidationChange}
            />
          </div>
          <div className="flex items-center justify-between border border-white/10 rounded-lg p-3">
            <div className="space-y-0.5">
              <Label className="text-xs uppercase text-white/50 font-medium">Exclude All Mental Models</Label>
              <p className="text-[10px] text-white/40">Hide every other mental model from this one</p>
            </div>
            <Switch checked={excludeAll} onCheckedChange={handleExcludeAllChange} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="mm-detail-exclude-list" className="text-xs uppercase text-white/50 font-medium">
              Exclude List
            </Label>
            <Input
              id="mm-detail-exclude-list"
              value={excludeList}
              onChange={(e) => setExcludeList(e.target.value)}
              placeholder="Comma-separated model IDs"
              className={inputClass}
              style={inputFocusStyle}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mm-detail-max-tokens" className="text-xs uppercase text-white/50 font-medium">
              Max Tokens
            </Label>
            <Input
              id="mm-detail-max-tokens"
              type="number"
              min={1}
              max={8192}
              step={1}
              value={maxTokens}
              onChange={(e) => handleMaxTokensChange(e.target.value)}
              placeholder="2048"
              className={inputClass}
              style={inputFocusStyle}
            />
            {maxTokensError && (
              <p className="text-[10px] text-red-400">{maxTokensError}</p>
            )}
          </div>
        </div>
      </div>

      {/* Read-only Metadata */}
      <div className="space-y-4 pt-2 border-t border-white/10 shrink-0">
        <div className="space-y-2">
          <Label className="text-xs uppercase text-white/50 font-medium">Tags</Label>
          {model.tags?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {model.tags.map((t) => (
                <span
                  key={t.id}
                  className="px-2.5 py-1 rounded-full bg-orange-400/20 text-orange-300 text-xs border border-orange-400/30"
                >
                  {t.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/40 italic">-</p>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs uppercase text-white/50 font-medium">Entities</Label>
          {model.entities?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {model.entities.map((e) => (
                <span
                  key={e.id}
                  className="px-2.5 py-1 rounded-full bg-purple-800/15 text-purple-400 text-xs border border-purple-700/20"
                >
                  {e.entity_id} — {e.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/40 italic">-</p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase text-white/50 font-medium">ID</p>
            <p className="text-sm text-white font-mono">{model.id}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase text-white/50 font-medium">Created</p>
            <p className="text-sm text-white/70">
              {formatDistanceToNow(new Date(model.created_at), { addSuffix: true })}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase text-white/50 font-medium">Updated</p>
            <p className="text-sm text-white/70">
              {formatDistanceToNow(new Date(model.updated_at), { addSuffix: true })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const actionBar = (
    <div className="shrink-0 px-6 py-4 border-t border-white/10 flex justify-end gap-3">
      <Button
        variant="ghost"
        onClick={() => onOpenChange(false)}
        className="text-white/70 hover:text-white hover:bg-white/5"
      >
        Close
      </Button>
      <Button
        onClick={handleSave}
        disabled={!hasChanges || isSaving}
        className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
        {isSaving ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && derivedConfigOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={`${
            isTemplate ? '!w-[85vw] !max-w-none' : 'sm:max-w-4xl'
          } max-h-[85vh] overflow-hidden p-0 flex flex-col`}
        >
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle className="text-xl font-semibold text-white">Mental Model Details</DialogTitle>
          </DialogHeader>

          {isTemplate ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
                <div className="flex-1 min-w-0 overflow-y-auto py-4 px-6">{formBody}</div>
                <div className="w-1/2 min-w-[480px] p-4 flex flex-col overflow-hidden">
                  <DerivedModelsPanel
                    model={model}
                    derived={derived}
                    className="flex-1 border border-white/10 rounded-md overflow-hidden"
                    onConfigure={(selected) => {
                      setSelectedDerived(selected);
                      setDerivedConfigOpen(true);
                    }}
                  />
                </div>
              </div>
              {actionBar}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto py-4 px-6">{formBody}</div>
              {actionBar}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ManageDerivedModelConfigDialog
        isOpen={derivedConfigOpen}
        onClose={() => {
          setDerivedConfigOpen(false);
          setSelectedDerived([]);
        }}
        derived={selectedDerived}
        onApply={(patch) => {
          setDerived((prev) =>
            prev.map((d) =>
              selectedDerived.some((sd) => sd.id === d.id) ? { ...d, ...patch } : d
            )
          );
        }}
      />

      <ConfirmDialog
        open={confirmTemplateOffOpen}
        onOpenChange={setConfirmTemplateOffOpen}
        title="Turn off Entity Template?"
        description={`Turning off Entity Template will reset any per-entity override settings for ${
          model.entities?.length ?? 0
        } related ${model.entities?.length === 1 ? 'entity' : 'entities'}. The entity associations themselves will remain and can still be managed separately. Derived instances will no longer be generated.`}
        onConfirm={executeSave}
        confirmLabel="Turn Off & Save"
        cancelLabel="Cancel"
        variant="destructive"
      />
    </>
  );
}

export default ModelDetailsDialog;
