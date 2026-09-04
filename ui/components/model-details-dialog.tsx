'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { mentalModelsApi } from '@/lib/api/client';
import {
  type DerivedMentalModel,
  type Entity,
  type MentalModel,
  type MentalModelEntityOverrides,
} from '@/lib/types/index';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { AqlEditor } from '@/components/aql-editor';
import { DerivedModelsPanel } from '@/components/derived-models-panel';
import { ManageDerivedModelConfigDialog } from '@/components/manage-derived-model-config-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DerivedModelHealthDialog } from '@/components/derived-model-health-dialog';
import {
  getRoleTemplateRule,
  getRoleTemplateInstructions,
  extractRoleTemplatePrefix,
  buildRoleTemplateValue,
  validateRoleBasedTemplate,
} from '@/lib/validation/contextual-template';

const inputFocusStyle = {
  '--tw-ring-color': 'rgb(52, 211, 153)',
  '--tw-ring-opacity': '0.4',
} as React.CSSProperties;

const inputClass =
  '!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2';

const ENTITY_NAME_PLACEHOLDER = '{entity-name}';
const ENTITY_ID_PLACEHOLDER = '{entity-id}';
const ENTITY_TYPE_PLACEHOLDER = '{entity-type}';

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
  templateRoles?: { value: string; label: string; derivation_scope: string }[];
}

