'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Network } from 'lucide-react';
import { serversApi } from '@/lib/api/client';
import { toast } from 'sonner';
import type { Server, ContextualGraphBankConfig } from '@/lib/types';

interface ServerGraphBanksDialogProps {
  server: Server | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerUpdated?: () => void;
}

export function ServerGraphBanksDialog({
  server,
  open,
  onOpenChange,
  onServerUpdated,
}: ServerGraphBanksDialogProps) {
  const [banks, setBanks] = useState<Array<{ bank_id: string; name?: string }>>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [configs, setConfigs] = useState<Record<string, ContextualGraphBankConfig>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!server || !open) return;

    const initial: Record<string, ContextualGraphBankConfig> = {};
    for (const cfg of server.contextual_graph_banks || []) {
      initial[cfg.bank_id] = { ...cfg };
    }
    setConfigs(initial);

    async function loadBanks() {
      if (!server) return;
      setLoadingBanks(true);
      try {
        const data = await serversApi.listBanks(server.id);
        setBanks(data || []);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load banks');
      } finally {
        setLoadingBanks(false);
      }
    }

    loadBanks();
  }, [server, open]);

  if (!server) return null;

  const toggleBank = (bankId: string) => {
    setConfigs((prev) => {
      const existing = prev[bankId];
      if (existing) {
        const { [bankId]: _, ...rest } = prev;
        return rest;
      }
      return {
        ...prev,
        [bankId]: { bank_id: bankId, mode: 'manual' as const },
      };
    });
  };

  const setMode = (bankId: string, mode: 'manual' | 'auto') => {
    setConfigs((prev) => ({
      ...prev,
      [bankId]: {
        ...prev[bankId],
        bank_id: bankId,
        mode,
        refresh_interval: mode === 'auto' ? (prev[bankId]?.refresh_interval || '10m') : undefined,
      },
    }));
  };

  const setInterval = (bankId: string, value: string) => {
    setConfigs((prev) => ({
      ...prev,
      [bankId]: {
        ...prev[bankId],
        bank_id: bankId,
        refresh_interval: value,
      },
    }));
  };

  const hasChanges = (() => {
    const initial = new Map((server.contextual_graph_banks || []).map((c) => [c.bank_id, c]));
    const next = new Map(Object.values(configs).map((c) => [c.bank_id, c]));
    if (initial.size !== next.size) return true;
    for (const [bankId, cfg] of next) {
      const existing = initial.get(bankId);
      if (!existing) return true;
      if (existing.mode !== cfg.mode) return true;
      if (cfg.mode === 'auto' && existing.refresh_interval !== cfg.refresh_interval) return true;
    }
    return false;
  })();

  const handleSave = async () => {
    const autoBanks = Object.values(configs).filter((c) => c.mode === 'auto');
    for (const cfg of autoBanks) {
      if (!cfg.refresh_interval || !/^(\d+)([mhdw])$/.test(cfg.refresh_interval)) {
        toast.error(`Invalid refresh interval for ${cfg.bank_id}. Use format like 5m, 2h, 1d, 1w.`);
        return;
      }
    }

    setSaving(true);
    try {
      await serversApi.update(server.id, {
        contextual_graph_banks: Object.values(configs),
      });
      toast.success('Graph bank settings updated');
      onServerUpdated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            <Network className="h-5 w-5 text-emerald-400" />
            Graph Banks — {server.name || server.base_url}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-white/60">
            Choose which banks are managed by the contextual graph. Manual banks appear in the Context Manager but never auto-sync. Auto banks sync on a refresh interval when the sync daemon is enabled.
          </p>

          {loadingBanks ? (
            <div className="flex items-center justify-center py-8 text-white/50">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading banks...
            </div>
          ) : banks.length === 0 ? (
            <div className="text-center py-6 text-white/50 text-sm">
              No banks found on this server.
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
              {banks.map((bank) => {
                const cfg = configs[bank.bank_id];
                const enabled = !!cfg;
                return (
                  <div
                    key={bank.bank_id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.03]"
                  >
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={() => toggleBank(bank.bank_id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {bank.name || bank.bank_id}
                      </p>
                      <p className="text-xs text-white/40 font-mono truncate">
                        {bank.bank_id}
                      </p>
                    </div>

                    {enabled && (
                      <>
                        <div className="flex items-center gap-2">
                          <Label className="text-xs text-white/50 whitespace-nowrap">Mode</Label>
                          <select
                            value={cfg.mode}
                            onChange={(e) => setMode(bank.bank_id, e.target.value as 'manual' | 'auto')}
                            className="h-8 rounded-md border border-white/20 bg-transparent text-white text-xs px-2 focus:border-emerald-400 focus:outline-none"
                          >
                            <option value="manual">Manual</option>
                            <option value="auto">Auto</option>
                          </select>
                        </div>

                        {cfg.mode === 'auto' && (
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-white/50 whitespace-nowrap">Interval</Label>
                            <Input
                              value={cfg.refresh_interval || ''}
                              onChange={(e) => setInterval(bank.bank_id, e.target.value)}
                              placeholder="10m"
                              className="h-8 w-20 !text-xs !rounded-md !border-white/20 !bg-transparent !text-white"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
