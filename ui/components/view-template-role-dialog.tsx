'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Lock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { templateRolesApi, type TemplateRole } from '@/lib/api/client';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from '@/components/ui/select';
import { toast } from 'sonner';

const SCOPE_LABELS: Record<'node' | 'edge' | 'seed', string> = {
  node: 'NODE',
  edge: 'EDGE',
  seed: 'SEED',
};

type Scope = keyof typeof SCOPE_LABELS;
const SCOPES: Scope[] = ['node', 'edge', 'seed'];

interface ViewTemplateRoleDialogProps {
  role: TemplateRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRoleUpdated?: () => void;
}

export function ViewTemplateRoleDialog({
  role,
  open,
  onOpenChange,
  onRoleUpdated,
}: ViewTemplateRoleDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [derivationScope, setDerivationScope] = useState<Scope>('node');
  const [sortOrder, setSortOrder] = useState(1);

  const isSystem = role?.is_system ?? false;

  useEffect(() => {
    if (role) {
      setDisplayName(role.display_name || '');
      setDerivationScope(role.derivation_scope);
      setSortOrder(role.sort_order ?? 1);
    }
  }, [role, open]);

  if (!role) return null;

  const hasChanges =
    !isSystem && (
      displayName !== (role.display_name || '') ||
      derivationScope !== role.derivation_scope ||
      sortOrder !== role.sort_order
    );

  const handleSave = async () => {
    if (isSystem) return;
    setIsSaving(true);
    try {
      const updates: Record<string, any> = {};
      if (displayName !== (role.display_name || '')) updates.display_name = displayName || null;
      if (derivationScope !== role.derivation_scope) updates.derivation_scope = derivationScope;
      if (sortOrder !== role.sort_order) updates.sort_order = sortOrder;

      if (Object.keys(updates).length > 0) {
        await templateRolesApi.update(role.role_id, updates);
        toast.success('Template role updated');
        onRoleUpdated?.();
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground-default flex items-center gap-2">
            Template Role Details
            {isSystem && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-badge-caution-bg border border-badge-caution-bd text-badge-caution-fg text-[10px] uppercase font-medium">
                <Lock className="h-3 w-3" />
                System — Read Only
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="display_name" className="text-xs uppercase text-foreground-subtle font-medium">
                Display Name
              </Label>
              <Input
                id="display_name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter display name"
                disabled={isSystem}
                className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="derivation_scope" className="text-xs uppercase text-foreground-subtle font-medium">
                  Derivation Scope
                </Label>
                <Select
                  value={derivationScope}
                  onValueChange={(v) => setDerivationScope(v as Scope)}
                  disabled={isSystem}
                >
                  <SelectTrigger id="derivation_scope" className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed">
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="sort_order" className="text-xs uppercase text-foreground-subtle font-medium">
                  Sort Order
                </Label>
                <Input
                  id="sort_order"
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                  disabled={isSystem}
                  className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border-default">
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Role ID</p>
              <p className="text-sm text-foreground-default font-mono">{role.role_id}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Type</p>
              <p className="text-sm text-foreground-default font-mono">{role.is_system ? 'system' : 'custom'}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Mental Models</p>
              <p className="text-sm text-foreground-default font-mono">
                {role.usage_count ? `${role.usage_count} model${role.usage_count !== 1 ? 's' : ''}` : 'None'}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Created</p>
              <p className="text-sm text-foreground-faint">
                {formatDistanceToNow(new Date(role.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Updated</p>
              <p className="text-sm text-foreground-faint">
                {formatDistanceToNow(new Date(role.updated_at), { addSuffix: true })}
              </p>
            </div>
          </div>

          {(role.usage_count ?? 0) > 0 && !isSystem && hasChanges && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-badge-caution-bg border border-badge-caution-bd">
              <svg className="h-4 w-4 text-badge-caution-fg mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-badge-caution-fg">
                This role is assigned to {role.usage_count} mental model{role.usage_count !== 1 ? 's' : ''}. Updating display name or sort order is safe; changing the derivation scope may affect how those models behave.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
            >
              Close
            </Button>
            {!isSystem && (
              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving}
                className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
