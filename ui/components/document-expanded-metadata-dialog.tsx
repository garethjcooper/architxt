'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, Sparkles } from 'lucide-react';
import { ArchitxtIcon } from './icons/architxt-icon';
import { documentsApi, type Metadata } from '@/lib/api/client';
import { toast } from 'sonner';

interface DocumentExpandedMetadataDialogProps {
  documentId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentExpandedMetadataDialog({
  documentId,
  open,
  onOpenChange,
}: DocumentExpandedMetadataDialogProps) {
  const [metadata, setMetadata] = useState<Metadata[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !documentId) {
      setMetadata([]);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const data = await documentsApi.getExpandedMetadata(documentId);
        setMetadata(data);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load metadata');
        setMetadata([]);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [open, documentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!w-[600px] !max-w-none max-h-[70vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-foreground-default flex items-center gap-2">
            <ArchitxtIcon className="h-5 w-5 text-foreground-faint" />
            Document Metadata
          </DialogTitle>
          <p className="text-xs text-foreground-subtle mt-1">
            Metadata tags associated with this document
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 mt-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 text-foreground-subtle animate-spin" />
              <span className="ml-2 text-sm text-foreground-subtle">Loading metadata...</span>
            </div>
          ) : metadata.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-foreground-subtle">
              <FileText className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No metadata available</p>
            </div>
          ) : (
            <div className="space-y-2">
              {metadata.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${
                    m.expanded
                      ? 'bg-badge-caution-bg/50 border-badge-caution-bd/50'
                      : 'bg-on-dark/[0.03] border-border-default'
                  }`}
                >
                  {/* Key */}
                  <span className="text-xs font-mono text-foreground-faint shrink-0 w-40 truncate">
                    {m.key}
                  </span>

                  {/* Value */}
                  <span className="text-xs text-foreground-muted flex-1 min-w-0 truncate">
                    {m.value ?? '-'}
                  </span>

                  {/* Badges */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {m.expanded && (
                      <Badge className="bg-badge-caution-bg text-badge-caution-fg border-badge-caution-bd/50 text-[10px] px-1.5 py-0">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Computed
                      </Badge>
                    )}
                    {m.generated_by === 'user' && (
                      <Badge className="bg-badge-info-bg text-badge-info-fg border-badge-info-bd/50 text-[10px] px-1.5 py-0">
                        User
                      </Badge>
                    )}
                    {m.generated_by === 'import' && (
                      <Badge className="bg-badge-entity-bg text-badge-entity-fg border-badge-entity-bd/50 text-[10px] px-1.5 py-0">
                        Import
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pt-3 border-t border-border-default">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
