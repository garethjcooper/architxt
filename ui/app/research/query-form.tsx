import { useState, useEffect, useCallback, useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Play } from 'lucide-react';
import { colorForType } from '@/components/research-canvas';
import { type ResearchQueryOptions } from './use-research-session';
import { type ResearchStepSummary } from '@/lib/api/client';
import { researchApi } from '@/lib/api/client';
import { AqlInput } from '@/components/aql-input';

export type Server = {
  id: number;
  name: string;
  base_url?: string;
};

export type Bank = {
  bank_id: string;
  name: string;
  description?: string;
};

export interface QueryFormProps {
  query: string;
  setQuery: (q: string) => void;
  cursor: number;
  setCursor: (c: number) => void;
  loading: boolean;
  isRunning?: boolean;
  availableEntities: EntityLike[];
  availableEdges: EdgeLike[];
  onSubmit: (e: React.FormEvent) => void;
  queryMode: 'prebuilt' | 'recall' | 'reflect' | 'synthesize' | 'models' | 'templates';
  selectedTemplateRoles: string[];
  setSelectedTemplateRoles: (r: string[]) => void;
  availableTemplateRoles: Array<{ value: string; label: string }>;
  queryOptions: ResearchQueryOptions;
  setQueryOptions: (opts: ResearchQueryOptions | ((prev: ResearchQueryOptions) => ResearchQueryOptions)) => void;
  availableMentalModels?: Array<{ id: number; ext_id: string; name?: string }>;
  serverId?: string;
  bankId?: string;
  /** Trail for synthesize-mode source step preview. */
  trail?: ResearchStepSummary[];
  /** Current step selection state for synthesize-mode preview. */
  selectedStepIds?: Set<number>;
  /** Active step id in step mode; used as synthesize fallback. */
  activeStepId?: number | null;
  /** Current view mode; used to decide which steps to preview. */
  viewMode?: 'step' | 'session';
}

export interface EntityLike {
  id: string;
  entity_id?: string | null;
  name?: string | null;
  label?: string | null;
  type?: string | null;
}

export interface EdgeLike {
  from: string;
  to: string;
  label?: string | null;
  type?: string | null;
}

const QUERY_PLACEHOLDERS: Record<QueryFormProps['queryMode'], string> = {
  prebuilt: 'Double-click an entity to add it to the prebuilt lookup list, then select one or more template roles to run.',
  recall: 'Returns facts for the given query in a table format. Type [[ to show list of existing known entities. Double click an entity or edge to add to this query.',
  reflect: 'Returns a generated narrative for the given query. Type [[ to show list of existing known entities. Double click an entity or edge to add to this query.',
  synthesize: 'Returns a narrative based on existing query steps. Select one or more steps to run the query against. Type [[ to show list of existing known entities. Double click an entity or edge to add to this query.',
  models: 'Select one or more mental models and enter a query to explore their content. Type [[ to show list of existing known entities.',
  templates: 'Double-click an entity in the Entities panel to add it to the template lookup list.',
};

