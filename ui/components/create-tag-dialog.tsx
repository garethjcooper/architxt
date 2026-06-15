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
import { tagsApi } from '@/lib/api/client';

interface CreateTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTagCreated: () => void;
}

export function CreateTagDialog({
  open,
  onOpenChange,
  onTagCreated,
}: CreateTagDialogProps) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset name when dialog opens
  useEffect(() => {
    if (open) {
      setName('');
    }
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = name.trim();

    if (!trimmedName || trimmedName.length === 0) {
      toast.error('Name is required');
      return;
    }

    setCreating(true);
    try {
      await tagsApi.create({
        name: trimmedName,
      });
      toast.success('Tag created successfully');
      setName('');
      onOpenChange(false);
      onTagCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create tag';
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
            Create Tag
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-xs uppercase text-white/50 font-medium">
              Name *
            </Label>
            <Input
              id="name"
              placeholder="Enter tag name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          {/* Actions */}
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
              disabled={!name.trim() || creating}
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
