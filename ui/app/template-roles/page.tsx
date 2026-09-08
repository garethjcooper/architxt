'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Puzzle, Search, X, RefreshCw, TableIcon } from 'lucide-react';
import { templateRolesApi, type TemplateRole } from '@/lib/api/client';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CreateTemplateRoleDialog } from '@/components/create-template-role-dialog';
import { ViewTemplateRoleDialog } from '@/components/view-template-role-dialog';
import { BatchProgressDialog, type BatchItem, type BatchResult } from '@/components/batch-progress-dialog';
import { BadgeCompactIcon } from '@/components/icons/badge-compact-icon';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const logger = createLogger('TemplateRolesPage');

const SCOPE_LABELS: Record<'node' | 'edge' | 'seed', string> = {
  node: 'NODE',
  edge: 'EDGE',
  seed: 'SEED',
};

export default function TemplateRolesPage() {
  const [roles, setRoles] = useState<TemplateRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchProgressOpen, setBatchProgressOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [batchTitle, setBatchTitle] = useState('');
  const [batchDescription, setBatchDescription] = useState('');
  const [batchOperation, setBatchOperation] = useState<(item: BatchItem) => Promise<void>>(() => async () => {});
  const [selectedRole, setSelectedRole] = useState<TemplateRole | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeze, setFreeze] = useState(false);
  const [compactBadges, setCompactBadges] = useState(false);

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

  const isAllSelected = filteredRoles.length > 0 && filteredRoles.every((r) => selected.has(r.role_id));
  const isIndeterminate = filteredRoles.some((r) => selected.has(r.role_id)) && !isAllSelected;

  const displayRoles = useMemo(() => {
    if (!search.trim()) return filteredRoles;
    const visibleIds = new Set(filteredRoles.map((r) => r.role_id));
    const selectedHidden = roles.filter((r) => selected.has(r.role_id) && !visibleIds.has(r.role_id));
    return [...filteredRoles, ...selectedHidden];
  }, [filteredRoles, roles, search, selected]);

  const toggleSelection = useCallback((roleId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (isAllSelected) {
        const next = new Set(prev);
        filteredRoles.forEach((r) => next.delete(r.role_id));
        return next;
      }
      return new Set([...prev, ...filteredRoles.map((r) => r.role_id)]);
    });
  }, [filteredRoles, isAllSelected]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

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

  const openDeleteConfirm = () => {
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setConfirmOpen(false);
      return;
    }
    setBatchTitle('Deleting Template Roles');
    setBatchDescription(`${ids.length} role${ids.length !== 1 ? 's' : ''}`);
    setBatchItems(
      ids.map((roleId) => {
        const role = roles.find((r) => r.role_id === roleId);
        return { id: roleId, label: role ? `${role.display_name} (${roleId})` : roleId };
      })
    );
    setBatchOperation(() => async (item: BatchItem) => {
      await templateRolesApi.delete(item.id as string);
    });
    setConfirmOpen(false);
    setBatchProgressOpen(true);
  };

  const impactedModels = useMemo(() => {
    return Array.from(selected).reduce((sum, roleId) => {
      const role = roles.find((r) => r.role_id === roleId);
      return sum + (role?.usage_count || 0);
    }, 0);
  }, [selected, roles]);

  const handleBatchDeleteComplete = (results: BatchResult[]) => {
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    if (failed === 0) {
      toast.success(`${succeeded} role${succeeded !== 1 ? 's' : ''} deleted`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} delete operations failed`);
    } else {
      toast.warning(`${succeeded} deleted, ${failed} failed`);
    }
    clearSelection();
    fetchRoles();
  };

  const handleRoleClick = (role: TemplateRole, e: React.MouseEvent) => {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) return;
    setSelectedRole(role);
    setViewOpen(true);
  };

  return (
    <PageShell
      title="Template Roles"
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
        <Button
          onClick={fetchRoles}
          title="Refresh"
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button
          onClick={openDeleteConfirm}
          disabled={selected.size === 0}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-red-500/30 text-red-400 hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-white/10 text-white hover:bg-surface-hover transition-colors"
          title="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-md bg-surface-card border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-emerald-900/20 border-b border-emerald-500/30 shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCompactBadges(!compactBadges)}
              title={compactBadges ? 'Expand badges' : 'Compact badges'}
              className={["inline-flex items-center justify-center h-6 rounded-md transition-colors px-1", compactBadges ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <BadgeCompactIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setFreeze(!freeze)}
              title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
              className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-mono text-emerald-400 bg-black/30 border border-emerald-500/30 px-2 py-0.5 rounded">
              {filteredRoles.length} ({selected.size})
            </span>
          </div>
        </div>

        <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className={["w-12 py-2 px-4 text-left", !freeze && "sticky top-0 left-0 z-30 bg-surface-card border-r border-white/5"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isAllSelected}
                    data-state={isIndeterminate ? 'indeterminate' : isAllSelected ? 'checked' : 'unchecked'}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Role ID</th>
                <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Display Name</th>
                <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Scope</th>
                <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Sort</th>
                <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Type</th>
                <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Mental Models</th>
                <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Created</th>
              </tr>
            </thead>
            <tbody>
              {displayRoles.length === 0 && !loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-white/70">
                    <div className="flex flex-col items-center gap-2">
                      <Puzzle className="h-8 w-8 opacity-50" />
                      <p>No template roles found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                displayRoles.map((role) => {
                  const isSelected = selected.has(role.role_id);
                  return (
                    <tr
                      key={role.role_id}
                      className={`border-b border-white/5 transition-colors cursor-pointer ${
                        role.is_system
                          ? 'bg-amber-900/10 hover:bg-amber-900/15'
                          : isSelected
                            ? 'bg-emerald-900/20'
                            : 'hover:bg-white/5'
                      }`}
                      onClick={(e) => handleRoleClick(role, e)}
                    >
                      <td
                        className={["py-1.5 px-4", freeze && "sticky left-0 z-10 border-r border-white/5", role.is_system ? "bg-amber-900/10" : isSelected ? "bg-emerald-900/20" : "bg-surface-card"].filter(Boolean).join(" ")}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleSelection(role.role_id)}
                        />
                      </td>
                      <td className="py-1.5 px-4 text-xs text-white/50 font-mono">{role.role_id}</td>
                      <td className="py-1.5 px-4 text-xs">
                        <span className="font-semibold text-white">{role.display_name}</span>
                      </td>
                      <td className="py-1.5 px-4 text-xs">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide border bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd">
                          {SCOPE_LABELS[role.derivation_scope] ?? role.derivation_scope}
                        </span>
                      </td>
                      <td className="py-1.5 px-4 text-xs text-white/60">{role.sort_order}</td>
                      <td className="py-1.5 px-4 text-xs text-white/70">
                        {role.is_system ? 'System' : 'Custom'}
                      </td>
                      <td className="py-1.5 px-4 text-xs text-white/70">
                        {role.usage_count ? `${role.usage_count} model${role.usage_count !== 1 ? 's' : ''}` : '-'}
                      </td>
                      <td className="py-1.5 px-4 text-xs text-white/50">
                        {formatDistanceToNow(new Date(role.created_at), { addSuffix: true })}
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
        title="Delete Selected Template Roles"
        description={
          selected.size === 0
            ? 'No roles selected.'
            : impactedModels > 0
              ? `Are you sure you want to delete ${selected.size} template role${selected.size !== 1 ? 's' : ''}? This will remove the role from ${impactedModels} mental model${impactedModels !== 1 ? 's' : ''}. Roles in use cannot be deleted and will fail in the batch.`
              : `Are you sure you want to delete ${selected.size} template role${selected.size !== 1 ? 's' : ''}? This action cannot be undone.`
        }
        onConfirm={handleDeleteConfirmed}
        variant="destructive"
      />

      <BatchProgressDialog
        open={batchProgressOpen}
        onClose={() => {
          setBatchProgressOpen(false);
          setBatchItems([]);
        }}
        title={batchTitle}
        description={batchDescription}
        items={batchItems}
        operation={batchOperation}
        onComplete={handleBatchDeleteComplete}
      />

      <ViewTemplateRoleDialog
        role={selectedRole}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onRoleUpdated={fetchRoles}
      />

      <CreateTemplateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onRoleCreated={fetchRoles}
      />
    </PageShell>
  );
}
