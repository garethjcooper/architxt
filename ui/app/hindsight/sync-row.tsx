'use client';

import { GitCompare, Clock } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

interface Divergence {
  content_differs: boolean;
  tags_differs: boolean;
  metadata_differs: boolean;
  context_differs: boolean;
  date_differs: boolean;
}

const statusBadgeClass: Record<string, string> = {
  uploaded:              'bg-fuchsia-800/15 text-fuchsia-400 border-fuchsia-700/20',
  ready_to_extract:      'bg-sky-800/15 text-sky-400 border-sky-700/20',
  processing_extract:    'bg-amber-800/15 text-amber-400 border-amber-700/20',
  request_release:       'bg-yellow-800/15 text-yellow-400 border-yellow-700/20',
  processed_extract_success: 'bg-emerald-800/15 text-emerald-400 border-emerald-700/20',
  processed_extract_failed:  'bg-rose-800/15 text-rose-400 border-rose-700/20',
  publishing:            'bg-orange-800/15 text-orange-400 border-orange-700/20',
  published:             'bg-emerald-800/15 text-emerald-400 border-emerald-700/20',
};

const statusLabel: Record<string, string> = {
  uploaded: 'uploaded',
  ready_to_extract: 'ready',
  processing_extract: 'extracting',
  request_release: 'releasing',
  processed_extract_success: 'extracted',
  processed_extract_failed: 'failed',
  publishing: 'publishing',
  published: 'published',
};

interface SyncRowProps {
  ext_id: string;
  archFilename?: string;
  hindTitle?: string;
  archHash?: string;
  hindHash?: string;
  archStatus?: string;
  divergence?: Divergence;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  showCheckbox?: boolean;
  showCompare?: boolean;
  onCompare?: () => void;
  pendingStatus?: string | null;
}

function DivergenceBadges({ divergence }: { divergence?: Divergence }) {
  if (!divergence) return null;

  const fields = [
    { label: 'content', differs: divergence.content_differs },
    { label: 'tags', differs: divergence.tags_differs },
    { label: 'metadata', differs: divergence.metadata_differs },
    { label: 'context', differs: divergence.context_differs },
    { label: 'date', differs: divergence.date_differs },
  ];

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {fields.map((f) => {
        const color = f.differs
          ? 'bg-red-500/15 text-red-300 border-red-500/25'
          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25';
        return (
          <span key={f.label} className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${color}`}>
            {f.label}
          </span>
        );
      })}
    </div>
  );
}

export default function SyncRow({
  ext_id,
  archFilename,
  hindTitle,
  archHash,
  hindHash,
  archStatus,
  divergence,
  isSelected,
  onSelect,
  showCheckbox = true,
  showCompare,
  onCompare,
  pendingStatus,
}: SyncRowProps) {
  return (
    <div className={`px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors ${isSelected ? 'bg-white/[0.04]' : ''}`}>
      <div className="flex items-start gap-2">
        {showCheckbox && (
          <div className="pt-0.5 shrink-0">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelect(checked === true)}
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-white/60 truncate" title={ext_id}>{ext_id}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {archStatus && (
                <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusBadgeClass[archStatus] || 'bg-neutral-500/15 text-neutral-300 border-neutral-400/30'}`}>
                  {statusLabel[archStatus] || archStatus}
                </span>
              )}
              {pendingStatus && (
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${pendingStatus === 'processing' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`} title={`Async task — ${pendingStatus}`}>
                  <Clock className="h-3 w-3" />
                  {pendingStatus}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-1 text-[11px]">
            {archFilename && (
              <span className="flex items-center gap-1.5 truncate max-w-[140px]" title={`${archFilename} • ${archHash || ''}`}>
                <span className="text-white/40">A: {archFilename}</span>
                {archHash && <span className="text-white/20 font-mono text-[10px]">{archHash.slice(0, 8)}</span>}
              </span>
            )}
            {!archFilename && archHash && (
              <span className="text-white/20 font-mono text-[10px]" title={archHash}>A-hash: {archHash.slice(0, 8)}</span>
            )}
            {hindTitle && (
              <span className="flex items-center gap-1.5 truncate max-w-[140px]" title={`${hindTitle} • ${hindHash || ''}`}>
                <span className="text-white/40">H: {hindTitle}</span>
                {hindHash && <span className="text-white/20 font-mono text-[10px]">{hindHash.slice(0, 8)}</span>}
              </span>
            )}
            {!hindTitle && hindHash && (
              <span className="text-white/20 font-mono text-[10px]" title={hindHash}>H-hash: {hindHash.slice(0, 8)}</span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2">
            <DivergenceBadges divergence={divergence} />
            {showCompare && divergence && (
              <button
                onClick={(e) => { e.stopPropagation(); onCompare?.(); }}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80 transition-colors shrink-0 mt-1.5"
                title="Compare"
              >
                <GitCompare className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
