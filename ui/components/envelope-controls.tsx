'use client';

import { useState } from 'react';
import { Copy, Download, Network, Plus, Shapes, Table2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';

interface EnvelopeControlsProps {
  title?: string;
  headerTitle?: string;
  count?: number;
  showIndex: boolean;
  onShowIndexChange: (checked: boolean) => void;
  plain: boolean;
  onPlainChange: (checked: boolean) => void;
  onCopyText: () => void;
  onSaveMd: () => void;
  /** Extra items rendered in the header row before the Controls toggle. */
  extraHeaderItems?: React.ReactNode;
  /** Structured data available for copy/add. */
  structuredItems?: {
    graph?: { payload: string; label?: string } | null;
    tables?: { payload: string; label?: string } | null;
    diagrams?: { payload: string; label?: string } | null;
  };
  /** Called for structured copy; when absent, structured buttons are hidden. */
  onCopyStructured?: (type: 'graph' | 'tables' | 'diagrams', payload: string, label?: string) => void;
  /** Called for structured add-to-page; when absent, add buttons are hidden. */
  onAddStructured?: (type: 'graph' | 'tables' | 'diagrams', payload: string, label?: string) => void;
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
  structuredItems,
  onCopyStructured,
  onAddStructured,
}: EnvelopeControlsProps) {
  const [controlsOpen, setControlsOpen] = useState(false);

  return (
    <div className="relative h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
      <div className="min-w-0 flex-1 text-xs font-medium truncate pr-3">{headerTitle ?? title}</div>
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
        <div className="absolute top-full right-3 mt-1 z-30 flex flex-col gap-2 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/95 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[260px]">
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
          {structuredItems?.graph && (
            <StructuredControlRow
              icon={<Network className="h-3 w-3" />}
              label={structuredItems.graph.label || 'Graph'}
              onCopy={() => onCopyStructured?.('graph', structuredItems.graph!.payload, structuredItems.graph!.label)}
              onAdd={onAddStructured ? () => onAddStructured('graph', structuredItems.graph!.payload, structuredItems.graph!.label) : undefined}
            />
          )}
          {structuredItems?.tables && (
            <StructuredControlRow
              icon={<Table2 className="h-3 w-3" />}
              label={structuredItems.tables.label || 'Tables'}
              onCopy={() => onCopyStructured?.('tables', structuredItems.tables!.payload, structuredItems.tables!.label)}
              onAdd={onAddStructured ? () => onAddStructured('tables', structuredItems.tables!.payload, structuredItems.tables!.label) : undefined}
            />
          )}
          {structuredItems?.diagrams && (
            <StructuredControlRow
              icon={<Shapes className="h-3 w-3" />}
              label={structuredItems.diagrams.label || 'Diagrams'}
              onCopy={() => onCopyStructured?.('diagrams', structuredItems.diagrams!.payload, structuredItems.diagrams!.label)}
              onAdd={onAddStructured ? () => onAddStructured('diagrams', structuredItems.diagrams!.payload, structuredItems.diagrams!.label) : undefined}
            />
          )}
          {(structuredItems?.graph || structuredItems?.tables || structuredItems?.diagrams) && (
            <div className="h-px bg-white/10" />
          )}
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

function StructuredControlRow({
  icon,
  label,
  onCopy,
  onAdd,
}: {
  icon: React.ReactNode;
  label: string;
  onCopy: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[10px] text-white/70">
      <div className="flex items-center gap-1.5 min-w-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onCopy}
          className="p-1 rounded hover:text-emerald-300 hover:bg-white/10 transition-colors"
          title="Copy"
          aria-label={`Copy ${label}`}
        >
          <Copy className="h-3 w-3" />
        </button>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="p-1 rounded hover:text-emerald-300 hover:bg-white/10 transition-colors"
            title="Add to page"
            aria-label={`Add ${label} to page`}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
