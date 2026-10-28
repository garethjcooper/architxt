'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { edgeTypesApi } from '@/lib/api/client';
import { ARCHIMATE_RELATIONSHIPS, type EdgeType } from '@/lib/types';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface ViewEdgeTypeDialogProps {
  edgeType: EdgeType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdgeTypeUpdated?: () => void;
}

export function ViewEdgeTypeDialog({
  edgeType,
  open,
  onOpenChange,
  onEdgeTypeUpdated,
}: ViewEdgeTypeDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [description, setDescription] = useState('');
  const [c4Description, setC4Description] = useState('');
  const [archimateRelationship, setArchimateRelationship] = useState<string>('');

  useEffect(() => {
    if (edgeType) {
      setTypeName(edgeType.type_name || '');
      setDescription(edgeType.description || '');
      setC4Description(edgeType.c4_description || '');
      setArchimateRelationship(edgeType.archimate_relationship || '');
    }
  }, [edgeType, open]);

  if (!edgeType) return null;

  const hasChanges =
    typeName !== (edgeType.type_name || '') ||
    description !== (edgeType.description || '') ||
    c4Description !== (edgeType.c4_description || '') ||
    archimateRelationship !== (edgeType.archimate_relationship || '');

  const isDescriptionValid = description.trim().length > 0;
  const isTypeNameValid =
    typeName.trim().length > 0 &&
    /^[a-z0-9-]+$/.test(typeName.trim()) &&
    !typeName.trim().startsWith('-') &&
    !typeName.trim().endsWith('-') &&
    !typeName.trim().includes('--');

  const handleSave = async () => {
    if (!isTypeNameValid || !isDescriptionValid) {
      toast.error('Type name and description are required');
      return;
    }

    setIsSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (typeName.trim() !== edgeType.type_name) {
        updates.type_name = typeName.trim();
      }
      if (description.trim() !== edgeType.description) {
        updates.description = description.trim();
      }
      if (c4Description.trim() !== (edgeType.c4_description || '')) {
        updates.c4_description = c4Description.trim() || null;
      }
      if (archimateRelationship.trim() !== (edgeType.archimate_relationship || '')) {
        updates.archimate_relationship = archimateRelationship.trim() || null;
      }

      if (Object.keys(updates).length > 0) {
        await edgeTypesApi.update(edgeType.id, updates);
        toast.success('Edge type updated');
        onEdgeTypeUpdated?.();
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass = "!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground-default">
            Edge Type Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edge-type-name" className="text-xs uppercase text-foreground-subtle font-medium">
                Type Name
              </Label>
              <Input
                id="edge-type-name"
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
                placeholder="e.g. depends-on"
                className={inputClass}
              />
              <p className="text-[10px] text-foreground-subtle">
                Lowercase letters, digits and hyphens. This is the value used in contextual graph edges.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edge-type-desc" className="text-xs uppercase text-foreground-subtle font-medium">
                Description *
              </Label>
              <Input
                id="edge-type-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. A depends on B"
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edge-type-c4" className="text-xs uppercase text-foreground-subtle font-medium">
                C4 Description
              </Label>
              <Input
                id="edge-type-c4"
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
              <Label htmlFor="edge-type-archimate" className="text-xs uppercase text-foreground-subtle font-medium">
                ArchiMate Relationship
              </Label>
              <select
                id="edge-type-archimate"
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
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border-default">
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">ID</p>
              <p className="text-sm text-foreground-default font-mono">{edgeType.id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Created</p>
              <p className="text-sm text-foreground-faint">
                {formatDistanceToNow(new Date(edgeType.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Updated</p>
              <p className="text-sm text-foreground-faint">
                {formatDistanceToNow(new Date(edgeType.updated_at), { addSuffix: true })}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
            >
              Close
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !hasChanges || !isDescriptionValid || !isTypeNameValid}
              className="bg-accent-primary-bg text-accent-primary-fg border border-accent-primary-bd hover:bg-accent-primary-bg/90 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
