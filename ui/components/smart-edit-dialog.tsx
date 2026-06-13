'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SmartDocumentEditor } from './smart-document-editor';

interface SmartEditDialogProps {
  documentId: number;
  content: string | null;
  contentBlocks?: any[] | null;
  contentLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function SmartEditDialog({
  documentId,
  content,
  contentBlocks,
  contentLoading,
  isOpen,
  onClose,
  onSaved,
}: SmartEditDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="!w-[85vw] !max-w-none h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">Smart Edit</DialogTitle>
        </DialogHeader>
        <SmartDocumentEditor
          documentId={documentId}
          content={content}
          contentBlocks={contentBlocks}
          contentLoading={contentLoading}
          onSaved={onSaved}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
