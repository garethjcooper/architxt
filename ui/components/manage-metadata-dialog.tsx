'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { documentsApi, metadataApi } from '@/lib/api/client';
import type { Document } from '@/lib/types/index';
import { toast } from 'sonner';
import { X, Braces } from 'lucide-react';

interface ManageMetadataDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDocIds: number[];
  onMetadataUpdated?: () => void;
}

interface MetadataState {
  id: number;
  key: string;
  value: string | null;
  originalState: 'none' | 'partial' | 'common';
  currentState: 'none' | 'partial' | 'common';
  docsCount: number;
  docsWithMetadata: number;
}

export function ManageMetadataDialog({
  isOpen,
  onClose,
  selectedDocIds,
  onMetadataUpdated,
}: ManageMetadataDialogProps) {
  const [metadata, setMetadata] = useState<MetadataState[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load documents and their metadata on open
  useEffect(() => {
    if (!isOpen || selectedDocIds.length === 0) return;

    // Reset filter when opening dialog
    setSearchQuery('');

    const loadData = async () => {
      try {
        setLoading(true);

        // Fetch all available metadata
        const allMetadata = await metadataApi.list();

        // Get metadata for each document
        const docMetaMap = new Map<number, number[]>();
        for (const docId of selectedDocIds) {
          const docMetadata = await documentsApi.getMetadata(docId);
          docMetaMap.set(docId, docMetadata.map((m) => m.id));
        }

        // Build metadata states based on current database state
        const metadataStates: MetadataState[] = allMetadata.map((meta) => {
          let docsWithMetadata = 0;
          for (const docId of selectedDocIds) {
            if (docMetaMap.get(docId)?.includes(meta.id)) {
              docsWithMetadata++;
            }
          }

          let originalState: 'common' | 'partial' | 'none';
          if (docsWithMetadata === selectedDocIds.length) {
            originalState = 'common';
          } else if (docsWithMetadata > 0) {
            originalState = 'partial';
          } else {
            originalState = 'none';
          }

          return {
            id: meta.id,
            key: meta.key,
            value: meta.value || null,
            originalState,
            currentState: originalState,
            docsCount: selectedDocIds.length,
            docsWithMetadata,
          };
        });

        setMetadata(metadataStates);
      } catch (error) {
        toast.error('Failed to load metadata');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, selectedDocIds]);

  const handleMetadataToggle = (metadataId: number) => {
    setMetadata((prev) =>
      prev.map((meta) => {
        if (meta.id !== metadataId) return meta;

        const newState = (() => {
          if (meta.currentState === 'none') {
            // If originally none (available), add to all
            if (meta.originalState === 'none') {
              return 'common';
            }
            // Otherwise (marked for removal), restore to original state
            return meta.originalState;
          } else if (meta.currentState === 'common') {
            return 'none'; // Remove from all
          } else {
            // Partial: add to remaining
            return 'common';
          }
        })();

        return { ...meta, currentState: newState };
      })
    );
  };

  const handleRemoveMetadata = (metadataId: number) => {
    setMetadata((prev) =>
      prev.map((meta) => {
        if (meta.id !== metadataId) return meta;

        // If currently common:
        if (meta.currentState === 'common') {
          // If originally common, mark for removal
          if (meta.originalState === 'common') {
            return { ...meta, currentState: 'none' };
          }
          // If originally partial or none, go back to original state
          return { ...meta, currentState: meta.originalState };
        }

        // If currently partial, remove completely
        if (meta.currentState === 'partial') {
          return { ...meta, currentState: 'none' };
        }

        // If currently none (marked for removal), restore to original state
        if (meta.currentState === 'none' && meta.originalState !== 'none') {
          return { ...meta, currentState: meta.originalState };
        }

        // If originally none and currently none (available), do nothing
        return meta;
      })
    );
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      // Calculate what changed
      const metadataToAdd: number[] = [];
      const metadataToRemove: number[] = [];

      for (const meta of metadata) {
        if (meta.currentState === 'common' && meta.originalState !== 'common') {
          metadataToAdd.push(meta.id);
        } else if (meta.currentState === 'none' && meta.originalState !== 'none') {
          metadataToRemove.push(meta.id);
        }
      }

      if (metadataToAdd.length === 0 && metadataToRemove.length === 0) {
        toast.info('No changes to save');
        onClose();
        return;
      }

      // Call batch API
      await documentsApi.batchUpdateMetadata(selectedDocIds, metadataToAdd, metadataToRemove);

      toast.success(`Updated metadata for ${selectedDocIds.length} document(s)`);

      onMetadataUpdated?.();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save metadata';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  // Filter metadata based on search
  const search = searchQuery.toLowerCase();
  const allFilteredMetadata = metadata.filter((m) =>
    `${m.key}=${m.value}`.toLowerCase().includes(search)
  );

  // Organize metadata into sections
  const commonMetadata = allFilteredMetadata
    .filter((m) => m.currentState === 'common')
    .sort((a, b) => `${a.key}=${a.value}`.localeCompare(`${b.key}=${b.value}`));
  const partialMetadata = allFilteredMetadata
    .filter((m) => m.currentState === 'partial')
    .sort((a, b) => `${a.key}=${a.value}`.localeCompare(`${b.key}=${b.value}`));
  const removedMetadata = allFilteredMetadata
    .filter((m) => m.originalState !== 'none' && m.currentState === 'none')
    .sort((a, b) => `${a.key}=${a.value}`.localeCompare(`${b.key}=${b.value}`));
  const availableMetadata = allFilteredMetadata
    .filter((m) => m.currentState === 'none' && m.originalState === 'none')
    .sort((a, b) => `${a.key}=${a.value}`.localeCompare(`${b.key}=${b.value}`));

  const renderPill = (meta: MetadataState) => {
    const isRemoved = meta.originalState !== 'none' && meta.currentState === 'none';
    const label = `${meta.key}=${meta.value}`;

    // Show count for partial metadata
    let displayLabel = label;
    if (meta.currentState === 'partial') {
      displayLabel = `${label} (${meta.docsWithMetadata}/${meta.docsCount})`;
    }

    return (
      <div
        key={`${meta.key}=${meta.value}`}
        onClick={() => {
          // Only allow toggling for partial and available metadata
          // Common metadata should only respond to X button
          if (meta.currentState === 'none' || meta.currentState === 'partial') {
            handleMetadataToggle(meta.id);
          }
        }}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs transition-all ${
          meta.currentState === 'common' ? '' : 'cursor-pointer'
        } ${
          isRemoved
            ? 'bg-slate-800/20 border-slate-600 text-white/40 line-through hover:bg-slate-800/30'
            : meta.currentState === 'common'
              ? 'bg-blue-500/20 border-blue-500/30 text-blue-300'
              : meta.currentState === 'partial'
                ? 'bg-slate-700/40 border-slate-600 text-white/70 hover:bg-slate-700/50'
                : 'bg-slate-800/30 border-slate-700 text-white/60 hover:bg-slate-700/30 hover:border-slate-600'
        }`}
      >
        <span className={isRemoved ? 'line-through' : ''}>{displayLabel}</span>
        {meta.currentState !== 'none' && !isRemoved && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveMetadata(meta.id);
            }}
            className="ml-1 hover:opacity-70 transition-opacity"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!w-[50vw] !max-w-none max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Metadata</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {selectedDocIds.length} document{selectedDocIds.length !== 1 ? 's' : ''} selected
          </p>
        </DialogHeader>

        {/* Search Box */}
        <div className="relative">
          <Braces className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/50 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by key or value..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded border border-white/20 bg-slate-800/50 text-white placeholder-white/50 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>

        <div className="space-y-6 overflow-y-auto flex-1">
          {/* On All Documents */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On All Documents</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading metadata...</p>
              ) : commonMetadata.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {commonMetadata.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No metadata on all documents</p>
              )}
            </div>
          </div>

          {/* On Some Documents */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On Some Documents</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading metadata...</p>
              ) : partialMetadata.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {partialMetadata.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No metadata on some documents</p>
              )}
            </div>
          </div>

          {/* Marked for Removal */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Marked for Removal</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading metadata...</p>
              ) : removedMetadata.length > 0 ? (
                <div className="flex flex-wrap gap-2 opacity-60">
                  {removedMetadata.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No metadata marked for removal</p>
              )}
            </div>
          </div>

          {/* Available to Add */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Available to Add</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading metadata...</p>
              ) : availableMetadata.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableMetadata.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">All metadata is assigned</p>
              )}
            </div>
          </div>

          {metadata.length === 0 && !loading && (
            <div className="text-center text-white/50 py-8">
              No metadata available
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-6 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={onClose}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
