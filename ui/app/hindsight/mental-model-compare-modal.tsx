'use client';

import { useEffect } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';

interface MentalModelDivergence {
  name_differs: boolean;
  source_query_differs: boolean;
  tags_differs: boolean;
  max_tokens_differs: boolean;
  refresh_mode_differs: boolean;
  refresh_after_consolidation_differs: boolean;
  exclude_all_mental_models_differs: boolean;
  exclude_mental_model_list_differs: boolean;
  tags_match_mode_differs: boolean;
}

interface MentalModelValues {
  ext_id: string;
  name?: string | null;
  source_query?: string | null;
  composed_query?: string | null;
  tags?: string[];
  max_tokens?: number;
  refresh_mode?: string;
  refresh_after_consolidation?: boolean;
  exclude_all_mental_models?: boolean;
  exclude_mental_model_list?: string;
  tags_match_mode?: string;
  is_derived?: boolean;
  compose_error?: string | null;
}

interface MentalModelCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  ext_id: string;
  arch?: MentalModelValues;
  hind?: MentalModelValues;
  divergence?: MentalModelDivergence;
}

const FIELD_DEFS = [
  { key: 'name_differs', label: 'Name', archKey: 'name', hindKey: 'name' },
  { key: 'source_query_differs', label: 'Composed Query', archKey: 'composed_query', hindKey: 'source_query' },
  { key: 'tags_differs', label: 'Tags', archKey: 'tags', hindKey: 'tags' },
  { key: 'max_tokens_differs', label: 'Max Tokens', archKey: 'max_tokens', hindKey: 'max_tokens' },
  { key: 'refresh_mode_differs', label: 'Refresh Mode', archKey: 'refresh_mode', hindKey: 'refresh_mode' },
  { key: 'refresh_after_consolidation_differs', label: 'Refresh After Consolidation', archKey: 'refresh_after_consolidation', hindKey: 'refresh_after_consolidation' },
  { key: 'exclude_all_mental_models_differs', label: 'Exclude All Mental Models', archKey: 'exclude_all_mental_models', hindKey: 'exclude_all_mental_models' },
  { key: 'exclude_mental_model_list_differs', label: 'Exclude List', archKey: 'exclude_mental_model_list', hindKey: 'exclude_mental_model_list' },
  { key: 'tags_match_mode_differs', label: 'Tags Match Mode', archKey: 'tags_match_mode', hindKey: 'tags_match_mode' },
] as const;

function formatValue(val: any): string {
  if (val == null) return '(none)';
  if (Array.isArray(val)) return val.length === 0 ? '(none)' : val.join(', ');
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

function ComposeErrorBanner({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <div className="px-3 py-2 border-b border-diff-differ-bd bg-diff-differ-bg">
      <div className="text-[10px] text-diff-differ-fg font-medium">Compose error (architxt)</div>
      <div className="text-[11px] text-diff-differ-fg/70 break-all leading-relaxed">{error}</div>
    </div>
  );
}

export default function MentalModelCompareModal({
  isOpen,
  onClose,
  ext_id,
  arch,
  hind,
  divergence,
}: MentalModelCompareModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !divergence) return null;

  const fields = FIELD_DEFS.map((def) => {
    const differs = (divergence as any)[def.key];
    const archVal = formatValue((arch as any)?.[def.archKey]);
    const hindVal = formatValue((hind as any)?.[def.hindKey]);
    return { ...def, differs, archVal, hindVal };
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop-strong backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 bg-surface-panel border border-border-default rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default">
          <div>
            <h3 className="text-sm font-semibold text-foreground-default">Mental Model Comparison</h3>
            <p className="text-[11px] text-foreground-subtle font-mono mt-0.5">{ext_id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground-muted hover:bg-surface-card transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto space-y-2">
          {fields.map((field) => (
            <div
              key={field.key}
              className={`rounded border ${
                field.differs
                  ? 'border-diff-differ-bd bg-diff-differ-bg'
                  : 'border-diff-match-bd bg-diff-match-bg'
              }`}
            >
              {/* Field header */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle">
                {field.differs ? (
                  <AlertCircle className="h-3.5 w-3.5 text-diff-differ-fg" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-diff-match-fg" />
                )}
                <span className={`text-xs font-medium ${field.differs ? 'text-diff-differ-fg' : 'text-diff-match-fg'}`}>
                  {field.label}
                </span>
                <span className={`text-[10px] ml-auto ${field.differs ? 'text-diff-differ-fg/60' : 'text-diff-match-fg/60'}`}>
                  {field.differs ? 'Different' : 'Same'}
                </span>
              </div>

              {/* Side-by-side values (only when different) */}
              {field.differs && (
                <div className="grid grid-cols-2 gap-0 divide-x divide-white/5">
                  <div className="px-3 py-2">
                    <div className="text-[10px] text-foreground-placeholder uppercase tracking-wider mb-1">architxt</div>
                    {field.key === 'source_query_differs' && arch?.compose_error && (
                      <ComposeErrorBanner error={arch.compose_error} />
                    )}
                    <div className="text-[11px] text-foreground-faint break-all leading-relaxed">{field.archVal}</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[10px] text-foreground-placeholder uppercase tracking-wider mb-1">Hindsight</div>
                    <div className="text-[11px] text-foreground-faint break-all leading-relaxed">{field.hindVal}</div>
                  </div>
                </div>
              )}

              {/* Single value when same */}
              {!field.differs && (
                <div className="px-3 py-2">
                  {field.key === 'source_query_differs' && arch?.compose_error && (
                    <ComposeErrorBanner error={arch.compose_error} />
                  )}
                  <div className="text-[11px] text-foreground-subtle break-all leading-relaxed">{field.archVal}</div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border-default flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-medium bg-surface-card border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
