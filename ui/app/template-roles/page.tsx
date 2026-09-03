'use client';

import { useState, useEffect, useMemo } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
import { Plus, Trash2, Search, X, RefreshCw, Puzzle, Save, Pencil } from 'lucide-react';
import { templateRolesApi, type TemplateRole } from '@/lib/api/client';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CreateTemplateRoleDialog } from '@/components/create-template-role-dialog';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TemplateRolesPage');

const SCOPE_LABELS: Record<'node' | 'edge' | 'seed' | 'graph', string> = {
  node: 'NODE',
  edge: 'EDGE',
  seed: 'SEED',
  graph: 'GRAPH',
};

type Scope = keyof typeof SCOPE_LABELS;
const SCOPES: Scope[] = ['node', 'edge', 'seed', 'graph'];

export default function TemplateRolesPage() {
  const [roles, setRoles] = useState<TemplateRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<TemplateRole>>({});

  const filteredRoles = useMemo(() => {
    if (!search.trim()) return roles;
    const q = search.toLowerCase();
    return roles.filter(
      (r) =>
        r.role_id.toLowerCase().includes(q) ||
        r.display_name.toLowerCase().includes(q) ||
        r.derivation_scope.toLowerCase().includes(q)
    );
  }, [roles, search]);

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const data = await templateRolesApi.list();
      setRoles(data);
    } catch (err) {
      logger.error('Failed to fetch template roles', { error: err });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const startEdit = (role: TemplateRole) => {
    setEditingId(role.role_id);
    setEditForm({
      display_name: role.display_name,
      derivation_scope: role.derivation_scope,
      sort_order: role.sort_order,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async (roleId: string) => {
    try {
      await templateRolesApi.update(roleId, {
        display_name: editForm.display_name,
        ...(editForm.derivation_scope !== undefined && { derivation_scope: editForm.derivation_scope }),
        sort_order: editForm.sort_order,
      });
      toast.success('Template role updated');
      setEditingId(null);
      fetchRoles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update template role';
      toast.error(msg);
    }
  };

  const openDeleteConfirm = (roleId: string) => {
    setPendingDelete(roleId);
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    if (!pendingDelete) return;
    try {
      await templateRolesApi.delete(pendingDelete);
      toast.success('Template role deleted');
      fetchRoles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete template role';
      toast.error(msg);
    } finally {
      setPendingDelete(null);
      setConfirmOpen(false);
    }
  };

  return (
    <PageShell
      title="Template roles"
      subtitle="Manage system and custom mental-model template roles."
      loading={loading}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search role id, name, scope…"
            className="h-8 pl-7 pr-7 text-xs rounded-full bg-white/5 border-2 border-white/10 text-white placeholder:text-white/30 focus-visible:border-emerald-500 focus-visible:ring-2 focus-visible:ring-emerald-500/30"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex-1" />
        <div className="w-px h-5 bg-white/10 mx-1" />
        <Button onClick={fetchRoles} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"
          title="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-md bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-emerald-900/20 border-b border-emerald-500/30 shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-emerald-400 bg-black/30 border border-emerald-500/30 px-2 py-0.5 rounded">
              {filteredRoles.length}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left sticky top-0 z-20 bg-[oklch(0.23_0_0)]">Role ID</th>
                <th className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left sticky top-0 z-20 bg-[oklch(0.23_0_0)]">Display Name</th>
                <th className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left sticky top-0 z-20 bg-[oklch(0.23_0_0)]">Scope</th>
                <th className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left sticky top-0 z-20 bg-[oklch(0.23_0_0)]">Sort</th>
                <th className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left sticky top-0 z-20 bg-[oklch(0.23_0_0)]">Type</th>
                <th className="text-xs uppercase text-white/60 font-medium py-2 px-4 text-left sticky top-0 z-20 bg-[oklch(0.23_0_0)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRoles.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-white/70">
                    <div className="flex flex-col items-center gap-2">
                      <Puzzle className="h-8 w-8 opacity-50" />
                      <p>No template roles found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRoles.map((role) => {
                  const isEditing = editingId === role.role_id;
                  return (
                    <tr key={role.role_id} className="border-b border-white/5">
                      <td className="py-1.5 px-4 text-xs text-white/50 font-mono">{role.role_id}</td>
                      <td className="py-1.5 px-4 text-xs">
                        {isEditing ? (
                          <Input
                            value={editForm.display_name ?? ''}
                            onChange={(e) => setEditForm((f) => ({ ...f, display_name: e.target.value }))}
                            className="h-7 text-xs bg-white/5 border-white/20 text-white"
                          />
                        ) : (
                          <span className="font-semibold text-white">{role.display_name}</span>
                        )}
                      </td>
                      <td className="py-1.5 px-4 text-xs">
                        {isEditing && !role.is_system ? (
                          <Select value={editForm.derivation_scope ?? role.derivation_scope} onValueChange={(v) => setEditForm((f) => ({ ...f, derivation_scope: v as TemplateRole['derivation_scope'] }))}>
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Scope" />
                            </SelectTrigger>
                            <SelectPopup>
                              {SCOPES.map((scope) => (
                                <SelectItem key={scope} value={scope}>
                                  {SCOPE_LABELS[scope]}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        ) : (
                          <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide border bg-emerald-950/30 text-emerald-400 border-emerald-500/40">
                            {SCOPE_LABELS[role.derivation_scope] ?? role.derivation_scope}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-4 text-xs">
                        {isEditing ? (
                          <Input
                            type="number"
                            value={editForm.sort_order ?? ''}
                            onChange={(e) => setEditForm((f) => ({ ...f, sort_order: Number(e.target.value) }))}
                            className="h-7 w-20 text-xs bg-white/5 border-white/20 text-white"
                          />
                        ) : (
                          <span className="text-white/60">{role.sort_order}</span>
                        )}
                      </td>
                      <td className="py-1.5 px-4 text-xs">
                        {role.is_system ? (
                          <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-[10px] font-semibold tracking-wide border bg-blue-950/30 text-blue-400 border-blue-500/40">
                            SYSTEM
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center px-3 py-1 rounded-md text-[10px] font-semibold tracking-wide border bg-white/5 text-white/70 border-white/20">
                            CUSTOM
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-4 text-xs">
                        <div className="flex items-center gap-2">
                          {isEditing ? (
                            <>
                              <Button
                                onClick={() => saveEdit(role.role_id)}
                                className="h-7 w-7 inline-flex items-center justify-center rounded bg-emerald-600 hover:bg-emerald-500 text-white"
                                title="Save"
                              >
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                onClick={cancelEdit}
                                variant="ghost"
                                className="h-7 w-7 inline-flex items-center justify-center rounded text-white/70 hover:text-white hover:bg-white/10"
                                title="Cancel"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                onClick={() => startEdit(role)}
                                variant="ghost"
                                className="h-7 w-7 inline-flex items-center justify-center rounded text-white/70 hover:text-white hover:bg-white/10"
                                title="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                onClick={() => openDeleteConfirm(role.role_id)}
                                variant="ghost"
                                className="h-7 w-7 inline-flex items-center justify-center rounded text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete Template Role"
        description="Are you sure you want to delete this template role? This action cannot be undone and is only allowed when no mental models reference the role."
        onConfirm={handleDeleteConfirmed}
        variant="destructive"
      />

      <CreateTemplateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onRoleCreated={fetchRoles}
      />
    </PageShell>
  );
}
