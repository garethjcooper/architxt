'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { documentsApi, contextsApi } from '@/lib/api/client';
import type { Document } from '@/lib/types/index';
import { toast } from 'sonner';
import { X, FolderOpen } from 'lucide-react';

interface ManageContextDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDocIds: number[];
  onContextUpdated?: () => void;
}

interface ContextState {
  id: number;
  description: string;
  originalState: 'none' | 'partial' | 'common';
  currentState: 'none' | 'partial' | 'common';
  docsCount: number;
  docsWithContext: number;
}

export function ManageContextDialog({
  isOpen,
  onClose,
  selectedDocIds,
  onContextUpdated,
}: ManageContextDialogProps) {
  const [contexts, setContexts] = useState<ContextState[]>([]);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Load documents and their contexts on open
  useEffect(() => {
    if (!isOpen || selectedDocIds.length === 0) return;

    setSearchQuery('');

    const loadData = async () => {
      try {
        setLoading(true);

        // Fetch document details
        const documents = await Promise.all(
          selectedDocIds.map((id) => documentsApi.get(id))
        );
        setDocs(documents);

        // Fetch all available contexts
        const allContexts = await contextsApi.list();

        // Build context states based on current database state
        const contextStates: ContextState[] = allContexts.map((ctx) => {
          let docsWithContext = 0;
          for (const docId of selectedDocIds) {
            if (documents.find((d) => d.id === docId)?.context_id === ctx.id) {
              docsWithContext++;
            }
          }

          let originalState: 'common' | 'partial' | 'none';
          if (docsWithContext === selectedDocIds.length) {
            originalState = 'common';
          } else if (docsWithContext > 0) {
            originalState = 'partial';
          } else {
            originalState = 'none';
          }

          return {
            id: ctx.id,
            description: ctx.description || 'Untitled Context',
            originalState,
            currentState: originalState,
            docsCount: selectedDocIds.length,
            docsWithContext,
          };
        });

        setContexts(contextStates);
      } catch (error) {
        toast.error('Failed to load contexts');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, selectedDocIds]);

  const handleContextToggle = (contextId: number) => {
    setContexts((prev) =>
      prev.map((ctx) => {
        if (ctx.id !== contextId) return ctx;

        const newState = (() => {
          if (ctx.currentState === 'none') {
            // If originally none (available pill), add to all
            if (ctx.originalState === 'none') {
              // Only allow adding if no other context is currently 'common'
              const hasCommonContext = prev.some(c => c.currentState === 'common');
              if (hasCommonContext) {
                toast.error('Only one context can be set for all documents');
                return 'none';
              }
              return 'common';
            }
            // Otherwise (marked for removal), restore to original state
            return ctx.originalState;
          } else if (ctx.currentState === 'common') {
            return 'none'; // Remove from all
          } else {
            // Partial: add to remaining
            // Only allow adding if no other context is currently 'common'
            const hasCommonContext = prev.some(c => c.id !== contextId && c.currentState === 'common');
            if (hasCommonContext) {
              toast.error('Only one context can be set for all documents');
              return 'partial';
            }
            return 'common';
          }
        })();

        return { ...ctx, currentState: newState };
      })
    );
  };

  const handleRemoveContext = (contextId: number) => {
    setContexts((prev) =>
      prev.map((ctx) => {
        if (ctx.id !== contextId) return ctx;

        // If currently common:
        if (ctx.currentState === 'common') {
          // If originally common (was on all docs), mark for removal
          if (ctx.originalState === 'common') {
            return { ...ctx, currentState: 'none' };
          }
          // If originally partial or none, go back to original state
          return { ...ctx, currentState: ctx.originalState };
        }

        // If currently partial:
        if (ctx.currentState === 'partial') {
          // Mark for removal (remove from all that have it)
          return { ...ctx, currentState: 'none' };
        }

        // If currently none (marked for removal), restore original
        if (ctx.originalState !== 'none') {
          return { ...ctx, currentState: ctx.originalState };
        }

        return ctx;
      })
    );
  };

  const filteredContexts = contexts.filter((ctx) =>
    (ctx.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const commonContexts = filteredContexts.filter((ctx) => ctx.currentState === 'common');
  const partialContexts = filteredContexts.filter((ctx) => ctx.currentState === 'partial');
  const markedForRemoval = filteredContexts.filter(
    (ctx) => ctx.currentState === 'none' && ctx.originalState !== 'none'
  );
  const availableContexts = filteredContexts.filter(
    (ctx) => ctx.currentState === 'none' && ctx.originalState === 'none'
  );

  const renderPill = (context: ContextState) => {
    const isRemoved = context.originalState !== 'none' && context.currentState === 'none';
    const isAdded = context.originalState === 'none' && context.currentState === 'common';
    const isAddedPartial = context.originalState === 'partial' && context.currentState === 'common';

    let label = context.description;

    // Show count for partial contexts
    if (context.currentState === 'partial') {
      label = `${context.description} (${context.docsWithContext}/${context.docsCount})`;
    } else if (isAddedPartial) {
      // When partial was added to all
      label = `${context.description} (+${context.docsCount - context.docsWithContext})`;
    } else if (isAdded) {
      // When white pill is added
      label = `${context.description} (+${context.docsCount})`;
    }

    return (
      <div
        key={context.id}
        onClick={() => {
          // Only allow toggling for partial and available pills
          if (context.currentState === 'none' || context.currentState === 'partial') {
            handleContextToggle(context.id);
          }
        }}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs transition-all ${
          context.currentState === 'common' ? '' : 'cursor-pointer'
        } ${
          isRemoved
            ? 'bg-slate-800/20 border-slate-600 text-white/40 line-through hover:bg-slate-800/30'
            : context.currentState === 'common'
              ? 'bg-violet-500/20 border-violet-500/30 text-violet-300'
              : context.currentState === 'partial'
                ? 'bg-slate-700/40 border-slate-600 text-white/70 hover:bg-slate-700/50'
                : 'bg-slate-800/30 border-slate-700 text-white/60 hover:bg-slate-700/30 hover:border-slate-600'
        }`}
      >
        <span className={isRemoved ? 'line-through' : ''}>{label}</span>

        {context.currentState !== 'none' && !isRemoved && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveContext(context.id);
            }}
            className="ml-1 hover:opacity-70 transition-opacity"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      // Calculate what context to set for all documents
      // Only one context can be common at a time
      const contextsToSet = commonContexts.filter(c => c.currentState === 'common');
      
      if (contextsToSet.length > 1) {
        toast.error('Only one context can be set as active for all documents');
        return;
      }

      // The new context ID (null if removing all)
      const newContextId = contextsToSet.length > 0 ? contextsToSet[0].id : null;

      // Use batch API to update all documents
      await documentsApi.batchUpdateContexts(selectedDocIds, newContextId);

      toast.success('Contexts updated successfully');
      onContextUpdated?.();
      onClose();
    } catch (error) {
      toast.error('Failed to save contexts');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!w-[50vw] !max-w-none max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Context</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {selectedDocIds.length} document{selectedDocIds.length !== 1 ? 's' : ''} selected
          </p>
        </DialogHeader>

        {/* Search Box */}
        <div className="relative">
          <FolderOpen className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/50 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by context..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded border border-white/20 bg-slate-800/50 text-white placeholder-white/50 focus:outline-none focus:border-violet-500/50 transition-colors"
          />
        </div>

        <div className="space-y-6 overflow-y-auto flex-1">
          {/* On All Documents */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On All Documents</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading contexts...</p>
              ) : commonContexts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {commonContexts.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No context on all documents</p>
              )}
            </div>
          </div>

          {/* On Some Documents */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On Some Documents</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading contexts...</p>
              ) : partialContexts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {partialContexts.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No context on some documents</p>
              )}
            </div>
          </div>

          {/* Marked for Removal */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Marked for Removal</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading contexts...</p>
              ) : markedForRemoval.length > 0 ? (
                <div className="flex flex-wrap gap-2 opacity-60">
                  {markedForRemoval.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No context marked for removal</p>
              )}
            </div>
          </div>

          {/* Available to Add */}
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Available to Add</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading contexts...</p>
              ) : availableContexts.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableContexts.map(renderPill)}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">All contexts are assigned</p>
              )}
            </div>
          </div>

          {contexts.length === 0 && !loading && (
            <div className="text-center text-white/50 py-8">
              No contexts available
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
            className="bg-violet-600 hover:bg-violet-700 text-white"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
