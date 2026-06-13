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
  const [apiVersion, setApiVersion] = useState('');
  const [creating, setCreating] = useState(false);

  // Reset fields when dialog opens
  useEffect(() => {
    if (open) {
      setBaseUrl('');
      setName('');
      setApiKey('');
      setApiVersion('');
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
        api_version: apiVersion.trim() || undefined,
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

  const inputClass = "!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-white">
            Create Server
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleCreate} className="space-y-6 py-4">
          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="base_url" className="text-xs uppercase text-white/50 font-medium">
              Base URL *
            </Label>
            <Input
              id="base_url"
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className={inputClass}
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name" className="text-xs uppercase text-white/50 font-medium">
              Name
            </Label>
            <Input
              id="name"
              placeholder="Production Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <Label htmlFor="api_key" className="text-xs uppercase text-white/50 font-medium">
              API Key
            </Label>
            <Input
              id="api_key"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className={inputClass}
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          {/* API Version */}
          <div className="space-y-2">
            <Label htmlFor="api_version" className="text-xs uppercase text-white/50 font-medium">
              API Version
            </Label>
            <Input
              id="api_version"
              placeholder="v1"
              value={apiVersion}
              onChange={(e) => setApiVersion(e.target.value)}
              className={inputClass}
              style={{
                '--tw-ring-color': 'rgb(52, 211, 153)',
                '--tw-ring-opacity': '0.4',
              } as React.CSSProperties}
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={creating}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Close
            </Button>
            <Button
              type="submit"
              disabled={!baseUrl.trim() || creating}
              className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
