'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { directivesApi, tagsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { X, Tag } from 'lucide-react';

interface ManageDirectiveTagsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDirectiveIds: number[];
  onTagsUpdated: () => void;
}

interface TagState {
  id: number;
  name: string;
  originalState: 'common' | 'partial' | 'none';
  currentState: 'common' | 'partial' | 'none';
  directivesWithTag: number;
  directivesCount: number;
}

export function ManageDirectiveTagsDialog({
  isOpen,
  onClose,
  selectedDirectiveIds,
  onTagsUpdated,
}: ManageDirectiveTagsDialogProps) {
  const [tags, setTags] = useState<TagState[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen || selectedDirectiveIds.length === 0) return;

    setSearchQuery('');

    const loadData = async () => {
      try {
        setLoading(true);

        const allTags = await tagsApi.list();
        const directiveTagMap = new Map<number, number[]>();

        for (const dirId of selectedDirectiveIds) {
          const directiveTags = await directivesApi.getTags(dirId);
          directiveTagMap.set(dirId, directiveTags.map((dt) => dt.id));
        }

        const tagStates: TagState[] = allTags.map((tag) => {
          let directivesWithTag = 0;
          for (const dirId of selectedDirectiveIds) {
            if (directiveTagMap.get(dirId)?.includes(tag.id)) {
              directivesWithTag++;
            }
          }

          let originalState: 'common' | 'partial' | 'none';
          if (directivesWithTag === selectedDirectiveIds.length) {
            originalState = 'common';
          } else if (directivesWithTag > 0) {
            originalState = 'partial';
          } else {
            originalState = 'none';
          }

          return {
            id: tag.id,
            name: tag.name,
            originalState,
            currentState: originalState,
            directivesWithTag,
            directivesCount: selectedDirectiveIds.length,
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
  }, [isOpen, selectedDirectiveIds]);

  const handleTagToggle = (tagId: number) => {
    setTags((prev) =>
      prev.map((tag) => {
        if (tag.id !== tagId) return tag;

        const newState = (() => {
          if (tag.currentState === 'none') {
            if (tag.originalState === 'none') {
              return 'common';
            }
            return tag.originalState;
          } else if (tag.currentState === 'common') {
            return 'none';
          } else {
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

        if (tag.currentState === 'common') {
          if (tag.originalState === 'common') {
            return { ...tag, currentState: 'none' };
          }
          return { ...tag, currentState: tag.originalState };
        }

        if (tag.currentState === 'partial') {
          return { ...tag, currentState: 'none' };
        }

        if (tag.currentState === 'none' && tag.originalState !== 'none') {
          return { ...tag, currentState: tag.originalState };
        }

        return tag;
      })
    );
  };

  const handleSave = async () => {
    try {
      setLoading(true);

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

      await directivesApi.batchUpdateTags(selectedDirectiveIds, tagsToAdd, tagsToRemove);

      toast.success(`Updated tags for ${selectedDirectiveIds.length} directive${selectedDirectiveIds.length !== 1 ? 's' : ''}`);
      onTagsUpdated();
      onClose();
    } catch (err) {
      toast.error('Failed to update tags');
    } finally {
      setLoading(false);
    }
  };

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

    if (tag.currentState === 'partial') {
      label = `${tag.name} (${tag.directivesWithTag}/${tag.directivesCount})`;
    } else if (isAddedPartial) {
      label = `${tag.name} (+${tag.directivesCount - tag.directivesWithTag})`;
    } else if (isAdded) {
      label = `${tag.name} (+${tag.directivesCount})`;
    }

    return (
      <div
        key={tag.id}
        onClick={() => {
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
            {selectedDirectiveIds.length} directive{selectedDirectiveIds.length !== 1 ? 's' : ''} selected
          </p>
        </DialogHeader>

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
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On All Directives</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : commonTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">{commonTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">No tags on all directives</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On Some Directives</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : partialTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">{partialTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">No tags on some directives</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Marked for Removal</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : removedTags.length > 0 ? (
                <div className="flex flex-wrap gap-2 opacity-60">{removedTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">No tags marked for removal</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Available to Add</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading tags...</p>
              ) : availableTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">{availableTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">All tags are assigned</p>
              )}
            </div>
          </div>

          {tags.length === 0 && !loading && (
            <div className="text-center text-white/50 py-8">No tags available</div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 border-t border-white/10">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading}
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
