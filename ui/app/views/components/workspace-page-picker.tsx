'use client';

import { Button } from '@/components/ui/button';
import type { ResearchStepSummary } from '@/lib/api/client';

interface WorkspacePagePickerProps {
  open: boolean;
  title: string;
  hasSession: boolean;
  curatedPages: ResearchStepSummary[];
  onClose: () => void;
  onCreatePage: () => void;
  onApplyToPage: (page: ResearchStepSummary) => void;
}

export function WorkspacePagePicker({
  open,
  title,
  hasSession,
  curatedPages,
  onClose,
  onCreatePage,
  onApplyToPage,
}: WorkspacePagePickerProps) {
  if (!open) return null;

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
        <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto mb-4">
          {hasSession && (
            <button
              type="button"
              onClick={onCreatePage}
              className="text-left text-xs px-2 py-1.5 rounded border border-dashed border-accent-primary-bd bg-accent-primary-bg/30 text-accent-primary-fg hover:bg-accent-primary-bg transition-colors"
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
              onClick={() => onApplyToPage(page)}
              className="text-left text-xs px-2 py-1.5 rounded border border-border-default bg-surface-inset text-foreground-faint hover:bg-surface-card hover:text-foreground-default transition-colors"
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
