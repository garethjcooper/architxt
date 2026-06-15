'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { documentsApi, tagsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { X, Tag } from 'lucide-react';

interface ManageTagsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDocIds: number[];
  onTagsUpdated: () => void;
}

interface TagState {
  id: number;
  name: string;
  originalState: 'common' | 'partial' | 'none'; // original state
  currentState: 'common' | 'partial' | 'none'; // current state after modifications
  docsWithTag: number; // number of docs that originally had this tag
  docsCount: number; // total docs selected
}

export function ManageTagsDialog({
  isOpen,
  onClose,
  selectedDocIds,
  onTagsUpdated,
}: ManageTagsDialogProps) {
  const [tags, setTags] = useState<TagState[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load documents and their tags on open
  useEffect(() => {
    if (!isOpen || selectedDocIds.length === 0) return;

    // Reset filter when opening dialog
    setSearchQuery('');

    const loadData = async () => {
      try {
        setLoading(true);

        // Fetch all available tags
        const allTags = await tagsApi.list();

        // Get tags for each document (fresh from database)
        const docTagMap = new Map<number, number[]>();
        for (const docId of selectedDocIds) {
          const docTags = await documentsApi.getTags(docId);
          docTagMap.set(docId, docTags.map((dt) => dt.id));
        }

        // Build tag states based on current database state
        const tagStates: TagState[] = allTags.map((tag) => {
          let docsWithTag = 0;
          for (const docId of selectedDocIds) {
            if (docTagMap.get(docId)?.includes(tag.id)) {
              docsWithTag++;
            }
          }

          let originalState: 'common' | 'partial' | 'none';
          if (docsWithTag === selectedDocIds.length) {
            originalState = 'common';
          } else if (docsWithTag > 0) {
            originalState = 'partial';
          } else {
            originalState = 'none';
          }

          return {
            id: tag.id,
            name: tag.name,
            originalState,
            currentState: originalState,
            docsWithTag,
            docsCount: selectedDocIds.length,
          };
        });

        setTags(tagStates);
      } catch (err) {
        toast.error('Failed to load tags');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, selectedDocIds]);

  const handleTagToggle = (tagId: number) => {
    setTags((prev) =>
      prev.map((tag) => {
        if (tag.id !== tagId) return tag;

        const newState = (() => {
          if (tag.currentState === 'none') {
            // If originally none (available pill), add to all
            if (tag.originalState === 'none') {
              return 'common';
            }
            // Otherwise (marked for removal), restore to original state
            return tag.originalState;
          } else if (tag.currentState === 'common') {
            return 'none'; // Remove from all
          } else {
            // Partial: add to remaining
            return 'common';
          }
        })();

        return { ...tag, currentState: newState };
      })
    );
  };

  const handleRemoveTag = (tagId: number) => {
    setTags((prev) =>
      prev.map((tag) => {
        if (tag.id !== tagId) return tag;

        // If currently common:
        if (tag.currentState === 'common') {
          // If originally common (was on all docs), mark for removal
          if (tag.originalState === 'common') {
            return { ...tag, currentState: 'none' };
          }
          // If originally partial or none, go back to original state
          return { ...tag, currentState: tag.originalState };
        }

        // If currently partial, remove completely
        if (tag.currentState === 'partial') {
          return { ...tag, currentState: 'none' };
        }

        // If currently none (marked for removal), restore to original state
        if (tag.currentState === 'none' && tag.originalState !== 'none') {
          return { ...tag, currentState: tag.originalState };
        }

        // If originally none and currently none (available pill), do nothing
        return tag;
      })
    );
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      // Calculate what changed
      const tagsToAdd: number[] = [];
      const tagsToRemove: number[] = [];

      for (const tag of tags) {
        if (tag.currentState === 'common' && tag.originalState !== 'common') {
          tagsToAdd.push(tag.id);
        } else if (tag.currentState === 'none' && tag.originalState !== 'none') {
          tagsToRemove.push(tag.id);
        }
      }

      if (tagsToAdd.length === 0 && tagsToRemove.length === 0) {
        toast.info('No changes to save');
        onClose();
        return;
      }

      // Call batch API
      await documentsApi.batchUpdateTags(selectedDocIds, tagsToAdd, tagsToRemove);

      toast.success(`Updated tags for ${selectedDocIds.length} document(s)`);

      onTagsUpdated();
      onClose();
    } catch (err) {
      toast.error('Failed to update tags');
    } finally {
      setLoading(false);
    }
  };

    // Organize tags into sections - show ALL tags with their current state, marking removed ones with strikethrough
  const allFilteredTags = tags.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const commonTags = allFilteredTags
    .filter((t) => t.currentState === 'common')
    .sort((a, b) => a.name.localeCompare(b.name));
  const partialTags = allFilteredTags
    .filter((t) => t.currentState === 'partial')
    .sort((a, b) => a.name.localeCompare(b.name));
  const removedTags = allFilteredTags
    .filter((t) => t.currentState === 'none' && t.originalState !== 'none')
    .sort((a, b) => a.name.localeCompare(b.name));
  const availableTags = allFilteredTags
    .filter((t) => t.currentState === 'none' && t.originalState === 'none')
    .sort((a, b) => a.name.localeCompare(b.name));

  const renderPill = (tag: TagState) => {
    const isRemoved = tag.originalState !== 'none' && tag.currentState === 'none';
    const isAdded = tag.originalState === 'none' && tag.currentState === 'common';
    const isAddedPartial = tag.originalState === 'partial' && tag.currentState === 'common';

    let label = tag.name;
    
    // Show count for partial tags (original or after adding)
    if (tag.currentState === 'partial') {
      label = `${tag.name} (${tag.docsWithTag}/${tag.docsCount})`;
    } else if (isAddedPartial) {
      // When partial was added to all
      label = `${tag.name} (+${tag.docsCount - tag.docsWithTag})`;
    } else if (isAdded) {
      // When white pill is added
      label = `${tag.name} (+${tag.docsCount})`;
    }

    return (
      <div
        key={tag.id}
        onClick={() => {
          // Only allow toggling for partial and available pills
          // Common pills (on all docs) should only respond to X button
          if (tag.currentState === 'none' || tag.currentState === 'partial') {
            handleTagToggle(tag.id);
          }
        }}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs transition-all ${
          tag.currentState === 'common' ? '' : 'cursor-pointer'
        } ${
          isRemoved
            ? 'bg-slate-800/20 border-slate-600 text-white/40 line-through hover:bg-slate-800/30'
            : tag.currentState === 'common'
              ? 'bg-orange-500/20 border-orange-500/30 text-orange-300'
              : tag.currentState === 'partial'
                ? 'bg-slate-700/40 border-slate-600 text-white/70 hover:bg-slate-700/50'
                : 'bg-slate-800/30 border-slate-700 text-white/60 hover:bg-slate-700/30 hover:border-slate-600'
        }`}
      >
        <span className={isRemoved ? 'line-through' : ''}>{label}</span>

        {tag.currentState !== 'none' && !isRemoved && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveTag(tag.id);
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
          <DialogTitle>Manage Tags</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {selectedDocIds.length} document(s) selected
          </p>
        </DialogHeader>

        {/* Search Box */}
        <div className="relative">
          <Tag className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/50 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded border border-white/20 bg-slate-800/50 text-white placeholder-white/50 focus:outline-none focus:border-orange-500/50 transition-colors"
          />
        </div>

        <div className="space-y-6 overflow-y-auto flex-1">
          {/* On All Documents */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On All Documents</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : commonTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {commonTags.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No tags on all documents</p>
              )}
            </div>
          </div>

          {/* On Some Documents */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On Some Documents</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : partialTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {partialTags.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No tags on some documents</p>
              )}
            </div>
          </div>

          {/* Marked for Removal */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Marked for Removal</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : removedTags.length > 0 ? (
                <div className="flex flex-wrap gap-2 opacity-60">
                  {removedTags.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No tags marked for removal</p>
              )}
            </div>
          </div>

          {/* Available to Add */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Available to Add</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : availableTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableTags.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">All tags are assigned</p>
              )}
            </div>
          </div>

          {tags.length === 0 && !loading && (
            <div className="text-center text-white/50 py-8">
              No tags available
            </div>
          )}
        </div>

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
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
