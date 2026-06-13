'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

export interface BatchItem {
  id: string | number;
  label: string;
}

export interface BatchResult {
  id: string | number;
  success: boolean;
  error?: string;
}

interface BatchProgressDialogProps {
  open: boolean;
  title: string;
  description?: string;
  items: BatchItem[];
  operation: (item: BatchItem) => Promise<void>;
  onComplete?: (results: BatchResult[]) => void;
  onClose: () => void;
}

export function BatchProgressDialog({
  open,
  title,
  description,
  items,
  operation,
  onComplete,
  onClose,
}: BatchProgressDialogProps) {
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState(0);
  const [results, setResults] = useState<BatchResult[]>([]);
  const [done, setDone] = useState(false);

  // Store operation in a ref so the effect doesn't re-trigger if the
  // function reference changes between renders.
  const operationRef = useRef(operation);
  operationRef.current = operation;

  const runBatch = useCallback(async () => {
    if (items.length === 0) {
      setDone(true);
      return;
    }

    setRunning(true);
    setCompleted(0);
    setFailed(0);
    setResults([]);
    setDone(false);

    const allResults: BatchResult[] = [];

    for (const item of items) {
      try {
        await operationRef.current(item);
        allResults.push({ id: item.id, success: true });
        setCompleted((prev) => prev + 1);
      } catch (err: any) {
        const message = err?.message || String(err) || 'Failed';
        allResults.push({ id: item.id, success: false, error: message });
        setFailed((prev) => prev + 1);
      }
    }

    setResults(allResults);
    setDone(true);
    setRunning(false);
    onComplete?.(allResults);
  }, [items, onComplete]);

  // Track previous open state so we can detect a fresh open
  const wasOpenRef = useRef(false);

  // Reset all progress state when the dialog is freshly opened
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setRunning(false);
      setCompleted(0);
      setFailed(0);
      setResults([]);
      setDone(false);
    }
    wasOpenRef.current = open;
  }, [open]);

  // Kick off the batch when the dialog is open and not running / not done
  useEffect(() => {
    if (open && !running && !done) {
      runBatch();
    }
  }, [open, runBatch, running, done]);

  // Guard against accidental page navigation while running
  useEffect(() => {
    if (!running) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [running]);

  // Prevent dismissal while running
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen && running) return;
    if (!isOpen) onClose();
  };

  const total = items.length;
  const handled = completed + failed;
  const percent = total > 0 ? Math.round((handled / total) * 100) : 0;
  const allSuccess = done && failed === 0 && completed === total;
  const hasFailures = failed > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {done ? (
              allSuccess ? (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-900/30">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                </div>
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-900/30">
                  <AlertTriangle className="h-5 w-5 text-amber-400" />
                </div>
              )
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-900/30">
                <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
              </div>
            )}
            <div>
              <DialogTitle>{title}</DialogTitle>
              {description && (
                <p className="text-sm text-white/70 mt-1">{description}</p>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-white/60">
              <span>
                {running
                  ? `Processing ${handled + 1} of ${total}…`
                  : done
                    ? allSuccess
                      ? 'Complete'
                      : 'Completed with errors'
                    : 'Waiting…'}
              </span>
              <span className="font-mono">
                {handled}/{total}
              </span>
            </div>
            <div className="h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  allSuccess
                    ? 'bg-emerald-500'
                    : hasFailures
                      ? 'bg-amber-500'
                      : 'bg-emerald-500'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span className="font-medium">{completed} succeeded</span>
            </div>
            {failed > 0 && (
              <div className="flex items-center gap-1.5 text-red-400">
                <XCircle className="h-3.5 w-3.5" />
                <span className="font-medium">{failed} failed</span>
              </div>
            )}
          </div>

          {/* Error list */}
          {done && hasFailures && (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 space-y-1.5">
              {results
                .filter((r) => !r.success)
                .map((r, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-xs text-red-300"
                  >
                    <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span className="break-all">
                      <span className="font-mono text-white/60">{r.id}</span>
                      {r.error && <span className="ml-1">— {r.error}</span>}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {done && (
          <div className="flex justify-end">
            <Button
              onClick={onClose}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
