'use client';

import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

interface EnvelopeControlsProps {
  title?: string;
  headerTitle?: string;
  count?: number;
  showIndex?: boolean;
  onShowIndexChange?: (checked: boolean) => void;
  plain: boolean;
  onPlainChange: (checked: boolean) => void;
  onCopyText: () => void;
  onSaveMd: () => void;
  /** Extra items rendered in the header row before the Controls toggle. */
  extraHeaderItems?: React.ReactNode;
  /** Render the Controls switch/dropdown. Defaults to true. */
  showControlsToggle?: boolean;
}

export function EnvelopeControls({
  title = 'Preview',
  headerTitle,
  count,
  showIndex,
  onShowIndexChange,
  plain,
  onPlainChange,
  onCopyText,
  onSaveMd,
  extraHeaderItems,
  showControlsToggle = true,
}: EnvelopeControlsProps) {
  const [controlsOpen, setControlsOpen] = useState(false);

  return (
    <div className="relative px-3 py-2 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
      <div className="text-sm font-medium truncate pr-3">{headerTitle ?? title}</div>
      <div className="flex items-center gap-2 shrink-0">
        {count !== undefined && (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-accent-primary-bd text-accent-primary-fg/80">
            {count}
          </Badge>
        )}
        {extraHeaderItems}
        {showControlsToggle && (
          <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint cursor-pointer select-none">
            <Switch
              checked={controlsOpen}
              onCheckedChange={(checked) => setControlsOpen(Boolean(checked))}
              size="sm"
            />
            Controls
          </label>
        )}
      </div>
      {showControlsToggle && controlsOpen && (
        <div className="absolute top-full right-3 mt-1 z-30 flex flex-col gap-2 rounded-md border border-border-default bg-surface-overlay/95 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[260px]">
          {showIndex != null && onShowIndexChange != null && (
            <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint cursor-pointer select-none">
              <Switch
                checked={showIndex}
                onCheckedChange={(checked) => onShowIndexChange(Boolean(checked))}
                size="sm"
              />
              Show index
            </label>
          )}
          <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint cursor-pointer select-none">
            <Switch
              checked={plain}
              onCheckedChange={(checked) => onPlainChange(Boolean(checked))}
              size="sm"
            />
            Plain text
          </label>
          <div className="h-px bg-surface-panel" />
          <button
            type="button"
            onClick={onCopyText}
            className="flex items-center gap-1.5 text-[10px] text-foreground-faint hover:text-accent-primary-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Copy className="h-3 w-3" />
            Copy text
          </button>
          <button
            type="button"
            onClick={onSaveMd}
            className="flex items-center gap-1.5 text-[10px] text-foreground-faint hover:text-accent-primary-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3 w-3" />
            Save .md
          </button>
        </div>
      )}
    </div>
  );
}
