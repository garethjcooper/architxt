'use client';

import { useState, useEffect } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { bankSettingsApi } from '@/lib/api/client';
import type { BankSettings } from '@/lib/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Pencil, Save, X, RotateCcw } from 'lucide-react';

const EXTRACTION_MODES: BankSettings['retain_extraction_mode'][] = ['concise', 'verbose', 'custom', 'verbatim', 'chunks'];

const EMPTY_SETTINGS: BankSettings = {
  retain_mission: '',
  observations_mission: '',
  reflect_mission: '',
  retain_extraction_mode: 'verbose',
  retain_chunk_size: 2000,
  entities_allow_free_form: false,
  disposition: { empathy: 1, literalism: 4, skepticism: 1 },
};

export default function BankSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [settings, setSettings] = useState<BankSettings>(EMPTY_SETTINGS);
  const [defaults, setDefaults] = useState<BankSettings>(EMPTY_SETTINGS);
  const [draft, setDraft] = useState<BankSettings>(EMPTY_SETTINGS);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const data = await bankSettingsApi.get();
      setSettings(data.settings);
      setDefaults(data.defaults);
      setDraft(data.settings);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load bank settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = await bankSettingsApi.update(draft);
      toast.success('Bank settings saved');
      setSettings(data.settings);
      setDraft(data.settings);
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save bank settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setDraft({ ...defaults });
    toast.info('Values reset to defaults — click Save to apply');
  };

  const handleCancel = () => {
    setDraft(settings);
    setIsEditing(false);
  };

  const setDisposition = (trait: keyof BankSettings['disposition'], value: number) => {
    setDraft((prev) => ({
      ...prev,
      disposition: { ...prev.disposition, [trait]: value },
    }));
  };

  const setMission = (field: keyof BankSettings, value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <PageShell
      title="Bank Settings"
      subtitle="Architxt master defaults for Hindsight memory banks. These values are used when pushing or pulling bank configuration."
      loading={loading || saving}
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-end gap-4 mb-4 shrink-0">
          {!isEditing ? (
            <Button onClick={() => setIsEditing(true)} className="h-8 bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default">
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button onClick={handleReset} variant="outline" size="sm" className="h-8">
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Reset to defaults
              </Button>
              <Button onClick={handleCancel} variant="outline" size="sm" className="h-8">
                <X className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} size="sm" className="h-8 bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-50">
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto min-h-0 -mr-2 pr-2">
          <div className="space-y-6">
            <SectionCard title="Missions">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <MissionField
                  label="Retain Mission"
                  value={isEditing ? draft.retain_mission : settings.retain_mission}
                  onChange={(v) => setMission('retain_mission', v)}
                  readOnly={!isEditing}
                />
                <MissionField
                  label="Observations Mission"
                  value={isEditing ? draft.observations_mission : settings.observations_mission}
                  onChange={(v) => setMission('observations_mission', v)}
                  readOnly={!isEditing}
                />
                <MissionField
                  label="Reflect Mission"
                  value={isEditing ? draft.reflect_mission : settings.reflect_mission}
                  onChange={(v) => setMission('reflect_mission', v)}
                  readOnly={!isEditing}
                />
              </div>
            </SectionCard>

            <SectionCard title="Extraction">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground-subtle uppercase tracking-wide">
                    Retain Extraction Mode
                  </Label>
                  {isEditing ? (
                    <select
                      value={draft.retain_extraction_mode}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          retain_extraction_mode: e.target.value as BankSettings['retain_extraction_mode'],
                        }))
                      }
                      className="h-8 w-full rounded-md border border-border-default bg-surface-card px-2.5 text-sm text-foreground-default focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none"
                    >
                      {EXTRACTION_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-sm text-foreground-muted">{settings.retain_extraction_mode}</span>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground-subtle uppercase tracking-wide">
                    Retain Chunk Size
                  </Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      min={1}
                      value={draft.retain_chunk_size}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, retain_chunk_size: parseInt(e.target.value, 10) || 0 }))
                      }
                      className="h-8 text-sm"
                    />
                  ) : (
                    <span className="text-sm text-foreground-muted">{settings.retain_chunk_size}</span>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="text-xs font-medium text-foreground-subtle uppercase tracking-wide">
                    Entities Allow Free Form
                  </Label>
                  {isEditing ? (
                    <div className="h-8 flex items-center">
                      <Switch
                        checked={draft.entities_allow_free_form}
                        onCheckedChange={(checked) =>
                          setDraft((prev) => ({ ...prev, entities_allow_free_form: checked }))
                        }
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-foreground-muted">{settings.entities_allow_free_form ? 'On' : 'Off'}</span>
                  )}
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Disposition">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {(['empathy', 'literalism', 'skepticism'] as const).map((trait) => (
                  <DispositionField
                    key={trait}
                    trait={trait}
                    value={isEditing ? draft.disposition[trait] : settings.disposition[trait]}
                    onChange={(v) => setDisposition(trait, v)}
                    readOnly={!isEditing}
                  />
                ))}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </PageShell>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-on-dark/[0.08] bg-surface-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-on-dark/[0.06] bg-on-dark/[0.02]">
        <h3 className="text-sm font-semibold text-foreground-default">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function MissionField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange?: (value: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex flex-col h-full space-y-2">
      <Label className="text-xs font-medium text-foreground-subtle uppercase tracking-wide">{label}</Label>
      <Textarea
        readOnly={readOnly}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className={cn(
          'flex-1 min-h-0 text-xs border-border-default resize-none focus-visible:ring-0 focus-visible:border-border-strong',
          readOnly
            ? 'bg-surface-inset text-foreground-muted'
            : 'bg-surface-card text-foreground-default'
        )}
      />
    </div>
  );
}

function DispositionField({
  trait,
  value,
  onChange,
  readOnly,
}: {
  trait: keyof BankSettings['disposition'];
  value: number;
  onChange?: (value: number) => void;
  readOnly: boolean;
}) {
  const label = trait.charAt(0).toUpperCase() + trait.slice(1);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-foreground-subtle uppercase tracking-wide">{label}</Label>
        <span className="text-xs text-foreground-subtle font-mono">{value}/5</span>
      </div>
      {readOnly ? (
        <div className="h-2 rounded-full bg-surface-inset overflow-hidden">
          <div
            className="h-full bg-accent-primary-bd rounded-full"
            style={{ width: `${(value / 5) * 100}%` }}
          />
        </div>
      ) : (
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={value}
          onChange={onChange ? (e) => onChange(parseInt(e.target.value, 10)) : undefined}
          className="w-full accent-accent-primary-bd"
        />
      )}
    </div>
  );
}
