'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { ResearchStepSummary } from '@/lib/api/client';

export type SaveToFormat = 'flowchart' | 'graph' | 'table';

interface WorkspacePagePickerProps {
  open: boolean;
  title: string;
  hasSession: boolean;
  curatedPages: ResearchStepSummary[];
  /** Initially selected export formats. Defaults to ['flowchart']. */
  initialFormats?: SaveToFormat[];
  onClose: () => void;
  onCreatePage: (formats: SaveToFormat[]) => void;
  onApplyToPage: (page: ResearchStepSummary, formats: SaveToFormat[]) => void;
}

export function WorkspacePagePicker({
  open,
  title,
  hasSession,
  curatedPages,
  initialFormats = ['flowchart'],
  onClose,
  onCreatePage,
  onApplyToPage,
}: WorkspacePagePickerProps) {
  const [selectedFormats, setSelectedFormats] = useState<Set<SaveToFormat>>(new Set(initialFormats));

  if (!open) return null;

  const toggleFormat = (format: SaveToFormat) => {
    setSelectedFormats((prev) => {
      const next = new Set(prev);
      if (next.has(format)) {
        next.delete(format);
      } else {
        next.add(format);
      }
      return next;
    });
  };

  const hasFormat = selectedFormats.size > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop-strong"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      tabIndex={-1}
      ref={(el) => { if (el) el.focus(); }}
    >
      <div className="rounded-lg border border-border-default bg-surface-raised p-4 w-80 shadow-lg">
        <div className="text-sm font-medium text-foreground-default mb-2">Send to workspace page</div>
        <p className="text-xs text-foreground-faint mb-4">“{title || 'Untitled'}”</p>

        <div className="rounded border border-border-default bg-surface-inset p-2 mb-4">
          <div className="text-[11px] font-medium text-foreground-muted mb-2 uppercase tracking-wide">Include</div>
          <label className="flex items-center justify-between gap-2 mb-2 text-xs text-foreground-faint cursor-pointer select-none">
            <span>Flowchart</span>
            <Switch
              checked={selectedFormats.has('flowchart')}
              onCheckedChange={() => toggleFormat('flowchart')}
              size="sm"
            />
          </label>
          <label className="flex items-center justify-between gap-2 mb-2 text-xs text-foreground-faint cursor-pointer select-none">
            <span>Graph</span>
            <Switch
              checked={selectedFormats.has('graph')}
              onCheckedChange={() => toggleFormat('graph')}
              size="sm"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-foreground-faint cursor-pointer select-none">
            <span>Table</span>
            <Switch
              checked={selectedFormats.has('table')}
              onCheckedChange={() => toggleFormat('table')}
              size="sm"
            />
          </label>
          {!hasFormat && (
            <p className="text-[11px] text-destructive-fg mt-2">Select at least one format.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto mb-4">
          {hasSession && (
            <button
              type="button"
              onClick={() => {
                if (!hasFormat) return;
                onCreatePage(Array.from(selectedFormats));
              }}
              disabled={!hasFormat}
              className="text-left text-xs px-2 py-1.5 rounded border border-dashed border-accent-primary-bd bg-accent-primary-bg/30 text-accent-primary-fg hover:bg-accent-primary-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              + New page
            </button>
          )}
          {curatedPages.length === 0 && (
            <div className="text-xs text-foreground-subtle">No curated pages yet. Create one from the Pages menu.</div>
          )}
          {curatedPages.map((page) => (
            <button
              key={page.id}
              type="button"
              onClick={() => {
                if (!hasFormat) return;
                onApplyToPage(page, Array.from(selectedFormats));
              }}
              disabled={!hasFormat}
              className="text-left text-xs px-2 py-1.5 rounded border border-border-default bg-surface-inset text-foreground-faint hover:bg-surface-card hover:text-foreground-default disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {page.intent_text || `Page ${page.id}`}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
