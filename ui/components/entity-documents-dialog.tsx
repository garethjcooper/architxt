'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, FileText } from 'lucide-react';
import { entitiesApi, documentsApi } from '@/lib/api/client';
import { EntityDetectionDialog } from './entity-detection-dialog';
import { toast } from 'sonner';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedEntityIds: number[];
}

interface RelatedDocument {
  id: number;
  ext_id: string | null;
  filename: string | null;
}

export function EntityDocumentsDialog({ isOpen, onClose, selectedEntityIds }: Props) {
  const [docs, setDocs] = useState<RelatedDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeDoc, setActiveDoc] = useState<{ id: number; content: string } | null>(null);
  const [fetchingDocId, setFetchingDocId] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen || selectedEntityIds.length === 0) {
      setDocs([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    entitiesApi.getDocuments(selectedEntityIds)
      .then((res) => {
        if (!cancelled) setDocs(res);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load related documents');
          setDocs([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [isOpen, selectedEntityIds]);

  const handleRowClick = async (doc: RelatedDocument) => {
    if (fetchingDocId === doc.id || activeDoc) return;
    setFetchingDocId(doc.id);
    try {
      const fullDoc = await documentsApi.get(doc.id);
      if (fullDoc.content) {
        setActiveDoc({ id: fullDoc.id, content: fullDoc.content });
      } else {
        toast.error('Document has no content to scan');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open document');
    } finally {
      setFetchingDocId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} modal={true}>
      <DialogContent className="sm:max-w-2xl bg-surface-card border-white/[0.08] text-white">
        <DialogHeader>
          <DialogTitle className="text-base font-medium text-white">
            Related documents
          </DialogTitle>
          <p className="text-xs text-white/50 mt-1">
            {selectedEntityIds.length} {selectedEntityIds.length === 1 ? 'entity' : 'entities'} selected
          </p>
        </DialogHeader>

        <div className="mt-4 rounded-md border border-white/[0.08] overflow-hidden">
          {loading && docs.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-accent-secondary-fg" />
            </div>
          ) : docs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-white/40">
              <FileText className="h-8 w-8 mb-3 opacity-30" />
              <span className="text-sm">No related documents found</span>
              <span className="text-xs mt-1">Try selecting different entities</span>
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-surface-card">
                  <TableRow className="border-b border-white/10 hover:bg-transparent">
                    <TableHead className="text-xs uppercase text-white/60 font-medium h-8 py-1.5 px-4 w-16">ID</TableHead>
                    <TableHead className="text-xs uppercase text-white/60 font-medium h-8 py-1.5 px-4 w-[35%]">External ID</TableHead>
                    <TableHead className="text-xs uppercase text-white/60 font-medium h-8 py-1.5 px-4">Filename</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => (
                    <TableRow
                      key={doc.id}
                      onClick={() => handleRowClick(doc)}
                      className="border-b border-white/[0.06] hover:bg-white/[0.06] cursor-pointer"
                    >
                      <TableCell className="py-1.5 px-4 text-xs font-mono text-white/70">
                        {fetchingDocId === doc.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-secondary-fg" />
                        ) : (
                          doc.id
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-white/80">{doc.ext_id || '-'}</TableCell>
                      <TableCell className="py-1.5 px-4 text-xs text-white/80 truncate max-w-[200px]">{doc.filename || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-white/[0.08] flex justify-end">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
        </div>

        {activeDoc && (
          <EntityDetectionDialog
            documentId={activeDoc.id}
            content={activeDoc.content}
            isOpen={true}
            onClose={() => setActiveDoc(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
