'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { entityTypesApi } from '@/lib/api/client';
import type { EntityType } from '@/lib/types';
import { toast } from 'sonner';
import { CaseMatchToggle } from './case-match-toggle';

interface ViewEntityTypeDialogProps {
  entityType: EntityType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntityTypeUpdated?: () => void;
}

const inputFocusStyle = {
  '--tw-ring-color': 'rgb(52, 211, 153)',
  '--tw-ring-opacity': '0.4',
} as React.CSSProperties;

export function ViewEntityTypeDialog({
  entityType,
  open,
  onOpenChange,
  onEntityTypeUpdated,
}: ViewEntityTypeDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [description, setDescription] = useState('');
  const [idLabel, setIdLabel] = useState('');
  const [nameLabel, setNameLabel] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);

  useEffect(() => {
    if (entityType) {
      setTypeName(entityType.type_name || '');
      setDescription(entityType.description || '');
      setIdLabel(entityType.id_label || 'id');
      setNameLabel(entityType.name_label || 'name');
      setCaseSensitive(entityType.case_match === 'sensitive');
    }
  }, [entityType, open]);

  if (!entityType) return null;

  const hasChanges =
    typeName !== (entityType.type_name || '') ||
    description !== (entityType.description || '') ||
    caseSensitive !== (entityType.case_match === 'sensitive');

  const handleSave = async () => {
    if (!typeName.trim()) {
      toast.error('Type name is required');
      return;
    }
    setIsSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (typeName.trim() !== entityType.type_name) {
        updates.type_name = typeName.trim();
      }
      if (description.trim() !== (entityType.description || '')) {
        updates.description = description.trim() || null;
      }
      if (caseSensitive !== (entityType.case_match === 'sensitive')) {
        updates.case_match = caseSensitive ? 'sensitive' : 'insensitive';
      }

      if (Object.keys(updates).length > 0) {
        await entityTypesApi.update(entityType.id, updates);
        toast.success('Entity type updated');
        onEntityTypeUpdated?.();
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            Entity Type Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Editable Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="et-name" className="text-xs uppercase text-white/50 font-medium">
                Type Name
              </Label>
              <Input
                id="et-name"
                value={typeName}
                onChange={(e) => setTypeName(e.target.value)}
                placeholder="e.g. Application Component"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={inputFocusStyle}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="et-id-label" className="text-xs uppercase text-white/50 font-medium">
                  ID Label
                </Label>
                <Input
                  id="et-id-label"
                  value={idLabel}
                  readOnly
                  className="!rounded-lg !border !border-white/20 !bg-transparent !text-white/70 cursor-default opacity-60 focus:!border-emerald-400 focus:!ring-2"
                  style={inputFocusStyle}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="et-name-label" className="text-xs uppercase text-white/50 font-medium">
                  Name Label
                </Label>
                <Input
                  id="et-name-label"
                  value={nameLabel}
                  readOnly
                  className="!rounded-lg !border !border-white/20 !bg-transparent !text-white/70 cursor-default opacity-60 focus:!border-emerald-400 focus:!ring-2"
                  style={inputFocusStyle}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="et-desc" className="text-xs uppercase text-white/50 font-medium">
                Description
              </Label>
              <Input
                id="et-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={inputFocusStyle}
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
          </div>

          {/* Read-only Metadata */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/10">
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">ID</p>
              <p className="text-sm text-white font-mono">{entityType.id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Created</p>
              <p className="text-sm text-white/70">
                {formatDistanceToNow(new Date(entityType.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Updated</p>
              <p className="text-sm text-white/70">
                {formatDistanceToNow(new Date(entityType.updated_at), { addSuffix: true })}
              </p>
            </div>
          </div>

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
              className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
