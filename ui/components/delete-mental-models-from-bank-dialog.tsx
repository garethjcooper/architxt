'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ServerBankSelectors, type SelectorBank } from '@/app/research-shared/server-bank-selectors';
import { hindsightApi, serversApi } from '@/lib/api/client';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { HindsightIcon } from '@/components/icons/hindsight-icon';
import { AlertCircle, Loader2, CheckCircle2, XCircle, ServerOff } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { MentalModel } from '@/lib/types';

interface PreviewModel {
  mm_id: number;
  ext_id: string | null;
  name: string | null;
  is_template: boolean;
  template_role: string | null;
  derived: {
    ext_id: string;
    name: string | null;
    entity_id: string;
    entity_name: string;
    present: boolean;
  }[];
  present: boolean;
  missing_reason: string | null;
}

interface DeleteMentalModelsFromBankDialogProps {
  models: MentalModel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function DeleteMentalModelsFromBankDialog({
  models,
  open,
  onOpenChange,
  onDeleted,
}: DeleteMentalModelsFromBankDialogProps) {
  const [servers, setServers] = useState<Array<{ id: number; name?: string; base_url?: string }>>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [preview, setPreview] = useState<PreviewModel[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const modelIds = useMemo(() => models.map((m) => m.id).join(','), [models]);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  // Reset state when opening/closing.
  useEffect(() => {
    if (!open) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreview(null);
    setPreviewError(null);
    setLoadingServers(true);
    serversApi.list()
      .then((data) => {
        setServers(data || []);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setPreviewError(`Failed to load servers: ${message}`);
      })
      .finally(() => setLoadingServers(false));
  }, [open]);

  // Load banks when server selection changes.
  useEffect(() => {
    if (!selectedServerId) {
      setBanks([]);
      return;
    }
    setLoadingBanks(true);
    serversApi.listBanks(Number(selectedServerId))
      .then((data) => setBanks(data || []))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setPreviewError(`Failed to load banks: ${message}`);
      })
      .finally(() => setLoadingBanks(false));
  }, [selectedServerId]);

  // Fetch preview whenever the dialog opens with a valid server+bank selection,
  // or when the selection / selected models change.
  useEffect(() => {
    if (!open || !selectedServerId || !selectedBankId || loadingBanks) {
      if (!open || !selectedServerId || !selectedBankId) setPreview(null);
      return;
    }
    const mmIds = modelIds.split(',').map((id) => Number(id)).filter((id) => !Number.isNaN(id));
    if (mmIds.length === 0) {
      setPreview([]);
      return;
    }
    let ignore = false;
    setPreviewLoading(true);
    setPreviewError(null);
    hindsightApi.previewDeleteMentalModels(Number(selectedServerId), selectedBankId, mmIds)
      .then((result) => {
        if (!ignore) setPreview(result.models || []);
      })
      .catch((err) => {
        if (!ignore) {
          const message = err instanceof Error ? err.message : String(err);
          setPreviewError(message);
        }
      })
      .finally(() => {
        if (!ignore) setPreviewLoading(false);
      });
    return () => { ignore = true; };
  }, [open, selectedServerId, selectedBankId, modelIds, loadingBanks]);

  const presentExtIds = useMemo(() => {
    const ids: string[] = [];
    for (const model of preview || []) {
      if (model.is_template) {
        for (const d of model.derived) {
          if (d.present) ids.push(d.ext_id);
        }
      } else if (model.present && model.ext_id) {
        ids.push(model.ext_id);
      }
    }
    return ids;
  }, [preview]);

  const canDelete = presentExtIds.length > 0 && !deleteLoading;

