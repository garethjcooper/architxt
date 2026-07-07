'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { entityTypesApi } from '@/lib/api/client';
import type { EntityType } from '@/lib/types';
import { toast } from 'sonner';
import { CaseMatchToggle } from './case-match-toggle';
import { EntityTypeIdSeparatorSelect } from './entity-type-id-separator-select';

interface ViewEntityTypeDialogProps {
  entityType: EntityType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntityTypeUpdated?: () => void;
}

const MIN_DIGITS = 1;
const MAX_DIGITS = 10;
const DEFAULT_DIGITS = 3;

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
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wordBoundaries, setWordBoundaries] = useState(true);
  const [usesPattern, setUsesPattern] = useState(false);
  const [idFormatPrefix, setIdFormatPrefix] = useState('');
  const [minIdDigits, setMinIdDigits] = useState(String(DEFAULT_DIGITS));
  const [idSeparator, setIdSeparator] = useState<'none' | '-'>('none');

  useEffect(() => {
    if (entityType) {
      setTypeName(entityType.type_name || '');
      setDescription(entityType.description || '');
      setCaseSensitive(entityType.case_match === 'sensitive');
      setWordBoundaries((entityType.word_boundary_match ?? 'boundaries') === 'boundaries');
      setUsesPattern(entityType.uses_entity_id_pattern ?? false);
      setIdFormatPrefix(entityType.id_format_prefix || '');
      setMinIdDigits(String(entityType.min_id_digits ?? DEFAULT_DIGITS));
      setIdSeparator(entityType.id_separator ?? 'none');
    }
  }, [entityType, open]);

  if (!entityType) return null;

  const hasChanges =
    typeName !== (entityType.type_name || '') ||
    description !== (entityType.description || '') ||
    caseSensitive !== (entityType.case_match === 'sensitive') ||
    wordBoundaries !== ((entityType.word_boundary_match ?? 'boundaries') === 'boundaries') ||
    usesPattern !== (entityType.uses_entity_id_pattern ?? false) ||
    idFormatPrefix.trim() !== (entityType.id_format_prefix || '') ||
    Number(minIdDigits || DEFAULT_DIGITS) !== (entityType.min_id_digits ?? DEFAULT_DIGITS) ||
    idSeparator !== (entityType.id_separator ?? 'none');

  const handlePrefixChange = (value: string) => {
    setIdFormatPrefix(value.replace(/[^a-zA-Z0-9]/g, ''));
  };

  const handleDigitsChange = (value: string) => {
    if (value === '') {
      setMinIdDigits('');
      return;
    }
    const num = Number(value);
    if (Number.isNaN(num)) return;
    setMinIdDigits(String(Math.max(MIN_DIGITS, Math.min(MAX_DIGITS, num))));
  };

  const handleSave = async () => {
    if (!typeName.trim()) {
      toast.error('Type name is required');
      return;
    }

    if (usesPattern) {
      const prefix = idFormatPrefix.trim();
      if (!prefix) {
        toast.error('Id Format Prefix is required when Entity Id Pattern is enabled');
        return;
      }
      const digits = Number(minIdDigits || DEFAULT_DIGITS);
      if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
        toast.error(`Minimum Number Of Id Digits must be between ${MIN_DIGITS} and ${MAX_DIGITS}`);
        return;
      }
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
      if (wordBoundaries !== ((entityType.word_boundary_match ?? 'boundaries') === 'boundaries')) {
        updates.word_boundary_match = wordBoundaries ? 'boundaries' : 'no-boundaries';
      }
      if (usesPattern !== (entityType.uses_entity_id_pattern ?? false)) {
        updates.uses_entity_id_pattern = usesPattern;
      }
      if (usesPattern && idFormatPrefix.trim() !== (entityType.id_format_prefix || '')) {
        updates.id_format_prefix = idFormatPrefix.trim();
      }
      if (usesPattern && Number(minIdDigits || DEFAULT_DIGITS) !== (entityType.min_id_digits ?? DEFAULT_DIGITS)) {
        updates.min_id_digits = Number(minIdDigits || DEFAULT_DIGITS);
      }
      if (usesPattern && idSeparator !== (entityType.id_separator ?? 'none')) {
        updates.id_separator = idSeparator;
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

  const inputClass = "!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2";
  const disabledClass = "opacity-50 pointer-events-none";

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
                className={inputClass}
                style={inputFocusStyle}
              />
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
                className={inputClass}
                style={inputFocusStyle}
              />
            </div>

            {/* Entity Id Pattern Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs uppercase text-white/50 font-medium">Use Entity Id Pattern</Label>
                <p className="text-[10px] text-white/40">Generate formatted ids like PREFIX-001</p>
              </div>
              <Switch checked={usesPattern} onCheckedChange={(v) => setUsesPattern(v)} />
            </div>

            {/* Pattern Fields */}
            <div className={`space-y-3 transition-opacity ${!usesPattern ? disabledClass : ''}`}>
              <div className="flex gap-3 items-start">
                <div className="flex-1 space-y-2 min-w-0">
                  <Label htmlFor="et-prefix" className="text-xs uppercase text-white/50 font-medium">
                    Id Format Prefix
                  </Label>
                  <Input
                    id="et-prefix"
                    value={idFormatPrefix}
                    onChange={(e) => handlePrefixChange(e.target.value)}
                    placeholder="e.g. APP"
                    className={inputClass}
                    style={inputFocusStyle}
                    disabled={!usesPattern}
                  />
                </div>
                <div className="w-20 space-y-2">
                  <Label htmlFor="et-separator" className="text-xs uppercase text-white/50 font-medium">
                    Separator
                  </Label>
                  <EntityTypeIdSeparatorSelect
                    id="et-separator"
                    value={idSeparator}
                    onChange={setIdSeparator}
                    disabled={!usesPattern}
                  />
                </div>
                <div className="w-24 space-y-2">
                  <Label htmlFor="et-digits" className="text-xs uppercase text-white/50 font-medium">
                    Digits
                  </Label>
                  <Input
                    id="et-digits"
                    type="number"
                    min={MIN_DIGITS}
                    max={MAX_DIGITS}
                    value={minIdDigits}
                    onChange={(e) => handleDigitsChange(e.target.value)}
                    placeholder="3"
                    className={inputClass}
                    style={inputFocusStyle}
                    disabled={!usesPattern}
                  />
                </div>
              </div>
              <p className="text-[10px] text-white/40">Alphanumeric prefix; separator between prefix and number; {MIN_DIGITS}–{MAX_DIGITS} digits.</p>
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

            {/* Word Boundary Toggle */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs uppercase text-white/50 font-medium">Respect Word Boundaries</Label>
                <p className="text-[10px] text-white/40">OFF = substring match, ON = whole-word match (default)</p>
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
