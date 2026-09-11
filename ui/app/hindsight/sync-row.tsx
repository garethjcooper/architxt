'use client';

import { GitCompare, Clock, ScanSearch } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { getStatusBadge, familyClass } from '@/lib/status-badge';

interface Divergence {
  content_differs: boolean;
  tags_differs: boolean;
  metadata_differs: boolean;
  context_differs: boolean;
  date_differs: boolean;
}

const statusBadgeClass: Record<string, string> = {
  uploaded:              familyClass.info,
  ready_to_extract:      familyClass.info,
  processing_extract:    familyClass.caution,
  request_release:       familyClass.caution,
  processed_extract_success: familyClass.success,
  processed_extract_failed:  familyClass.danger,
  publishing:            familyClass.caution,
  published:             familyClass.success,
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
  archHasEntities?: boolean;
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
          ? 'bg-diff-differ-bg text-diff-differ-fg border-diff-differ-bd'
          : 'bg-diff-match-bg text-diff-match-fg border-diff-match-bd';
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
  archHasEntities,
  divergence,
  isSelected,
  onSelect,
  showCheckbox = true,
  showCompare,
  onCompare,
  pendingStatus,
}: SyncRowProps) {
  return (
    <div className={`px-3 py-2 border-b border-border-subtle hover:bg-surface-card transition-colors ${isSelected ? 'bg-on-dark/[0.04]' : ''}`}>
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
            <span className="text-xs font-mono text-foreground-faint truncate" title={ext_id}>{ext_id}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {archStatus && archStatus !== 'processed_extract_success' && (
                <span className={getStatusBadge(archStatus).className}>
                  {getStatusBadge(archStatus).label}
                </span>
              )}
              {archHasEntities && (
                <span className={`${familyClass.entity} text-[10px] px-1.5 py-0.5 gap-1`} title="Entities detected in extracted content">
                  <ScanSearch className="h-3 w-3" />
                  Detected
                </span>
              )}
              {pendingStatus && (
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${pendingStatus === 'processing' ? familyClass.info : familyClass.caution}`} title={`Async task — ${pendingStatus}`}>
                  <Clock className="h-3 w-3" />
                  {pendingStatus}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-0.5 mt-1 text-[11px]">
            {archFilename && (
              <span className="flex items-center gap-1.5 min-w-0 truncate" title={`${archFilename} • ${archHash || ''}`}>
                <span className="text-foreground-subtle shrink-0">A: {archFilename}</span>
                {archHash && <span className="text-foreground-placeholder font-mono text-[10px] shrink-0">{archHash.slice(0, 8)}</span>}
              </span>
            )}
            {!archFilename && archHash && (
              <span className="text-foreground-placeholder font-mono text-[10px] truncate" title={archHash}>A-hash: {archHash.slice(0, 8)}</span>
            )}
            {hindTitle && (
              <span className="flex items-center gap-1.5 min-w-0 truncate" title={`${hindTitle} • ${hindHash || ''}`}>
                <span className="text-foreground-subtle shrink-0">H: {hindTitle}</span>
                {hindHash && <span className="text-foreground-placeholder font-mono text-[10px] shrink-0">{hindHash.slice(0, 8)}</span>}
              </span>
            )}
          </div>

          <div className="flex items-start justify-between gap-2">
            <DivergenceBadges divergence={divergence} />
            {showCompare && divergence && (
              <button
                onClick={(e) => { e.stopPropagation(); onCompare?.(); }}
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-card border border-border-default text-foreground-subtle hover:bg-surface-panel hover:text-foreground-muted transition-colors shrink-0 mt-1.5"
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
