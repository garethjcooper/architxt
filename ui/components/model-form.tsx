'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useEffect } from 'react';
import type { MentalModel, StandardDimension } from '@/lib/types/index';
import { mentalModelsApi } from '@/lib/api/client';

const inputFocusStyle = {
  '--tw-ring-color': 'rgb(52, 211, 153)',
  '--tw-ring-opacity': '0.4',
} as React.CSSProperties;

const inputClass = "!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2";

interface ModelFormProps {
  initial?: MentalModel | null;
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
    dimension: string | null;
    returns: 'json' | 'narrative';
    concatenation: 'merge' | 'compile';
    is_template: boolean;
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

export function ModelForm({ initial, onSubmit, onCancel, submitLabel }: ModelFormProps) {
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
  const [dimension, setDimension] = useState(initial?.dimension || 'none');
  const [returns, setReturns] = useState<'json' | 'narrative'>(initial?.returns ?? 'narrative');
  const [concatenation, setConcatenation] = useState<'merge' | 'compile'>(initial?.concatenation ?? 'compile');
  const [submitting, setSubmitting] = useState(false);
  const [standardDimensions, setStandardDimensions] = useState<StandardDimension[]>([]);

  useEffect(() => {
    let cancelled = false;
    mentalModelsApi.listStandardDimensions().then((dims) => {
      if (!cancelled) setStandardDimensions(dims);
    }).catch(() => {
      if (!cancelled) setStandardDimensions([]);
    });
    return () => { cancelled = true; };
  }, []);

  const templateValidation = useMemo(() => {
    if (!isTemplate) return null;
    if (!/\{entity-(id|name|type)\}/.test(`${extId}${name}`)) {
      return "Template mode requires {entity-id}, {entity-name} or {entity-type} to be present in Template Id (External ID) or Name at a minimum. Source Query can also use entity tags.";
    }
    return null;
  }, [isTemplate, extId, name]);

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
        dimension: dimension.trim() || null,
        returns,
        concatenation,
        is_template: isTemplate,
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
          <Label className="text-xs uppercase text-white/50 font-medium">Entity Template</Label>
          <p className="text-[10px] text-white/40">Derive one mental model per related entity</p>
          {templateValidation && (
            <p className="text-[10px] text-red-400 mt-0.5">{templateValidation}</p>
          )}
        </div>
        <Switch
          checked={isTemplate}
          onCheckedChange={(v) => setIsTemplate(!!v)}
        />
      </div>

      {isTemplate && (
        <div className="border border-white/10 rounded-lg p-3 bg-white/[0.02]">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mm-dimension" className="text-xs uppercase text-white/50 font-medium">Dimension</Label>
              <select
                id="mm-dimension"
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
                className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
              >
                {standardDimensions.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mm-returns" className="text-xs uppercase text-white/50 font-medium">Returns</Label>
              <select
                id="mm-returns"
                value={returns}
                onChange={(e) => setReturns(e.target.value as 'json' | 'narrative')}
                className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
              >
                <option value="json">JSON</option>
                <option value="narrative">Narrative</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mm-concatenation" className="text-xs uppercase text-white/50 font-medium">Concatenation</Label>
              <select
                id="mm-concatenation"
                value={concatenation}
                onChange={(e) => setConcatenation(e.target.value as 'merge' | 'compile')}
                className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
              >
                <option value="merge">Merge</option>
                <option value="compile">Compile</option>
              </select>
            </div>
          </div>
        </div>
      )}


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
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className={inputClass}
            style={inputFocusStyle}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mm-source-query" className="text-xs uppercase text-white/50 font-medium">Source Query *</Label>
        <Textarea
          id="mm-source-query"
          value={sourceQuery}
          onChange={(e) => setSourceQuery(e.target.value)}
          placeholder="Query used to source this model"
          className={inputClass}
          style={{ ...inputFocusStyle, minHeight: '80px' }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
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
      </div>

      <div className="grid grid-cols-2 gap-4">
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
      </div>

      <div className="grid grid-cols-2 gap-4">
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

      {!isTemplate && (
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="mm-dimension" className="text-xs uppercase text-white/50 font-medium">Dimension</Label>
            <select
              id="mm-dimension"
              value={dimension}
              onChange={(e) => setDimension(e.target.value)}
              className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
            >
              {standardDimensions.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mm-returns" className="text-xs uppercase text-white/50 font-medium">Returns</Label>
            <select
              id="mm-returns"
              value={returns}
              onChange={(e) => setReturns(e.target.value as 'json' | 'narrative')}
              className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
            >
              <option value="json">JSON</option>
              <option value="narrative">Narrative</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mm-concatenation" className="text-xs uppercase text-white/50 font-medium">Concatenation</Label>
            <select
              id="mm-concatenation"
              value={concatenation}
              onChange={(e) => setConcatenation(e.target.value as 'merge' | 'compile')}
              className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
            >
              <option value="merge">Merge</option>
              <option value="compile">Compile</option>
            </select>
          </div>
        </div>
      )}

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
