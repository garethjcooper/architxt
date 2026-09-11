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
import { serversApi } from '@/lib/api/client';

interface CreateServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerCreated: () => void;
}

export function CreateServerDialog({
  open,
  onOpenChange,
  onServerCreated,
}: CreateServerDialogProps) {
  const [baseUrl, setBaseUrl] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset fields when dialog opens
  useEffect(() => {
    if (open) {
      setBaseUrl('');
      setName('');
      setApiKey('');
    }
  }, [open]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedUrl = baseUrl.trim();

    if (!trimmedUrl) {
      toast.error('Base URL is required');
      return;
    }

    setCreating(true);
    try {
      await serversApi.create({
        base_url: trimmedUrl,
        name: name.trim() || undefined,
        api_key: apiKey.trim() || undefined,
      });
      toast.success('Server created successfully');
      onOpenChange(false);
      onServerCreated?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create server';
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const inputClass = "!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-foreground-default">
            Create Server
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleCreate} className="space-y-6 py-4">
          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="base_url" className="text-xs uppercase text-foreground-subtle font-medium">
              Base URL *
            </Label>
            <Input
              id="base_url"
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-xs uppercase text-foreground-subtle font-medium">
              Name
            </Label>
            <Input
              id="name"
              placeholder="Production Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="api_key" className="text-xs uppercase text-foreground-subtle font-medium">
              API Key
            </Label>
            <Input
              id="api_key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={creating}
              className="text-foreground-faint hover:text-foreground-default hover:bg-surface-card"
            >
              Close
            </Button>
            <Button
              type="submit"
              disabled={!baseUrl.trim() || creating}
              className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creating && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
