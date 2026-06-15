'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, Pencil, X, Layers } from 'lucide-react';
import { entityTypesApi, entitiesApi } from '@/lib/api/client';
import type { EntityType } from '@/lib/types';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ManageEntityTypesDialog');

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
  const [addIdLabel, setAddIdLabel] = useState('');
  const [addNameLabel, setAddNameLabel] = useState('');
  const [addDescription, setAddDescription] = useState('');
  const [adding, setAdding] = useState(false);

  // Edit state: id -> field values
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTypeName, setEditTypeName] = useState('');
  const [editIdLabel, setEditIdLabel] = useState('');
  const [editNameLabel, setEditNameLabel] = useState('');
  const [editDescription, setEditDescription] = useState('');
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
    setAddIdLabel('');
    setAddNameLabel('');
    setAddDescription('');
    setShowAddForm(false);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addTypeName.trim();
    if (!name) {
      toast.error('Type name is required');
      return;
    }
    setAdding(true);
    try {
      await entityTypesApi.create({
        type_name: name,
        id_label: addIdLabel.trim() || undefined,
        name_label: addNameLabel.trim() || undefined,
        description: addDescription.trim() || undefined,
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
    setEditIdLabel(t.id_label || '');
    setEditNameLabel(t.name_label || '');
    setEditDescription(t.description || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTypeName('');
    setEditIdLabel('');
    setEditNameLabel('');
    setEditDescription('');
  };

  const handleSaveEdit = async (id: number) => {
    const name = editTypeName.trim();
    if (!name) {
      toast.error('Type name is required');
      return;
    }
    setSavingEdit(true);
    try {
      await entityTypesApi.update(id, {
        type_name: name,
        id_label: editIdLabel.trim() || undefined,
        name_label: editNameLabel.trim() || undefined,
        description: editDescription.trim() || undefined,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
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
                <div className="space-y-1">
                  <Label className="text-xs text-white/60">ID Label</Label>
                  <Input
                    value={addIdLabel}
                    onChange={(e) => setAddIdLabel(e.target.value)}
                    placeholder="e.g. Component ID"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-white/60">Name Label</Label>
                  <Input
                    value={addNameLabel}
                    onChange={(e) => setAddNameLabel(e.target.value)}
                    placeholder="e.g. Component Name"
                    className="h-8 text-sm"
                  />
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
                  <th className="text-left py-2 px-3 text-xs uppercase text-white/50 font-medium">ID Label</th>
                  <th className="text-left py-2 px-3 text-xs uppercase text-white/50 font-medium">Name Label</th>
                  <th className="text-left py-2 px-3 text-xs uppercase text-white/50 font-medium">Description</th>
                  <th className="text-center py-2 px-3 text-xs uppercase text-white/50 font-medium w-12">Match</th>
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
                              value={editIdLabel}
                              onChange={(e) => setEditIdLabel(e.target.value)}
                              className="h-7 text-sm px-2"
                              placeholder="ID Label"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <Input
                              value={editNameLabel}
                              onChange={(e) => setEditNameLabel(e.target.value)}
                              className="h-7 text-sm px-2"
                              placeholder="Name Label"
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
                          <td className="py-2 px-3 text-white/50 text-xs">{t.id_label || <span className="text-white/20">-</span>}</td>
                          <td className="py-2 px-3 text-white/50 text-xs">{t.name_label || <span className="text-white/20">-</span>}</td>
                          <td className="py-2 px-3 text-white/50 text-xs">{t.description || <span className="text-white/20">-</span>}</td>
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
