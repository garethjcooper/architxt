'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { edgeTypesApi } from '@/lib/api/client';
import { ARCHIMATE_RELATIONSHIPS } from '@/lib/types';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdgeTypeCreated?: () => void;
}

export function CreateEdgeTypeDialog({ open, onOpenChange, onEdgeTypeCreated }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [description, setDescription] = useState('');
  const [c4Description, setC4Description] = useState('');
  const [archimateRelationship, setArchimateRelationship] = useState<string>('');

  const reset = () => {
    setTypeName('');
    setDescription('');
    setC4Description('');
    setArchimateRelationship('');
  };

  const normalizeName = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '').replace(/^-+|-+$/g, '').replace(/--+/g, '-');

  const handleTypeNameChange = (value: string) => {
    setTypeName(normalizeName(value));
  };

  const isValid =
    typeName.trim().length > 0 &&
    /^[a-z0-9-]+$/.test(typeName.trim()) &&
    !typeName.trim().startsWith('-') &&
    !typeName.trim().endsWith('-') &&
    !typeName.trim().includes('--') &&
    description.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) {
      toast.error('Type name and description are required');
      return;
    }

    setIsLoading(true);
    try {
      await edgeTypesApi.create({
        type_name: typeName.trim(),
        description: description.trim(),
        c4_description: c4Description.trim() || undefined,
        archimate_relationship: archimateRelationship.trim() || undefined,
      });
      toast.success('Edge type created');
      reset();
      onOpenChange(false);
      onEdgeTypeCreated?.();
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
            Create Edge Type
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="cet-edge-type-name" className="text-xs uppercase text-foreground-subtle font-medium">
              Type Name *
            </Label>
            <Input
              id="cet-edge-type-name"
              value={typeName}
              onChange={(e) => handleTypeNameChange(e.target.value)}
              placeholder="e.g. depends-on"
              className={inputClass}
              required
            />
            <p className="text-[10px] text-foreground-subtle">
              Lowercase letters, digits and hyphens. This is the value used in contextual graph edges.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cet-edge-type-desc" className="text-xs uppercase text-foreground-subtle font-medium">
              Description *
            </Label>
            <Input
              id="cet-edge-type-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. A depends on B"
              className={inputClass}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cet-edge-type-c4" className="text-xs uppercase text-foreground-subtle font-medium">
              C4 Description
            </Label>
            <Input
              id="cet-edge-type-c4"
              value={c4Description}
              onChange={(e) => setC4Description(e.target.value)}
              placeholder="e.g. uses"
              className={inputClass}
            />
            <p className="text-[10px] text-foreground-subtle">
              Reserved for the future C4 overlay. Safe to leave blank.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cet-edge-type-archimate" className="text-xs uppercase text-foreground-subtle font-medium">
              ArchiMate Relationship
            </Label>
            <select
              id="cet-edge-type-archimate"
              value={archimateRelationship}
              onChange={(e) => setArchimateRelationship(e.target.value)}
              className="w-full h-10 rounded-lg border border-border-strong bg-surface-card px-3 text-sm text-foreground-default focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle focus:ring-focus-ring-subtle outline-none"
            >
              <option value="">None</option>
              {ARCHIMATE_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <p className="text-[10px] text-foreground-subtle">
              Constrained to the standard ArchiMate relationship set.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card">
              Close
            </Button>
            <Button type="submit" disabled={isLoading || !isValid} className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
