'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { entitiesApi, entityTypesApi } from '@/lib/api/client';
import type { Entity, EntityType } from '@/lib/types';
import { toast } from 'sonner';
import { CaseMatchToggle } from './case-match-toggle';
import { checkEntityIdConformity, formatEntityIdPattern } from '@/lib/entity-id-pattern';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entity: Entity | null;
  entityTypes: EntityType[];
  onEntityUpdated?: () => void;
}

const inputFocusStyle = {
  '--tw-ring-color': 'rgb(52, 211, 153)',
  '--tw-ring-opacity': '0.4',
} as React.CSSProperties;

export function ViewEntityDialog({ open, onOpenChange, entity, entityTypes, onEntityUpdated }: Props) {
  const [isSaving, setIsSaving] = useState(false);

  const [typeId, setTypeId] = useState<number | ''>('');
  const [entityId, setEntityId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wordBoundaries, setWordBoundaries] = useState(true);

  useEffect(() => {
    if (entity) {
      setTypeId(entity.type_id);
      setEntityId(entity.entity_id || '');
      setName(entity.name || '');
      setDescription(entity.description || '');
      setAliases([...entity.aliases]);
      setNewAlias('');
      setCaseSensitive(entity.case_match === 'sensitive');
      setWordBoundaries((entity.word_boundary_match ?? 'boundaries') === 'boundaries');
    }
  }, [entity, open]);

  const selectedType = entityTypes.find((t) => t.id === Number(typeId)) || null;

  const entityIdConformity = useMemo(() => {
    if (!selectedType) return null;
    return checkEntityIdConformity(entityId, selectedType);
  }, [entityId, selectedType]);

  const [nextEntityId, setNextEntityId] = useState<string | null>(null);
  const [nextIdLoading, setNextIdLoading] = useState(false);

  useEffect(() => {
    if (!selectedType || !selectedType.uses_entity_id_pattern || !entity) {
      setNextEntityId(null);
      return;
    }
    let cancelled = false;
    setNextIdLoading(true);
    entityTypesApi.getNextEntityId(selectedType.id, entity.entity_id)
      .then((res) => {
        if (!cancelled) setNextEntityId(res.next_entity_id);
      })
      .catch(() => {
        if (!cancelled) setNextEntityId(null);
      })
      .finally(() => {
        if (!cancelled) setNextIdLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedType, entity]);

  const hasChanges = useMemo(() => {
    if (!entity) return false;
    return (
      name !== (entity.name || '') ||
      entityId !== (entity.entity_id || '') ||
      typeId !== entity.type_id ||
      description !== (entity.description || '') ||
      JSON.stringify(aliases) !== JSON.stringify(entity.aliases) ||
      caseSensitive !== (entity.case_match === 'sensitive') ||
      wordBoundaries !== (entity.word_boundary_match === 'boundaries')
    );
  }, [entity, name, entityId, typeId, description, aliases, caseSensitive, wordBoundaries]);

  if (!entity) return null;

  const addAlias = () => {
    const trimmed = newAlias.trim();
    if (trimmed && !aliases.includes(trimmed)) {
      setAliases((prev) => [...prev, trimmed]);
      setNewAlias('');
    }
  };

  const removeAlias = (idx: number) => {
    setAliases((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!entityId.trim() || !name.trim() || typeId === '') {
      toast.error('Type, Entity ID, and Name are required');
      return;
    }
    setIsSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (typeId !== entity.type_id) updates.type_id = Number(typeId);
      if (entityId.trim() !== entity.entity_id) updates.entity_id = entityId.trim();
      if (name.trim() !== entity.name) updates.name = name.trim();
      if (description.trim() !== (entity.description || '')) updates.description = description.trim() || null;
      if (JSON.stringify(aliases) !== JSON.stringify(entity.aliases)) updates.aliases = aliases;
      if (caseSensitive !== (entity.case_match === 'sensitive')) {
        updates.case_match = caseSensitive ? 'sensitive' : 'insensitive';
      }
      if (wordBoundaries !== (entity.word_boundary_match === 'boundaries')) {
        updates.word_boundary_match = wordBoundaries ? 'boundaries' : 'no-boundaries';
      }

      if (Object.keys(updates).length > 0) {
        await entitiesApi.update(entity.id, updates);
        toast.success('Entity updated');
        onEntityUpdated?.();
      }
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            Entity Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Editable Fields */}
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="ent-name" className="text-xs uppercase text-white/50 font-medium">
                Name
              </Label>
              <Input
                id="ent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter entity name"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
                style={inputFocusStyle}
              />
            </div>

            {/* Entity ID + Type */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ent-eid" className="text-xs uppercase text-white/50 font-medium">
                  Entity ID
                </Label>
                <Input
                  id="ent-eid"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  placeholder="SYS-001"
                  className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
                  style={inputFocusStyle}
                />
                {selectedType?.uses_entity_id_pattern && entityIdConformity && (
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <span
                      title={entityIdConformity.message || ''}
                      className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-mono font-medium border ${
                        entityIdConformity.conforms
                          ? 'bg-badge-success-bg text-accent-secondary-fg border-accent-secondary-bd'
                          : 'bg-badge-caution-bg text-badge-caution-fg border-badge-caution-bd'
                      }`}
                    >
                      {formatEntityIdPattern(selectedType)}
                    </span>
                    {nextEntityId && (
                      <button
                        type="button"
                        onClick={() => setEntityId(nextEntityId)}
                        className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-mono font-medium border bg-badge-success-bg text-accent-secondary-fg border-accent-secondary-bd hover:bg-emerald-800/30"
                      >
                        Next ID: {nextEntityId}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ent-type" className="text-xs uppercase text-white/50 font-medium">
                  Type
                </Label>
                <select
                  id="ent-type"
                  value={typeId}
                  onChange={(e) => setTypeId(Number(e.target.value) || '')}
                  className="w-full h-8 rounded-md border border-white/10 bg-surface-card px-2.5 text-sm text-white/80 focus:border-accent-primary-bd focus:ring-2 focus:ring-focus-ring-subtle outline-none"
                >
                  {entityTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.type_name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="ent-desc" className="text-xs uppercase text-white/50 font-medium">
                Description
              </Label>
              <Input
                id="ent-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
                style={inputFocusStyle}
              />
            </div>

            {/* Aliases */}
            <div className="space-y-2">
              <Label className="text-xs uppercase text-white/50 font-medium">
                Aliases
              </Label>
              <div className="flex gap-2">
                <Input
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder="Add alias…"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
                  className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
                  style={inputFocusStyle}
                />
                <Button type="button" variant="outline" size="sm" onClick={addAlias}>
                  Add
                </Button>
              </div>
              {aliases.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {aliases.map((a, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-badge-entity-bg text-badge-entity-fg border border-badge-entity-bd/50">
                      {a}
                      <button type="button" onClick={() => removeAlias(i)} className="text-badge-entity-fg/60 hover:text-badge-entity-fg">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Case Match Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs uppercase text-white/50 font-medium">Case-Sensitive Match</Label>
                <p className="text-[10px] text-white/40">OFF = insensitive, ON = exact case</p>
              </div>
              <CaseMatchToggle
                checked={caseSensitive}
                onChange={setCaseSensitive}
              />
            </div>

            {/* Word Boundary Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs uppercase text-white/50 font-medium">Respect Word Boundaries</Label>
                <p className="text-[10px] text-white/40">OFF = substring match, ON = whole-word match</p>
              </div>
              <CaseMatchToggle
                checked={wordBoundaries}
                onChange={setWordBoundaries}
              />
            </div>
          </div>

          {/* Read-only Metadata */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/10">
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">ID</p>
              <p className="text-sm text-white font-mono">{entity.id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Generated By</p>
              <p className="text-sm text-white font-mono">{entity.generated_by}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Documents</p>
              <p className="text-sm text-white font-mono">
                {entity.usage_count ? `${entity.usage_count} document${entity.usage_count !== 1 ? 's' : ''}` : 'None'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Created</p>
              <p className="text-sm text-white/70">
                {formatDistanceToNow(new Date(entity.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Updated</p>
              <p className="text-sm text-white/70">
                {formatDistanceToNow(new Date(entity.updated_at), { addSuffix: true })}
              </p>
            </div>
          </div>

          {/* Hindsight sync warning */}
          {(entity.usage_count ?? 0) > 0 && hasChanges && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-badge-caution-bg border border-badge-caution-bd">
              <svg className="h-4 w-4 text-badge-caution-fg mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-badge-caution-fg">
                This entity is referenced in {entity.usage_count} document{entity.usage_count !== 1 ? 's' : ''}. If any of these documents have already been synced to Hindsight, the updated entity name/ID may cause a mismatch on the next sync.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Close
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="bg-accent-primary-fg hover:bg-accent-primary-fg text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
