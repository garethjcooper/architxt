'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { serversApi } from '@/lib/api/client';
import { toast } from 'sonner';

interface Server {
  id: number;
  base_url: string;
  name: string;
  api_key: string | null;
  api_version: string | null;
  contextual_graph_banks: { bank_id: string; mode: 'manual' | 'auto'; refresh_interval?: string }[];
  created_at: string;
  updated_at: string;
}

interface ViewServerDialogProps {
  server: Server | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onServerUpdated?: () => void;
}

export function ViewServerDialog({
  server,
  open,
  onOpenChange,
  onServerUpdated,
}: ViewServerDialogProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (server) {
      setName(server.name || '');
      setBaseUrl(server.base_url || '');
      setApiKey(server.api_key || '');
    }
  }, [server, open]);

  if (!server) return null;

  const hasChanges =
    name !== (server.name || '') ||
    baseUrl !== (server.base_url || '') ||
    apiKey !== (server.api_key || '');

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updates: Record<string, any> = {};

      if (name !== (server.name || '')) {
        updates.name = name || null;
      }
      if (baseUrl !== (server.base_url || '')) {
        updates.base_url = baseUrl || null;
      }
      if (apiKey !== (server.api_key || '')) {
        updates.api_key = apiKey || null;
      }

      if (Object.keys(updates).length > 0) {
        await serversApi.update(server.id, updates);
        toast.success('Server updated');
        onServerUpdated?.();
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
          <DialogTitle className="text-xl font-semibold text-foreground-default">
            Server Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Editable Fields */}
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs uppercase text-foreground-subtle font-medium">
                Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter server name"
                className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
              />
            </div>

            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="base-url" className="text-xs uppercase text-foreground-subtle font-medium">
                Base URL
              </Label>
              <Input
                id="base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="Enter base URL"
                className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
              />
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-xs uppercase text-foreground-subtle font-medium">
                API Key
              </Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key (hidden)"
                className="!rounded-lg !border !border-border-strong !bg-transparent !text-foreground-default !placeholder:text-foreground-subtle focus:!border-focus-ring focus:!ring-2 focus:!ring-focus-ring-subtle"
              />
            </div>
          </div>

          {/* Read-only Metadata */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border-default">
            <div className="col-span-2 space-y-2">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Contextual Graph Banks</p>
              {(server.contextual_graph_banks || []).length === 0 ? (
                <p className="text-sm text-foreground-subtle">None configured.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {(server.contextual_graph_banks || []).map((cfg) => (
                    <span
                      key={cfg.bank_id}
                      className={[
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border",
                        cfg.mode === 'auto'
                          ? 'bg-accent-secondary-bg/50 text-accent-secondary-fg border-accent-secondary-bd'
                          : 'bg-badge-neutral-bg text-badge-neutral-fg border-badge-neutral-bd',
                      ].join(' ')}
                      title={cfg.mode === 'auto' ? `Auto sync${cfg.refresh_interval ? ` (${cfg.refresh_interval})` : ''}` : 'Manual only'}
                    >
                      {cfg.bank_id}
                      <span className="text-foreground-subtle">·{cfg.mode === 'auto' ? 'auto' : 'manual'}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Server ID</p>
              <p className="text-sm text-foreground-default font-mono">{server.id}</p>
            </div>
            <div className="col-span-1"></div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Created</p>
              <p className="text-sm text-foreground-faint">
                {formatDistanceToNow(new Date(server.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-foreground-subtle font-medium">Updated</p>
              <p className="text-sm text-foreground-faint">
                {formatDistanceToNow(new Date(server.updated_at), { addSuffix: true })}
              </p>
            </div>
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
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