export function QueryForm(props: QueryFormProps) {
  const {
    query,
    setQuery,
    cursor,
    setCursor,
    loading,
    isRunning,
    availableEntities,
    availableEdges,
    onSubmit,
    queryMode,
    selectedTemplateRoles,
    setSelectedTemplateRoles,
    availableTemplateRoles,
    queryOptions,
    setQueryOptions,
    availableMentalModels = [],
    serverId,
    bankId,
    trail = [],
    selectedStepIds = new Set(),
    activeStepId,
    viewMode = 'step',
  } = props;

  const [eligibleTemplates, setEligibleTemplates] = useState<Array<{
    id: number;
    ext_id: string;
    name: string;
    matched_entities: Array<{
      entity_id: string;
      name: string;
      type_name?: string;
      derived_ext_id: string;
    }>;
  }>>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [eligibleError, setEligibleError] = useState<string | null>(null);

  const sourceSteps = useMemo(() => {
    if (queryMode !== 'synthesize') return [];
    const ids = selectedStepIds.size > 0
      ? selectedStepIds
      : activeStepId != null
        ? new Set([activeStepId])
        : new Set<number>();
    if (ids.size === 0) return [];
    return trail
      .filter((s) => ids.has(s.id))
      .sort((a, b) => trail.indexOf(a) - trail.indexOf(b));
  }, [queryMode, trail, selectedStepIds, activeStepId]);

  // Fetch eligible templates whenever selected entities change in templates mode.
  useEffect(() => {
    if (queryMode !== 'templates' || !serverId || !bankId) {
      setEligibleTemplates([]);
      setEligibleError(null);
      return;
    }
    const entityIds = queryOptions.templates?.selectedEntities
      ?.map((id) => entityMap.get(id)?.entity_id)
      .filter((id): id is string => Boolean(id)) || [];
    if (entityIds.length === 0) {
      setEligibleTemplates([]);
      setEligibleError(null);
      return;
    }
    let cancelled = false;
    setEligibleLoading(true);
    setEligibleError(null);
    researchApi.eligibleTemplateModels({
      server_id: parseInt(serverId, 10),
      bank_id: bankId,
      entities: entityIds,
    })
      .then((res) => {
        if (!cancelled) {
          setEligibleTemplates(res.templates || []);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEligibleError(err instanceof Error ? err.message : String(err));
          setEligibleTemplates([]);
        }
      })
      .finally(() => {
        if (!cancelled) setEligibleLoading(false);
      });
    return () => { cancelled = true; };
  }, [queryMode, serverId, bankId, queryOptions.templates?.selectedEntities]);

  const entityMap = useMemo(() => {
    const map = new Map<string, EntityLike>();
    for (const e of availableEntities) {
      map.set(e.id, e);
    }
    return map;
  }, [availableEntities]);

  return (
    <form onSubmit={onSubmit} className="flex flex-col h-full p-2 gap-2 overflow-hidden">
      <div className="flex flex-1 min-h-0 gap-2">
        {queryMode !== 'models' && queryMode !== 'templates' && queryMode !== 'prebuilt' && (
          <div className="flex flex-col flex-1 min-h-0 relative">
            <AqlInput
              value={query}
              onChange={(value, newCursor) => {
                setQuery(value);
                setCursor(newCursor);
              }}
              disabled={isRunning}
              placeholder={QUERY_PLACEHOLDERS[queryMode]}
              availableEntities={availableEntities}
              availableEdges={availableEdges}
              className="flex-1 min-h-0"
            />
          </div>
        )}

        {queryMode === 'prebuilt' && availableTemplateRoles.length > 0 && (
          <div className="flex flex-1 min-h-0 gap-2 w-full">
            <div className={`w-1/3 min-h-0 flex flex-col border-r border-white/10 pr-2 ${isRunning ? 'opacity-50' : ''}`}>
              <div className="text-[10px] text-white/70 font-medium mb-1">Entities</div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                {(() => {
                  const selectedIds = queryOptions.prebuilt?.selectedEntities || [];
                  if (selectedIds.length === 0) {
                    return (
                      <div className="text-[10px] text-white/40 italic">
                        Double-click an entity in the Entities panel to add it here.
                      </div>
                    );
                  }
                  return selectedIds
                    .map((id) => entityMap.get(id))
                    .filter((e): e is EntityLike => Boolean(e))
                    .map((entity) => {
                      const display = entity.label || entity.id;
                      const qualified = entity.type && !entity.id.startsWith(`${entity.type}:`)
                        ? `${entity.type}:${entity.id}`
                        : entity.id;
                      return (
                        <div
                          key={entity.id}
                          className="flex items-center gap-2 rounded border border-white/5 bg-black/20 px-2 py-1.5 min-h-[2.8125rem]"
                          style={{ borderLeftColor: colorForType(entity.type || undefined), borderLeftWidth: 3 }}
                        >
                          <div className="min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden">
                            <div className="text-xs text-white/90 truncate">{display}</div>
                            <div className="text-[10px] text-white/50 font-mono truncate">{qualified}</div>
                          </div>
                          <button
                            type="button"
                            disabled={isRunning}
                            onClick={() => {
                              setQueryOptions((o) => ({
                                ...o,
                                prebuilt: {
                                  ...o.prebuilt,
                                  selectedEntities: selectedIds.filter((id) => id !== entity.id),
                                },
                              }));
                            }}
                            className={`shrink-0 text-white/50 hover:text-red-400 text-xs px-1 ${isRunning ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            aria-label={`Remove ${display} from prebuilt lookup`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      );
                    });
                })()}
              </div>
            </div>
            <div className={`flex-1 min-h-0 flex flex-col pl-2 ${isRunning ? 'opacity-50' : ''}`}>
              <div className="text-[10px] text-white/70 font-medium mb-1">Model types</div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                {availableTemplateRoles.map(({ value, label }) => {
                  const selected = selectedTemplateRoles.includes(value);
                  return (
                    <label
                      key={value}
                      className={`flex items-center gap-2 text-[10px] text-white/80 ${isRunning ? 'cursor-not-allowed' : 'hover:text-white cursor-pointer'}`}
                    >
                      <Checkbox
                        disabled={isRunning}
                        checked={selected}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedTemplateRoles([...selectedTemplateRoles, value]);
                          } else {
                            setSelectedTemplateRoles(selectedTemplateRoles.filter((x) => x !== value));
                          }
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {(queryMode === 'recall' || queryMode === 'reflect' || queryMode === 'synthesize') && (
          <div className={`w-36 shrink-0 flex flex-col min-h-0 border-l border-white/10 pl-2 ${isRunning ? 'opacity-50' : ''}`}>
            <div className="text-[10px] text-white/70 font-medium mb-1">Options</div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {queryMode === 'recall' && (
                <RecallOptions options={queryOptions.recall} onChange={(recall) => setQueryOptions((prev) => ({ ...prev, recall }))} disabled={isRunning} />
              )}
              {queryMode === 'reflect' && (
                <ReflectOptions options={queryOptions.reflect} onChange={(reflect) => setQueryOptions((prev) => ({ ...prev, reflect }))} disabled={isRunning} />
              )}
              {queryMode === 'synthesize' && (
                <SynthesizeOptions options={queryOptions.synthesize} onChange={(synthesize) => setQueryOptions((prev) => ({ ...prev, synthesize }))} disabled={isRunning} />
              )}
            </div>
          </div>
        )}

        {queryMode === 'models' && availableMentalModels.length > 0 && (
          <div className={`w-full shrink-0 flex flex-col min-h-0 border-l border-white/10 pl-2 ${isRunning ? 'opacity-50' : ''}`}>
            <div className="flex-1 min-h-0 overflow-y-auto px-1 py-1 space-y-1">
              {availableMentalModels.map((model) => {
                const selections = queryOptions.models?.selections || [];
                const selected = selections.some((s) => s.id === String(model.id) || s.ext_id === model.ext_id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    disabled={isRunning}
                    onClick={() => {
                      const next = !selected
                        ? [...selections, { kind: 'model' as const, id: String(model.id), ext_id: model.ext_id, name: model.name }]
                        : selections.filter((s) => s.id !== String(model.id) && s.ext_id !== model.ext_id);
                      setQueryOptions((prev) => ({ ...prev, models: { ...prev.models, selections: next } }));
                    }}
                    className={`w-full flex items-center gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors ${
                      selected
                        ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-200'
                        : 'bg-black/20 border-white/5 text-white/90 hover:bg-white/5'
                    } ${isRunning ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    title={model.name || model.ext_id || String(model.id)}
                  >
                    <Checkbox
                      disabled={isRunning}
                      checked={selected}
                      className="shrink-0"
                      aria-label={`Select mental model ${model.name || model.ext_id}`}
                    />
                    <div className="flex-1 text-left min-w-0 flex flex-col gap-0.5">
                      <div className="flex items-center justify-between text-xs text-white/90">
                        <span className="truncate">{model.name || model.ext_id || `Model #${model.id}`}</span>
                      </div>
                      <div className="text-[10px] text-white/50 font-mono truncate">
                        {model.ext_id || `model:${model.id}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {queryMode === 'templates' && (
          <div className="flex flex-1 min-h-0 gap-2 w-full">
            <div className={`w-1/3 min-h-0 flex flex-col border-r border-white/10 pr-2 ${isRunning ? 'opacity-50' : ''}`}>
              <div className="text-[10px] text-white/70 font-medium mb-1">Entities</div>
              <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
                {(() => {
                  const selectedIds = queryOptions.templates?.selectedEntities || [];
                  if (selectedIds.length === 0) {
                    return (
                      <div className="text-[10px] text-white/40 italic">
                        Double-click an entity in the Entities panel to add it here.
                      </div>
                    );
                  }
                  return selectedIds
                    .map((id) => entityMap.get(id))
                    .filter((e): e is EntityLike => Boolean(e))
                    .map((entity) => {
                      const display = entity.label || entity.id;
                      const qualified = entity.type && !entity.id.startsWith(`${entity.type}:`)
                        ? `${entity.type}:${entity.id}`
                        : entity.id;
                      return (
                        <div
                          key={entity.id}
                          className="flex items-center gap-2 rounded border border-white/5 bg-black/20 px-2 py-1.5 min-h-[2.8125rem]"
                          style={{ borderLeftColor: colorForType(entity.type || undefined), borderLeftWidth: 3 }}
                        >
                          <div className="min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden">
                            <div className="text-xs text-white/90 truncate">{display}</div>
                            <div className="text-[10px] text-white/50 font-mono truncate">{qualified}</div>
                          </div>
                          <button
                            type="button"
                            disabled={isRunning}
                            onClick={() => {
                              setQueryOptions((o) => ({
                                ...o,
                                templates: {
                                  ...o.templates,
                                  selectedEntities: selectedIds.filter((id) => id !== entity.id),
                                  selections: [],
                                },
                              }));
                            }}
                            className={`shrink-0 text-white/50 hover:text-red-400 text-xs px-1 ${isRunning ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                            aria-label={`Remove ${display} from template lookup`}
                            title="Remove"
                          >
                            ×
                          </button>
                        </div>
                      );
                    });
                })()}
              </div>
            </div>
            <div className={`flex-1 min-h-0 flex flex-col pl-2 ${isRunning ? 'opacity-50' : ''}`}>
              <div className="text-[10px] text-white/70 font-medium mb-1">Eligible Templates</div>
              {eligibleLoading && (
                <div className="text-[10px] text-white/40 italic">Loading eligible templates…</div>
              )}
              {eligibleError && (
                <div className="text-[10px] text-red-400 italic">{eligibleError}</div>
              )}
              {!eligibleLoading && !eligibleError && eligibleTemplates.length === 0 && (
                <div className="text-[10px] text-white/40 italic">
                  {queryOptions.templates?.selectedEntities?.length
                    ? 'No templates match the selected entities.'
                    : 'Double-click an entity in the Entities panel to see eligible templates.'}
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="flex flex-col gap-1">
                  {eligibleTemplates.map((template) => {
                    const selections = queryOptions.templates?.selections || [];
                    const selectedEntityIds = new Set(
                      selections.filter((s) => s.kind === 'derived_model').map((s) => s.ext_id),
                    );
                    const inScopeIds = new Set(
                      queryOptions.templates?.selectedEntities
                        ?.map((id) => entityMap.get(id)?.entity_id)
                        .filter((id): id is string => Boolean(id)) || [],
                    );
                    const scopeEntities = template.matched_entities.filter((me) => inScopeIds.has(me.entity_id));
                    const allSelected = scopeEntities.length > 0 && scopeEntities.every((me) => selectedEntityIds.has(me.derived_ext_id));
                    const partiallySelected = scopeEntities.some((me) => selectedEntityIds.has(me.derived_ext_id)) && !allSelected;
                    const selected = selections.some((s) => s.ext_id === template.ext_id) || allSelected;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        disabled={isRunning}
                        onClick={() => {
                          const prev = queryOptions.templates?.selections || [];
                          const existing = scopeEntities
                            .map((me) => me.derived_ext_id)
                            .filter((extId) => prev.some((s) => s.ext_id === extId));
                          const isSelected = existing.length > 0 && existing.length === scopeEntities.length;
                          const next = isSelected
                            ? prev.filter((s) => !scopeEntities.some((me) => me.derived_ext_id === s.ext_id))
                            : [
                                ...prev,
                                ...scopeEntities
                                  .filter((me) => !prev.some((s) => s.ext_id === me.derived_ext_id))
                                  .map((me) => ({
                                    kind: 'derived_model' as const,
                                    ext_id: me.derived_ext_id,
                                    name: `${template.name || template.ext_id} — ${me.name}`,
                                  })),
                              ];
                          setQueryOptions((o) => ({
                            ...o,
                            templates: {
                              ...o.templates,
                              selections: next,
                            },
                          }));
                        }}
                        className={`w-full flex items-center justify-between gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors ${
                          allSelected
                            ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-200'
                            : partiallySelected
                              ? 'bg-emerald-900/10 border-emerald-500/20 text-emerald-200/80'
                              : 'bg-black/20 border-white/5 text-white/90 hover:bg-white/5'
                        } ${isRunning ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                        title={template.ext_id}
                      >
                        <div className="min-w-0 flex-1 flex flex-col gap-0.5 overflow-hidden">
                          <div className="text-xs text-white/90 truncate">{template.name || template.ext_id}</div>
                          <div className="text-[10px] text-white/50 font-mono truncate">{template.ext_id}</div>
                        </div>
                        <span className="shrink-0 text-[10px] text-white/60">
                          {scopeEntities.length} in scope
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

        {queryMode === 'synthesize' && (
          <div className="shrink-0 flex flex-col gap-1 border-t border-white/10 pt-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] text-white/70 font-medium">Synthesize source steps</span>
              <span className="text-[10px] text-white/50">{sourceSteps.length} selected</span>
            </div>
            <div className="h-[3.5rem] overflow-y-auto rounded border border-white/10 bg-black/20 px-2 py-1 space-y-1">
              {sourceSteps.length === 0 ? (
                <div className="text-[10px] text-white/40 italic">No steps selected. In step mode the active step is used; in merge mode the checked steps are used.</div>
              ) : (
                sourceSteps.map((step, idx) => (
                  <div key={step.id} className="flex items-center gap-1.5 text-[10px] text-white/80">
                    <span className="px-1 rounded border border-white/10 bg-white/5 text-white/60 uppercase tracking-wide shrink-0">
                      {step.action_type || 'discover'}
                    </span>
                    <span className="truncate">
                      <span className="text-white/50 mr-1">#{idx + 1}</span>
                      {step.intent_text || 'Untitled query'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

      <div className="flex gap-2 shrink-0">
        <Button
          type="submit"
          disabled={isRunning || loading || (queryMode === 'models' ? !queryOptions.models?.selections?.length : queryMode === 'templates' ? !queryOptions.templates?.selections?.length : queryMode === 'prebuilt' ? false : !query.trim())}
          className="flex-1"
          size="sm"
        >
          {isRunning ? 'Running…' : (
            <>
              <Play className="w-4 h-4 mr-2" />
              {queryMode === 'synthesize' ? 'Synthesize' : queryMode === 'models' ? 'Run Models' : queryMode === 'templates' ? 'Run Templates' : 'Run Query'}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

const FACT_TYPES = ['world', 'experience', 'observation'];
const BUDGET_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'mid', label: 'Mid' },
  { value: 'high', label: 'High' },
] as const;

type Budget = 'low' | 'mid' | 'high';

function BudgetSelect({
  value,
  onChange,
  disabled,
}: {
  value?: Budget;
  onChange: (value: Budget) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/60">Budget</span>
      <select
        disabled={disabled}
        value={value || 'mid'}
        onChange={(e) => onChange(e.target.value as Budget)}
        className="h-7 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2 text-[10px] text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:opacity-50"
      >
        {BUDGET_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MaxTokensInput({
  value,
  onChange,
  disabled,
}: {
  value?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-white/60">Max tokens</span>
      <input
        type="number"
        min={1}
        max={128000}
        step={1}
        disabled={disabled}
        value={value ?? ''}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10);
          onChange(Number.isNaN(parsed) ? 0 : parsed);
        }}
        className="bg-black/20 border border-white/10 rounded text-[10px] text-white px-1.5 py-1 outline-none focus:border-emerald-500 disabled:opacity-50"
      />
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked?: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-1.5 text-[10px] text-white/80 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
      <Switch disabled={disabled} checked={!!checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  );
}
function RecallOptions({
  options,
  onChange,
  disabled,
}: {
  options?: ResearchQueryOptions['recall'];
  onChange: (options: ResearchQueryOptions['recall']) => void;
  disabled?: boolean;
}) {
  const opts = options || {};
  const types = opts.types || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-white/60">Fact types</span>
        <div className="space-y-1">
          {FACT_TYPES.map((t) => (
            <label key={t} className={`flex items-center gap-1.5 text-[10px] text-white/80 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
              <Checkbox
                disabled={disabled}
                checked={types.includes(t)}
                onCheckedChange={(checked) => {
                  const next = checked ? [...types, t] : types.filter((x) => x !== t);
                  onChange({ ...opts, types: next });
                }}
              />
              <span className="capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>
      <BudgetSelect value={opts.budget} onChange={(budget) => onChange({ ...opts, budget })} disabled={disabled} />
      <MaxTokensInput value={opts.maxTokens} onChange={(maxTokens) => onChange({ ...opts, maxTokens })} disabled={disabled} />
      <Toggle label="Include source facts" checked={opts.includeSourceFacts} onChange={(checked) => onChange({ ...opts, includeSourceFacts: checked })} disabled={disabled} />
      <Toggle label="Prefer observations" checked={opts.preferObservations} onChange={(checked) => onChange({ ...opts, preferObservations: checked })} disabled={disabled} />
    </div>
  );
}


function ReflectOptions({
  options,
  onChange,
  disabled,
}: {
  options?: ResearchQueryOptions['reflect'];
  onChange: (options: ResearchQueryOptions['reflect']) => void;
  disabled?: boolean;
}) {
  const opts = options || {};
  const factTypes = opts.factTypes || [];
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-white/60">Fact types</span>
        <div className="space-y-1">
          {FACT_TYPES.map((t) => (
            <label key={t} className={`flex items-center gap-1.5 text-[10px] text-white/80 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
              <Checkbox
                disabled={disabled}
                checked={factTypes.includes(t)}
                onCheckedChange={(checked) => {
                  const next = checked ? [...factTypes, t] : factTypes.filter((x) => x !== t);
                  onChange({ ...opts, factTypes: next });
                }}
              />
              <span className="capitalize">{t}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <BudgetSelect value={opts.budget} onChange={(budget) => onChange({ ...opts, budget })} disabled={disabled} />
        <MaxTokensInput value={opts.maxTokens} onChange={(maxTokens) => onChange({ ...opts, maxTokens })} disabled={disabled} />
      </div>
      <Toggle label="Include source facts" checked={opts.includeSourceFacts} onChange={(checked) => onChange({ ...opts, includeSourceFacts: checked })} disabled={disabled} />
      <Toggle label="Exclude mental models" checked={opts.excludeMentalModels} onChange={(checked) => onChange({ ...opts, excludeMentalModels: checked })} disabled={disabled} />
    </div>
  );
}

function SynthesizeOptions({
  options,
  onChange,
  disabled,
}: {
  options?: ResearchQueryOptions['synthesize'];
  onChange: (options: ResearchQueryOptions['synthesize']) => void;
  disabled?: boolean;
}) {
  const opts = options || {};
  return (
    <div className="space-y-2">
      <MaxTokensInput value={opts.maxTokens} onChange={(maxTokens) => onChange({ ...opts, maxTokens })} disabled={disabled} />
    </div>
  );
}
