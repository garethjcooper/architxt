'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { mentalModelsApi, entitiesApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { X, Boxes } from 'lucide-react';

interface ManageModelEntitiesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModelIds: number[];
  onEntitiesUpdated: () => void;
}

interface EntityState {
  id: number;
  entityId: string;
  name: string;
  typeName: string;
  originalState: 'common' | 'partial' | 'none';
  currentState: 'common' | 'partial' | 'none';
  modelsWithEntity: number;
  modelsCount: number;
}

export function ManageModelEntitiesDialog({
  isOpen,
  onClose,
  selectedModelIds,
  onEntitiesUpdated,
}: ManageModelEntitiesDialogProps) {
  const [entities, setEntities] = useState<EntityState[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!isOpen || selectedModelIds.length === 0) return;

    setSearchQuery('');

    const loadData = async () => {
      try {
        setLoading(true);

        const allEntities = await entitiesApi.list();
        const modelEntityMap = new Map<number, number[]>();

        for (const mmId of selectedModelIds) {
          const modelEntities = await mentalModelsApi.getEntities(mmId);
          modelEntityMap.set(mmId, modelEntities.map((e) => e.id));
        }

        const entityStates: EntityState[] = allEntities.map((entity) => {
          let modelsWithEntity = 0;
          for (const mmId of selectedModelIds) {
            if (modelEntityMap.get(mmId)?.includes(entity.id)) {
              modelsWithEntity++;
            }
          }

          let originalState: 'common' | 'partial' | 'none';
          if (modelsWithEntity === selectedModelIds.length) {
            originalState = 'common';
          } else if (modelsWithEntity > 0) {
            originalState = 'partial';
          } else {
            originalState = 'none';
          }

          return {
            id: entity.id,
            entityId: entity.entity_id,
            name: entity.name,
            typeName: entity.type_name,
            originalState,
            currentState: originalState,
            modelsWithEntity,
            modelsCount: selectedModelIds.length,
          };
        });

        setEntities(entityStates);
      } catch (err) {
        toast.error('Failed to load entities');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isOpen, selectedModelIds]);

  const handleEntityToggle = (entityId: number) => {
    setEntities((prev) =>
      prev.map((entity) => {
        if (entity.id !== entityId) return entity;

        const newState = (() => {
          if (entity.currentState === 'none') {
            return entity.originalState === 'none' ? 'common' : entity.originalState;
          } else if (entity.currentState === 'common') {
            return 'none';
          } else {
            return 'common';
          }
        })();

        return { ...entity, currentState: newState };
      })
    );
  };

  const handleRemoveEntity = (entityId: number) => {
    setEntities((prev) =>
      prev.map((entity) => {
        if (entity.id !== entityId) return entity;

        if (entity.currentState === 'common') {
          return entity.originalState === 'common'
            ? { ...entity, currentState: 'none' }
            : { ...entity, currentState: entity.originalState };
        }

        if (entity.currentState === 'partial') {
          return { ...entity, currentState: 'none' };
        }

        if (entity.currentState === 'none' && entity.originalState !== 'none') {
          return { ...entity, currentState: entity.originalState };
        }

        return entity;
      })
    );
  };

  const handleSave = async () => {
    try {
      setLoading(true);

      const entitiesToAdd: number[] = [];
      const entitiesToRemove: number[] = [];

      for (const entity of entities) {
        if (entity.currentState === 'common' && entity.originalState !== 'common') {
          entitiesToAdd.push(entity.id);
        } else if (entity.currentState === 'none' && entity.originalState !== 'none') {
          entitiesToRemove.push(entity.id);
        }
      }

      if (entitiesToAdd.length === 0 && entitiesToRemove.length === 0) {
        toast.info('No changes to save');
        onClose();
        return;
      }

      await mentalModelsApi.batchUpdateEntities(selectedModelIds, entitiesToAdd, entitiesToRemove);

      toast.success(`Updated entities for ${selectedModelIds.length} mental model(s)`);
      onEntitiesUpdated();
      onClose();
    } catch (err) {
      toast.error('Failed to update entities');
    } finally {
      setLoading(false);
    }
  };

  const allFiltered = entities.filter((e) =>
    e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.entityId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.typeName.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const commonEntities = allFiltered.filter((e) => e.currentState === 'common').sort((a, b) => a.name.localeCompare(b.name));
  const partialEntities = allFiltered.filter((e) => e.currentState === 'partial').sort((a, b) => a.name.localeCompare(b.name));
  const removedEntities = allFiltered.filter((e) => e.currentState === 'none' && e.originalState !== 'none').sort((a, b) => a.name.localeCompare(b.name));
  const availableEntities = allFiltered.filter((e) => e.currentState === 'none' && e.originalState === 'none').sort((a, b) => a.name.localeCompare(b.name));

  const renderPill = (entity: EntityState) => {
    const isRemoved = entity.originalState !== 'none' && entity.currentState === 'none';
    const isAdded = entity.originalState === 'none' && entity.currentState === 'common';
    const isAddedPartial = entity.originalState === 'partial' && entity.currentState === 'common';

    let label = `${entity.entityId} — ${entity.name}`;

    if (entity.currentState === 'partial') {
      label = `${entity.entityId} — ${entity.name} (${entity.modelsWithEntity}/${entity.modelsCount})`;
    } else if (isAddedPartial) {
      label = `${entity.entityId} — ${entity.name} (+${entity.modelsCount - entity.modelsWithEntity})`;
    } else if (isAdded) {
      label = `${entity.entityId} — ${entity.name} (+${entity.modelsCount})`;
    }

    return (
      <div
        key={entity.id}
        onClick={() => {
          if (entity.currentState === 'none' || entity.currentState === 'partial') {
            handleEntityToggle(entity.id);
          }
        }}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs transition-all ${
          entity.currentState === 'common' ? '' : 'cursor-pointer'
        } ${
          isRemoved
            ? 'bg-slate-800/20 border-slate-600 text-white/40 line-through hover:bg-slate-800/30'
            : entity.currentState === 'common'
              ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-300'
              : entity.currentState === 'partial'
                ? 'bg-slate-700/40 border-slate-600 text-white/70 hover:bg-slate-700/50'
                : 'bg-slate-800/30 border-slate-700 text-white/60 hover:bg-slate-700/30 hover:border-slate-600'
        }`}
      >
        <span className={isRemoved ? 'line-through' : ''}>{label}</span>
        <span className="text-[10px] text-white/40">{entity.typeName}</span>

        {entity.currentState !== 'none' && !isRemoved && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveEntity(entity.id);
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
      <DialogContent className="!w-[60vw] !max-w-none max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Manage Model Entities</DialogTitle>
          <p className="text-sm text-white/60 mt-2">
            {selectedModelIds.length} mental model(s) selected
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
            <h3 className="text-sm font-medium text-white/80 mb-2">On All Models</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading entities...</p>
              ) : commonEntities.length > 0 ? (
                <div className="flex flex-wrap gap-2">{commonEntities.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">No entities on all models</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">On Some Models</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading entities...</p>
              ) : partialEntities.length > 0 ? (
                <div className="flex flex-wrap gap-2">{partialEntities.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">No entities on some models</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Marked for Removal</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading entities...</p>
              ) : removedEntities.length > 0 ? (
                <div className="flex flex-wrap gap-2 opacity-60">{removedEntities.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">No entities marked for removal</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-white/80 mb-2">Available to Add</h3>
            <div className="max-h-32 overflow-y-auto">
              {loading ? (
                <p className="text-xs text-white/40 italic">Loading entities...</p>
              ) : availableEntities.length > 0 ? (
                <div className="flex flex-wrap gap-2">{availableEntities.map(renderPill)}</div>
              ) : (
                <p className="text-xs text-white/40 italic">All entities are assigned</p>
              )}
            </div>
          </div>

          {entities.length === 0 && !loading && (
            <div className="text-center text-white/50 py-8">No entities available</div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-6 border-t border-white/10">
          <Button variant="ghost" onClick={onClose} className="text-white/70 hover:text-white hover:bg-white/5">
            Close
          </Button>
          <Button onClick={handleSave} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
