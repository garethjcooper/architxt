'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { entityTypesApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { CaseMatchToggle } from './case-match-toggle';
import { EntityTypeIdSeparatorSelect } from './entity-type-id-separator-select';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEntityTypeCreated?: () => void;
}

const MIN_DIGITS = 1;
const MAX_DIGITS = 10;
const DEFAULT_DIGITS = 3;

export function CreateEntityTypeDialog({ open, onOpenChange, onEntityTypeCreated }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [typeName, setTypeName] = useState('');
  const [description, setDescription] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wordBoundaries, setWordBoundaries] = useState(true);
  const [usesPattern, setUsesPattern] = useState(false);
  const [idFormatPrefix, setIdFormatPrefix] = useState('');
  const [minIdDigits, setMinIdDigits] = useState(String(DEFAULT_DIGITS));
  const [idSeparator, setIdSeparator] = useState<'none' | '-'>('none');

  const reset = () => {
    setTypeName('');
    setDescription('');
    setCaseSensitive(false);
    setWordBoundaries(true);
    setUsesPattern(false);
    setIdFormatPrefix('');
    setMinIdDigits(String(DEFAULT_DIGITS));
    setIdSeparator('none');
  };

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = typeName.trim();
    if (!trimmed) {
      toast.error('Type name is required');
      return;
    }

    if (usesPattern) {
      const prefix = idFormatPrefix.trim();
      if (!prefix) {
        toast.error('Id Format Prefix is required when Entity Id Pattern is enabled');
        return;
      }
      const digits = Number(minIdDigits);
      if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
        toast.error(`Minimum Number Of Id Digits must be between ${MIN_DIGITS} and ${MAX_DIGITS}`);
        return;
      }
    }

    setIsLoading(true);
    try {
      await entityTypesApi.create({
        type_name: trimmed,
        description: description.trim() || undefined,
        case_match: caseSensitive ? 'sensitive' : 'insensitive',
        word_boundary_match: wordBoundaries ? 'boundaries' : 'no-boundaries',
        uses_entity_id_pattern: usesPattern,
        id_format_prefix: usesPattern ? idFormatPrefix.trim() || undefined : undefined,
        min_id_digits: usesPattern ? Number(minIdDigits) : undefined,
        id_separator: usesPattern ? idSeparator : undefined,
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

  const inputClass = "!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle";
  const disabledClass = "opacity-50 pointer-events-none";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground-default">
            Create Entity Type
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="cet-name" className="text-xs uppercase text-foreground-subtle font-medium">
              Type Name *
            </Label>
            <Input
              id="cet-name"
              value={typeName}
              onChange={(e) => setTypeName(e.target.value)}
              placeholder="e.g. Application Component"
              className={inputClass}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cet-desc" className="text-xs uppercase text-foreground-subtle font-medium">
              Description
            </Label>
            <Input
              id="cet-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className={inputClass}
            />
          </div>

          {/* Entity Id Pattern Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-xs uppercase text-foreground-subtle font-medium">Use Entity Id Pattern</Label>
              <p className="text-[10px] text-foreground-subtle">Generate formatted ids like PREFIX-001</p>
            </div>
            <Switch checked={usesPattern} onCheckedChange={(v) => setUsesPattern(v)} />
          </div>

          {/* Pattern Fields */}
          <div className={`space-y-3 transition-opacity ${!usesPattern ? disabledClass : ''}`}>
            <div className="flex gap-3 items-start">
              <div className="flex-1 space-y-2 min-w-0">
                <Label htmlFor="cet-prefix" className="text-xs uppercase text-foreground-subtle font-medium">
                  Id Format Prefix *
                </Label>
                <Input
                  id="cet-prefix"
                  value={idFormatPrefix}
                  onChange={(e) => handlePrefixChange(e.target.value)}
                  placeholder="e.g. APP"
                  className={inputClass}
                  disabled={!usesPattern}
                />
              </div>
              <div className="w-20 space-y-2">
                <Label htmlFor="cet-separator" className="text-xs uppercase text-foreground-subtle font-medium">
                  Separator *
                </Label>
                <EntityTypeIdSeparatorSelect
                  id="cet-separator"
                  value={idSeparator}
                  onChange={setIdSeparator}
                  disabled={!usesPattern}
                />
              </div>
              <div className="w-24 space-y-2">
                <Label htmlFor="cet-digits" className="text-xs uppercase text-foreground-subtle font-medium">
                  Digits *
                </Label>
                <Input
                  id="cet-digits"
                  type="number"
                  min={MIN_DIGITS}
                  max={MAX_DIGITS}
                  value={minIdDigits}
                  onChange={(e) => handleDigitsChange(e.target.value)}
                  placeholder="3"
                  className={inputClass}
                  disabled={!usesPattern}
                />
              </div>
            </div>
            <p className="text-[10px] text-foreground-subtle">Alphanumeric prefix; separator between prefix and number; {MIN_DIGITS}–{MAX_DIGITS} digits.</p>
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
