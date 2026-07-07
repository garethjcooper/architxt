'use client';

import { useState, useRef, useEffect } from 'react';
import { Switch } from '@/components/ui/switch';
import { Copy, Download } from 'lucide-react';

interface CardControlsProps {
  scroll: boolean;
  onScrollChange: (value: boolean) => void;
  onCopy: () => void;
  onSaveMd: () => void;
}

export function CardControls({ scroll, onScrollChange, onCopy, onSaveMd }: CardControlsProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close the panel when clicking outside of it.
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        panelRef.current?.contains(e.target as Node) ||
        toggleRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative flex items-center">
      <div ref={toggleRef}>
        <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
          <Switch
            checked={open}
            onCheckedChange={(checked) => setOpen(Boolean(checked))}
            size="sm"
          />
          Controls
        </label>
      </div>
      {open && (
        <CardControlsPanel
          panelRef={panelRef}
          toggleRef={toggleRef}
          scroll={scroll}
          onScrollChange={onScrollChange}
          onCopy={() => {
            onCopy();
            setOpen(false);
          }}
          onSaveMd={() => {
            onSaveMd();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface CardControlsPanelProps {
  panelRef: React.RefObject<HTMLDivElement | null>;
  toggleRef: React.RefObject<HTMLDivElement | null>;
  scroll: boolean;
  onScrollChange: (value: boolean) => void;
  onCopy: () => void;
  onSaveMd: () => void;
}

function CardControlsPanel({
  panelRef,
  toggleRef,
  scroll,
  onScrollChange,
  onCopy,
  onSaveMd,
}: CardControlsPanelProps) {
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    const toggle = toggleRef.current;
    if (!toggle) return;
    const rect = toggle.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [toggleRef]);

  if (!position) return null;

  return (
    <div
      ref={panelRef}
      className="fixed z-[100] flex flex-col gap-2 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/95 backdrop-blur-sm px-3 py-2 shadow-lg w-fit"
      style={{ top: position.top, right: position.right }}
    >
      <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
        <Switch
          checked={scroll}
          onCheckedChange={(checked) => onScrollChange(Boolean(checked))}
          size="sm"
        />
        Scroll
      </label>
      <div className="h-px bg-white/10" />
      <button
        type="button"
        onClick={onCopy}
        className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
      >
        <Copy className="h-3 w-3" />
        Copy text
      </button>
      <button
        type="button"
        onClick={onSaveMd}
        className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
      >
        <Download className="h-3 w-3" />
        Save .md
      </button>
    </div>
  );
}
