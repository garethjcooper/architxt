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
          <DialogTitle className="text-xl font-semibold text-white">
            Create Metadata Entry
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Key Field */}
          <div className="space-y-2">
            <Label htmlFor="create-key" className="text-xs uppercase text-white/50 font-medium">
              Key *
            </Label>
            <Input
              id="create-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter metadata key"
              className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          {/* Value Field */}
          <div className="space-y-2">
            <Label htmlFor="create-value" className="text-xs uppercase text-white/50 font-medium">
              Value
            </Label>
            <Input
              id="create-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter metadata value (optional)"
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
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Close
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!key.trim() || isLoading}
              className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
