'use client';

import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, X } from 'lucide-react';
import { entitiesApi, entityTypesApi } from '@/lib/api/client';
import type { EntityType } from '@/lib/types';
import { toast } from 'sonner';
import { CaseMatchToggle } from './case-match-toggle';
import { checkEntityIdConformity, formatEntityIdPattern } from '@/lib/entity-id-pattern';
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityTypes: EntityType[];
  onEntityCreated?: () => void;
  defaultTypeId?: number;
}

export function CreateEntityDialog({ open, onOpenChange, entityTypes, onEntityCreated, defaultTypeId }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [typeId, setTypeId] = useState<number | ''>('');
  const [entityId, setEntityId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [aliases, setAliases] = useState<string[]>([]);
  const [newAlias, setNewAlias] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wordBoundaries, setWordBoundaries] = useState(true);

  const selectedType = useMemo(
    () => entityTypes.find((t) => t.id === Number(typeId)) || null,
    [typeId, entityTypes]
  );

  const entityIdConformity = useMemo(() => {
    if (!selectedType) return null;
    return checkEntityIdConformity(entityId, selectedType);
  }, [entityId, selectedType]);

  const [nextEntityId, setNextEntityId] = useState<string | null>(null);
  const [nextIdLoading, setNextIdLoading] = useState(false);

  useEffect(() => {
    if (!selectedType || !selectedType.uses_entity_id_pattern) {
      setNextEntityId(null);
      return;
    }
    let cancelled = false;
    setNextIdLoading(true);
    entityTypesApi.getNextEntityId(selectedType.id)
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
  }, [selectedType]);

  useEffect(() => {
    if (open && defaultTypeId) {
      setTypeId(defaultTypeId);
    }
  }, [open, defaultTypeId]);

  // Inherit type defaults when type changes
  useEffect(() => {
    if (typeId === '') {
      setCaseSensitive(false);
      setWordBoundaries(true);
      return;
    }
    const type = selectedType;
    setCaseSensitive((type?.case_match ?? 'insensitive') === 'sensitive');
    setWordBoundaries((type?.word_boundary_match ?? 'boundaries') === 'boundaries');
  }, [typeId, selectedType]);

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

  const reset = () => {
    setTypeId('');
    setEntityId('');
    setName('');
    setDescription('');
    setAliases([]);
    setNewAlias('');
    setCaseSensitive(false);
    setWordBoundaries(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityId.trim() || !name.trim() || typeId === '') {
      toast.error('Type, Entity ID, and Name are required');
      return;
    }
    setIsLoading(true);
    try {
      await entitiesApi.create({
        type_id: Number(typeId),
        entity_id: entityId.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        aliases,
        case_match: caseSensitive ? 'sensitive' : 'insensitive',
        word_boundary_match: wordBoundaries ? 'boundaries' : 'no-boundaries',
      });
      toast.success('Entity created');
      reset();
      onOpenChange(false);
      onEntityCreated?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create');
    } finally {
      setIsLoading(false);
    }
  };

  const inputClass = "!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground-default">
            Create Entity
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="ce-type" className="text-xs uppercase text-foreground-subtle font-medium">
              Type *
            </Label>
            <select
              id="ce-type"
              value={typeId}
              onChange={(e) => setTypeId(Number(e.target.value) || '')}
              className="w-full h-8 rounded-md border border-border-default bg-surface-card px-2.5 text-sm text-foreground-muted focus:border-accent-primary-bd focus:ring-2 focus:ring-focus-ring-subtle outline-none"
              required
            >
              <option value="">Select type…</option>
              {entityTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.type_name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ce-eid" className="text-xs uppercase text-foreground-subtle font-medium">
                Entity ID *
              </Label>
              <Input
                id="ce-eid"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="SYS-001"
                className={inputClass}
                required
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
                  <div className="flex items-center gap-2">
                    {nextIdLoading && <Loader2 className="h-3 w-3 animate-spin text-foreground-subtle" />}
                    {nextEntityId && (
                      <button
                        type="button"
                        onClick={() => setEntityId(nextEntityId)}
                        className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-mono font-medium border bg-badge-success-bg text-badge-success-fg border-badge-success-bd hover:bg-badge-success-bg-hover"
                      >
                        Next ID: {nextEntityId}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="ce-name" className="text-xs uppercase text-foreground-subtle font-medium">
                Name *
              </Label>
              <Input
                id="ce-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Finance Gateway"
                className={inputClass}
                required
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="ce-desc" className="text-xs uppercase text-foreground-subtle font-medium">
              Description
            </Label>
            <Input
              id="ce-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className={inputClass}
            />
          </div>

          {/* Aliases */}
          <div className="space-y-2">
            <Label className="text-xs uppercase text-foreground-subtle font-medium">Aliases</Label>
            <div className="flex gap-2">
              <Input
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                placeholder="Add alias…"
                className={inputClass}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={addAlias}>Add</Button>
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
              <Label className="text-xs uppercase text-foreground-subtle font-medium">Case-Sensitive Match</Label>
              <p className="text-[10px] text-foreground-subtle">OFF = insensitive (default), ON = exact case</p>
            </div>
            <CaseMatchToggle
              checked={caseSensitive}
              onChange={setCaseSensitive}
            />
          </div>

          {/* Word Boundary Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-xs uppercase text-foreground-subtle font-medium">Respect Word Boundaries</Label>
              <p className="text-[10px] text-foreground-subtle">OFF = substring match, ON = whole-word match (default)</p>
            </div>
            <CaseMatchToggle
              checked={wordBoundaries}
              onChange={setWordBoundaries}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card">
              Close
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