  const handleDelete = async () => {
    if (!selectedServerId || !selectedBankId || presentExtIds.length === 0) return;
    setDeleteLoading(true);
    try {
      const result = await hindsightApi.deleteMentalModels(Number(selectedServerId), selectedBankId, presentExtIds);
      if (result.failed_count && result.failed_count > 0) {
        toast.error(`${result.failed_count} deletion${result.failed_count === 1 ? '' : 's'} failed`, {
          description: result.failed?.map((f) => `${f.ext_id}: ${f.error}`).join('\n'),
        });
      } else {
        toast.success(`Deleted ${result.deleted_count ?? presentExtIds.length} mental model${(result.deleted_count ?? presentExtIds.length) === 1 ? '' : 's'} from Hindsight`);
      }
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to delete mental models', { description: message });
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-foreground-default">
            <HindsightIcon className="h-5 w-5 text-destructive-fg" />
            Delete mental models from Hindsight bank
          </DialogTitle>
          <DialogDescription>
            Choose a server and bank. Only the selected models (or their derived instances) that are actually present on Hindsight will be deleted.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0">
          <ServerBankSelectors
            servers={servers}
            selectedServerId={selectedServerId}
            setSelectedServerId={setSelectedServerId}
            banks={banks}
            selectedBankId={selectedBankId}
            setSelectedBankId={setSelectedBankId}
            loadingBanks={loadingBanks}
            disabled={deleteLoading}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto py-2">
          {loadingServers && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-foreground-subtle">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading servers...
            </div>
          )}

          {previewError && (
            <Alert variant="destructive" className="mb-3">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap">{previewError}</AlertDescription>
            </Alert>
          )}

          {!selectedServerId && !loadingServers && (
            <div className="flex items-center gap-2 py-6 text-sm text-foreground-subtle">
              <ServerOff className="h-4 w-4" />
              Select a server and bank to see which models are present.
            </div>
          )}

          {previewLoading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-foreground-subtle">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking Hindsight...
            </div>
          )}

          {preview && preview.length > 0 && (
            <div className="space-y-2">
              {preview.map((model) => {
                const isParentDeletable = !model.is_template;
                const hasDerived = model.derived.length > 0;
                return (
                  <div
                    key={model.mm_id}
                    className={cn(
                      'rounded-md border overflow-hidden',
                      model.present && isParentDeletable
                        ? 'border-destructive-bd bg-destructive-bg/30'
                        : 'border-border-default bg-surface-card'
                    )}
                  >
                    <div className="flex items-center gap-2 px-3 py-2">
                      {model.present && isParentDeletable ? (
                        <CheckCircle2 className="h-4 w-4 text-destructive-fg shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-foreground-subtle shrink-0" />
                      )}
                      <span className="text-sm font-medium text-foreground-default truncate min-w-0 flex-1">
                        {model.name || model.ext_id || `Model ${model.mm_id}`}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-mono truncate shrink-0',
                          model.present && isParentDeletable ? 'text-destructive-fg' : 'text-foreground-subtle'
                        )}
                      >
                        {model.ext_id || `id:${model.mm_id}`}
                      </span>
                    </div>

                    {hasDerived && (
                      <div className="border-t border-border-default bg-surface-inset">
                        {model.derived.map((d) => (
                          <div
                            key={d.ext_id}
                            className={cn(
                              'flex items-center gap-2 px-3 py-1.5 text-xs',
                              d.present ? 'text-destructive-fg' : 'text-foreground-subtle'
                            )}
                          >
                            {d.present ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span className="text-foreground-default truncate min-w-0 flex-1">{d.name}</span>
                            <span className="font-mono truncate shrink-0">{d.ext_id}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center justify-between text-xs text-foreground-subtle px-1 pt-1">
                <span>
                  {presentExtIds.length} will be deleted · {(preview?.length ?? 0) > 0 ? preview.reduce((acc, m) => acc + (m.is_template ? m.derived.length : 1), 0) - presentExtIds.length : 0} not present
                </span>
              </div>
            </div>
          )}

          {preview && preview.length === 0 && !previewLoading && (
            <div className="text-sm text-foreground-subtle py-6 text-center">
              No models selected.
            </div>
          )}

          {!preview && selectedServerId && selectedBankId && !previewLoading && !previewError && (
            <div className="text-sm text-foreground-subtle py-6 text-center">
              Loading preview...
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleteLoading}
            className="border-border-strong text-foreground-default hover:bg-surface-panel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleDelete}
            disabled={!canDelete}
            className="bg-destructive-fg text-foreground-default hover:bg-destructive-fg/80 disabled:opacity-50"
          >
            {deleteLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Deleting...
              </>
            ) : (
              `Delete ${presentExtIds.length} from bank`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
