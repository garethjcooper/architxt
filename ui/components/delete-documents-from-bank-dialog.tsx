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
import type { Document } from '@/lib/types';

interface PreviewDocument {
  doc_id: number;
  ext_id: string | null;
  name: string | null;
  present: boolean;
  missing_reason: string | null;
}

interface DeleteDocumentsFromBankDialogProps {
  documents: Document[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}

export function DeleteDocumentsFromBankDialog({
  documents,
  open,
  onOpenChange,
  onDeleted,
}: DeleteDocumentsFromBankDialogProps) {
  const [servers, setServers] = useState<Array<{ id: number; name?: string; base_url?: string }>>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [preview, setPreview] = useState<PreviewDocument[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const docIds = useMemo(() => documents.map((d) => d.id).join(','), [documents]);

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
      .then((data) => setServers(data || []))
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
  // or when the selection / selected documents change.
  useEffect(() => {
    if (!open || !selectedServerId || !selectedBankId || loadingBanks) {
      if (!open || !selectedServerId || !selectedBankId) setPreview(null);
      return;
    }
    const ids = docIds.split(',').map((id) => Number(id)).filter((id) => !Number.isNaN(id));
    if (ids.length === 0) {
      setPreview([]);
      return;
    }
    let ignore = false;
    setPreviewLoading(true);
    setPreviewError(null);
    hindsightApi.previewDeleteDocuments(Number(selectedServerId), selectedBankId, ids)
      .then((result) => {
        if (!ignore) setPreview(result.documents || []);
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
  }, [open, selectedServerId, selectedBankId, docIds, loadingBanks]);

  const presentExtIds = useMemo(() => {
    return (preview || [])
      .filter((d) => d.present && d.ext_id)
      .map((d) => d.ext_id as string);
  }, [preview]);

  const canDelete = presentExtIds.length > 0 && !deleteLoading;

  const handleDelete = async () => {
    if (!selectedServerId || !selectedBankId || presentExtIds.length === 0) return;
    setDeleteLoading(true);
    try {
      const result = await hindsightApi.deleteDocuments(Number(selectedServerId), selectedBankId, presentExtIds);
      if (result.failed_count && result.failed_count > 0) {
        toast.error(`${result.failed_count} deletion${result.failed_count === 1 ? '' : 's'} failed`, {
          description: result.failed?.map((f) => `${f.ext_id}: ${f.error}`).join('\n'),
        });
      } else {
        toast.success(`Deleted ${result.deleted_count ?? presentExtIds.length} document${(result.deleted_count ?? presentExtIds.length) === 1 ? '' : 's'} from Hindsight`);
      }
      onDeleted?.();
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Failed to delete documents', { description: message });
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
            Delete documents from Hindsight bank
          </DialogTitle>
          <DialogDescription>
            Choose a server and bank. Only the selected documents that are actually present on Hindsight will be deleted.
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
              Select a server and bank to see which documents are present.
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
              {preview.map((doc) => (
                <div
                  key={doc.doc_id}
                  className={cn(
                    'rounded-md border overflow-hidden',
                    doc.present
                      ? 'border-destructive-bd bg-destructive-bg/30'
                      : 'border-border-default bg-surface-card'
                  )}
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    {doc.present ? (
                      <CheckCircle2 className="h-4 w-4 text-destructive-fg shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-foreground-subtle shrink-0" />
                    )}
                    <span className="text-sm font-medium text-foreground-default truncate min-w-0 flex-1">
                      {doc.name || doc.ext_id || `Document ${doc.doc_id}`}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-mono truncate shrink-0',
                        doc.present ? 'text-destructive-fg' : 'text-foreground-subtle'
                      )}
                    >
                      {doc.ext_id || `id:${doc.doc_id}`}
                    </span>
                  </div>

                  {doc.missing_reason && !doc.present && (
                    <div className="border-t border-border-default bg-surface-inset px-3 py-1.5 text-xs text-foreground-subtle">
                      {doc.missing_reason}
                    </div>
                  )}
                </div>
              ))}

              <div className="flex items-center justify-between text-xs text-foreground-subtle px-1 pt-1">
                <span>
                  {presentExtIds.length} will be deleted · {(preview?.length ?? 0) - presentExtIds.length} not present
                </span>
              </div>
            </div>
          )}

          {preview && preview.length === 0 && !previewLoading && (
            <div className="text-sm text-foreground-subtle py-6 text-center">
              No documents selected.
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
