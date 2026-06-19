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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { directivesApi } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('CreateDirectiveDialog');

interface CreateDirectiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDirectiveCreated?: () => void;
}

export function CreateDirectiveDialog({
  open,
  onOpenChange,
  onDirectiveCreated,
}: CreateDirectiveDialogProps) {
  const [name, setName] = useState('');
  const [statement, setStatement] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [priority, setPriority] = useState(0);
  const [creating, setCreating] = useState(false);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName('');
      setStatement('');
      setIsActive(true);
      setPriority(0);
    }
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();
    const trimmedStatement = statement.trim();
    logger.info('Creating directive', { name: trimmedName, statement: trimmedStatement });

    if (!trimmedName) {
      toast.error('Name is required');
      return;
    }
    if (!trimmedStatement) {
      toast.error('Statement is required');
      return;
    }

    setCreating(true);
    try {
      await directivesApi.create({
        name: trimmedName,
        statement: trimmedStatement,
        is_active: isActive,
        priority: Number.isFinite(priority) ? priority : 0,
      });
      toast.success('Directive created successfully');
      setName('');
      setStatement('');
      setIsActive(true);
      setPriority(0);
      onOpenChange(false);
      onDirectiveCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create directive';
      logger.error('Failed to create directive', { error: err });
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
            Create Directive
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleCreate}>
          <div className="space-y-6 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="directive-name" className="text-xs uppercase text-white/50 font-medium">
                Name *
              </Label>
              <Input
                id="directive-name"
                placeholder="Enter directive name / id"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>

            {/* Statement */}
            <div className="space-y-2">
              <Label htmlFor="directive-statement" className="text-xs uppercase text-white/50 font-medium">
                Statement *
              </Label>
              <Textarea
                id="directive-statement"
                placeholder="Enter directive statement"
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                rows={4}
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
                  id="directive-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
                <Label htmlFor="directive-active" className="text-xs uppercase text-white/50 font-medium">
                  Active
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="directive-priority" className="text-xs uppercase text-white/50 font-medium">
                  Priority
                </Label>
                <Input
                  id="directive-priority"
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

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={creating || !name.trim() || !statement.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              {creating ? 'Creating...' : 'Create Directive'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
