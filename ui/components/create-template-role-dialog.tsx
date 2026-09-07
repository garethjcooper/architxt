'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { templateRolesApi } from '@/lib/api/client';

const SCOPE_LABELS: Record<'node' | 'edge' | 'seed', string> = {
  node: 'NODE',
  edge: 'EDGE',
  seed: 'SEED',
};

type Scope = keyof typeof SCOPE_LABELS;
const SCOPES: Scope[] = ['node', 'edge', 'seed'];

interface CreateTemplateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoleCreated: () => void;
}

export function CreateTemplateRoleDialog({
  open,
  onOpenChange,
  onRoleCreated,
}: CreateTemplateRoleDialogProps) {
  const [roleId, setRoleId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [derivationScope, setDerivationScope] = useState<Scope>('node');
  const [sortOrder, setSortOrder] = useState(1);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open) {
      setRoleId('');
      setDisplayName('');
      setDerivationScope('node');
      setSortOrder(1);
    }
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedId = roleId.trim();
    const trimmedName = displayName.trim();

    if (!trimmedId) {
      toast.error('Role ID is required');
      return;
    }
    if (!trimmedName) {
      toast.error('Display name is required');
      return;
    }

    setCreating(true);
    try {
      await templateRolesApi.create({
        role_id: trimmedId,
        display_name: trimmedName,
        derivation_scope: derivationScope,
        sort_order: sortOrder,
      });
      toast.success('Template role created');
      onOpenChange(false);
      onRoleCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create template role';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            Create Template Role
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label htmlFor="role_id" className="text-xs uppercase text-white/50 font-medium">
              Role ID *
            </Label>
            <Input
              id="role_id"
              placeholder="my_custom_role"
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
            <p className="text-[11px] text-white/40">
              Max 64 characters. The <code className="text-amber-400">sys_</code> prefix is reserved for system roles.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="display_name" className="text-xs uppercase text-white/50 font-medium">
              Display Name *
            </Label>
            <Input
              id="display_name"
              placeholder="My custom role"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="derivation_scope" className="text-xs uppercase text-white/50 font-medium">
                Derivation Scope *
              </Label>
              <select
                id="derivation_scope"
                value={derivationScope}
                onChange={(e) => setDerivationScope(e.target.value as Scope)}
                className="w-full h-10 rounded-lg border border-white/20 bg-[oklch(0.23_0_0)] px-3 text-sm text-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/40 outline-none"
              >
                {SCOPES.map((scope) => (
                  <option key={scope} value={scope}>
                    {SCOPE_LABELS[scope]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sort_order" className="text-xs uppercase text-white/50 font-medium">
                Sort Order
              </Label>
              <Input
                id="sort_order"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={creating}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Close
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!roleId.trim() || !displayName.trim() || creating}
              className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
