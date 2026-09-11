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
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { contextsApi } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('CreateContextDialog');

interface CreateContextDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContextCreated: () => void;
}

export function CreateContextDialog({
  open,
  onOpenChange,
  onContextCreated,
}: CreateContextDialogProps) {
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset description when dialog opens
  useEffect(() => {
    if (open) {
      setDescription('');
    }
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedDesc = description.trim();
    logger.info('Creating context', { description });

    if (!trimmedDesc || trimmedDesc.length === 0) {
      toast.error('Description is required');
      return;
    }

    setCreating(true);
    try {
      await contextsApi.create({
        description: trimmedDesc,
      });
      toast.success('Context created successfully');
      setDescription('');
      onOpenChange(false);
      onContextCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create context';
      logger.error('Failed to create context', { error: err });
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground-default">
            Create Context
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description" className="text-xs uppercase text-foreground-subtle font-medium">
              Description *
            </Label>
            <Textarea
              id="description"
              placeholder="Enter context description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={creating}
              className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
            >
              Close
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!description.trim() || creating}
              className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
