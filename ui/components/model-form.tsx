'use client';

import { useState, useMemo, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MentalModel } from '@/lib/types/index';
import { AqlEditor } from '@/components/aql-editor';

const inputFocusStyle = {
  '--tw-ring-color': 'rgb(52, 211, 153)',
  '--tw-ring-opacity': '0.4',
} as React.CSSProperties;

const inputClass = "!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2";

interface ModelFormProps {
  initial?: MentalModel | null;
  mode: 'create' | 'edit';
  templateRoles?: { value: string; label: string; derivation_scope: string }[];
  onSubmit: (data: {
    ext_id: string;
    name: string;
    source_query: string;
    refresh_mode: 'full' | 'delta';
    refresh_after_consolidation: boolean;
    exclude_all_mental_models: boolean;
    exclude_mental_model_list?: string;
    max_tokens: number;
    tags_match_mode: 'all_strict' | 'any_strict' | 'all' | 'any' | 'exact';
    is_template: boolean;
    template_role?: string;
  }) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

function validateMaxTokens(value: string): { valid: true; value: number } | { valid: false; error: string } {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { valid: false, error: 'Max tokens is required' };
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 8192) {
    return { valid: false, error: 'Max tokens must be an integer between 1 and 8192' };
  }
  return { valid: true, value: n };
}

