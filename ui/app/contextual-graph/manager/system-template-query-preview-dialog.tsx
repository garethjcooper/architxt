'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageSquareText, Loader2 } from 'lucide-react';
import type { ModelRef } from '@/lib/contextual-graph/display';

interface SystemTemplateQueryPreviewDialogProps {
  isOpen: boolean;
  onClose: () => void;
  refItem: ModelRef | null;
  composedQuery: string | null;
  composeError: string | null;
  loading: boolean;
}

export function SystemTemplateQueryPreviewDialog({
  isOpen,
  onClose,
  refItem,
  composedQuery,
  composeError,
  loading,
}: SystemTemplateQueryPreviewDialogProps) {
  const extId = refItem?.ext_id || '-';
  const role = refItem?.role || '-';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!w-[70vw] !max-w-none max-h-[80vh] overflow-hidden p-0 flex flex-col">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle className="text-lg font-semibold text-foreground-default flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-accent-tertiary-fg" />
            Composed Query Preview
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 text-xs text-foreground-subtle space-y-1">
          <div>
            <span className="text-foreground-subtle">Role:</span>{' '}
            <span className="font-mono text-foreground-faint">{role}</span>
          </div>
          <div>
            <span className="text-foreground-subtle">External ID:</span>{' '}
            <span className="font-mono text-foreground-faint">{extId}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-6 py-3">
          <div className="flex-1 flex flex-col border border-border-default rounded-md overflow-hidden bg-surface-inset">
            <div className="px-3 py-2 border-b border-border-default bg-on-dark/[0.03] flex items-center justify-between">
              <span className="text-xs uppercase text-foreground-faint font-medium">Composed Query</span>
              <span className="text-[10px] text-foreground-subtle tabular-nums">
                {composedQuery?.length?.toLocaleString() ?? 0} chars
              </span>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {loading ? (
                <div className="h-full flex items-center justify-center gap-2 text-sm text-foreground-faint">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Composing query...
                </div>
              ) : composeError ? (
                <div className="h-full flex flex-col gap-2">
                  <span className="text-xs font-medium text-destructive-fg">Composition failed</span>
                  <pre className="text-xs font-mono text-destructive-fg/80 whitespace-pre-wrap break-all">
                    {composeError}
                  </pre>
                </div>
              ) : composedQuery ? (
                <pre className="text-xs font-mono text-foreground-muted whitespace-pre-wrap break-all">
                  {composedQuery}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-foreground-subtle">
                  No composed query available.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-border-default flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SystemTemplateQueryPreviewDialog;
