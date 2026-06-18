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
          <DialogTitle className="text-xl font-semibold text-white">
            Server Details
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Editable Fields */}
          <div className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs uppercase text-white/50 font-medium">
                Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter server name"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>

            {/* Base URL */}
            <div className="space-y-2">
              <Label htmlFor="base-url" className="text-xs uppercase text-white/50 font-medium">
                Base URL
              </Label>
              <Input
                id="base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="Enter base URL"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-xs uppercase text-white/50 font-medium">
                API Key
              </Label>
              <Input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API key (hidden)"
                className="!rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>
          </div>

          {/* Read-only Metadata */}
          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/10">
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Server ID</p>
              <p className="text-sm text-white font-mono">{server.id}</p>
            </div>
            <div className="col-span-1"></div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Created</p>
              <p className="text-sm text-white/70">
                {formatDistanceToNow(new Date(server.created_at), { addSuffix: true })}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs uppercase text-white/50 font-medium">Updated</p>
              <p className="text-sm text-white/70">
                {formatDistanceToNow(new Date(server.updated_at), { addSuffix: true })}
              </p>
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
