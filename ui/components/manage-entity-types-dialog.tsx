'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Plus, Trash2, Pencil, X, Layers } from 'lucide-react';
import { entityTypesApi, entitiesApi } from '@/lib/api/client';
import type { EntityType } from '@/lib/types';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { CaseMatchToggle } from './case-match-toggle';
import { EntityTypeIdSeparatorSelect } from './entity-type-id-separator-select';

const logger = createLogger('ManageEntityTypesDialog');

const WORD_BOUNDARY_LABELS: Record<'boundaries' | 'no-boundaries', string> = {
  boundaries: '\u2202',
  'no-boundaries': '\u221e',
};

const MIN_DIGITS = 1;
const MAX_DIGITS = 10;
const DEFAULT_DIGITS = 3;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTypesChanged?: () => void;
}

export function ManageEntityTypesDialog({ open, onOpenChange, onTypesChanged }: Props) {
  const [types, setTypes] = useState<EntityType[]>([]);
  const [loading, setLoading] = useState(false);
  const [entityCounts, setEntityCounts] = useState<Record<number, number>>({});

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addTypeName, setAddTypeName] = useState('');
  const [addDescription, setAddDescription] = useState('');
  const [addCaseSensitive, setAddCaseSensitive] = useState(false);
  const [addWordBoundaries, setAddWordBoundaries] = useState(true);
  const [addUsesPattern, setAddUsesPattern] = useState(false);
  const [addIdFormatPrefix, setAddIdFormatPrefix] = useState('');
  const [addMinIdDigits, setAddMinIdDigits] = useState(String(DEFAULT_DIGITS));
  const [addIdSeparator, setAddIdSeparator] = useState<'none' | '-'>('none');
  const [adding, setAdding] = useState(false);

  // Edit state: id -> field values
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTypeName, setEditTypeName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCaseSensitive, setEditCaseSensitive] = useState(false);
  const [editWordBoundaries, setEditWordBoundaries] = useState(true);
  const [editUsesPattern, setEditUsesPattern] = useState(false);
  const [editIdFormatPrefix, setEditIdFormatPrefix] = useState('');
  const [editMinIdDigits, setEditMinIdDigits] = useState(String(DEFAULT_DIGITS));
  const [editIdSeparator, setEditIdSeparator] = useState<'none' | '-'>('none');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTypes = async () => {
    setLoading(true);
    try {
      const [typeData, entityData] = await Promise.all([
        entityTypesApi.list(),
        entitiesApi.list().catch(() => [] as EntityType[]),
      ]);
      setTypes(typeData);

      // Count entities per type
      const counts: Record<number, number> = {};
      for (const ent of entityData as any[]) {
        counts[ent.type_id] = (counts[ent.type_id] || 0) + 1;
      }
      setEntityCounts(counts);
    } catch (err: any) {
      logger.error('Failed to fetch types', { error: err });
      toast.error(err.message || 'Failed to load entity types');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchTypes();
  }, [open]);

  const resetAddForm = () => {
    setAddTypeName('');
    setAddDescription('');
    setAddCaseSensitive(false);
    setAddWordBoundaries(true);
    setAddUsesPattern(false);
    setAddIdFormatPrefix('');
    setAddMinIdDigits(String(DEFAULT_DIGITS));
    setAddIdSeparator('none');
    setShowAddForm(false);
  };

  const handlePrefixChange = (setter: (v: string) => void) => (value: string) => {
    setter(value.replace(/[^a-zA-Z0-9]/g, ''));
  };

  const handleDigitsChange = (setter: (v: string) => void) => (value: string) => {
    if (value === '') {
      setter('');
      return;
    }
    const num = Number(value);
    if (Number.isNaN(num)) return;
    setter(String(Math.max(MIN_DIGITS, Math.min(MAX_DIGITS, num))));
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addTypeName.trim();
    if (!name) {
      toast.error('Type name is required');
      return;
    }

    if (addUsesPattern) {
      const prefix = addIdFormatPrefix.trim();
      if (!prefix) {
        toast.error('Id Format Prefix is required when Entity Id Pattern is enabled');
        return;
      }
      const digits = Number(addMinIdDigits || DEFAULT_DIGITS);
      if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
        toast.error(`Minimum Number Of Id Digits must be between ${MIN_DIGITS} and ${MAX_DIGITS}`);
        return;
      }
    }

    setAdding(true);
    try {
      await entityTypesApi.create({
        type_name: name,
        description: addDescription.trim() || undefined,
        case_match: addCaseSensitive ? 'sensitive' : 'insensitive',
        word_boundary_match: addWordBoundaries ? 'boundaries' : 'no-boundaries',
        uses_entity_id_pattern: addUsesPattern,
        id_format_prefix: addUsesPattern ? addIdFormatPrefix.trim() || undefined : undefined,
        min_id_digits: addUsesPattern ? Number(addMinIdDigits || DEFAULT_DIGITS) : undefined,
        id_separator: addUsesPattern ? addIdSeparator : undefined,
      });
      toast.success('Entity type created');
      resetAddForm();
      await fetchTypes();
      onTypesChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create type');
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (t: EntityType) => {
    setEditingId(t.id);
    setEditTypeName(t.type_name || '');
    setEditDescription(t.description || '');
    setEditCaseSensitive(t.case_match === 'sensitive');
    setEditWordBoundaries((t.word_boundary_match ?? 'boundaries') === 'boundaries');
    setEditUsesPattern(t.uses_entity_id_pattern ?? false);
    setEditIdFormatPrefix(t.id_format_prefix || '');
    setEditMinIdDigits(String(t.min_id_digits ?? DEFAULT_DIGITS));
    setEditIdSeparator(t.id_separator ?? 'none');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTypeName('');
    setEditDescription('');
    setEditCaseSensitive(false);
    setEditWordBoundaries(true);
    setEditUsesPattern(false);
    setEditIdFormatPrefix('');
    setEditMinIdDigits(String(DEFAULT_DIGITS));
    setEditIdSeparator('none');
  };

  const handleSaveEdit = async (id: number) => {
    const name = editTypeName.trim();
    if (!name) {
      toast.error('Type name is required');
      return;
    }

    if (editUsesPattern) {
      const prefix = editIdFormatPrefix.trim();
      if (!prefix) {
        toast.error('Id Format Prefix is required when Entity Id Pattern is enabled');
        return;
      }
      const digits = Number(editMinIdDigits || DEFAULT_DIGITS);
      if (!Number.isInteger(digits) || digits < MIN_DIGITS || digits > MAX_DIGITS) {
        toast.error(`Minimum Number Of Id Digits must be between ${MIN_DIGITS} and ${MAX_DIGITS}`);
        return;
      }
    }

    setSavingEdit(true);
    try {
      await entityTypesApi.update(id, {
        type_name: name,
        description: editDescription.trim() || undefined,
        case_match: editCaseSensitive ? 'sensitive' : 'insensitive',
        word_boundary_match: editWordBoundaries ? 'boundaries' : 'no-boundaries',
        uses_entity_id_pattern: editUsesPattern,
        id_format_prefix: editUsesPattern ? editIdFormatPrefix.trim() || undefined : undefined,
        min_id_digits: editUsesPattern ? Number(editMinIdDigits || DEFAULT_DIGITS) : undefined,
        id_separator: editUsesPattern ? editIdSeparator : undefined,
      });
      toast.success('Entity type updated');
      setEditingId(null);
      await fetchTypes();
      onTypesChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update type');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: number) => {
    const count = entityCounts[id] || 0;
    if (count > 0) {
      toast.error(`Cannot delete: ${count} entity(ies) use this type. Delete or reassign them first.`);
      return;
    }
    setDeletingId(id);
    setDeleting(true);
    try {
      await entityTypesApi.delete(id);
      toast.success('Entity type deleted');
      await fetchTypes();
      onTypesChanged?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete type');
    } finally {
      setDeleting(false);
      setDeletingId(null);
    }
  };

  const renderPatternPreview = (t: EntityType) => {
    if (!t.uses_entity_id_pattern) return <span className="text-white/20">-</span>;
    const digits = t.min_id_digits ?? DEFAULT_DIGITS;
    const placeholder = '0'.repeat(Math.min(digits, 6));
    const sep = t.id_separator === '-' ? '-' : '';
    const text = `${t.id_format_prefix || ''}${sep}${placeholder}`;
    return <span title={`${digits} digit(s)`} className="text-white/60 text-xs">{text}</span>;
  };

  const disabledClass = "opacity-50 pointer-events-none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold text-white">
            <Layers className="h-5 w-5 text-emerald-400" />
            Manage Entity Types
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Header bar */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/50">{types.length} type(s)</span>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              <Plus className="h-3.5 w-3.5" />
              {showAddForm ? 'Cancel' : 'Add Type'}
            </Button>
          </div>

          {/* Add form */}
          {showAddForm && (
            <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-900/10 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-white/60">Type Name *</Label>
                  <Input
                    value={addTypeName}
                    onChange={(e) => setAddTypeName(e.target.value)}
                    placeholder="e.g. Application Component"
                    className="h-8 text-sm"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-white/60">Description</Label>
                  <Input
                    value={addDescription}
                    onChange={(e) => setAddDescription(e.target.value)}
                    placeholder="Optional"
                    className="h-8 text-sm"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-xs text-white/60">Use Entity Id Pattern</Label>
                  <p className="text-[10px] text-white/40">Generate formatted ids like PREFIX-001</p>
                </div>
                <Switch checked={addUsesPattern} onCheckedChange={(v) => setAddUsesPattern(v)} />
              </div>

              <div className={`space-y-2 transition-opacity ${!addUsesPattern ? disabledClass : ''}`}>
                <div className="flex gap-3 items-start">
                  <div className="flex-1 space-y-1 min-w-0">
                    <Label className="text-xs text-white/60">Id Format Prefix *</Label>
                    <Input
                      value={addIdFormatPrefix}
                      onChange={(e) => handlePrefixChange(setAddIdFormatPrefix)(e.target.value)}
                      placeholder="e.g. APP"
                      className="h-8 text-sm"
                      disabled={!addUsesPattern}
                    />
                  </div>
                  <div className="w-20 space-y-1">
                    <Label className="text-xs text-white/60">Separator *</Label>
                    <EntityTypeIdSeparatorSelect
                      value={addIdSeparator}
                      onChange={setAddIdSeparator}
                      disabled={!addUsesPattern}
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label className="text-xs text-white/60">Digits *</Label>
                    <Input
                      type="number"
                      min={MIN_DIGITS}
                      max={MAX_DIGITS}
                      value={addMinIdDigits}
                      onChange={(e) => handleDigitsChange(setAddMinIdDigits)(e.target.value)}
                      placeholder="3"
                      className="h-8 text-sm"
                      disabled={!addUsesPattern}
                    />
                  </div>
                </div>
                <p className="text-[10px] text-white/40">Alphanumeric prefix; separator; {MIN_DIGITS}–{MAX_DIGITS} digits.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-white/60">Case-Sensitive</Label>
                  <div className="flex items-center h-8">
                    <CaseMatchToggle checked={addCaseSensitive} onChange={setAddCaseSensitive} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-white/60">Word Boundaries</Label>
                  <div className="flex items-center h-8">
                    <CaseMatchToggle checked={addWordBoundaries} onChange={setAddWordBoundaries} />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="sm" onClick={resetAddForm}>Close</Button>
                <Button type="submit" size="sm" disabled={adding} className="bg-emerald-600 hover:bg-emerald-500 text-white">
                  {adding && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                  Create
                </Button>
              </div>
            </form>
          )}

          {/* Types table */}
          <div className="rounded-md overflow-hidden border border-white/[0.08]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left py-2 px-3 text-xs uppercase text-white/50 font-medium">Type Name</th>
                  <th className="text-left py-2 px-3 text-xs uppercase text-white/50 font-medium">Description</th>
                  <th className="text-left py-2 px-3 text-xs uppercase text-white/50 font-medium">Pattern</th>
                  <th className="text-center py-2 px-3 text-xs uppercase text-white/50 font-medium w-12">Case</th>
                  <th className="text-center py-2 px-3 text-xs uppercase text-white/50 font-medium w-12">Boundary</th>
                  <th className="text-center py-2 px-3 text-xs uppercase text-white/50 font-medium w-12">Entities</th>
                  <th className="text-right py-2 px-3 text-xs uppercase text-white/50 font-medium w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {types.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-white/50">
                      <div className="flex flex-col items-center gap-2">
                        <Layers className="h-6 w-6 opacity-40" />
                        <p>No entity types found.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  types.map((t) => (
                    <tr key={t.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      {editingId === t.id ? (
                        <>
                          <td className="py-2 px-3">
                            <Input
                              value={editTypeName}
                              onChange={(e) => setEditTypeName(e.target.value)}
                              className="h-7 text-sm px-2"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit(t.id); }
                                if (e.key === 'Escape') cancelEdit();
                              }}
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="h-7 text-sm px-2"
                              placeholder="Description"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <div className={`space-y-2 ${!editUsesPattern ? disabledClass : ''}`}>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-white/50">Use pattern</span>
                                <Switch checked={editUsesPattern} onCheckedChange={(v) => setEditUsesPattern(v)} size="sm" />
                              </div>
                              <div className="flex gap-2 items-start">
                                <Input
                                  value={editIdFormatPrefix}
                                  onChange={(e) => handlePrefixChange(setEditIdFormatPrefix)(e.target.value)}
                                  className="h-6 text-xs px-2 flex-1 min-w-0"
                                  placeholder="Prefix"
                                  disabled={!editUsesPattern}
                                />
                                <EntityTypeIdSeparatorSelect
                                  value={editIdSeparator}
                                  onChange={setEditIdSeparator}
                                  disabled={!editUsesPattern}
                                  compact
                                />
                                <Input
                                  type="number"
                                  min={MIN_DIGITS}
                                  max={MAX_DIGITS}
                                  value={editMinIdDigits}
                                  onChange={(e) => handleDigitsChange(setEditMinIdDigits)(e.target.value)}
                                  className="h-6 text-xs px-2 w-16"
                                  placeholder="Digits"
                                  disabled={!editUsesPattern}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <div className="flex items-center justify-center">
                              <CaseMatchToggle checked={editCaseSensitive} onChange={setEditCaseSensitive} />
                            </div>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <div className="flex items-center justify-center">
                              <CaseMatchToggle checked={editWordBoundaries} onChange={setEditWordBoundaries} />
                            </div>
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-white/40">{entityCounts[t.id] || 0}</td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-emerald-400 hover:text-emerald-300"
                                onClick={() => handleSaveEdit(t.id)}
                                disabled={savingEdit}
                                title="Save"
                              >
                                {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-xs font-bold">✓</span>}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-white/40 hover:text-white/70"
                                onClick={cancelEdit}
                                title="Cancel"
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 px-3 text-white/80 font-medium">{t.type_name}</td>
                          <td className="py-2 px-3 text-white/50 text-xs">{t.description || <span className="text-white/20">-</span>}</td>
                          <td className="py-2 px-3">{renderPatternPreview(t)}</td>
                          <td className="py-2 px-3 text-center">
                            <span
                              title={(t.case_match ?? 'insensitive') === 'sensitive' ? 'Case-sensitive match' : 'Case-insensitive match'}
                              className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${
                                (t.case_match ?? 'insensitive') === 'sensitive'
                                  ? 'bg-amber-800/15 text-amber-400 border-amber-700/20'
                                  : 'bg-white/5 text-white/20 border-white/5'
                              }`}
                            >
                              {(t.case_match ?? 'insensitive') === 'sensitive' ? 'Aa' : 'aa'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span
                              title={(t.word_boundary_match ?? 'boundaries') === 'boundaries' ? 'Whole-word match' : 'Substring match'}
                              className={`inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border ${
                                (t.word_boundary_match ?? 'boundaries') === 'boundaries'
                                  ? 'bg-violet-800/15 text-violet-400 border-violet-700/20'
                                  : 'bg-white/5 text-white/20 border-white/5'
                              }`}
                            >
                              {WORD_BOUNDARY_LABELS[(t.word_boundary_match ?? 'boundaries')]}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono ${(entityCounts[t.id] || 0) > 0 ? 'bg-emerald-800/15 text-emerald-400 border border-emerald-700/20' : 'bg-white/5 text-white/30 border border-white/5'}`}>
                              {entityCounts[t.id] || 0}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-white/40 hover:text-white/70"
                                onClick={() => startEdit(t)}
                                title="Edit"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-red-400/60 hover:text-red-400"
                                onClick={() => handleDelete(t.id)}
                                disabled={deleting && deletingId === t.id}
                                title="Delete"
                              >
                                {deleting && deletingId === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Close */}
          <div className="flex justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
