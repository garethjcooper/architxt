'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { mentalModelsApi, tagsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { X, Tag } from 'lucide-react';

interface ManageModelTagsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModelIds: number[];
  onTagsUpdated: () => void;
}

interface TagState {
  id: number;
  name: string;
  originalState: 'common' | 'partial' | 'none';
  currentState: 'common' | 'partial' | 'none';
  modelsWithTag: number;
  modelsCount: number;
}

export function ManageModelTagsDialog({
  isOpen,
  onClose,
  selectedModelIds,
  onTagsUpdated,
}: ManageModelTagsDialogProps) {
  const [tags, setTags] = useState<TagState[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen || selectedModelIds.length === 0) return;

    setSearchQuery('');

    const loadData = async () => {
      try {
        setLoading(true);

        const allTags = await tagsApi.list();
        const modelTagMap = new Map<number, number[]>();

        for (const mmId of selectedModelIds) {
          const modelTags = await mentalModelsApi.getTags(mmId);
          modelTagMap.set(mmId, modelTags.map((t) => t.id));
        }

        const tagStates: TagState[] = allTags.map((tag) => {
          let modelsWithTag = 0;
          for (const mmId of selectedModelIds) {
            if (modelTagMap.get(mmId)?.includes(tag.id)) {
              modelsWithTag++;
            }
          }

          let originalState: 'common' | 'partial' | 'none';
          if (modelsWithTag === selectedModelIds.length) {
            originalState = 'common';
          } else if (modelsWithTag > 0) {
            originalState = 'partial';
          } else {
            originalState = 'none';
          }

          return {
            id: tag.id,
            name: tag.name,
            originalState,
            currentState: originalState,
            modelsWithTag,
            modelsCount: selectedModelIds.length,
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
  }, [isOpen, selectedModelIds]);

  const handleTagToggle = (tagId: number) => {
    setTags((prev) =>
      prev.map((tag) => {
        if (tag.id !== tagId) return tag;

        const newState = (() => {
          if (tag.currentState === 'none') {
            return tag.originalState === 'none' ? 'common' : tag.originalState;
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
          return tag.originalState === 'common'
            ? { ...tag, currentState: 'none' }
            : { ...tag, currentState: tag.originalState };
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

      await mentalModelsApi.batchUpdateTags(selectedModelIds, tagsToAdd, tagsToRemove);

      toast.success(`Updated tags for ${selectedModelIds.length} mental model(s)`);
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
  const commonTags = allFilteredTags.filter((t) => t.currentState === 'common').sort((a, b) => a.name.localeCompare(b.name));
  const partialTags = allFilteredTags.filter((t) => t.currentState === 'partial').sort((a, b) => a.name.localeCompare(b.name));
  const removedTags = allFilteredTags.filter((t) => t.currentState === 'none' && t.originalState !== 'none').sort((a, b) => a.name.localeCompare(b.name));
  const availableTags = allFilteredTags.filter((t) => t.currentState === 'none' && t.originalState === 'none').sort((a, b) => a.name.localeCompare(b.name));

  const renderPill = (tag: TagState) => {
    const isRemoved = tag.originalState !== 'none' && tag.currentState === 'none';
    const isAdded = tag.originalState === 'none' && tag.currentState === 'common';
    const isAddedPartial = tag.originalState === 'partial' && tag.currentState === 'common';

    let label = tag.name;

    if (tag.currentState === 'partial') {
      label = `${tag.name} (${tag.modelsWithTag}/${tag.modelsCount})`;
    } else if (isAddedPartial) {
      label = `${tag.name} (+${tag.modelsCount - tag.modelsWithTag})`;
    } else if (isAdded) {
      label = `${tag.name} (+${tag.modelsCount})`;
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
            ? 'bg-badge-neutral-bg border-border-default text-foreground-subtle line-through hover:bg-surface-card'
            : tag.currentState === 'common'
              ? 'bg-badge-caution-bg border-badge-caution-bd text-badge-caution-fg'
              : tag.currentState === 'partial'
                ? 'bg-badge-neutral-bg border-badge-neutral-bd text-badge-neutral-fg hover:bg-badge-neutral-bg/70'
                : 'bg-surface-card border-border-default text-foreground-faint hover:bg-surface-hover hover:border-border-strong'
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
          <DialogTitle>Manage Model Tags</DialogTitle>
          <p className="text-sm text-foreground-faint mt-2">
            {selectedModelIds.length} mental model(s) selected
          </p>
        </DialogHeader>

        <div className="relative">
          <Tag className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-foreground-subtle pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded border border-border-strong bg-surface-card text-foreground-default placeholder-white/50 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle transition-colors"
          />
        </div>

        <div className="space-y-6 overflow-y-auto flex-1">
          <div>
            <h3 className="text-sm font-medium text-foreground-muted mb-2">On All Models</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-foreground-subtle italic">Loading tags...</p>
              ) : commonTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">{commonTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-foreground-subtle italic">No tags on all models</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground-muted mb-2">On Some Models</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-foreground-subtle italic">Loading tags...</p>
              ) : partialTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">{partialTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-foreground-subtle italic">No tags on some models</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground-muted mb-2">Marked for Removal</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-foreground-subtle italic">Loading tags...</p>
              ) : removedTags.length > 0 ? (
                <div className="flex flex-wrap gap-2 opacity-60">{removedTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-foreground-subtle italic">No tags marked for removal</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-foreground-muted mb-2">Available to Add</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-foreground-subtle italic">Loading tags...</p>
              ) : availableTags.length > 0 ? (
                <div className="flex flex-wrap gap-2">{availableTags.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-foreground-subtle italic">All tags are assigned</p>
              )}
            </div>
          </div>

          {tags.length === 0 && !loading && (
            <div className="text-center text-foreground-subtle py-8">No tags available</div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 border-t border-border-default">
          <Button variant="ghost" onClick={onClose} className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card">
            Close
          </Button>
          <Button onClick={handleSave} disabled={loading} className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default">
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
