'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';

interface BankSettingsValues {
  retain_mission: string;
  observations_mission: string;
  reflect_mission: string;
  retain_extraction_mode: string;
  retain_chunk_size: number;
  entities_allow_free_form: boolean;
  disposition: { empathy: number; literalism: number; skepticism: number };
}

interface BankSettingsDivergence {
  retain_mission_differs: boolean;
  observations_mission_differs: boolean;
  reflect_mission_differs: boolean;
  retain_extraction_mode_differs: boolean;
  retain_chunk_size_differs: boolean;
  entities_allow_free_form_differs: boolean;
  disposition_differs: boolean;
}

interface BankSettingsCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  arch?: BankSettingsValues;
  hind?: BankSettingsValues;
  divergence?: BankSettingsDivergence;
}

const MISSION_FIELDS: { key: keyof BankSettingsDivergence; label: string; archKey: keyof BankSettingsValues; hindKey: keyof BankSettingsValues }[] = [
  { key: 'retain_mission_differs', label: 'retain_mission', archKey: 'retain_mission', hindKey: 'retain_mission' },
  { key: 'observations_mission_differs', label: 'observations_mission', archKey: 'observations_mission', hindKey: 'observations_mission' },
  { key: 'reflect_mission_differs', label: 'reflect_mission', archKey: 'reflect_mission', hindKey: 'reflect_mission' },
];

const SCALAR_FIELDS: { key: keyof BankSettingsDivergence; label: string; archKey: keyof BankSettingsValues; hindKey: keyof BankSettingsValues; fmt: (v: any) => string }[] = [
  { key: 'retain_extraction_mode_differs', label: 'Extraction Mode', archKey: 'retain_extraction_mode', hindKey: 'retain_extraction_mode', fmt: (v) => String(v) },
  { key: 'retain_chunk_size_differs', label: 'Chunk Size', archKey: 'retain_chunk_size', hindKey: 'retain_chunk_size', fmt: (v) => String(v) },
  { key: 'entities_allow_free_form_differs', label: 'Entities Allow Free Form', archKey: 'entities_allow_free_form', hindKey: 'entities_allow_free_form', fmt: (v) => v ? 'On' : 'Off' },
];

export default function BankSettingsCompareModal({
  isOpen,
  onClose,
  arch,
  hind,
  divergence,
}: BankSettingsCompareModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !divergence) return null;

  const renderBadge = (differs: boolean) => (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
      differs
        ? 'bg-diff-differ-bg text-diff-differ-fg border-diff-differ-bd'
        : 'bg-diff-match-bg text-diff-match-fg border-diff-match-bd'
    }`}>
      {differs ? 'Differs' : 'Same'}
    </span>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop-strong backdrop-blur-sm">
      <div className="relative w-full max-w-3xl mx-4 bg-surface-panel border border-border-default rounded-lg shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-default shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-foreground-default">Bank Settings Comparison</h3>
            <p className="text-[11px] text-foreground-subtle mt-0.5">Architxt master vs selected Hindsight bank</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-foreground-subtle hover:text-foreground-muted hover:bg-surface-card transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto">
          <div className="grid grid-cols-3 gap-3 mb-4 text-xs font-medium text-foreground-subtle">
            <span className="col-span-1">Field</span>
            <span className="col-span-1">architxt</span>
            <span className="col-span-1">Hindsight</span>
          </div>

          {MISSION_FIELDS.map((field) => {
            const differs = divergence[field.key];
            return (
              <div key={field.label} className="grid grid-cols-3 gap-3 py-2 border-b border-border-subtle last:border-0">
                <div className="flex items-start gap-2 col-span-1">
                  <span className="text-xs text-foreground-default">{field.label}</span>
                  {renderBadge(differs)}
                </div>
                <div className="col-span-1 text-[11px] text-foreground-subtle bg-surface-card rounded px-2 py-1 whitespace-pre-wrap">
                  {(arch?.[field.archKey] as string) || '-'}
                </div>
                <div className="col-span-1 text-[11px] text-foreground-subtle bg-surface-card rounded px-2 py-1 whitespace-pre-wrap">
                  {(hind?.[field.hindKey] as string) || '-'}
                </div>
              </div>
            );
          })}

          {SCALAR_FIELDS.map((field) => {
            const differs = divergence[field.key];
            return (
              <div key={field.label} className="grid grid-cols-3 gap-3 py-2 border-b border-border-subtle last:border-0">
                <div className="flex items-center gap-2 col-span-1">
                  <span className="text-xs text-foreground-default">{field.label}</span>
                  {renderBadge(differs)}
                </div>
                <div className="col-span-1 text-[11px] text-foreground-subtle bg-surface-card rounded px-2 py-1">
                  {field.fmt(arch?.[field.archKey])}
                </div>
                <div className="col-span-1 text-[11px] text-foreground-subtle bg-surface-card rounded px-2 py-1">
                  {field.fmt(hind?.[field.hindKey])}
                </div>
              </div>
            );
          })}

          {<div className="grid grid-cols-3 gap-3 py-2 border-b border-border-subtle last:border-0">
            <div className="flex items-center gap-2 col-span-1">
              <span className="text-xs text-foreground-default">Disposition</span>
              {renderBadge(divergence.disposition_differs)}
            </div>
            <div className="col-span-1 text-[11px] text-foreground-subtle bg-surface-card rounded px-2 py-1">
              empathy {arch?.disposition.empathy}, literalism {arch?.disposition.literalism}, skepticism {arch?.disposition.skepticism}
            </div>
            <div className="col-span-1 text-[11px] text-foreground-subtle bg-surface-card rounded px-2 py-1">
              empathy {hind?.disposition.empathy}, literalism {hind?.disposition.literalism}, skepticism {hind?.disposition.skepticism}
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}
