"use client";

import { useState, useEffect, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { PageShell } from "@/app/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useMultiSelect } from "@/hooks/useMultiSelect";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { createLogger } from "@/lib/logger";
import {
  Trash2,
  Plus,
  Activity,
  Search,
  X,
  RefreshCw,
  TableIcon,
} from "lucide-react";
import { traceProfilesApi } from "@/lib/api/client";
import { TraceProfile } from "@/lib/types";
import { toast } from "sonner";
import { TraceProfileDialog } from "./_components/trace-profile-dialog";

const logger = createLogger('TraceProfilesPage');

export default function TraceProfilesPage() {
  const [profiles, setProfiles] = useState<TraceProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TraceProfile | null>(null);

  /* ── List state ── */
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [freeze, setFreeze] = useState(false);

  useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    setLoading(true);
    try {
      const data = await traceProfilesApi.list();
      setProfiles(data);
    } catch (err) {
      toast.error("Failed to load trace profiles");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  function handleEdit(profile: TraceProfile) {
    setEditing(profile);
    setDialogOpen(true);
  }

  function handleCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  const filteredProfiles = useMemo(() => {
    if (!search.trim()) return profiles;
    const q = search.toLowerCase();
    return profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.config?.parser?.module && p.config.parser.module.toLowerCase().includes(q)) ||
        p.id.toString().includes(q)
    );
  }, [profiles, search]);

  const { selected, toggleSelection, toggleAll, clearSelection, isAllSelected } = useMultiSelect(filteredProfiles);

  const displayProfiles = useMemo(() => {
    if (!search.trim()) return filteredProfiles;
    const visibleIds = new Set(filteredProfiles.map((p) => p.id));
    const selectedHidden = profiles.filter((p) => selected.has(p.id) && !visibleIds.has(p.id));
    return [...filteredProfiles, ...selectedHidden];
  }, [filteredProfiles, profiles, search, selected]);

  function openDeleteConfirm() {
    setConfirmOpen(true);
  }

  async function handleDeleteConfirmed() {
    const ids = Array.from(selected) as number[];
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await traceProfilesApi.delete(id);
        succeeded++;
      } catch (err) {
        logger.error('Failed to delete trace profile', { id, error: err });
        failed++;
      }
    }
    if (failed === 0) {
      toast.success(`${succeeded} profile${succeeded !== 1 ? 's' : ''} deleted`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} delete operations failed`);
    } else {
      toast.warning(`${succeeded} deleted, ${failed} failed`);
    }
    clearSelection();
    setConfirmOpen(false);
    await loadProfiles();
  }

  const handleProfileClick = (profile: TraceProfile, e: React.MouseEvent) => {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    handleEdit(profile);
  };

  return (
    <PageShell
      title="Trace profiles"
      subtitle="Configure engines that turn raw trace/log files into intermediate spans."
      loading={loading}
      count={profiles.length}
      countLabel="profile"
    >
      <div className="flex items-center gap-2 mb-2">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, engine, description…"
            className="h-8 pl-7 pr-7 text-xs rounded-full bg-surface-card border-2 border-border-default text-foreground-default placeholder:text-foreground-placeholder focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground-faint"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex-1" />
        <div className="w-px h-5 bg-surface-panel mx-1" />
        <Button onClick={loadProfiles} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-border-default text-foreground-default hover:bg-surface-hover transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>
        <Button
          onClick={openDeleteConfirm}
          disabled={selected.size === 0}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-destructive-bd text-destructive-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          onClick={handleCreate}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-border-default text-foreground-default hover:bg-surface-hover transition-colors"
          title="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="rounded-md bg-surface-card border border-on-dark/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-accent-primary-bg border-b border-accent-primary-bd shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFreeze(!freeze)}
              title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
              className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd" : "text-foreground-subtle hover:text-foreground-faint border border-transparent"].join(" ")}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-mono text-accent-secondary-fg bg-surface-inset border border-accent-secondary-bd px-2 py-0.5 rounded">
              {filteredProfiles.length} ({selected.size})
            </span>
          </div>
        </div>

        <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
          <table className="w-full caption-bottom text-sm">
            <thead>
              <tr className="border-b border-border-default">
                <th className={["w-12 py-2 px-4 text-left", !freeze && "sticky top-0 left-0 z-30 bg-surface-card border-r border-border-subtle"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={toggleAll}
                  />
                </th>
                <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>ID</th>
                <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Name</th>
                <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Engine</th>
                <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Config Updated</th>
                <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Description</th>
                <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {displayProfiles.length === 0 && !loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-foreground-faint">
                    <div className="flex flex-col items-center gap-2">
                      <Activity className="h-8 w-8 opacity-50" />
                      <p>No trace profiles found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                displayProfiles.map((profile) => (
                  <tr
                    key={profile.id}
                    className={`border-b border-border-subtle transition-colors cursor-pointer ${
                      selected.has(profile.id) ? 'bg-accent-primary-bg' : 'hover:bg-surface-card'
                    }`}
                    onClick={(e) => handleProfileClick(profile, e)}
                  >
                    <td className={["py-1.5 px-4", freeze && "sticky left-0 z-10 border-r border-border-subtle", selected.has(profile.id) ? "bg-accent-primary-bg" : "bg-surface-card"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(profile.id)}
                        onCheckedChange={() => toggleSelection(profile.id)}
                      />
                    </td>
                    <td className="py-1.5 px-4 text-xs text-foreground-subtle font-mono">{profile.id}</td>
                    <td className="py-1.5 px-4 text-xs font-semibold text-foreground-default">
                      {profile.name ? (
                        <span className={search.trim() && profile.name.toLowerCase().includes(search.toLowerCase()) ? 'text-accent-primary-fg' : ''}>
                          {profile.name}
                        </span>
                      ) : (
                        <span className="text-foreground-placeholder text-xs">-</span>
                      )}
                    </td>
                    <td className="py-1.5 px-4 text-xs text-foreground-faint">{profile.config?.parser?.module || "—"}</td>
                    <td className="py-1.5 px-4 text-xs text-foreground-subtle">
                      {profile.config_updated_at ? formatDistanceToNow(new Date(profile.config_updated_at), { addSuffix: true }) : "—"}
                    </td>
                    <td className="py-1.5 px-4 text-xs text-foreground-muted max-w-md">
                      <span className="truncate block">
                        {profile.description || "—"}
                      </span>
                    </td>
                    <td className="py-1.5 px-4 text-xs text-foreground-subtle">
                      {formatDistanceToNow(new Date(profile.updated_at), { addSuffix: true })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete Selected Trace Profiles"
        description={`Are you sure you want to delete ${selected.size} trace profile${selected.size !== 1 ? 's' : ''}? This action cannot be undone.`}
        onConfirm={handleDeleteConfirmed}
        variant="destructive"
      />

      <TraceProfileDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={loadProfiles}
      />
    </PageShell>
  );
}
