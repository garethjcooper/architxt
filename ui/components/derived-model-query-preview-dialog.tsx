'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Eye, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DerivedMentalModel, MentalModelReturns } from '@/lib/types/index';
import { MENTAL_MODEL_RETURNS_OPTIONS } from '@/lib/types/index';
import { mentalModelsApi } from '@/lib/api/client';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface DerivedModelQueryPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  modelId: number;
  derived: DerivedMentalModel[];
}

type PreviewRow = DerivedMentalModel & {
  composed_query?: string | null;
  compose_error?: string | null;
};

type PreviewStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'done'; rows: PreviewRow[] };

function returnsLabel(value: MentalModelReturns): string {
  return MENTAL_MODEL_RETURNS_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function DerivedModelQueryPreviewDialog({
  isOpen,
  onClose,
  modelId,
  derived,
}: DerivedModelQueryPreviewDialogProps) {
  const [status, setStatus] = useState<PreviewStatus>({ state: 'idle' });
  const [selectedId, setSelectedId] = useState<string | number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStatus({ state: 'idle' });
      setSelectedId(null);
      return;
    }

    setStatus({ state: 'loading' });
    setSelectedId(null);

    let cancelled = false;

    mentalModelsApi
      .getDerived(modelId)
      .then((serverRows) => {
        if (cancelled) return;

        const composedByEntityId = new Map<string | number, PreviewRow>();
        for (const row of serverRows) {
          const entityId = row.derived_entity?.id;
          if (entityId != null) {
            composedByEntityId.set(entityId, row);
          }
        }

        const merged: PreviewRow[] = derived.map((d) => {
          const entityId = d.derived_entity?.id;
          const serverRow = entityId != null ? composedByEntityId.get(entityId) : undefined;
          return {
            ...d,
            composed_query: serverRow?.composed_query ?? null,
            compose_error: serverRow?.compose_error ?? null,
          };
        });

        setStatus({ state: 'done', rows: merged });
        if (merged.length > 0) {
          setSelectedId(merged[0].id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ state: 'error', message });
        toast.error(`Failed to load composed queries: ${message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, modelId, derived]);

  const rows = status.state === 'done' ? status.rows : [];
  const selectedRow = useMemo(
    () => rows.find((r) => r.id === selectedId) || rows[0] || null,
    [rows, selectedId]
  );

  const hasQuery = selectedRow && selectedRow.composed_query;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[85vw] !max-w-none max-h-[85vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle className="text-lg font-semibold text-white flex items-center gap-2">
            <Eye className="h-5 w-5 text-purple-400" />
            Provisioning Query Preview
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 text-xs text-white/50">
          Shows the fully composed query that will be used when this derived mental model is
          provisioned to Hindsight. The shape is determined by the model&apos;s <strong>Returns</strong> type.
        </div>

        <div className="flex-1 min-h-0 flex flex-row overflow-hidden px-6 py-3 gap-4">
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-auto">
              {status.state === 'loading' ? (
                <div className="h-full flex items-center justify-center gap-2 text-sm text-white/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading composed queries...
                </div>
              ) : status.state === 'error' ? (
                <div className="h-full flex items-center justify-center text-sm text-red-400">
                  {status.message}
                </div>
              ) : rows.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-white/50">
                  No derived instances selected.
                </div>
              ) : (
                <Table className="w-full caption-bottom text-sm table-fixed">
                  <TableHeader>
                    <TableRow className="border-b border-white/10 hover:bg-transparent">
                      <TableHead className="w-[28%] text-xs uppercase text-white/60 font-medium py-2 px-3">Name</TableHead>
                      <TableHead className="w-[28%] text-xs uppercase text-white/60 font-medium py-2 px-3">External ID</TableHead>
                      <TableHead className="w-[28%] text-xs uppercase text-white/60 font-medium py-2 px-3">Entity</TableHead>
                      <TableHead className="w-[16%] text-xs uppercase text-white/60 font-medium py-2 px-3">Returns</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const selected = selectedRow?.id === row.id;
                      const hasError = !!row.compose_error;
                      const hasContent = !!row.composed_query;

                      return (
                        <TableRow
                          key={row.id}
                          onClick={() => setSelectedId(row.id)}
                          className={`border-b border-white/5 cursor-pointer transition-colors ${
                            selected ? 'bg-purple-900/30' : 'hover:bg-white/5'
                          }`}
                        >
                          <TableCell className="py-2 px-3 text-xs text-white/80 truncate" title={row.name || '-'}>
                            {row.name || '-'}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-xs font-mono text-white/60 truncate" title={row.ext_id || '-'}>
                            {row.ext_id || '-'}
                          </TableCell>
                          <TableCell className="py-2 px-3 text-xs text-white/60 truncate" title={`${row.derived_entity?.entity_id} — ${row.derived_entity?.name}`}>
                            {row.derived_entity?.entity_id} — {row.derived_entity?.name}
                          </TableCell>
                          <TableCell className="py-2 px-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                                hasError
                                  ? 'bg-red-500/15 text-red-300 border-red-500/30'
                                  : hasContent
                                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                  : 'bg-slate-700/40 text-white/60 border-slate-600'
                              }`}
                              title={hasError ? (row.compose_error ?? undefined) : hasContent ? 'Composed query available' : 'No composed query'}
                            >
                              {returnsLabel(row.returns)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>

          <div className="w-1/2 min-w-[360px] flex flex-col border border-white/10 rounded-md overflow-hidden bg-black/20">
            <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-center justify-between">
              <span className="text-xs uppercase text-white/60 font-medium">Composed Query</span>
              {selectedRow && (
                <span className="text-[10px] text-white/40 tabular-nums">
                  {selectedRow.composed_query?.length?.toLocaleString() ?? 0} chars
                </span>
              )}
            </div>
            <div className="flex-1 overflow-auto p-3">
              {status.state === 'loading' ? (
                <div className="h-full flex items-center justify-center gap-2 text-sm text-white/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading...
                </div>
              ) : selectedRow?.compose_error ? (
                <div className="h-full flex flex-col gap-2">
                  <span className="text-xs font-medium text-red-300">Composition failed</span>
                  <pre className="text-xs font-mono text-red-300/80 whitespace-pre-wrap break-all">
                    {selectedRow.compose_error}
                  </pre>
                </div>
              ) : hasQuery ? (
                <pre className="text-xs font-mono text-white/80 whitespace-pre-wrap break-all">
                  {selectedRow.composed_query}
                </pre>
              ) : selectedRow ? (
                <div className="h-full flex items-center justify-center text-sm text-white/50">
                  No composed query available for this instance.
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-white/50">
                  Select a derived instance to view its composed query.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default DerivedModelQueryPreviewDialog;
