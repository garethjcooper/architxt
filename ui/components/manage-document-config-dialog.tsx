'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { documentsApi, traceProfilesApi } from '@/lib/api/client';
import type { TraceProfile } from '@/lib/types';
import { toast } from 'sonner';
import { AlertTriangle, Calendar as CalendarIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import type { Document } from '@/lib/types/index';

interface ManageDocumentConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDocIds: number[];
  documents: Document[];
  onConfigUpdated: () => void;
}

interface DateFieldState {
  selectedValue: string | null;
  allSame: boolean;
  counts: Map<string | null, number>;
}

interface TraceProfileFieldState {
  selectedValue: string | null;
  allSame: boolean;
  counts: Map<string | null, number>;
}

export function ManageDocumentConfigDialog({
  isOpen,
  onClose,
  selectedDocIds,
  documents,
  onConfigUpdated,
}: ManageDocumentConfigDialogProps) {
  const [state, setState] = useState<DateFieldState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [traceState, setTraceState] = useState<TraceProfileFieldState | null>(null);
  const [traceEnabled, setTraceEnabled] = useState(false);
  const [traceProfiles, setTraceProfiles] = useState<TraceProfile[]>([]);

  const selectedDocs = useMemo(
    () => documents.filter((d) => selectedDocIds.includes(d.id)),
    [documents, selectedDocIds]
  );

  // Trace profile only applies to trace documents
  const traceDocs = useMemo(
    () => selectedDocs.filter((d) => d.source_type === 'trace'),
    [selectedDocs]
  );
  const hasNonTraceInSelection = selectedDocs.length > traceDocs.length;

  useEffect(() => {
    if (!isOpen) return;
    traceProfilesApi.list()
      .then(setTraceProfiles)
      .catch(() => setTraceProfiles([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || selectedDocs.length === 0) return;

    const counts = new Map<string | null, number>();
    for (const doc of selectedDocs) {
      const value = doc.timestamp ?? null;
      counts.set(value, (counts.get(value) || 0) + 1);
    }

    // Majority wins; blank on tie.
    let selectedValue: string | null = null;
    let maxCount = -1;
    let ties: (string | null)[] = [];

    for (const [value, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        selectedValue = value;
        ties = [value];
      } else if (count === maxCount) {
        ties.push(value);
      }
    }

    if (ties.length > 1) {
      selectedValue = null;
    }

    setState({
      selectedValue,
      allSame: counts.size <= 1,
      counts,
    });

    setEnabled(selectedDocs.length === 1);

    // Trace profile: same majority logic over trace docs only
    const tCounts = new Map<string | null, number>();
    for (const doc of traceDocs) {
      const value = doc.processing_options?.trace_profile ?? null;
      tCounts.set(value, (tCounts.get(value) || 0) + 1);
    }
    let tSelected: string | null = null;
    let tMax = -1;
    let tTies: (string | null)[] = [];
    for (const [value, count] of tCounts.entries()) {
      if (count > tMax) {
        tMax = count;
        tSelected = value;
        tTies = [value];
      } else if (count === tMax) {
        tTies.push(value);
      }
    }
    if (tTies.length > 1) tSelected = null;
    setTraceState({ selectedValue: tSelected, allSame: tCounts.size <= 1, counts: tCounts });
    setTraceEnabled(traceDocs.length > 0 && traceDocs.length <= selectedDocs.length);
  }, [isOpen, selectedDocs, traceDocs]);

  const timestamp = state?.selectedValue || '';

  const selectedDate = useMemo(() => {
    if (!timestamp) return undefined;
    try {
      const d = parseISO(timestamp);
      return isNaN(d.getTime()) ? undefined : d;
    } catch {
      return undefined;
    }
  }, [timestamp]);

  const selectedTime = useMemo(() => {
    if (!timestamp) return '';
    try {
      const d = parseISO(timestamp);
      return isNaN(d.getTime()) ? '' : format(d, 'HH:mm:ss');
    } catch {
      return '';
    }
  }, [timestamp]);

  const setDate = (date: Date | undefined) => {
    if (!date || !state) return;
    const result = new Date(date);
    if (selectedDate) {
      result.setHours(selectedDate.getHours(), selectedDate.getMinutes(), selectedDate.getSeconds(), 0);
    } else {
      result.setHours(0, 0, 0, 0);
    }
    setState({ ...state, selectedValue: result.toISOString() });
  };

  const setTime = (time: string) => {
    if (!state) return;
    if (!time || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
      if (timestamp) {
        const current = parseISO(timestamp);
        if (!isNaN(current.getTime())) {
          setState({ ...state, selectedValue: current.toISOString() });
        }
      }
      return;
    }
    const base = selectedDate ? new Date(selectedDate) : new Date();
    const [hours, minutes, seconds] = time.split(':').map(Number);
    base.setHours(hours, minutes, seconds, 0);
    setState({ ...state, selectedValue: base.toISOString() });
  };

  const impactedCount = useMemo(() => {
    if (!state) return 0;
    return selectedDocs.filter((d) => (d.timestamp ?? null) !== state.selectedValue).length;
  }, [selectedDocs, state]);

  const traceImpactedCount = useMemo(() => {
    if (!traceState) return 0;
    return traceDocs.filter((d) => (d.processing_options?.trace_profile ?? null) !== traceState.selectedValue).length;
  }, [traceDocs, traceState]);

  const traceStatusText = useMemo(() => {
    if (!traceState) return '';
    if (traceDocs.length === 0) return 'No trace documents in selection';
    if (traceState.allSame) return `Same on all ${traceDocs.length} trace document${traceDocs.length === 1 ? '' : 's'}`;
    const selectedCount = traceState.counts.get(traceState.selectedValue) || 0;
    const differentCount = traceDocs.length - selectedCount;
    const label = traceState.selectedValue ?? '—';
    return `${label} selected — ${selectedCount} match, ${differentCount} different`;
  }, [traceState, traceDocs]);

  // Changing the trace profile only makes sense when it actually changes on at
  // least one trace doc — re-extraction with a new profile may invalidate data.
  const traceProfileChanges = traceEnabled && traceState !== null && traceImpactedCount > 0;

  const statusText = useMemo(() => {
    if (!state) return '';
    if (state.allSame) {
      return `Same on all ${selectedDocs.length} documents`;
    }
    const selectedCount = state.counts.get(state.selectedValue) || 0;
    const differentCount = selectedDocs.length - selectedCount;
    const selectedLabel = state.selectedValue ?? '—';
    return `${selectedLabel} selected — ${selectedCount} match, ${differentCount} different`;
  }, [state, selectedDocs.length]);

  const handleSave = async () => {
    if (!state || (!enabled && !traceEnabled)) {
      toast.info('No fields selected to save');
      onClose();
      return;
    }

    try {
      setLoading(true);
      const payload: { timestamp?: string | null; trace_profile?: string | null } = {};
      if (enabled) payload.timestamp = state?.selectedValue ?? null;
      if (traceEnabled) payload.trace_profile = traceState?.selectedValue ?? null;
      const response = await documentsApi.batchUpdateConfig(selectedDocIds, payload);
      const skippedNote = response.trace_docs_skipped
        ? `, ${response.trace_docs_skipped} non-trace skipped`
        : '';
      toast.success(
        `Updated configuration for ${selectedDocIds.length} document(s) — ${response.docs_updated} changed${skippedNote}`
      );
      onConfigUpdated();
      onClose();
    } catch (err) {
      toast.error('Failed to update configuration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!w-[25vw] !max-w-none max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Document Configuration</DialogTitle>
          <p className="text-sm text-foreground-faint mt-2">
            {selectedDocIds.length} document(s) selected
          </p>
        </DialogHeader>

        <div className="space-y-3 flex-1 py-2">
          {state && (
            <div
              className={`flex items-center justify-between py-3 px-3 rounded border border-border-default bg-on-dark/[0.02] transition-opacity ${
                enabled ? '' : 'opacity-50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Checkbox
                  checked={enabled}
                  onCheckedChange={(checked) => setEnabled(checked === true)}
                  className="shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground-default">Document Date</p>
                  <p className="text-xs text-foreground-subtle">{statusText}</p>
                  {impactedCount === 0 ? (
                    <p className="text-xs text-accent-secondary-fg mt-0.5">
                      All {selectedDocs.length} document{selectedDocs.length === 1 ? '' : 's'} match
                    </p>
                  ) : (
                    <p className="text-xs text-accent-secondary-fg mt-0.5">
                      Will change {impactedCount} document{impactedCount === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Popover>
                  <PopoverTrigger className="inline-flex">
                    <div
                      className={cn(
                        'inline-flex items-center justify-start gap-2 rounded-lg border border-border-strong bg-transparent px-3 py-2 text-left text-foreground-default hover:bg-surface-card transition-colors',
                        !timestamp && 'text-foreground-subtle'
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 text-foreground-subtle shrink-0" />
                      {timestamp ? (
                        <span className="text-foreground-default">
                          {(() => {
                            try {
                              const d = parseISO(timestamp);
                              if (isNaN(d.getTime())) throw new Error('invalid');
                              return format(d, 'dd/MM/yyyy HH:mm:ss');
                            } catch {
                              return timestamp;
                            }
                          })()}
                        </span>
                      ) : (
                        <span>dd/mm/yyyy hh:mm:ss</span>
                      )}
                    </div>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <div className="p-3">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={setDate}
                        className="text-foreground-default"
                      />
                      <div className="flex items-center gap-2 px-2 pt-2 border-t border-border-default">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-[11px] text-foreground-subtle uppercase">Time</Label>
                          <input
                            type="text"
                            pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                            placeholder="HH:MM:SS"
                            value={selectedTime}
                            onChange={(e) => setTime(e.target.value)}
                            className="w-20 bg-surface-card border border-border-default rounded px-2 py-1 text-xs text-foreground-default placeholder:text-foreground-subtle focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring-subtle"
                          />
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          {/* Trace Profile — only meaningful when trace documents are selected */}
          {traceDocs.length > 0 && traceState && (
            <div
              className={`flex items-center justify-between py-3 px-3 rounded border border-border-default bg-on-dark/[0.02] transition-opacity ${
                traceEnabled ? '' : 'opacity-50'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Checkbox
                  checked={traceEnabled}
                  onCheckedChange={(checked) => setTraceEnabled(checked === true)}
                  className="shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground-default">Trace Profile</p>
                  <p className="text-xs text-foreground-subtle">{traceStatusText}</p>
                  {hasNonTraceInSelection && (
                    <p className="text-xs text-foreground-faint mt-0.5">
                      Applies to the {traceDocs.length} trace document{traceDocs.length === 1 ? '' : 's'} only — non-trace documents are skipped
                    </p>
                  )}
                  {traceProfileChanges && (
                    <p className="text-xs text-badge-caution-fg mt-0.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Will change {traceImpactedCount} trace document{traceImpactedCount === 1 ? '' : 's'} — re-extraction with a different profile may invalidate existing extracted data
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={traceState.selectedValue ?? '__none__'}
                  onChange={(e) => setTraceState({ ...traceState, selectedValue: e.target.value === '__none__' ? null : e.target.value })}
                  disabled={!traceEnabled}
                  className="h-10 w-44 rounded-lg border border-border-strong bg-surface-card px-3 text-sm text-foreground-default focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="__none__">— none —</option>
                  {traceProfiles.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 border-t border-border-default">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
          >
            Close
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || (!enabled && !traceEnabled)}
            className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
