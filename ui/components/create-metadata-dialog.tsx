'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { metadataApi } from '@/lib/api/client';
import { toast } from 'sonner';

interface CreateMetadataDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMetadataCreated?: () => void;
}

export function CreateMetadataDialog({
  open,
  onOpenChange,
  onMetadataCreated,
}: CreateMetadataDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');

  const handleCreate = async () => {
    if (!key.trim()) {
      toast.error('Key is required');
      return;
    }

    setIsLoading(true);
    try {
      await metadataApi.create({
        key: key.trim(),
        value: value.trim() || undefined,
        generated_by: 'user',
      });
      toast.success('Metadata entry created');
      setKey('');
      setValue('');
      onMetadataCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground-default">
            Create Metadata Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Key Field */}
          <div className="space-y-2">
            <Label htmlFor="create-key" className="text-xs uppercase text-foreground-subtle font-medium">
              Key *
            </Label>
            <Input
              id="create-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter metadata key"
              className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
            />
          </div>

          {/* Value Field */}
          <div className="space-y-2">
            <Label htmlFor="create-value" className="text-xs uppercase text-foreground-subtle font-medium">
              Value
            </Label>
            <Input
              id="create-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter metadata value (optional)"
              className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
            >
              Close
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!key.trim() || isLoading}
              className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
