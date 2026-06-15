'use client';

import { useState, useEffect } from 'react';
import { hindsightApi } from '@/lib/api/client';
import { X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('CompareModal');

interface FieldCompare {
  name: string;
  architxt: any;
  hindsight: any;
  same: boolean;
}

interface CompareResult {
  ext_id: string;
  architxt_id: number;
  fields: FieldCompare[];
}

interface CompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  serverId: number;
  bankId: string;
  documentId: string;
}

const FIELD_LABELS: Record<string, string> = {
  content_hash: 'Content Hash',
  tags: 'Tags',
  metadata: 'Metadata',
  context: 'Context',
  event_date: 'Event Date',
};

function formatValue(val: any): string {
  if (val == null) return '(none)';
  if (Array.isArray(val)) return val.length === 0 ? '(none)' : val.join(', ');
  if (typeof val === 'object') {
    const entries = Object.entries(val);
    if (entries.length === 0) return '(none)';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }
  return String(val);
}

export default function CompareModal({ isOpen, onClose, serverId, bankId, documentId }: CompareModalProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);

  useEffect(() => {
    if (!isOpen || !documentId) return;

    setLoading(true);
    setResult(null);

    hindsightApi.compare(serverId, bankId, documentId)
      .then((data) => {
        setResult(data);
      })
      .catch((err: any) => {
        logger.error('Compare failed', err);
        toast.error(`Compare failed: ${err.message}`);
      })
      .finally(() => setLoading(false));
  }, [isOpen, documentId, serverId, bankId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 bg-[oklch(0.21_0_0)] border border-white/10 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div>
            <h3 className="text-sm font-semibold text-white/90">Document Comparison</h3>
            <p className="text-[11px] text-white/40 font-mono mt-0.5">{documentId}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
          {loading && (
            <div className="flex items-center gap-3 py-8 text-white/40">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Fetching detailed comparison...</span>
            </div>
          )}

          {!loading && !result && (
            <div className="py-8 text-center text-white/30 text-sm">Failed to load comparison</div>
          )}

          {result && (
            <div className="space-y-2">
              {result.fields.map((field) => (
                <div
                  key={field.name}
                  className={`rounded border ${
                    field.same
                      ? 'border-emerald-500/20 bg-emerald-900/10'
                      : 'border-red-500/20 bg-red-900/10'
                  }`}
                >
                  {/* Field header */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5">
                    {field.same ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                    )}
                    <span className={`text-xs font-medium ${field.same ? 'text-emerald-300' : 'text-red-300'}`}>
                      {FIELD_LABELS[field.name] || field.name}
                    </span>
                    <span className={`text-[10px] ml-auto ${field.same ? 'text-emerald-400/60' : 'text-red-400/60'}`}>
                      {field.same ? 'Same' : 'Different'}
                    </span>
                  </div>

                  {/* Side-by-side values */}
                  {!field.same && (
                    <div className="grid grid-cols-2 gap-0 divide-x divide-white/5">
                      <div className="px-3 py-2">
                        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">architxt</div>
                        <div className="text-[11px] text-white/60 break-all leading-relaxed">
                          {formatValue(field.architxt)}
                        </div>
                      </div>
                      <div className="px-3 py-2">
                        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Hindsight</div>
                        <div className="text-[11px] text-white/60 break-all leading-relaxed">
                          {formatValue(field.hindsight)}
                        </div>
                      </div>
                    </div>
                  )}

                  {field.same && (
                    <div className="px-3 py-2">
                      <div className="text-[11px] text-white/50 break-all leading-relaxed">
                        {formatValue(field.architxt)}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
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
