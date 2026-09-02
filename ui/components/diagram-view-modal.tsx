'use client';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MermaidEditor } from '@/components/mermaid-editor';

export interface DiagramViewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Diagram name shown in the header. */
  name?: string;
  /** Raw Mermaid source (without fence markers). */
  content: string;
}

export function DiagramViewModal({ open, onOpenChange, name, content }: DiagramViewModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col" showCloseButton>
        <DialogHeader className="shrink-0">
          <DialogTitle>{name || 'Diagram'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden">
          <MermaidEditor
            content={content}
            onChange={() => {}}
            name={name}
            readOnly
            className="h-full"
          />
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