function substitutePlaceholders(template: string | null, entity: Entity): string {
  if (!template) return '';
  return template
    .replaceAll(ENTITY_NAME_PLACEHOLDER, entity.name ?? '')
    .replaceAll(ENTITY_ID_PLACEHOLDER, entity.entity_id ?? '')
    .replaceAll(ENTITY_TYPE_PLACEHOLDER, entity.type_name ?? '');
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
    viewp_description: null,
    viewp_meta: null,
    refresh_mode: overrides.refresh_mode ?? baseConfig.refresh_mode,
    refresh_after_consolidation:
      overrides.refresh_after_consolidation ?? baseConfig.refresh_after_consolidation,
    exclude_all_mental_models:
      overrides.exclude_all_mental_models ?? baseConfig.exclude_all_mental_models,
    exclude_mental_model_list: null,
    max_tokens: overrides.max_tokens ?? baseConfig.max_tokens,
    tags_match_mode: model.tags_match_mode,
    is_template: false,
    is_system_template: false,
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

export function ModelDetailsDialog({ model, open, onOpenChange, onUpdated, templateRoles }: ModelDetailsDialogProps) {
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
  const isSystemTemplate = model.is_system_template;
  const isRoleTemplate = !!model.template_role;
  const isLockedTemplate = isSystemTemplate || isRoleTemplate;

  const selectedTemplateRole = useMemo(
    () => (templateRoles ?? []).find((r) => r.value === model.template_role) ?? null,
    [templateRoles, model.template_role]
  );
  const roleScope = selectedTemplateRole?.derivation_scope ?? null;
  const roleRule = roleScope ? getRoleTemplateRule(roleScope) : null;

  // For role-based templates, the user only edits the prefix of the name; the
  // mandatory placeholder tail is read-only. ext_id is immutable, so we only
  // validate that it matches the expected format and derive the prefix from it.
  const [namePrefix, setNamePrefix] = useState('');

  useEffect(() => {
    if (!roleScope) {
      setNamePrefix('');
      return;
    }
    const extPrefix = extractRoleTemplatePrefix(roleScope, 'extId', model.ext_id ?? '') ?? '';
    const namePrefixFromModel = extractRoleTemplatePrefix(roleScope, 'name', model.name ?? '') ?? '';
    setNamePrefix(namePrefixFromModel || extPrefix);
  }, [roleScope, model.ext_id, model.name]);

  const effectiveName = useMemo(() => {
    if (!roleScope || !roleRule) return name;
    return buildRoleTemplateValue(roleScope, 'name', namePrefix) ?? roleRule.nameTail;
  }, [roleScope, roleRule, namePrefix, name]);

  const [derived, setDerived] = useState<DerivedMentalModel[]>(() =>
    model.is_template ? buildDerivedRows(model, buildBaseConfig(model)) : []
  );
  const [selectedDerived, setSelectedDerived] = useState<DerivedMentalModel[]>([]);
  const [derivedConfigOpen, setDerivedConfigOpen] = useState(false);
  const [derivedHealthOpen, setDerivedHealthOpen] = useState(false);
  const [confirmTemplateOffOpen, setConfirmTemplateOffOpen] = useState(false);

  const baseConfig: BaseConfig = useMemo(
    () => ({
      ext_id: model.ext_id,
      name: effectiveName.trim() || null,
      source_query: sourceQuery.trim() || null,
      refresh_mode: refreshMode,
      refresh_after_consolidation: refreshAfterConsolidation,
      exclude_all_mental_models: excludeAll,
      max_tokens: parseMaxTokens(maxTokens, model.max_tokens ?? 2048),
    }),
    [model.ext_id, effectiveName, sourceQuery, refreshMode, refreshAfterConsolidation, excludeAll, maxTokens, model.max_tokens]
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
    setDerived(
      model.is_template ? buildDerivedRows(model, buildBaseConfig(model)) : []
    );
    setSelectedDerived([]);
    setDerivedConfigOpen(false);
    setDerivedHealthOpen(false);
  }, [open, model]);

  // If entities are added/removed while the modal is open, rebuild derived
  // rows. Existing rows are preserved so live edits survive. Skip for non-template models.
  useEffect(() => {
    if (!open || !model || !model.is_template) return;
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
    () => (model.is_template ? buildDerivedRows(model, buildBaseConfig(model)) : []),
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
    effectiveName.trim() !== (model.name ?? '').trim() ||
    sourceQuery.trim() !== (model.source_query ?? '').trim() ||
    refreshMode !== (model.refresh_mode ?? 'full') ||
    refreshAfterConsolidation !== (model.refresh_after_consolidation ?? false) ||
    excludeAll !== (model.exclude_all_mental_models ?? false) ||
    excludeList !== (model.exclude_mental_model_list ?? '') ||
    parsedMaxTokens !== (model.max_tokens ?? 2048) ||
    tagsMatchMode !== (model.tags_match_mode ?? 'all_strict') ||
    (!isLockedTemplate && isTemplate !== (model.is_template ?? false)) ||
    (!isSystemTemplate && derivedChanged);

  const templateValidation = useMemo(() => {
    if (!isTemplate) return null;
    if (isSystemTemplate) return null;
    if (roleRule) return null; // role-based validation takes over
    if (!/\{entity-(id|name|type)|node-(id|name)|source-(id|name)|target-(id|name)|seed-(id|name)|batch\}/.test(model.ext_id ?? '')) {
      return 'Template mode requires a supported placeholder in External ID. Supported: {entity-id}, {entity-name}, {entity-type}, {node-id}, {node-name}, {source-id}, {source-name}, {target-id}, {target-name}, {seed-id}, {seed-name}, {batch}.';
    }
    return null;
  }, [isTemplate, isSystemTemplate, roleRule, model.ext_id]);

  const roleTemplateValidation = useMemo(() => {
    if (!roleScope || !model.template_role) return null;
    return validateRoleBasedTemplate(roleScope, {
      extId: model.ext_id ?? '',
      name: effectiveName,
      sourceQuery,
    });
  }, [roleScope, model.ext_id, model.template_role, effectiveName, sourceQuery]);

  const extIdFormatWarning = useMemo(() => {
    if (!roleScope || !model.template_role) return null;
    const result = validateRoleBasedTemplate(roleScope, {
      extId: model.ext_id ?? '',
      name: model.name ?? '',
      sourceQuery: model.source_query ?? '',
    });
    if (result.valid) return null;
    // Surface only ext_id related errors; name/source_query will be validated live.
    const extIdErrors = result.errors.filter((e) => e.includes('External ID'));
    return extIdErrors.length > 0 ? extIdErrors.join(' ') : null;
  }, [roleScope, model.ext_id, model.name, model.source_query, model.template_role]);

  const roleInstructions = useMemo(() => {
    if (!roleScope) return null;
    return getRoleTemplateInstructions(roleScope);
  }, [roleScope]);

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
    if (!roleScope) {
      setName(value);
      updateDerivedPlaceholders({
        ...baseConfig,
        name: value.trim() || null,
      });
      return;
    }
    // The role tail is immutable; only accept changes to the prefix.
    const prefix = extractRoleTemplatePrefix(roleScope, 'name', value) ?? value;
    setNamePrefix(prefix);
    updateDerivedPlaceholders({
      ...baseConfig,
      name: buildRoleTemplateValue(roleScope, 'name', prefix) ?? null,
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
    if (isLockedTemplate) return;
    setIsTemplate(value);
    if (value && derived.length === 0) {
      setDerived(buildDerivedRows(model, baseConfig));
    }
  };

  const handleSave = async () => {
    if (!effectiveName.trim() || !sourceQuery.trim()) {
      toast.error('Name and Source Query are required');
      return;
    }
    const parsed = parseMaxTokens(maxTokens, model.max_tokens ?? 2048);
    if (Number(maxTokens.trim()) !== parsed) {
      toast.error('Max tokens must be an integer between 1 and 8192');
      setMaxTokensError('Max tokens must be an integer between 1 and 8192');
      return;
    }
    if (roleTemplateValidation && !roleTemplateValidation.valid) {
      toast.error(roleTemplateValidation.errors.join(' '));
      return;
    }
    if (willDisableTemplateOnSave) {
      setConfirmTemplateOffOpen(true);
      return;
    }
    await executeSave();
  };

  const executeSave = async () => {
    if (!effectiveName.trim() || !sourceQuery.trim()) {
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
      if (effectiveName.trim() !== (model.name ?? '')) updates.name = effectiveName.trim();
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
      if (!isLockedTemplate && isTemplate !== (model.is_template ?? false)) updates.is_template = isTemplate;

      if (Object.keys(updates).length > 0) {
        await mentalModelsApi.update(model.id, updates);
        toast.success('Mental model updated');
      }

      if (!isLockedTemplate && isTemplate && derived.length > 0) {
        const groups = new Map<string, { entityIds: number[]; overrides: MentalModelEntityOverrides }>();
        for (const d of derived) {
          const overrides: MentalModelEntityOverrides = {
            refresh_mode: d.refresh_mode,
            refresh_after_consolidation: d.refresh_after_consolidation,
            exclude_all_mental_models: d.exclude_all_mental_models,
            max_tokens: d.max_tokens,
          };
          const key = JSON.stringify(overrides);
          if (!groups.has(key)) {
            groups.set(key, { entityIds: [], overrides });
          }
          groups.get(key)!.entityIds.push(d.derived_entity.id);
        }
        await Promise.all(
          Array.from(groups.values()).map((group) =>
            mentalModelsApi.batchUpdateEntityOverrides(model.id, group.entityIds, group.overrides)
          )
        );
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
            <div className="flex items-center gap-2">
              <Label className="text-xs uppercase text-white/50 font-medium">Entity Template</Label>
              {isSystemTemplate && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-700/40 text-white/70 border-slate-600">
                  System template
                </span>
              )}
              {isRoleTemplate && (
                <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/40 text-emerald-200/80 border-emerald-700/50">
                  {model.template_role}
                </span>
              )}
            </div>
            <p className="text-[10px] text-white/40">Derive one mental model per related entity</p>
            {templateValidation && (
              <p className="text-[10px] text-red-400 mt-0.5">{templateValidation}</p>
            )}
          </div>
          <Switch checked={isTemplate} onCheckedChange={handleIsTemplateChange} disabled={isLockedTemplate} />
        </div>

        {isRoleTemplate && (
          <div className="space-y-2">
            <Label htmlFor="mm-detail-template-role" className="text-xs uppercase text-white/50 font-medium">
              Template Role
            </Label>
            <p id="mm-detail-template-role" className="text-sm text-white font-mono truncate">
              {model.template_role}
            </p>
          </div>
        )}

        {roleInstructions && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            <p className="font-medium">{selectedTemplateRole?.label} format requirements</p>
            <p className="mt-1 text-amber-100/80">{roleInstructions}</p>
          </div>
        )}

        {extIdFormatWarning && (
          <p className="text-[10px] text-red-400">External ID: {extIdFormatWarning}</p>
        )}

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
            {roleScope && roleRule ? (
              <div className="flex items-center">
                <Input
                  id="mm-detail-name"
                  value={namePrefix}
                  disabled={isSystemTemplate}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="prefix"
                  className={`${inputClass} rounded-r-none border-r-0`}
                  style={inputFocusStyle}
                />
                <span className="flex items-center h-10 px-3 rounded-r-lg border border-l-0 border-white/20 bg-white/5 text-sm text-white/70 whitespace-nowrap">
                  {roleRule.nameTail}
                </span>
              </div>
            ) : (
              <Input
                id="mm-detail-name"
                value={name}
                disabled={isSystemTemplate}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Display name"
                className={inputClass}
                style={inputFocusStyle}
              />
            )}
            {roleTemplateValidation && !roleTemplateValidation.valid && (
              <div className="mt-1 space-y-0.5">
                {roleTemplateValidation.errors
                  .filter((e) => !e.includes('External ID'))
                  .map((err, idx) => (
                    <p key={idx} className="text-[10px] text-red-400">{err}</p>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="mm-detail-source-query" className="text-xs uppercase text-white/50 font-medium">
            Source Query *
          </Label>
          <AqlEditor
            id="mm-detail-source-query"
            value={sourceQuery}
            onChange={(value) => handleSourceQueryChange(value)}
            disabled={isSystemTemplate}
            placeholder="AQL query used to source this model"
            availableEntities={[]}
            availableEdges={[]}
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
        disabled={!hasChanges || isSaving || !!(roleTemplateValidation && !roleTemplateValidation.valid)}
        className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
        {isSaving ? 'Saving...' : 'Save Changes'}
      </Button>
    </div>
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (derivedConfigOpen || derivedHealthOpen)) return;
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className={`${
            isTemplate && !isLockedTemplate ? '!w-[85vw] !max-w-none' : 'sm:max-w-4xl'
          } max-h-[85vh] overflow-hidden p-0 flex flex-col`}
        >
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle className="text-xl font-semibold text-white">Mental Model Details</DialogTitle>
          </DialogHeader>

          {isTemplate ? (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 flex flex-row overflow-hidden">
                <div className="flex-1 min-w-0 overflow-y-auto py-4 px-6">{formBody}</div>
                <div className="w-1/2 min-w-[480px] p-4 flex flex-col gap-4 overflow-hidden">
                  <div className="shrink-0 border border-white/10 rounded-lg p-3 bg-white/[0.02]">
                    <p className="text-xs uppercase text-white/50 font-medium">
                      Derived instances inherit the template configuration above.
                    </p>
                  </div>

                  <DerivedModelsPanel
                    model={model}
                    derived={derived}
                    className="flex-1 border border-white/10 rounded-md overflow-hidden"
                    onConfigure={(selected) => {
                      setSelectedDerived(selected);
                      setDerivedConfigOpen(true);
                    }}
                    onHealth={(selected) => {
                      setSelectedDerived(selected);
                      setDerivedHealthOpen(true);
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

      <DerivedModelHealthDialog
        isOpen={derivedHealthOpen}
        onClose={() => {
          setDerivedHealthOpen(false);
          setSelectedDerived([]);
        }}
        derived={selectedDerived}
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
