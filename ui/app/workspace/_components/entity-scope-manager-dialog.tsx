'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { entitiesApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { X, Boxes } from 'lucide-react';
import type { Entity } from '@/lib/types';

interface EntityScopeManagerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  scopeEntityIds: string[];
  onSave: (nextScopeEntityIds: string[]) => Promise<void>;
}

interface EntityItem {
  id: number;
  entityId: string;
  name: string;
  typeName: string;
}

export function EntityScopeManagerDialog({
  isOpen,
  onClose,
  scopeEntityIds,
  onSave,
}: EntityScopeManagerDialogProps) {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const scopeSet = useMemo(() => new Set(scopeEntityIds), [scopeEntityIds]);
  const [draftSet, setDraftSet] = useState<Set<string>>(() => new Set(scopeEntityIds));

  useEffect(() => {
    if (isOpen) {
      setDraftSet(new Set(scopeEntityIds));
      setSearchQuery('');

      let cancelled = false;
      setLoading(true);
      entitiesApi
        .list()
        .then((data) => {
          if (cancelled) return;
          setEntities(Array.isArray(data) ? data : []);
        })
        .catch(() => {
          if (cancelled) return;
          toast.error('Failed to load entities');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [isOpen, scopeEntityIds]);

  const handleToggle = (qualifiedId: string) => {
    setDraftSet((prev) => {
      const next = new Set(prev);
      if (next.has(qualifiedId)) {
        next.delete(qualifiedId);
      } else {
        next.add(qualifiedId);
      }
      return next;
    });
  };

  const handleRemove = (qualifiedId: string) => {
    setDraftSet((prev) => {
      const next = new Set(prev);
      next.delete(qualifiedId);
      return next;
    });
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave(Array.from(draftSet));
      toast.success('Entity scope updated');
      onClose();
    } catch (err) {
      toast.error('Failed to update entity scope');
    } finally {
      setSaving(false);
    }
  };

  const qualifiedId = (entity: Entity) => `${entity.type_name}:${entity.entity_id}`;

  const allFiltered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = entities;
    if (q) {
      list = entities.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.entity_id.toLowerCase().includes(q) ||
          e.type_name.toLowerCase().includes(q)
      );
    }
    return list
      .map((e) => ({ entity: e, qid: qualifiedId(e) }))
      .sort((a, b) => a.entity.name.localeCompare(b.entity.name));
  }, [entities, searchQuery]);

  const inScopeItems = allFiltered.filter(({ qid }) => draftSet.has(qid));
  const availableItems = allFiltered.filter(({ qid }) => !draftSet.has(qid));

  const renderPill = (entity: EntityItem, inScope: boolean) => {
    const qid = `${entity.typeName}:${entity.entityId}`;
    const label = `${qid} ${entity.name}`;

    return (
      <span
        key={entity.id}
        onClick={() => {
          if (!inScope) {
            handleToggle(`${entity.typeName}:${entity.entityId}`);
          }
        }}
        title={label}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] border truncate max-w-[200px] transition-all ${
          inScope ? '' : 'cursor-pointer'
        } ${
          inScope
            ? 'bg-purple-800/15 text-purple-400 border-purple-700/20'
            : 'bg-purple-800/15 text-purple-400 border-purple-700/20 hover:bg-purple-800/25 hover:border-purple-700/40'
        }`}
      >
        <span className="truncate">{label}</span>

        {inScope && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRemove(`${entity.typeName}:${entity.entityId}`);
            }}
            className="ml-1 hover:opacity-70 transition-opacity shrink-0"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </span>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="!w-[60vw] !max-w-none max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Entity Scope</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {inScopeItems.length} of {allFiltered.length} entities selected
          </p>
        </DialogHeader>

        <div className="relative">
          <Boxes className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-white/50 pointer-events-none" />
          <input
            type="text"
            placeholder="Filter by entity id, name or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-3 py-2 rounded border border-white/20 bg-slate-800/50 text-white placeholder-white/50 focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>

        <div className="space-y-6 overflow-y-auto flex-1">
          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">In scope</h3>
            <div className="max-h-40 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading entities...</p>
              ) : inScopeItems.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {inScopeItems.map(({ entity }) =>
                    renderPill(
                      {
                        id: entity.id,
                        entityId: entity.entity_id,
                        name: entity.name,
                        typeName: entity.type_name,
                      },
                      true
                    )
                  )}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">No entities in scope</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Available to add</h3>
            <div className="max-h-40 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading entities...</p>
              ) : availableItems.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableItems.map(({ entity }) =>
                    renderPill(
                      {
                        id: entity.id,
                        entityId: entity.entity_id,
                        name: entity.name,
                        typeName: entity.type_name,
                      },
                      false
                    )
                  )}
                </div>
              ) : (
                <p className="text-xs text-white/40 italic">All available entities are in scope</p>
              )}
            </div>
          </div>

          {!loading && entities.length === 0 && (
            <div className="text-center text-white/50 py-8">No entities available</div>
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
            disabled={loading || saving}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
