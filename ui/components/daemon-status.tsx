'use client';

import { useState, useEffect, useCallback } from 'react';
import { documentsApi } from '@/lib/api/client';
import { Activity, CheckCircle2, Loader2, Clock, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import { ArchitxtIcon } from '@/components/icons/architxt-icon';
import { formatDistanceToNow } from 'date-fns';
import { ConfirmDialog } from './confirm-dialog';

interface ProcessingStage {
  status: string;
  started_at?: string;
  completed_at?: string;
  metrics?: Record<string, any>;
  sub_progress?: {
    current: number;
    total: number;
    label: string;
    event?: string;
    durationMs?: number;
    tokens?: number;
  };
  timeline?: Array<{
    at: string;
    current: number;
    total: number;
    label: string;
    event?: string;
    durationMs?: number;
    tokens?: number;
  }>;
}

interface ProcessingProgress {
  pipeline: string[];
  current_step: number;
  started_at: string;
  updated_at: string;
  stages: Record<string, ProcessingStage>;
  current_stage: string;
}

interface ProcessingStatus {
  document: {
    id: number;
    ext_id: string | null;
    filename: string | null;
    status: string;
  };
  progress: ProcessingProgress | null;
  history: any | null;
}

export function DaemonStatus() {
  const [status, setStatus] = useState<ProcessingStatus | null>(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setError(false);
      setCancelError(null);
      const data = await documentsApi.getProcessingStatus();
      setStatus(data.processing);
    } catch (err) {
      setError(true);
    }
  }, []);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleCancel = useCallback(async () => {
    if (!status?.document?.id) return;
    
    setConfirmOpen(true);
  }, [status?.document?.id]);

  const executeCancel = useCallback(async () => {
    if (!status?.document?.id) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      await documentsApi.cancel(status.document.id);
      setStatus(null);
      setExpanded(false);
    } catch (err: any) {
      setCancelError(err?.message || 'Failed to cancel');
    } finally {
      setIsCancelling(false);
    }
  }, [status?.document?.id]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  const isProcessing = status != null && status.progress !== null;
  const progress = status?.progress ?? null;

  // Edge case: active processing reported but no progress data
  if (isProcessing && !progress) return null;

  const pipeline = progress?.pipeline || [];
  const currentStep = progress?.current_step ?? 0;
  const totalSteps = pipeline.length;
  const percent = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;
  const currentStageName = progress?.current_stage || pipeline[currentStep] || 'unknown';
  const doc = status?.document ?? null;

  return (
    <div className="relative mr-4">
      <button
        onClick={handleToggle}
        className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/10 px-3 py-1.5 hover:bg-white/[0.06] transition-colors"
      >
        <span className="relative flex h-2 w-2">
          {isProcessing ? (
            <>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </>
          ) : (
            <span className="inline-flex rounded-full h-2 w-2 bg-white/20"></span>
          )}
        </span>

        <div className="flex flex-col items-start min-w-0">
          <div className="flex items-center gap-1.5 text-xs">
            <ArchitxtIcon className="h-3 w-3 text-white/40" />
            {isProcessing && doc ? (
              <>
                <span className="text-white/70 font-medium">Doc #{doc.id}</span>
                <span className="text-white/30">•</span>
                <span className="text-emerald-400 font-medium">{currentStageName}</span>
                {(() => {
                  const sub = progress?.stages?.[currentStageName]?.sub_progress;
                  if (sub?.label) return (
                    <span className="text-white/40">• {sub.label}</span>
                  );
                  return null;
                })()}
              </>
            ) : (
              <span className="text-white/50">Extraction idle</span>
            )}
          </div>
          {isProcessing && (
            <div className="w-full h-1 bg-white/10 rounded-full mt-1 overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>

        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-white/40 ml-1" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-white/40 ml-1" />
        )}
      </button>

      {expanded && (
        <div className="absolute top-full right-0 mt-2 z-50 w-80 rounded-xl border border-white/10 bg-[oklch(0.18_0_0)] shadow-xl p-4 space-y-3">
          {isProcessing && progress && doc ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-emerald-400 animate-spin" />
                  <span className="text-sm font-medium text-white">Processing</span>
                </div>
                <span className="text-[11px] text-white/40">{percent}%</span>
              </div>

              <div className="rounded-lg bg-white/[0.03] p-2.5 space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-white/40">Document:</span>
                  <span className="text-white/70 font-mono">#{doc.id}</span>
                </div>
                {doc.ext_id && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-white/40">External ID:</span>
                    <span className="text-white/70 font-mono">{doc.ext_id}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-white/40">Status:</span>
                  <span className="text-emerald-400">{doc.status}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="h-3 w-3 text-white/30" />
                  <span className="text-white/40">Started</span>
                  <span className="text-white/60">
                    {progress.started_at && !Number.isNaN(Date.parse(progress.started_at))
                      ? formatDistanceToNow(new Date(progress.started_at), { addSuffix: true })
                      : '-'}
                  </span>
                </div>
              </div>

              {/* Cancel button */}
              <button
                onClick={handleCancel}
                disabled={isCancelling}
                className="flex items-center justify-center gap-1.5 w-full rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {isCancelling ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
                {isCancelling ? 'Cancelling...' : 'Cancel Processing'}
              </button>

              {cancelError && (
                <div className="text-[11px] text-red-400 text-center">{cancelError}</div>
              )}

              <div className="space-y-1">
                {pipeline.map((stageName) => {
                  const stage = progress.stages?.[stageName];
                  const isCompleted = stage?.status === 'completed';
                  const isCurrent = stageName === currentStageName;

                  return (
                    <div key={stageName} className="flex items-center gap-2">
                      <div className="flex-shrink-0 w-4 flex justify-center">
                        {isCompleted ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : isCurrent ? (
                          <Loader2 className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
                        ) : (
                          <div className="h-2 w-2 rounded-full bg-white/15" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span
                          className={`text-xs font-medium ${
                            isCompleted
                              ? 'text-emerald-400'
                              : isCurrent
                              ? 'text-white'
                              : 'text-white/30'
                          }`}
                        >
                          {stageName}
                        </span>
                        {isCurrent && stage?.sub_progress?.label && (
                          <span className="text-[10px] text-white/40">
                            {stage.sub_progress.label}
                          </span>
                        )}
                        {isCurrent && stage?.metrics?.avgDurationMs && (
                          <span className="text-[10px] text-white/40">
                            avg {stage.metrics.avgDurationMs < 1000 
                              ? `${stage.metrics.avgDurationMs}ms` 
                              : `${(stage.metrics.avgDurationMs / 1000).toFixed(1)}s`}
                            {stage.metrics.minDurationMs != null && stage.metrics.maxDurationMs != null && (
                              <> • min {(stage.metrics.minDurationMs / 1000).toFixed(1)}s / max {(stage.metrics.maxDurationMs / 1000).toFixed(1)}s</>
                            )}
                            {stage.metrics.totalTokens > 0 && (
                              <> • {stage.metrics.totalTokens.toLocaleString()} tokens</>
                            )}
                          </span>
                        )}
                        {isCurrent && (stage?.sub_progress?.total ?? 0) > 0 && (
                          <div className="w-24 h-0.5 bg-white/10 rounded-full mt-0.5">
                            <div
                              className="h-full bg-emerald-500/60 rounded-full transition-all duration-300"
                              style={{
                                width: `${Math.round(
                                  (((stage?.sub_progress?.current ?? 0)) / (stage?.sub_progress?.total ?? 1)) * 100
                                )}%`
                              }}
                            />
                          </div>
                        )}
                      </div>
                      {stage?.metrics?.durationMs && (
                        <span className="text-[11px] text-white/30 ml-auto">
                          {stage.metrics.durationMs < 1000
                            ? `${stage.metrics.durationMs}ms`
                            : `${(stage.metrics.durationMs / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-600 to-green-400 rounded-full transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>

              <div className="text-[10px] text-white/20 text-center">
                {currentStep} of {totalSteps} stages complete
              </div>
            </>
          ) : (
            <div className="text-xs text-white/40 text-center py-2">No documents currently processing</div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel Processing?"
        description={`Cancel processing of document #${status?.document?.id || ''}?\nFile: ${status?.document?.filename || 'unknown'}\n\nThe pipeline will abort at the next stage boundary. This action cannot be undone.`}
        onConfirm={executeCancel}
        confirmLabel={isCancelling ? 'Cancelling...' : 'Cancel Processing'}
        variant="destructive"
      />
    </div>
  );
}
