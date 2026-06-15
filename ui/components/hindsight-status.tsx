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
  let indicatorColor = 'bg-white/20';
  if (pendingCount > 0) indicatorColor = 'bg-emerald-500';
  else if (failedCount > 0) indicatorColor = 'bg-red-500';
  else if (completedCount > 0) indicatorColor = 'bg-emerald-500';

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-3 py-1.5 hover:bg-white/[0.06] transition-colors"
      >
        <span className="relative flex h-2 w-2">
          {pendingCount > 0 ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${indicatorColor}`}></span>
            </>
          ) : (
            <span className={`inline-flex rounded-full h-2 w-2 ${indicatorColor}`}></span>
          )}
        </span>

        <div className="flex flex-col items-start min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <HindsightIcon className="h-3 w-3 text-white/40" />
            {hasActive ? (
              <>
                <span className="text-white/70 font-medium">
                  {pendingCount > 0
                    ? `${pendingCount} pending`
                    : failedCount > 0
                    ? `${failedCount} failed`
                    : `${completedCount} done`}
                </span>
                {ops.length > 1 && (
                  <span className="text-white/30">• {ops.length} total</span>
                )}
              </>
            ) : (
              <span className="text-white/50">Hindsight idle</span>
            )}
          </div>
        </div>

        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-white/40 ml-1" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-white/40 ml-1" />
        )}
      </button>

      {expanded && (
        <div className="absolute top-full left-0 mt-2 z-50 w-80 rounded-xl border border-white/10 bg-[oklch(0.18_0_0)] shadow-xl p-4 space-y-3">
          {error ? (
            <div className="text-xs text-red-400 text-center py-2">Failed to load status</div>
          ) : ops.length === 0 ? (
            <div className="text-xs text-white/40 text-center py-2">No Hindsight operations</div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {ops.map((op) => (
                  <div
                    key={op.pop_id}
                    className="flex items-start gap-2 rounded-lg bg-white/[0.03] p-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-white/70 font-mono truncate">
                          {op.pop_ext_id || `doc-${op.pop_doc_id}`}
                        </span>
                        <span className="text-white/30">→</span>
                        <span className="text-white/50 truncate">{op.pop_bank_id}</span>
                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${op.pop_status === 'processing' ? 'bg-sky-500/10 text-sky-400 border-sky-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                          <Clock className="h-3 w-3" />
                          {op.pop_status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-white/30">
                          {formatDistanceToNow(new Date(op.pop_created_at), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      {op.pop_error_message && (
                        <div className="text-[10px] text-red-400 mt-1 truncate" title={op.pop_error_message}>
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
