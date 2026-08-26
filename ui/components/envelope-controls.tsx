'use client';

import { useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

interface EnvelopeControlsProps {
  title?: string;
  count?: number;
  showIndex: boolean;
  onShowIndexChange: (checked: boolean) => void;
  plain: boolean;
  onPlainChange: (checked: boolean) => void;
  onCopyText: () => void;
  onSaveMd: () => void;
  /** Extra items rendered in the header row before the Controls toggle. */
  extraHeaderItems?: React.ReactNode;
}

export function EnvelopeControls({
  title = 'Preview',
  count,
  showIndex,
  onShowIndexChange,
  plain,
  onPlainChange,
  onCopyText,
  onSaveMd,
  extraHeaderItems,
}: EnvelopeControlsProps) {
  const [controlsOpen, setControlsOpen] = useState(false);

  return (
    <div className="relative h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
      <div className="min-w-0 flex-1 text-xs font-medium truncate pr-3">{title}</div>
      <div className="flex items-center gap-2 shrink-0">
        {count !== undefined && (
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-white/20 text-emerald-200/80">
            {count}
          </Badge>
        )}
        {extraHeaderItems}
        <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
          <Switch
            checked={controlsOpen}
            onCheckedChange={(checked) => setControlsOpen(Boolean(checked))}
            size="sm"
          />
          Controls
        </label>
      </div>
      {controlsOpen && (
        <div className="absolute top-full right-3 mt-1 z-30 flex flex-col gap-2 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/95 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[220px]">
          <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
            <Switch
              checked={showIndex}
              onCheckedChange={(checked) => onShowIndexChange(Boolean(checked))}
              size="sm"
            />
            Show index
          </label>
          <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
            <Switch
              checked={plain}
              onCheckedChange={(checked) => onPlainChange(Boolean(checked))}
              size="sm"
            />
            Plain text
          </label>
          <div className="h-px bg-white/10" />
          <button
            type="button"
            onClick={onCopyText}
            className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Copy className="h-3 w-3" />
            Copy text
          </button>
          <button
            type="button"
            onClick={onSaveMd}
            className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="h-3 w-3" />
            Save .md
          </button>
        </div>
      )}
    </div>
  );
}
