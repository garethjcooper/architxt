'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { entityTypesApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { CaseMatchToggle } from './case-match-toggle';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntityTypeCreated?: () => void;
}

export function CreateEntityTypeDialog({ open, onOpenChange, onEntityTypeCreated }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [description, setDescription] = useState('');
  const [idLabel, setIdLabel] = useState('id');
  const [nameLabel, setNameLabel] = useState('name');
  const [caseSensitive, setCaseSensitive] = useState(false);

  const reset = () => {
    setTypeName('');
    setDescription('');
    setIdLabel('id');
    setNameLabel('name');
    setCaseSensitive(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = typeName.trim();
    if (!trimmed) {
      toast.error('Type name is required');
      return;
    }
    setIsLoading(true);
    try {
      await entityTypesApi.create({
        type_name: trimmed,
        description: description.trim() || undefined,
        id_label: idLabel.trim() || undefined,
        name_label: nameLabel.trim() || undefined,
        case_match: caseSensitive ? 'sensitive' : 'insensitive',
      });
      toast.success('Entity type created');
      reset();
      onOpenChange(false);
      onEntityTypeCreated?.();
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
            Create Entity Type
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="cet-name" className="text-xs uppercase text-white/50 font-medium">
              Type Name *
            </Label>
            <Input
              id="cet-name"
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              placeholder="e.g. Application Component"
              className={inputClass}
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cet-id-label" className="text-xs uppercase text-white/50 font-medium">
                ID Label
              </Label>
              <Input
                id="cet-id-label"
                value={idLabel}
                readOnly
                className={`${inputClass} cursor-default opacity-60`}
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cet-name-label" className="text-xs uppercase text-white/50 font-medium">
                Name Label
              </Label>
              <Input
                id="cet-name-label"
                value={nameLabel}
                readOnly
                className={`${inputClass} cursor-default opacity-60`}
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cet-desc" className="text-xs uppercase text-white/50 font-medium">
              Description
            </Label>
            <Input
              id="cet-desc"
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
