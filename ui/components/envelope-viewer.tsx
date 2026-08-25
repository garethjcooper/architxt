'use client';

import { useMemo, useState } from 'react';
import { NarrativeViewer } from './narrative-viewer';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';

export interface EnvelopeCopyEvent {
  type: 'narrative' | 'graph' | 'tables' | 'diagrams';
  /** Markdown for narrative sections; JSON stringified payloads for structured types. */
  payload: string;
  /** Human-readable label for the copied chunk. */
  label?: string;
}

export interface EnvelopeViewerProps {
  /** Envelope to render. */
  envelope: ResearchStepSummary | DiscoverStepResponse | null;
  /** Human-readable title used for the section index and downloads. */
  title?: string;
  /** Optional count badge shown in the header. */
  count?: number;
  /** Called when a copy action is requested. When omitted, the viewer copies/downloads directly. */
  onCopy?: (event: EnvelopeCopyEvent) => void;
  /** Optional key namespace passed through to NarrativeViewer. */
  keyPrefix?: string;
  /** Optional extra className for the outer container. */
  className?: string;
  /** Whether the left-hand section index sidebar is shown. */
  showIndex?: boolean;
  /** Whether the floating data-controls panel is available. */
  showControls?: boolean;
  /** Initial rendering mode for the narrative. */
  defaultViewMode?: 'plain' | 'markdown';
  /** Name used for downloaded file names. */
  sessionName?: string;
}

function sanitizeFilenameBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_').slice(0, 50);
}

function downloadMarkdown(markdown: string, sessionName: string) {
  const date = new Date().toISOString().split('T')[0];
  const sanitized = sanitizeFilenameBase(sessionName);
  const filename = `${sanitized}-${date}.md`;
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Downloaded as ${filename}`);
}

export function EnvelopeViewer({
  envelope,
  title = 'Preview',
  count,
  onCopy,
  keyPrefix,
  className = '',
  showIndex = false,
  showControls = false,
  defaultViewMode = 'markdown',
  sessionName,
}: EnvelopeViewerProps) {
  const markdown = useMemo(() => buildEnvelopeMarkdown(envelope ?? null), [envelope]);
  const [showIndexState, setShowIndexState] = useState(showIndex);
  const [plain, setPlain] = useState(defaultViewMode === 'plain');
  const [controlsOpen, setControlsOpen] = useState(false);

  const viewMode = plain ? 'plain' : 'markdown';
  const effectiveSessionName = sessionName ?? title;

  const handleCopy = () => {
    if (!markdown) return;
    if (onCopy) {
      onCopy({ type: 'narrative', payload: markdown, label: effectiveSessionName });
      return;
    }
    navigator.clipboard.writeText(markdown).then(() => toast.success('Copied to clipboard'));
  };

  const handleSave = () => {
    if (!markdown) return;
    if (onCopy) {
      onCopy({ type: 'narrative', payload: markdown, label: effectiveSessionName });
      return;
    }
    downloadMarkdown(markdown, effectiveSessionName);
  };

  const handleCopySection = onCopy
    ? (sectionMarkdown: string, sectionTitle?: string) =>
        onCopy({ type: 'narrative', payload: sectionMarkdown, label: sectionTitle || effectiveSessionName })
    : undefined;

  return (
    <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${className}`}>
      {showControls && (
        <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
          <div className="text-xs font-medium truncate">{title}</div>
          <div className="flex items-center gap-2">
            {count !== undefined && (
              <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-white/20 text-emerald-200/80">
                {count}
              </Badge>
            )}
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch
                checked={controlsOpen}
                onCheckedChange={(checked) => setControlsOpen(Boolean(checked))}
                size="sm"
              />
              Controls
            </label>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden p-2 relative">
        {showControls && controlsOpen && (
          <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/75 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[220px]">
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch
                checked={showIndexState}
                onCheckedChange={(checked) => setShowIndexState(Boolean(checked))}
                size="sm"
              />
              Show index
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch
                checked={plain}
                onCheckedChange={(checked) => setPlain(Boolean(checked))}
                size="sm"
              />
              Plain text
            </label>
            <div className="h-px bg-white/10" />
            <button
              type="button"
              onClick={handleCopy}
              disabled={!markdown}
              className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Copy className="h-3 w-3" />
              Copy text
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!markdown}
              className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="h-3 w-3" />
              Save .md
            </button>
          </div>
        )}
        <NarrativeViewer
          content={markdown}
          title="Sections"
          viewMode={viewMode}
          showIndex={showIndexState}
          onCopySection={handleCopySection}
          keyPrefix={keyPrefix}
          className="h-full"
        />
      </div>
    </div>
  );
}
