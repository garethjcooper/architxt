'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, X } from 'lucide-react';
import { entitiesApi } from '@/lib/api/client';
import type { EntityType } from '@/lib/types';
import { toast } from 'sonner';
import { CaseMatchToggle } from './case-match-toggle';

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

  useEffect(() => {
    if (open && defaultTypeId) {
      setTypeId(defaultTypeId);
    }
  }, [open, defaultTypeId]);

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

  const inputClass = "!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            Create Entity
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="ce-type" className="text-xs uppercase text-white/50 font-medium">
              Type *
            </Label>
            <select
              id="ce-type"
              value={typeId}
              onChange={(e) => setTypeId(Number(e.target.value) || '')}
              className="w-full h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
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
              <Label htmlFor="ce-eid" className="text-xs uppercase text-white/50 font-medium">
                Entity ID *
              </Label>
              <Input
                id="ce-eid"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="SYS-001"
                className={inputClass}
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ce-name" className="text-xs uppercase text-white/50 font-medium">
                Name *
              </Label>
              <Input
                id="ce-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Finance Gateway"
                className={inputClass}
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
                required
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="ce-desc" className="text-xs uppercase text-white/50 font-medium">
              Description
            </Label>
            <Input
              id="ce-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className={inputClass}
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          {/* Aliases */}
          <div className="space-y-2">
            <Label className="text-xs uppercase text-white/50 font-medium">Aliases</Label>
            <div className="flex gap-2">
              <Input
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                placeholder="Add alias…"
                className={inputClass}
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
              />
              <Button type="button" variant="outline" size="sm" onClick={addAlias}>Add</Button>
            </div>
            {aliases.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {aliases.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-purple-800/15 text-purple-400 border border-purple-700/20">
                    {a}
                    <button type="button" onClick={() => removeAlias(i)} className="text-purple-400/60 hover:text-purple-300">
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
              <p className="text-[10px] text-white/40">OFF = insensitive (default), ON = exact case</p>
            </div>
            <CaseMatchToggle
              checked={caseSensitive}
              onChange={setCaseSensitive}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-white/70 hover:text-white hover:bg-white/5">
              Close
            </Button>
            <Button type="submit" disabled={isLoading} className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
