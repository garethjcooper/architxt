'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface ValueMismatch {
  entity_id: string;
  arch: string;
  hind: string;
}

interface TypeDivergence {
  id_differs: boolean;
  name_differs: boolean;
  description_differs: boolean;
  arch_count: number;
  hind_count: number;
  missing_in_arch: string[];
  missing_in_hind: string[];
  name_mismatches: ValueMismatch[];
  orphan_names?: string[];
  synced_fields?: string[];
}

interface EntityCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  ext_id: string;
  arch_count?: number;
  hind_count?: number;
  divergence?: TypeDivergence;
}

export default function EntityCompareModal({
  isOpen,
  onClose,
  ext_id,
  arch_count,
  hind_count,
  divergence,
}: EntityCompareModalProps) {
  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !divergence) return null;

  const syncedFields = divergence.synced_fields || ['id', 'name', 'description'];

  const fields = syncedFields.map((key) => {
    if (key === 'id') return { label: 'ID Field', differs: divergence.id_differs };
    if (key === 'name') return { label: 'Name Field', differs: divergence.name_differs };
    if (key === 'description') return { label: 'Description Field', differs: divergence.description_differs };
    return { label: key, differs: false };
  });

  const hasMissing = (divergence.missing_in_arch || []).length > 0 || (divergence.missing_in_hind || []).length > 0;
  const hasMismatches = (divergence.name_mismatches || []).length > 0;
  const hasOrphans = (divergence.orphan_names || []).length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 bg-[oklch(0.21_0_0)] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-semibold text-white/90">Entity Type Comparison</h3>
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
          {/* Count summary */}
          <div className="rounded border border-white/10 bg-white/[0.02] px-3 py-2 mb-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-white/50">architxt: <span className="text-white/80 font-mono">{arch_count ?? 0}</span> values</span>
              <span className="text-white/50">Bank: <span className="text-white/80 font-mono">{hind_count ?? 0}</span> values</span>
            </div>
          </div>

          {/* Schema field badges */}
          {fields.map((field) => (
            <div
              key={field.label}
              className={`rounded border ${
                field.differs
                  ? 'border-red-500/20 bg-red-900/10'
                  : 'border-emerald-500/20 bg-emerald-900/10'
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                <span
                  className={`h-2 w-2 rounded-full ${field.differs ? 'bg-red-400' : 'bg-emerald-400'}`}
                />
                <span className={`text-xs font-medium ${field.differs ? 'text-red-300' : 'text-emerald-300'}`}>
                  {field.label}
                </span>
                <span className={`text-[10px] ml-auto ${field.differs ? 'text-red-400/60' : 'text-emerald-400/60'}`}>
                  {field.differs ? 'Different' : 'Same'}
                </span>
              </div>
            </div>
          ))}

          {/* Name mismatches */}
          {hasMismatches && (
            <div className="rounded border border-red-500/20 bg-red-900/10">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-xs font-medium text-red-300">Name Mismatches</span>
                <span className="text-[10px] ml-auto text-red-400/60">{divergence.name_mismatches!.length}</span>
              </div>
              <div className="grid grid-cols-2 gap-0 divide-x divide-white/5">
                <div className="px-3 py-2">
                  <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">architxt</div>
                  <div className="space-y-1">
                    {divergence.name_mismatches!.map((m) => (
                      <div key={`arch-${m.entity_id}`} className="text-[11px] text-white/60">
                        <span className="font-mono text-white/40">{m.entity_id}</span>: {m.arch}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="px-3 py-2">
                  <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Hindsight</div>
                  <div className="space-y-1">
                    {divergence.name_mismatches!.map((m) => (
                      <div key={`hind-${m.entity_id}`} className="text-[11px] text-white/60">
                        <span className="font-mono text-white/40">{m.entity_id}</span>: {m.hind}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Missing in architxt */}
          {(divergence.missing_in_arch || []).length > 0 && (
            <div className="rounded border border-red-500/20 bg-red-900/10">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-xs font-medium text-red-300">Missing on architxt</span>
                <span className="text-[10px] ml-auto text-red-400/60">{divergence.missing_in_arch!.length}</span>
              </div>
              <div className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {divergence.missing_in_arch!.map((id) => (
                    <span key={id} className="text-[11px] font-mono text-white/60 bg-black/30 px-1.5 py-0.5 rounded">{id}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Missing in Hindsight */}
          {(divergence.missing_in_hind || []).length > 0 && (
            <div className="rounded border border-red-500/20 bg-red-900/10">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-xs font-medium text-red-300">Missing on Bank</span>
                <span className="text-[10px] ml-auto text-red-400/60">{divergence.missing_in_hind!.length}</span>
              </div>
              <div className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {divergence.missing_in_hind!.map((id) => (
                    <span key={id} className="text-[11px] font-mono text-white/60 bg-black/30 px-1.5 py-0.5 rounded">{id}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Orphan names */}
          {hasOrphans && (
            <div className="rounded border border-red-500/20 bg-red-900/10">
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                <span className="h-2 w-2 rounded-full bg-red-400" />
                <span className="text-xs font-medium text-red-300">Orphan Names</span>
                <span className="text-[10px] ml-auto text-red-400/60">{divergence.orphan_names!.length}</span>
              </div>
              <div className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {divergence.orphan_names!.map((name, i) => (
                    <span key={i} className="text-[11px] text-white/60 bg-black/30 px-1.5 py-0.5 rounded">{name}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!hasMismatches && !hasMissing && !hasOrphans && (
            <div className="text-center py-6 text-white/30 text-sm">No detailed differences found.</div>
          )}
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
