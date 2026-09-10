'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectValue,
  SelectTrigger,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
import { Loader2, Network, AlertTriangle, ChevronDown, ChevronUp, Trash2, Bomb } from 'lucide-react';
import { serversApi, contextualGraphApi, hindsightApi, mentalModelsApi } from '@/lib/api/client';
import { toast } from 'sonner';
import { ConfirmDialog } from './confirm-dialog';
import type { Server, ContextualGraphBankConfig } from '@/lib/types';

const LEGACY_MODEL_TYPE_TO_ROLE: Record<string, string> = {
  'entity-summary': 'sys_entity_summary',
  'entity-capabilities': 'sys_entity_capabilities',
  'edge-ctx': 'sys_edge_context',
  'discover': 'sys_discovery_context',
};

interface ServerGraphBanksDialogProps {
  server: Server | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerUpdated?: () => void;
}

function ensureRestriction(cfg: ContextualGraphBankConfig): NonNullable<ContextualGraphBankConfig['restriction']> {
  return cfg.restriction || { import: {}, deploy: {} };
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
  const [templateRoles, setTemplateRoles] = useState<{ role_id: string; display_name: string; derivation_scope: string }[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [cleaning, setCleaning] = useState<Record<string, boolean>>({});
  const [clearingAll, setClearingAll] = useState<Record<string, boolean>>({});
  const [confirmClearBankId, setConfirmClearBankId] = useState<string | null>(null);

  useEffect(() => {
    if (!server || !open) return;

    const initial: Record<string, ContextualGraphBankConfig> = {};
    for (const cfg of server.contextual_graph_banks || []) {
      initial[cfg.bank_id] = JSON.parse(JSON.stringify(cfg));
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

    async function loadTemplateRoles() {
      setLoadingRoles(true);
      try {
        const roles = await mentalModelsApi.listTemplateRoles({ available: true });
        const seen = new Set<string>();
        setTemplateRoles(
          (roles || [])
            .filter((r) => r.value)
            .filter((r) => {
              if (seen.has(r.value)) return false;
              seen.add(r.value);
              return true;
            })
            .map((r) => ({
              role_id: r.value,
              display_name: r.label || r.value,
              derivation_scope: r.derivation_scope || '',
            })),
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load template roles');
        setTemplateRoles([]);
      } finally {
        setLoadingRoles(false);
      }
    }

    loadBanks();
    loadTemplateRoles();
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

  const setImportRestriction = (bankId: string, key: string, value: unknown) => {
    setConfigs((prev) => {
      const cfg = prev[bankId];
      const restriction = ensureRestriction(cfg);
      return {
        ...prev,
        [bankId]: {
          ...cfg,
          bank_id: bankId,
          restriction: {
            ...restriction,
            import: { ...restriction.import, [key]: value },
          },
        },
      };
    });
  };

  const setDeployRestriction = (bankId: string, key: string, value: unknown) => {
    setConfigs((prev) => {
      const cfg = prev[bankId];
      const restriction = ensureRestriction(cfg);
      return {
        ...prev,
        [bankId]: {
          ...cfg,
          bank_id: bankId,
          restriction: {
            ...restriction,
            deploy: { ...restriction.deploy, [key]: value },
          },
        },
      };
    });
  };

  const toggleModelType = (bankId: string, roleId: string) => {
    setConfigs((prev) => {
      const cfg = prev[bankId];
      const restriction = ensureRestriction(cfg);
      const current = restriction.deploy?.allowed_model_types || [];
      const next = current.includes(roleId) ? current.filter((t: string) => t !== roleId) : [...current, roleId];
      return {
        ...prev,
        [bankId]: {
          ...cfg,
          bank_id: bankId,
          restriction: {
            ...restriction,
            deploy: { ...restriction.deploy, allowed_model_types: next },
          },
        },
      };
    });
  };

  const parsePatternCsv = (value: string): string[] =>
    value.split(',').map((s) => s.trim()).filter(Boolean);

  const hasChanges = (() => {
    const initial = new Map((server.contextual_graph_banks || []).map((c) => [c.bank_id, c]));
    const next = new Map(Object.values(configs).map((c) => [c.bank_id, c]));
    if (initial.size !== next.size) return true;
    for (const [bankId, cfg] of next) {
      const existing = initial.get(bankId);
      if (!existing) return true;
      if (JSON.stringify(existing) !== JSON.stringify(cfg)) return true;
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

  const handleCleanBank = async (bankId: string, dryRun: boolean, deleteLocalGraph: boolean) => {
    setCleaning((prev) => ({ ...prev, [bankId]: true }));
    try {
      const result = await contextualGraphApi.undeployBank(server.id, bankId, {
        dry_run: dryRun,
        delete_local_graph: deleteLocalGraph,
      });
      if (!result.success) {
        toast.error(result.error || 'Clean failed');
        return;
      }
      if (dryRun) {
        toast.info(
          `Dry run for ${bankId}: ${result.target_count ?? 0} generated mental models would be deleted. ` +
            (deleteLocalGraph
              ? `${result.deleted_local_graph?.nodes ?? 0} nodes / ${result.deleted_local_graph?.edges ?? 0} edges would be removed locally.`
              : 'Local graph would be preserved.'),
        );
        return;
      }
      toast.success(
        `Cleaned ${bankId}: deleted ${result.deleted_count ?? 0} models` +
          (deleteLocalGraph
            ? ` and removed ${result.deleted_local_graph?.nodes ?? 0} nodes / ${result.deleted_local_graph?.edges ?? 0} edges locally.`
            : `, cleared ${result.cleared?.nodes ?? 0} nodes / ${result.cleared?.edges ?? 0} edges, marked ${result.marked_stale?.nodes ?? 0} stale.`),
      );
      onServerUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Clean failed');
    } finally {
      setCleaning((prev) => ({ ...prev, [bankId]: false }));
    }
  };

  const handleClearAllMentalModels = async (bankId: string) => {
    setClearingAll((prev) => ({ ...prev, [bankId]: true }));
    try {
      const result = await hindsightApi.clearAllMentalModels(server.id, bankId);
      if (!result.success) {
        toast.error(result.error || 'Failed to clear mental models');
        return;
      }
      toast.success(
        `Cleared ${result.deleted_count ?? 0} of ${result.total ?? 0} mental models from ${bankId}` +
          (result.failed_count ? ` (${result.failed_count} failed)` : ''),
      );
      onServerUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear mental models');
    } finally {
      setClearingAll((prev) => ({ ...prev, [bankId]: false }));
    }
  };

  const isAutoWithNoRestriction = (cfg: ContextualGraphBankConfig) => {
    if (cfg.mode !== 'auto') return false;
    const r = cfg.restriction;
    if (!r) return true;
    const deploy = r.deploy || {};
    const importR = r.import || {};
    const hasDeployCap = typeof deploy.max_models_per_run === 'number';
    const hasImportCap = typeof importR.top_k_nodes === 'number';
    return !hasDeployCap && !hasImportCap;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh]">
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
              <Network className="h-5 w-5 text-accent-secondary-fg" />
              Graph Banks — {server.name || server.base_url}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-4 pr-1">
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
              <div className="space-y-2">
                {banks.map((bank) => {
                  const cfg = configs[bank.bank_id];
                  const enabled = !!cfg;
                  const isExpanded = !!expanded[bank.bank_id];
                  const restriction = ensureRestriction(cfg || {});
                  const importR = restriction.import || {};
                  const deploy = restriction.deploy || {};
                  const needsWarning = enabled && isAutoWithNoRestriction(cfg);

                return (
                  <div
                    key={bank.bank_id}
                    className="rounded-lg border border-white/10 bg-white/[0.03] overflow-hidden"
                  >
                    <div className="flex items-center gap-3 p-3">
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
                              className="h-7 w-[110px] rounded-md border border-white/10 bg-surface-card px-2 text-xs text-white/80 focus:border-accent-primary-bd focus:ring-2 focus:ring-focus-ring-subtle outline-none"
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

                          <button
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [bank.bank_id]: !prev[bank.bank_id],
                              }))
                            }
                            className="inline-flex items-center justify-center h-7 w-7 rounded text-white/50 hover:text-white hover:bg-white/5"
                            title="Restrictions"
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                        </>
                      )}
                    </div>

                    {enabled && isExpanded && (
                      <div className="px-4 pb-4 space-y-4 border-t border-white/10">
                        {needsWarning && (
                          <div className="mt-3 flex items-start gap-2 rounded-md bg-badge-caution-bg/50 border border-badge-caution-bd p-2.5 text-badge-caution-fg text-xs">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>
                              Auto-sync with no restrictions can provision many mental models. Set import limits and deploy caps below.
                            </span>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-white/80 uppercase tracking-wide">Import limits</p>
                            <div>
                              <Label className="text-xs text-white/50">Top K nodes</Label>
                              <Input
                                type="number"
                                min={1}
                                value={importR.top_k_nodes ?? ''}
                                onChange={(e) =>
                                  setImportRestriction(
                                    bank.bank_id,
                                    'top_k_nodes',
                                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                                  )
                                }
                                placeholder="100"
                                className="h-8 !text-xs !rounded-md !border-white/20 !bg-transparent !text-white"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-white/50">Min edge weight</Label>
                              <Input
                                type="number"
                                min={0}
                                step={0.1}
                                value={importR.min_weight ?? ''}
                                onChange={(e) =>
                                  setImportRestriction(
                                    bank.bank_id,
                                    'min_weight',
                                    e.target.value === '' ? undefined : parseFloat(e.target.value),
                                  )
                                }
                                placeholder="0"
                                className="h-8 !text-xs !rounded-md !border-white/20 !bg-transparent !text-white"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-white/50">Include patterns (comma-separated regex)</Label>
                              <Input
                                value={(importR.include_patterns || []).join(', ')}
                                onChange={(e) =>
                                  setImportRestriction(bank.bank_id, 'include_patterns', parsePatternCsv(e.target.value))
                                }
                                placeholder="e.g. ^API:, Service"
                                className="h-8 !text-xs !rounded-md !border-white/20 !bg-transparent !text-white"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-white/50">Exclude patterns (comma-separated regex)</Label>
                              <Input
                                value={(importR.exclude_patterns || []).join(', ')}
                                onChange={(e) =>
                                  setImportRestriction(bank.bank_id, 'exclude_patterns', parsePatternCsv(e.target.value))
                                }
                                placeholder="e.g. temp-, noise"
                                className="h-8 !text-xs !rounded-md !border-white/20 !bg-transparent !text-white"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium text-white/80 uppercase tracking-wide">Deploy limits</p>
                            <div>
                              <Label className="text-xs text-white/50">Max models per run</Label>
                              <Input
                                type="number"
                                min={1}
                                value={deploy.max_models_per_run ?? ''}
                                onChange={(e) =>
                                  setDeployRestriction(
                                    bank.bank_id,
                                    'max_models_per_run',
                                    e.target.value === '' ? undefined : parseInt(e.target.value, 10),
                                  )
                                }
                                placeholder="50"
                                className="h-8 !text-xs !rounded-md !border-white/20 !bg-transparent !text-white"
                              />
                            </div>
                            <div>
                              <Label className="text-xs text-white/50">Model types</Label>
                              <div className="flex flex-wrap gap-2 mt-1.5">
                                {templateRoles.map((role) => (
                                  <label
                                    key={role.role_id}
                                    className="inline-flex items-center gap-1.5 text-xs text-white/70 cursor-pointer"
                                  >
                                    <Checkbox
                                      checked={(deploy.allowed_model_types || []).includes(role.role_id)}
                                      onCheckedChange={() => toggleModelType(bank.bank_id, role.role_id)}
                                    />
                                    {role.display_name}
                                  </label>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-white/10">
                          <div className="text-xs text-white/40">
                            Auto defaults: top 100 nodes, no model types deployed.
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={cleaning[bank.bank_id]}
                              onClick={() => handleCleanBank(bank.bank_id, true, false)}
                              className="h-7 text-[11px] text-badge-caution-fg hover:text-badge-caution-fg hover:bg-badge-caution-bg/50"
                            >
                              {cleaning[bank.bank_id] ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                              Dry-run clean
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={cleaning[bank.bank_id]}
                              onClick={() => {
                                if (confirm(`Delete all contextual-graph mental models from ${bank.bank_id}? Local graph nodes will be marked stale but kept. Auto-sync will be disabled for this bank.`)) {
                                  handleCleanBank(bank.bank_id, false, false);
                                }
                              }}
                              className="h-7 text-[11px] text-destructive-fg hover:text-destructive-fg hover:bg-destructive-bg"
                            >
                              {cleaning[bank.bank_id] ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                              Clean models
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={cleaning[bank.bank_id]}
                              onClick={() => {
                                if (confirm(`Delete all contextual-graph mental models AND remove the entire local context graph from ${bank.bank_id}? Auto-sync will be disabled for this bank.`)) {
                                  handleCleanBank(bank.bank_id, false, true);
                                }
                              }}
                              className="h-7 text-[11px] text-destructive-fg hover:text-destructive-fg hover:bg-destructive-bg"
                            >
                              {cleaning[bank.bank_id] ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                              Clean everything
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={clearingAll[bank.bank_id]}
                              onClick={() => setConfirmClearBankId(bank.bank_id)}
                              className="h-7 text-[11px] text-red-600 hover:text-destructive-fg hover:bg-destructive-bg"
                            >
                              {clearingAll[bank.bank_id] ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Bomb className="h-3 w-3 mr-1" />}
                              Clear all mental models
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0">
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
            className="bg-accent-primary-fg hover:bg-accent-primary-fg text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={!!confirmClearBankId}
      onOpenChange={(open) => {
        if (!open) setConfirmClearBankId(null);
      }}
      title="Clear all mental models?"
      description={`This will permanently delete all mental models from the Hindsight bank "${confirmClearBankId}". This action cannot be undone and will break any contextual graph or research features relying on them.`}
      confirmLabel="Clear all"
      cancelLabel="Cancel"
      variant="destructive"
      onConfirm={() => {
        if (confirmClearBankId) {
          handleClearAllMentalModels(confirmClearBankId);
        }
      }}
    />
  </>
  );
}
