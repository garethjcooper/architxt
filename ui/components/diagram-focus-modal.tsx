'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MermaidEditor } from '@/components/mermaid-editor';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';

export interface DiagramFocusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  content: string;
  /** Called when Apply is pressed. In read-only mode this is omitted and the modal shows only Close. */
  onApply?: (event: EnvelopeCopyEvent) => void;
  /** When true, renders a read-only view with no editing controls. */
  readOnly?: boolean;
}

export function DiagramFocusModal({ open, onOpenChange, name: initialName, content: initialContent, onApply, readOnly = false }: DiagramFocusModalProps) {
  const [draftName, setDraftName] = useState(initialName);
  const [draftContent, setDraftContent] = useState(initialContent);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftName(initialName);
    setDraftContent(initialContent);
    setError(null);
  }, [initialName, initialContent]);

  const handleApply = useCallback(() => {
    if (readOnly || error) return;
    onApply?.({ type: 'diagrams', payload: JSON.stringify([{ name: draftName, type: 'flowchart', content: draftContent }]), label: draftName });
    onOpenChange(false);
  }, [readOnly, error, onApply, draftName, draftContent, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col" showCloseButton>
        <DialogHeader className="shrink-0">
          <DialogTitle>{draftName || 'Diagram'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs text-white/60">Name:</span>
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              disabled={readOnly}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-black/30 border border-white/10 text-[12px] text-white/80 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="Diagram name"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <MermaidEditor
              content={draftContent}
              onChange={setDraftContent}
              onErrorChange={setError}
              name={draftName}
              readOnly={readOnly}
              className="h-full"
            />
          </div>
          <div className="shrink-0 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button type="button" size="sm" onClick={handleApply} disabled={!!error} title={error ? 'Fix the diagram error before applying' : 'Apply changes'}>
                Apply
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
