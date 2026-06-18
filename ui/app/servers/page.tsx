'use client';

import { useState, useEffect } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Server as ServerIcon, Activity, Loader2, CheckCircle, XCircle, RefreshCw, TableIcon } from 'lucide-react';
import { serversApi } from '@/lib/api/client';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { CreateServerDialog } from '@/components/create-server-dialog';
import { ViewServerDialog } from '@/components/view-server-dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import type { Server } from '@/lib/types';

const logger = createLogger('ServersPage');

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [healthStatus, setHealthStatus] = useState<Record<number, { status: 'ok' | 'error'; message: string; data?: any } | null>>({});
  const [checkingHealth, setCheckingHealth] = useState<Set<number>>(new Set());
  const [freeze, setFreeze] = useState(false);

  // Multi-select hook
  const { selected, toggleSelection, toggleAll, clearSelection, isAllSelected } = useMultiSelect(servers);

  const fetchServers = async () => {
    setLoading(true);
    try {
      const data = await serversApi.list();
      setServers(data);
    } catch (err) {
      logger.error('Failed to fetch servers', { error: err });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  const openDeleteConfirm = () => {
    setConfirmOpen(true);
  };

  const handleDeleteConfirmed = async () => {
    try {
      const deleteCount = selected.size;
      for (const id of Array.from(selected)) {
        await serversApi.delete(id as number);
      }
      toast.success(`${deleteCount} server(s) deleted`);
      clearSelection();
      await fetchServers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete';
      toast.error(msg);
    }
  };

  const handleServerClick = (server: Server, e: React.MouseEvent) => {
    e.preventDefault();
    // Don't open dialog if clicking on checkbox
    if ((e.target as HTMLElement).closest('[role="checkbox"]')) {
      return;
    }
    setSelectedServer(server);
    setViewOpen(true);
  };

  const handleCheckHealth = async (serverId?: number) => {
    const ids = serverId ? [serverId] : Array.from(selected);
    if (ids.length === 0) return;

    setCheckingHealth(prev => new Set([...prev, ...ids]));

    for (const id of ids) {
      try {
        const data = await serversApi.checkHealth(id as number);
        setHealthStatus(prev => ({ ...prev, [id]: { status: 'ok', message: data.status || 'healthy', data } }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Health check failed';
        setHealthStatus(prev => ({ ...prev, [id]: { status: 'error', message: msg } }));
      } finally {
        setCheckingHealth(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    }
  };

  return (
    <PageShell
      title="Servers"
      subtitle="Manage backend servers and processing nodes."
      count={servers.length}
      countLabel="server"
      loading={loading}
    >
      {/* Action buttons */}
      <div className="flex items-center gap-2 mb-2">
        <Button
          onClick={() => handleCheckHealth()}
          disabled={selected.size === 0 || checkingHealth.size > 0}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-neutral-500/30 text-neutral-300 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {checkingHealth.size > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          Health
        </Button>

        <div className="flex-1" />
        <div className="w-px h-5 bg-white/10 mx-1" />

        <Button onClick={fetchServers} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>

        <Button
          onClick={openDeleteConfirm}
          disabled={selected.size === 0}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-red-500/30 text-red-400 hover:bg-[oklch(0.27_0_0)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        <Button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"
          title="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className={["rounded-md bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden", !freeze ? "max-h-[calc(100vh-240px)]" : ""].filter(Boolean).join(" ")}>
        {/* Grey header bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-neutral-800/20 border-b border-neutral-500/30 shrink-0">
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFreeze(!freeze)}
              title={!freeze ? 'Unfreeze panes' : 'Freeze panes'}
              className={["inline-flex items-center justify-center h-6 w-6 rounded transition-colors", !freeze ? "bg-neutral-500/20 text-neutral-400 border border-neutral-500/40" : "text-white/40 hover:text-white/70 border border-transparent"].join(" ")}
            >
              <TableIcon className="h-3.5 w-3.5" />
            </button>
            <span className="text-xs font-mono text-neutral-400 bg-black/30 border border-neutral-500/30 px-2 py-0.5 rounded">
              {servers.length} ({selected.size})
            </span>
          </div>
        </div>

        <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/10">
              <th className={["w-12 py-2 px-4 text-left", !freeze && "sticky top-0 left-0 z-30 bg-[oklch(0.23_0_0)] border-r border-white/5"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Server ID</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Name</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Base URL</th>
              <th className={["text-xs uppercase text-white/60 font-medium py-2 px-4 text-left w-24", !freeze && "sticky top-0 z-20 bg-[oklch(0.23_0_0)]"].filter(Boolean).join(" ")}>Health</th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 && !loading ? (
              <tr key="empty-state">
                <td colSpan={5} className="text-center py-8 text-white/70">
                  <div className="flex flex-col items-center gap-2">
                    <ServerIcon className="h-8 w-8 opacity-50" />
                    <p>No servers found.</p>
                  </div>
                </td>
              </tr>
            ) : (
              servers.map((server) => (
                <tr
                  key={server.id}
                  className={`border-b border-white/5 transition-colors cursor-pointer ${
                    selected.has(server.id) ? 'bg-neutral-800/20' : 'hover:bg-white/5'
                  }`}
                  onClick={(e) => handleServerClick(server, e)}
                >
                  <td className={["py-1.5 px-4", !freeze && "sticky left-0 z-10 bg-[oklch(0.23_0_0)] border-r border-white/5"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(server.id)}
                      onCheckedChange={() => toggleSelection(server.id)}
                    />
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/50 font-mono">{server.id}</td>
                  <td className="py-1.5 px-4 text-xs">
                    {server.name ? (
                      <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] bg-neutral-500/20 text-neutral-300 border border-neutral-500/30">
                        {server.name}
                      </span>
                    ) : (
                      <span className="text-white/30 text-xs">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-white/60">
                    {server.base_url}
                  </td>
                  <td className="py-1.5 px-4">
                    <div className="flex items-center gap-2">
                      {healthStatus[server.id] && (
                        healthStatus[server.id]?.status === 'ok' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400" title={healthStatus[server.id]?.message}>
                            <CheckCircle className="h-3.5 w-3.5" />
                            OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-red-400" title={healthStatus[server.id]?.message}>
                            <XCircle className="h-3.5 w-3.5" />
                            Error
                          </span>
                        )
                      )}
                      {checkingHealth.has(server.id) && (
                        <Loader2 className="h-3.5 w-3.5 text-white/40 animate-spin" />
                      )}
                      {!healthStatus[server.id] && !checkingHealth.has(server.id) && (
                        <span className="text-[11px] text-white/20">—</span>
                      )}
                    </div>
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
        title="Delete Selected Servers"
        description={`Are you sure you want to delete ${selected.size} server(s)? This action cannot be undone.`}
        onConfirm={handleDeleteConfirmed}
        variant="destructive"
      />

      <ViewServerDialog
        server={selectedServer}
        open={viewOpen}
        onOpenChange={setViewOpen}
        onServerUpdated={fetchServers}
      />

      <CreateServerDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onServerCreated={fetchServers}
      />
    </PageShell>
  );
}
