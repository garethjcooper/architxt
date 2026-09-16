'use client';

import { useState, useEffect, useCallback } from 'react';
import { hindsightApi } from '@/lib/api/client';
import { Clock, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { HindsightIcon } from '@/components/icons/hindsight-icon';
import { formatDistanceToNow } from 'date-fns';

interface PendingOp {
  pop_id: number;
  pop_operation_id: string;
  pop_server_id: number;
  pop_bank_id: string;
  pop_doc_id: number;
  pop_ext_id: string | null;
  pop_action: string;
  pop_status: string;  // raw Hindsight status: 'pending', 'processing', 'completed', 'failed', ...
  pop_error_message: string | null;
  pop_created_at: string;
}

export function HindsightStatus() {
  const [ops, setOps] = useState<PendingOp[]>([]);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchOps = useCallback(async () => {
    try {
      setError(false);
      const result = await hindsightApi.listAllOperations();
      setOps(result.operations || []);
    } catch (err) {
      setError(true);
    }
  }, []);

  useEffect(() => {
    fetchOps();
    const interval = setInterval(fetchOps, 5000);
    return () => clearInterval(interval);
  }, [fetchOps]);

  const isTerminal = (s: string) => ['completed', 'failed', 'acknowledged', 'cancelled', 'canceled'].includes(s);
  const isFailedLike = (s: string) => s === 'failed' || s === 'cancelled' || s === 'canceled';
  const pendingCount = ops.filter((op) => !isTerminal(op.pop_status)).length;
  const failedCount = ops.filter((op) => isFailedLike(op.pop_status)).length;
  const completedCount = ops.filter((op) => op.pop_status === 'completed').length;

  const hasActive = ops.length > 0;

  // Determine indicator colour
  let indicatorColor = 'bg-surface-strong';
  if (pendingCount > 0) indicatorColor = 'bg-accent-primary-solid';
  else if (failedCount > 0) indicatorColor = 'bg-destructive-fg';
  else if (completedCount > 0) indicatorColor = 'bg-accent-primary-solid';

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 rounded-lg bg-on-dark/[0.03] border border-border-default px-3 py-1.5 hover:bg-on-dark/[0.06] transition-colors"
      >
        <span className="relative flex h-2 w-2">
          {pendingCount > 0 ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-primary-solid opacity-75"></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${indicatorColor}`}></span>
            </>
          ) : (
            <span className={`inline-flex rounded-full h-2 w-2 ${indicatorColor}`}></span>
          )}
        </span>

        <div className="flex flex-col items-start min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <HindsightIcon className="h-3 w-3 text-foreground-subtle" />
            {hasActive ? (
              <>
                <span className="text-foreground-faint font-medium">
                  {pendingCount > 0
                    ? `${pendingCount} pending`
                    : failedCount > 0
                    ? `${failedCount} failed`
                    : `${completedCount} done`}
                </span>
                {ops.length > 1 && (
                  <span className="text-foreground-placeholder">• {ops.length} total</span>
                )}
              </>
            ) : (
              <span className="text-foreground-subtle">Hindsight idle</span>
            )}
          </div>
        </div>

        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-foreground-subtle ml-1" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-foreground-subtle ml-1" />
        )}
      </button>

      {expanded && (
        <div className="absolute top-full left-0 mt-2 z-50 w-80 rounded-xl border border-border-default bg-surface-raised shadow-xl p-4 space-y-3">
          {error ? (
            <div className="text-xs text-destructive-fg text-center py-2">Failed to load status</div>
          ) : ops.length === 0 ? (
            <div className="text-xs text-foreground-subtle text-center py-2">No Hindsight operations</div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {ops.map((op) => (
                  <div
                    key={op.pop_id}
                    className="flex items-start gap-2 rounded-lg bg-surface-card p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-foreground-faint font-mono truncate">
                          {op.pop_ext_id || `doc-${op.pop_doc_id}`}
                        </span>
                        <span className="text-foreground-placeholder">→</span>
                        <span className="text-foreground-subtle truncate">{op.pop_bank_id}</span>
                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${op.pop_status === 'processing' ? 'bg-badge-info-bg text-badge-info-fg border-badge-info-bd' : 'bg-badge-caution-bg text-badge-caution-fg border-badge-caution-bd'}`}>
                          <Clock className="h-3 w-3" />
                          {op.pop_status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-foreground-placeholder">
                          {formatDistanceToNow(new Date(op.pop_created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      {op.pop_error_message && (
                        <div className="text-[10px] text-destructive-fg mt-1 truncate" title={op.pop_error_message}>
                          {op.pop_error_message}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
