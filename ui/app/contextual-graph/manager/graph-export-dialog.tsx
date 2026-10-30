'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  contextualGraphApi,
  type CsvExportEnvelope,
  type GraphExportEnvelope,
} from '@/lib/api/client';
import { downloadBlob, sanitizeFilenameBase } from '@/lib/utils';
import { toast } from 'sonner';
import { Download, Loader2 } from 'lucide-react';

const FORMAT_OPTIONS = [
  { value: 'json', label: 'JSON' },
  { value: 'graphml', label: 'GraphML' },
  { value: 'gexf', label: 'GEXF' },
  { value: 'cypher', label: 'Cypher' },
  { value: 'c4', label: 'C4 (Structurizr DSL)' },
  { value: 'c4-mermaid', label: 'C4 (Mermaid)' },
  { value: 'archimate', label: 'ArchiMate XML' },
  { value: 'csv', label: 'CSV (nodes + edges)' },
] as const;

type ExportFormat = (typeof FORMAT_OPTIONS)[number]['value'];

interface GraphExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: number;
  bankId: string;
}

const MIME_TYPES: Record<ExportFormat, string> = {
  json: 'application/json',
  graphml: 'application/graphml+xml',
  gexf: 'application/gexf+xml',
  cypher: 'text/plain; charset=utf-8',
  c4: 'text/plain; charset=utf-8',
  'c4-mermaid': 'text/plain; charset=utf-8',
  archimate: 'application/xml; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  json: '.json',
  graphml: '.graphml',
  gexf: '.gexf',
  cypher: '.cypher',
  c4: '.dsl',
  'c4-mermaid': '.mmd',
  archimate: '.xml',
  csv: '.csv',
};

function defaultBaseName(bankId: string) {
  const date = new Date().toISOString().split('T')[0];
  return `${sanitizeFilenameBase(bankId || 'graph')}-${date}`;
}

export function GraphExportDialog({
  open,
  onOpenChange,
  serverId,
  bankId,
}: GraphExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('json');
  const [filename, setFilename] = useState('');
  const [undirected, setUndirected] = useState(false);
  const [includeEntityContent, setIncludeEntityContent] = useState(false);
  const [includeEdgeContent, setIncludeEdgeContent] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setFormat('json');
      setFilename('');
      setUndirected(false);
      setIncludeEntityContent(false);
      setIncludeEdgeContent(false);
    }
  }, [open]);

  const handleExport = async () => {
    if (!serverId || !bankId) {
      toast.error('Select a server and bank before exporting');
      return;
    }

    setLoading(true);
    try {
      const baseName = sanitizeFilenameBase(filename || defaultBaseName(bankId)).slice(0, 100);

      if (format === 'csv') {
        const result = (await contextualGraphApi.export(serverId, bankId, {
          format,
          undirected,
        })) as CsvExportEnvelope;
        downloadBlob(
          new Blob([result.nodes], { type: MIME_TYPES.csv }),
          `${baseName}-nodes${EXTENSIONS.csv}`
        );
        downloadBlob(
          new Blob([result.edges], { type: MIME_TYPES.csv }),
          `${baseName}-edges${EXTENSIONS.csv}`
        );
        toast.success('Downloaded nodes.csv and edges.csv');
      } else if (format === 'json') {
        const result = (await contextualGraphApi.export(serverId, bankId, {
          format,
          undirected,
          includeEntityContent,
          includeEdgeContent,
        })) as GraphExportEnvelope;
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: MIME_TYPES.json });
        downloadBlob(blob, `${baseName}${EXTENSIONS.json}`);
        toast.success('Downloaded JSON export');
      } else {
        const result = (await contextualGraphApi.export(serverId, bankId, {
          format,
          undirected,
        })) as string;
        const blob = new Blob([result], { type: MIME_TYPES[format] });
        downloadBlob(blob, `${baseName}${EXTENSIONS[format]}`);
        toast.success(`Downloaded ${format.toUpperCase()} export`);
      }

      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Export failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-accent-primary-fg" />
            Export graph
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="export-format">Format</Label>
            <select
              id="export-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              className="h-9 w-full rounded-md border border-border-default bg-surface-card px-3 text-sm text-foreground-default focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none"
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="export-filename">Filename base (optional)</Label>
            <Input
              id="export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={defaultBaseName(bankId)}
              disabled={loading}
              className="h-9"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground-muted cursor-pointer">
            <Checkbox
              checked={undirected}
              onCheckedChange={(checked) => setUndirected(!!checked)}
              disabled={loading}
            />
            <span>Undirected edges only</span>
          </label>

          {format === 'json' && (
            <div className="space-y-2 pt-1">
              <p className="text-sm font-medium text-foreground-default">Include mental model content</p>
              <label className="flex items-center gap-2 text-sm text-foreground-muted cursor-pointer">
                <Checkbox
                  checked={includeEntityContent}
                  onCheckedChange={(checked) => setIncludeEntityContent(!!checked)}
                  disabled={loading}
                />
                <span>Entity Content</span>
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground-muted cursor-pointer">
                <Checkbox
                  checked={includeEdgeContent}
                  onCheckedChange={(checked) => setIncludeEdgeContent(!!checked)}
                  disabled={loading}
                />
                <span>Edge Content</span>
              </label>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleExport}
            disabled={loading || !serverId || !bankId}
            className="bg-accent-primary-solid text-foreground-default hover:bg-accent-primary-solid-hover"
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GraphExportDialog;
