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
          <DialogTitle className="text-lg font-semibold text-white flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-purple-400" />
            Composed Query Preview
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-2 text-xs text-white/50 space-y-1">
          <div>
            <span className="text-white/40">Role:</span>{' '}
            <span className="font-mono text-white/70">{role}</span>
          </div>
          <div>
            <span className="text-white/40">External ID:</span>{' '}
            <span className="font-mono text-white/70">{extId}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden px-6 py-3">
          <div className="flex-1 flex flex-col border border-white/10 rounded-md overflow-hidden bg-black/20">
            <div className="px-3 py-2 border-b border-white/10 bg-white/[0.03] flex items-center justify-between">
              <span className="text-xs uppercase text-white/60 font-medium">Composed Query</span>
              <span className="text-[10px] text-white/40 tabular-nums">
                {composedQuery?.length?.toLocaleString() ?? 0} chars
              </span>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {loading ? (
                <div className="h-full flex items-center justify-center gap-2 text-sm text-white/60">
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
                <pre className="text-xs font-mono text-white/80 whitespace-pre-wrap break-all">
                  {composedQuery}
                </pre>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-white/50">
                  No composed query available.
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

export default SystemTemplateQueryPreviewDialog;
