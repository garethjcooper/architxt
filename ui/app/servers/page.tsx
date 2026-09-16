'use client';

import { useState, useEffect } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Server as ServerIcon, Activity, Loader2, CheckCircle, XCircle, RefreshCw, TableIcon, Network } from 'lucide-react';
import { serversApi } from '@/lib/api/client';
import { familyClass } from '@/lib/status-badge';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { CreateServerDialog } from '@/components/create-server-dialog';
import { ViewServerDialog } from '@/components/view-server-dialog';
import { ServerGraphBanksDialog } from '@/components/server-graph-banks-dialog';
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
  const [graphBanksOpen, setGraphBanksOpen] = useState(false);
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

  const openGraphBanks = (server: Server, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedServer(server);
    setGraphBanksOpen(true);
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
      loading={loading}
    >
      {/* Action buttons */}
      <div className="flex items-center gap-2 mb-2">
        <Button
          onClick={() => handleCheckHealth()}
          disabled={selected.size === 0 || checkingHealth.size > 0}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-sm font-medium bg-surface-card border border-accent-secondary-bd text-accent-secondary-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {checkingHealth.size > 0 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          Health
        </Button>

        <div className="flex-1" />
        <div className="w-px h-5 bg-surface-panel mx-1" />

        <Button onClick={fetchServers} title="Refresh" className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-border-default text-foreground-default hover:bg-surface-hover transition-colors"><RefreshCw className="h-3.5 w-3.5" /></Button>

        <Button
          onClick={openDeleteConfirm}
          disabled={selected.size === 0}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-destructive-bd text-destructive-fg hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>

        <Button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-surface-card border border-border-default text-foreground-default hover:bg-surface-hover transition-colors"
          title="Add Server"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className={["rounded-md bg-surface-card border border-on-dark/[0.08] flex flex-col flex-1 min-h-0 overflow-hidden", !freeze ? "max-h-[calc(100vh-240px)]" : ""].filter(Boolean).join(" ")}>
        {/* Grey header bar */}
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
              {servers.length} ({selected.size})
            </span>
          </div>
        </div>

        <div className={["flex-1 overflow-auto", !freeze ? "min-h-0" : ""].filter(Boolean).join(" ")}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border-default">
              <th className={["w-12 py-2 px-4 text-left", !freeze && "sticky top-0 left-0 z-30 bg-surface-card border-r border-border-subtle"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={toggleAll}
                />
              </th>
              <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Server ID</th>
              <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Name</th>
              <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Base URL</th>
              <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-32", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Graph Banks</th>
              <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-24", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}>Health</th>
              <th className={["text-xs uppercase text-foreground-faint font-medium py-2 px-4 text-left w-20", !freeze && "sticky top-0 z-20 bg-surface-card"].filter(Boolean).join(" ")}></th>
            </tr>
          </thead>
          <tbody>
            {servers.length === 0 && !loading ? (
              <tr key="empty-state">
                <td colSpan={7} className="text-center py-8 text-foreground-faint">
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
                  className={`border-b border-border-subtle transition-colors cursor-pointer ${
                    selected.has(server.id) ? 'bg-accent-primary-bg' : 'hover:bg-surface-card'
                  }`}
                  onClick={(e) => handleServerClick(server, e)}
                >
                  <td className={["py-1.5 px-4", !freeze && "sticky left-0 z-10 bg-surface-card border-r border-border-subtle"].filter(Boolean).join(" ")} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(server.id)}
                      onCheckedChange={() => toggleSelection(server.id)}
                    />
                  </td>
                  <td className="py-1.5 px-4 text-xs text-foreground-subtle font-mono">{server.id}</td>
                  <td className="py-1.5 px-4 text-xs">
                    {server.name ? (
                      <span className="inline-flex px-2.5 py-1 rounded-full text-[10px] bg-accent-secondary-bg text-accent-secondary-fg border border-accent-secondary-bd">
                        {server.name}
                      </span>
                    ) : (
                      <span className="text-foreground-placeholder text-xs">-</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-xs text-foreground-faint">
                    {server.base_url}
                  </td>
                  <td className="py-1.5 px-4">
                    <div className="flex flex-wrap gap-1">
                      {(server.contextual_graph_banks || []).length === 0 ? (
                        <span className="text-[11px] text-foreground-placeholder">—</span>
                      ) : (
                        (server.contextual_graph_banks || []).map((cfg) => (
                          <span
                            key={cfg.bank_id}
                            className={[
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border",
                              cfg.mode === 'auto'
                                ? 'bg-badge-success-bg text-badge-success-fg border-badge-success-bd'
                                : 'bg-accent-secondary-bg/50 text-accent-secondary-fg border-accent-secondary-bd/50',
                            ].join(' ')}
                            title={cfg.mode === 'auto' ? `Auto sync${cfg.refresh_interval ? ` (${cfg.refresh_interval})` : ''}` : 'Manual only'}
                          >
                            {cfg.mode === 'auto' ? 'A' : 'M'} {cfg.bank_id}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 px-4">
                    <div className="flex items-center gap-2">
                      {healthStatus[server.id] && (
                        (() => {
                          const isOk = healthStatus[server.id]?.status === 'ok';
                          const Icon = isOk ? CheckCircle : XCircle;
                          return (
                            <span className={`inline-flex items-center gap-1 text-[11px] ${isOk ? familyClass.success : familyClass.danger}`} title={healthStatus[server.id]?.message}>
                              <Icon className="h-3.5 w-3.5" />
                              {isOk ? 'OK' : 'Error'}
                            </span>
                          );
                        })()
                      )}
                      {checkingHealth.has(server.id) && (
                        <Loader2 className="h-3.5 w-3.5 text-foreground-subtle animate-spin" />
                      )}
                      {!healthStatus[server.id] && !checkingHealth.has(server.id) && (
                        <span className="text-[11px] text-foreground-placeholder">—</span>
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 px-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => openGraphBanks(server, e)}
                      className="h-7 px-2 text-[11px] text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
                      title="Configure graph banks"
                    >
                      <Network className="h-3.5 w-3.5 mr-1" />
                      Banks
                    </Button>
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

      <ServerGraphBanksDialog
        server={selectedServer}
        open={graphBanksOpen}
        onOpenChange={setGraphBanksOpen}
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
