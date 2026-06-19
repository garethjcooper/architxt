'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { directivesApi } from '@/lib/api/client';
import { toast } from 'sonner';
import type { Directive } from '@/lib/types';

interface ViewDirectiveDialogProps {
  directive: Directive | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDirectiveUpdated?: () => void;
}

export function ViewDirectiveDialog({
  directive,
  open,
  onOpenChange,
  onDirectiveUpdated,
}: ViewDirectiveDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [statement, setStatement] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [priority, setPriority] = useState(0);

  useEffect(() => {
    if (directive) {
      setName(directive.name || '');
      setStatement(directive.statement || '');
      setIsActive(directive.is_active ?? true);
      setPriority(directive.priority ?? 0);
    }
  }, [directive, open]);

  if (!directive) return null;

  const hasChanges =
    name !== (directive.name || '') ||
    statement !== (directive.statement || '') ||
    isActive !== (directive.is_active ?? true) ||
    priority !== (directive.priority ?? 0);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: Record<string, any> = {
        name: name,
        statement: statement,
      };

      if (isActive !== (directive.is_active ?? true)) {
        updates.is_active = isActive;
      }
      if (priority !== (directive.priority ?? 0)) {
        updates.priority = Number.isFinite(priority) ? priority : 0;
      }

      await directivesApi.update(directive.id, updates);
      toast.success('Directive updated');
      onDirectiveUpdated?.();
      onOpenChange(false);
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
          <DialogTitle className="text-xl font-semibold text-white">
            Directive Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="view-directive-name" className="text-xs uppercase text-white/50 font-medium">
                Name
              </Label>
              <Input
                id="view-directive-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Directive name / id"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>

            {/* Statement */}
            <div className="space-y-2">
              <Label htmlFor="view-directive-statement" className="text-xs uppercase text-white/50 font-medium">
                Statement
              </Label>
              <Textarea
                id="view-directive-statement"
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="Directive statement"
                rows={5}
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>

            {/* Active + Priority */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="view-directive-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
                <Label htmlFor="view-directive-active" className="text-xs uppercase text-white/50 font-medium">
                  Active
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="view-directive-priority" className="text-xs uppercase text-white/50 font-medium">
                  Priority
                </Label>
                <Input
                  id="view-directive-priority"
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value || '0', 10))}
                  className="!w-20 !rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                  style={{
                    '--tw-ring-color': 'rgb(52, 211, 153)',
                    '--tw-ring-opacity': '0.4',
                  } as React.CSSProperties}
                />
              </div>
            </div>
          </div>

          {/* Read-only metadata */}
          <div className="space-y-4 pt-2 border-t border-white/10">
            <div className="space-y-2">
              <Label className="text-xs uppercase text-white/50 font-medium">Tags</Label>
              {directive.tags?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {directive.tags.map((t) => (
                    <span
                      key={t.id}
                      className="px-2.5 py-1 rounded-full bg-orange-400/20 text-orange-300 text-xs border border-orange-400/30"
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-white/40 italic">-</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs uppercase text-white/50 font-medium">Directive ID</p>
                <p className="text-sm text-white font-mono">{directive.id}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase text-white/50 font-medium">Generated By</p>
                <p className="text-sm text-white font-mono">{directive.generated_by}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase text-white/50 font-medium">Created</p>
                <p className="text-sm text-white/70">
                  {formatDistanceToNow(new Date(directive.created_at), { addSuffix: true })}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase text-white/50 font-medium">Updated</p>
                <p className="text-sm text-white/70">
                  {formatDistanceToNow(new Date(directive.updated_at), { addSuffix: true })}
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Close
            </Button>
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