export function ModelForm({ initial, mode, templateRoles, onSubmit, onCancel, submitLabel }: ModelFormProps) {
  const isSystemTemplate = initial?.is_system_template ?? false;
  const [extId, setExtId] = useState(initial?.ext_id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [sourceQuery, setSourceQuery] = useState(initial?.source_query ?? '');
  const [refreshMode, setRefreshMode] = useState<'full' | 'delta'>(initial?.refresh_mode ?? 'full');
  const [refreshAfterConsolidation, setRefreshAfterConsolidation] = useState(initial?.refresh_after_consolidation ?? false);
  const [excludeAll, setExcludeAll] = useState(initial?.exclude_all_mental_models ?? false);
  const [excludeList, setExcludeList] = useState(initial?.exclude_mental_model_list ?? '');
  const [maxTokens, setMaxTokens] = useState(initial?.max_tokens?.toString() ?? '2048');
  const [maxTokensError, setMaxTokensError] = useState<string | null>(null);
  const [tagsMatchMode, setTagsMatchMode] = useState<'all_strict' | 'any_strict' | 'all' | 'any' | 'exact'>(initial?.tags_match_mode ?? 'all_strict');
  const [isTemplate, setIsTemplate] = useState(initial?.is_template ?? false);
  const [templateRole, setTemplateRole] = useState(initial?.template_role ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Reserved system roles cannot be minted manually; hide them from the create dropdown.
  const availableRoles = useMemo(() => {
    if (mode === 'edit') return templateRoles ?? [];
    return (templateRoles ?? []).filter((r) => !r.value.startsWith('sys_'));
  }, [templateRoles, mode]);

  const selectedRole = useMemo(
    () => availableRoles.find((r) => r.value === templateRole) ?? null,
    [availableRoles, templateRole]
  );

  // A non-Generic template role implies templated derivation, so force Entity Template on.
  const effectiveIsTemplate = isTemplate || !!templateRole;
  const roleControlsTemplate = !!templateRole;

  useEffect(() => {
    if (templateRole && !isTemplate) {
      setIsTemplate(true);
    }
  }, [templateRole, isTemplate]);

  const templateValidation = useMemo(() => {
    if (!effectiveIsTemplate) return null;
    if (isSystemTemplate) return null;
    if (!/\{entity-(id|name|type)|node-(id|name)|source-(id|name)|target-(id|name)|seed-(id|name)|batch\}/.test(`${extId}${name}`)) {
      return "Template mode requires a supported placeholder in Template Id (External ID) or Name. Supported: {entity-id}, {entity-name}, {entity-type}, {node-id}, {node-name}, {source-id}, {source-name}, {target-id}, {target-name}, {seed-id}, {seed-name}, {batch}.";
    }
    return null;
  }, [effectiveIsTemplate, isSystemTemplate, extId, name]);

  const roleRequirementHint = useMemo(() => {
    if (!selectedRole) return null;
    return `Role "${selectedRole.label}" (${selectedRole.derivation_scope}) requires Entity Template mode and a supported placeholder in External ID or Name.`;
  }, [selectedRole]);

  const handleIsTemplateChange = (v: boolean) => {
    if (isSystemTemplate || roleControlsTemplate) return;
    setIsTemplate(v);
  };

  const handleTemplateRoleChange = (value: string) => {
    setTemplateRole(value);
    if (value && !isTemplate) {
      setIsTemplate(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extId.trim() || !name.trim() || !sourceQuery.trim()) {
      toast.error('External ID, Name and Source Query are required');
      return;
    }
    const maxTokensValidation = validateMaxTokens(maxTokens);
    if (!maxTokensValidation.valid) {
      toast.error(maxTokensValidation.error);
      setMaxTokensError(maxTokensValidation.error);
      return;
    }
    if (templateValidation) {
      toast.error(templateValidation);
      return;
    }
    try {
      setSubmitting(true);
      await onSubmit({
        ext_id: extId.trim(),
        name: name.trim(),
        source_query: sourceQuery.trim(),
        refresh_mode: refreshMode,
        refresh_after_consolidation: refreshAfterConsolidation,
        exclude_all_mental_models: excludeAll,
        exclude_mental_model_list: excludeList.trim() || undefined,
        max_tokens: maxTokensValidation.value,
        tags_match_mode: tagsMatchMode,
        is_template: effectiveIsTemplate,
        template_role: templateRole || undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save mental model');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 py-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Label className="text-xs uppercase text-white/50 font-medium">Entity Template</Label>
            {isSystemTemplate && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-slate-700/40 text-white/70 border-slate-600">
                System template
              </span>
            )}
            {selectedRole && !isSystemTemplate && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-900/40 text-emerald-300 border-emerald-700/50">
                {selectedRole.label} · {selectedRole.derivation_scope}
              </span>
            )}
          </div>
          <p className="text-[10px] text-white/40">Derive one mental model per related entity</p>
          {roleRequirementHint && (
            <p className="text-[10px] text-emerald-400/80 mt-0.5">{roleRequirementHint}</p>
          )}
          {templateValidation && !roleRequirementHint && (
            <p className="text-[10px] text-red-400 mt-0.5">{templateValidation}</p>
          )}
          {!templateValidation && !roleRequirementHint && isTemplate && !templateRole && (
            <p className="text-[10px] text-white/40 mt-0.5">Generic templates also require a placeholder.</p>
          )}
        </div>
        <Switch
          checked={effectiveIsTemplate}
          onCheckedChange={(v) => handleIsTemplateChange(!!v)}
          disabled={isSystemTemplate || roleControlsTemplate}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mm-ext-id" className="text-xs uppercase text-white/50 font-medium">External ID *</Label>
          <Input
            id="mm-ext-id"
            value={extId}
            onChange={(e) => setExtId(e.target.value)}
            placeholder="e.g. mental-model-001"
            className={inputClass}
            style={inputFocusStyle}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mm-name" className="text-xs uppercase text-white/50 font-medium">Name *</Label>
          <Input
            id="mm-name"
            value={name}
            disabled={isSystemTemplate}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className={inputClass}
            style={inputFocusStyle}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mm-source-query" className="text-xs uppercase text-white/50 font-medium">Source Query *</Label>
        <AqlEditor
          id="mm-source-query"
          value={sourceQuery}
          onChange={(value) => setSourceQuery(value)}
          disabled={false}
          placeholder="Query used to source this model"
          availableEntities={[]}
          availableEdges={[]}
          className={inputClass}
          style={{ ...inputFocusStyle, minHeight: '80px' }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mm-template-role" className="text-xs uppercase text-white/50 font-medium">Template Role</Label>
          <select
          id="mm-template-role"
          value={templateRole}
          disabled={mode === 'edit' || isSystemTemplate}
          onChange={(e) => handleTemplateRoleChange(e.target.value)}
          className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none disabled:opacity-50"
          >
          <option value="">Generic / no role</option>
          {availableRoles?.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label} ({role.derivation_scope})
            </option>
          ))}
          </select>
          <p className="text-[10px] text-white/40">
          {mode === 'edit' ? 'Role is immutable after creation.' : 'Assigns derivation scope and contextual behavior. Reserved system roles are hidden because they cannot be created manually.'}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mm-refresh-mode" className="text-xs uppercase text-white/50 font-medium">Refresh Mode</Label>
          <select
            id="mm-refresh-mode"
            value={refreshMode}
            onChange={(e) => setRefreshMode(e.target.value as 'full' | 'delta')}
            className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
          >
            <option value="full">Full</option>
            <option value="delta">Delta</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mm-tags-match-mode" className="text-xs uppercase text-white/50 font-medium">Tags Match</Label>
          <select
            id="mm-tags-match-mode"
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
        <div className="flex items-center justify-between border border-white/10 rounded-lg p-3">
          <div className="space-y-0.5">
            <Label className="text-xs uppercase text-white/50 font-medium">Refresh after consolidation</Label>
            <p className="text-[10px] text-white/40">Run a refresh once consolidation completes</p>
          </div>
          <Switch
            checked={refreshAfterConsolidation}
            onCheckedChange={(v) => setRefreshAfterConsolidation(!!v)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex items-center justify-between border border-white/10 rounded-lg p-3">
          <div className="space-y-0.5">
            <Label className="text-xs uppercase text-white/50 font-medium">Exclude All Mental Models</Label>
            <p className="text-[10px] text-white/40">Hide every other mental model from this one</p>
          </div>
          <Switch
            checked={excludeAll}
            onCheckedChange={(v) => setExcludeAll(!!v)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="mm-max-tokens" className="text-xs uppercase text-white/50 font-medium">Max Tokens</Label>
          <Input
            id="mm-max-tokens"
            type="number"
            min={1}
            max={8192}
            step={1}
            value={maxTokens}
            onChange={(e) => {
              setMaxTokens(e.target.value);
              setMaxTokensError(null);
            }}
            placeholder="2048"
            className={inputClass}
            style={inputFocusStyle}
          />
          {maxTokensError && (
            <p className="text-[10px] text-red-400">{maxTokensError}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mm-exclude-list" className="text-xs uppercase text-white/50 font-medium">Exclude List</Label>
          <Input
            id="mm-exclude-list"
            value={excludeList}
            onChange={(e) => setExcludeList(e.target.value)}
            placeholder="Comma-separated model IDs"
            className={inputClass}
            style={inputFocusStyle}
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
        <Button type="button" variant="ghost" onClick={onCancel} className="text-white/70 hover:text-white hover:bg-white/5">Close</Button>
        <Button type="submit" disabled={submitting || !extId.trim() || !name.trim() || !sourceQuery.trim() || !!templateValidation || !!maxTokensError} className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
