'use client';

import { useEffect } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';

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

interface DirectiveCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  ext_id: string;
  arch?: DirectiveValues;
  hind?: DirectiveValues;
  divergence?: DirectiveDivergence;
}

const FIELD_DEFS = [
  { key: 'name_differs', label: 'Name', archKey: 'name', hindKey: 'name' },
  { key: 'statement_differs', label: 'Statement', archKey: 'statement', hindKey: 'statement' },
  { key: 'priority_differs', label: 'Priority', archKey: 'priority', hindKey: 'priority' },
  { key: 'is_active_differs', label: 'Active', archKey: 'is_active', hindKey: 'is_active' },
  { key: 'tags_differs', label: 'Tags', archKey: 'tags', hindKey: 'tags' },
] as const;

function formatValue(val: any): string {
  if (val == null) return '(none)';
  if (Array.isArray(val)) return val.length === 0 ? '(none)' : val.join(', ');
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

export default function DirectiveCompareModal({
  isOpen,
  onClose,
  ext_id,
  arch,
  hind,
  divergence,
}: DirectiveCompareModalProps) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 bg-[oklch(0.21_0_0)] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-semibold text-white/90">Directive Comparison</h3>
            <p className="text-[11px] text-white/40 font-mono mt-0.5">{ext_id}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
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
                  ? 'border-red-500/20 bg-red-900/10'
                  : 'border-emerald-500/20 bg-emerald-900/10'
              }`}
            >
              {/* Field header */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                {field.differs ? (
                  <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <span className={`text-xs font-medium ${field.differs ? 'text-red-300' : 'text-emerald-300'}`}>
                  {field.label}
                </span>
                <span className={`text-[10px] ml-auto ${field.differs ? 'text-red-400/60' : 'text-emerald-400/60'}`}>
                  {field.differs ? 'Different' : 'Same'}
                </span>
              </div>

              {/* Side-by-side values (only when different) */}
              {field.differs && (
                <div className="grid grid-cols-2 gap-0 divide-x divide-white/5">
                  <div className="px-3 py-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">architxt</div>
                    <div className="text-[11px] text-white/60 break-all leading-relaxed">{field.archVal}</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Hindsight</div>
                    <div className="text-[11px] text-white/60 break-all leading-relaxed">{field.hindVal}</div>
                  </div>
                </div>
              )}

              {/* Single value when same */}
              {!field.differs && (
                <div className="px-3 py-2">
                  <div className="text-[11px] text-white/50 break-all leading-relaxed">{field.archVal}</div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs font-medium bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white/90 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
