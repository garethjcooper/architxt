'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { documentsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { Calendar as CalendarIcon } from 'lucide-react';
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

  const selectedDocs = useMemo(
    () => documents.filter((d) => selectedDocIds.includes(d.id)),
    [documents, selectedDocIds]
  );

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
  }, [isOpen, selectedDocs]);

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
    if (!state || !enabled) {
      toast.info('No fields selected to save');
      onClose();
      return;
    }

    try {
      setLoading(true);
      const response = await documentsApi.batchUpdateConfig(selectedDocIds, {
        timestamp: state.selectedValue,
      });
      toast.success(
        `Updated configuration for ${selectedDocIds.length} document(s) — ${response.docs_updated} changed`
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
          <p className="text-sm text-white/60 mt-2">
            {selectedDocIds.length} document(s) selected
          </p>
        </DialogHeader>

        <div className="space-y-3 flex-1 py-2">
          {state && (
            <div
              className={`flex items-center justify-between py-3 px-3 rounded border border-white/10 bg-white/[0.02] transition-opacity ${
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
                  <p className="text-sm font-medium text-white/90">Document Date</p>
                  <p className="text-xs text-white/50">{statusText}</p>
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
                        'inline-flex items-center justify-start gap-2 rounded-lg border border-white/20 bg-transparent px-3 py-2 text-left text-white hover:bg-white/5 transition-colors',
                        !timestamp && 'text-white/40'
                      )}
                    >
                      <CalendarIcon className="h-4 w-4 text-white/50 shrink-0" />
                      {timestamp ? (
                        <span className="text-white">
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
                  <PopoverContent className="w-auto p-0 bg-[oklch(0.20_0_0)] border-white/20">
                    <div className="p-3">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={setDate}
                        className="text-white"
                      />
                      <div className="flex items-center gap-2 px-2 pt-2 border-t border-white/10">
                        <div className="flex items-center gap-1.5">
                          <Label className="text-[11px] text-white/40 uppercase">Time</Label>
                          <input
                            type="text"
                            pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                            placeholder="HH:MM:SS"
                            value={selectedTime}
                            onChange={(e) => setTime(e.target.value)}
                            className="w-20 bg-surface-card border border-white/10 rounded px-2 py-1 text-xs text-white placeholder:text-white/40 focus:border-focus-ring focus:outline-none focus:ring-1 focus:ring-focus-ring-subtle"
                          />
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !enabled}
            className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
