"use client";

import { useState, useEffect } from "react";
import { PageShell } from "@/app/components/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { settingsApi, type SettingsSnapshot, type ConfigValue } from "@/lib/api/client";
import { createLogger } from "@/lib/logger";
import {
  RefreshCw,
  FileText,
  Image,
  Wrench,
  Hash,
  Search,
} from "lucide-react";
import { toast } from "sonner";

const logger = createLogger("SettingsPage");

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const data = await settingsApi.get();
      setSettings(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load settings";
      logger.error("Failed to fetch settings", { error: err });
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <PageShell
      title="Settings"
      subtitle="View prompts, docling config, entity tag format, entity match pattern, and server info."
      loading={loading}
    >
      {/* Top action bar */}
      <div className="flex items-center justify-end gap-2 mb-4">
        <Button
          onClick={fetchSettings}
          disabled={loading}
          title="Refresh"
          className="inline-flex items-center justify-center h-8 w-8 rounded text-sm font-medium bg-[oklch(0.23_0_0)] border border-white/10 text-white hover:bg-[oklch(0.27_0_0)] transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {settings && (
        <div className="space-y-6">
          {/* -- PROMPTS -- */}
          <SectionCard icon={<Image className="h-4 w-4" />} title="Pipeline Stages">
            <div className="space-y-6">
              <DiagramPromptBlock
                label="Diagram Description (Vision)"
                data={settings.prompts.diagram_description}
              />
              <div className="border-t border-white/10" />
              <PromptBlock
                label="Document Denoise (LLM)"
                data={settings.prompts.document_denoise_llm}
              />
              <div className="border-t border-white/10" />
              <DenoiseConfigBlock
                label="Document Denoise Rules"
                data={settings.prompts.document_denoise}
              />
            </div>
          </SectionCard>

          {/* -- DOCLING -- */}
          <SectionCard icon={<Wrench className="h-4 w-4" />} title="Docling">
            <ConfigRow
              name="service_url"
              envVar={settings.docling.service_url.envVar}
              value={settings.docling.service_url.value}
            />
          </SectionCard>

          {/* -- ENTITY TAG FORMAT -- */}
          <SectionCard icon={<Hash className="h-4 w-4" />} title="Entity Tag Format">
            <div className="space-y-1">
              <ConfigRow
                name="active_key"
                envVar={settings.entity_tag.active_key.envVar}
                value={settings.entity_tag.active_key.value}
              />
              <ConfigRow
                name="active_name"
                envVar={settings.entity_tag.active_name.envVar}
                value={settings.entity_tag.active_name.value}
              />
              <ConfigRow
                name="synced_fields"
                envVar={settings.entity_tag.synced_fields.envVar}
                value={settings.entity_tag.synced_fields.value}
              />
              <ConfigRow
                name="sync_name"
                envVar={settings.entity_tag.sync_name.envVar}
                value={settings.entity_tag.sync_name.value}
              />
            </div>
          </SectionCard>

          {/* -- ENTITY MATCH PATTERN -- */}
          <SectionCard icon={<Search className="h-4 w-4" />} title="Entity Match Pattern">
            <div className="space-y-1">
              <ConfigRow
                name="pattern"
                envVar={settings.entity_match.pattern.envVar}
                value={settings.entity_match.pattern.value}
                isCode
              />
              <ConfigRow
                name="description"
                envVar={settings.entity_match.description.envVar}
                value={settings.entity_match.description.value}
              />
            </div>
          </SectionCard>

          {/* -- SERVER -- */}
          <SectionCard icon={<FileText className="h-4 w-4" />} title="Server">
            <div className="space-y-1">
              <ConfigRow
                name="host"
                envVar={settings.server.host.envVar}
                value={settings.server.host.value}
              />
              <ConfigRow
                name="port"
                envVar={settings.server.port.envVar}
                value={settings.server.port.value}
              />
              <ConfigRow
                name="env"
                envVar={settings.server.env.envVar}
                value={settings.server.env.value}
              />
            </div>
          </SectionCard>

          {/* -- UI -- */}
          <SectionCard icon={<FileText className="h-4 w-4" />} title="UI">
            <div className="space-y-1">
              <ConfigRow
                name="port"
                envVar={settings.ui.port.envVar}
                value={settings.ui.port.value}
              />
              <ConfigRow
                name="api_base_url"
                envVar={settings.ui.api_base_url.envVar}
                value={settings.ui.api_base_url.value}
              />
            </div>
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}

/* -------------------- Sub-components -------------------- */

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-[oklch(0.23_0_0)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
        <span className="text-white/60">{icon}</span>
        <h3 className="text-sm font-semibold text-white/90">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ConfigRow({
  name,
  envVar,
  value,
  isCode = false,
}: {
  name: string;
  envVar: string;
  value: string | number | boolean | string[] | null;
  isCode?: boolean;
}) {
  const display = Array.isArray(value) ? value.join(", ") : String(value ?? "—");
  return (
    <div className="flex items-start gap-3 py-1">
      <div className="w-[160px] shrink-0">
        <span className="text-sm text-white/50">{name}</span>
      </div>
      <div className="flex-1 min-w-0">
        {isCode ? (
          <code className="block text-xs text-white/80 font-mono bg-black/30 border border-white/10 px-2 py-0.5 rounded break-all">
            {display}
          </code>
        ) : (
          <span className="text-sm text-white/80">{display}</span>
        )}
      </div>
      <div className="w-[240px] shrink-0 text-right">
        <span className="text-xs text-white/30 font-mono">{envVar}</span>
      </div>
    </div>
  );
}

function StatusBadge({ value }: { value: boolean | string | '—' }) {
  const isOn = value === true || value === 'true';
  const isOff = value === false || value === 'false' || value === '—';
  if (isOn) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-800/15 text-emerald-400 border border-emerald-700/20">
        Enabled
      </span>
    );
  }
  if (isOff) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-800/15 text-red-400 border border-red-700/20">
        Disabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800/15 text-slate-400 border border-slate-700/20">
      {String(value)}
    </span>
  );
}

function EnabledRow({
  envVar,
  value,
}: {
  envVar: string;
  value: boolean | string | '—';
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-[160px] shrink-0">
        <span className="text-sm text-white/50">enabled</span>
      </div>
      <div className="flex-1 min-w-0">
        <StatusBadge value={value} />
      </div>
      <div className="w-[240px] shrink-0 text-right">
        <span className="text-xs text-white/30 font-mono">{envVar}</span>
      </div>
    </div>
  );
}

function DiagramPromptBlock({
  label,
  data,
}: {
  label: string;
  data: {
    enabled: { value: boolean | '—'; envVar: string };
    provider: { value: string; envVar: string };
    model: { value: string; envVar: string };
    temperature: { value: number | "—"; envVar: string };
    task_prompt: { value: string; envVar: string };
    system_prompt: { value: string; envVar: string };
    timeout_ms: { value: number | "—"; envVar: string };
    batch_size: { value: number | "—"; envVar: string };
    max_batches: { value: number | "—"; envVar: string };
    concurrency: { value: number | "—"; envVar: string };
  } | null;
}) {
  if (!data) {
    return <div className="text-sm text-white/40 italic">{label} — not configured</div>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <EnabledRow envVar={data.enabled.envVar} value={data.enabled.value} />
        <ConfigRow name="provider" envVar={data.provider.envVar} value={data.provider.value} />
        <ConfigRow name="model" envVar={data.model.envVar} value={data.model.value} />
        <ConfigRow name="temperature" envVar={data.temperature.envVar} value={data.temperature.value} />
        <ConfigRow name="timeout_ms" envVar={data.timeout_ms.envVar} value={data.timeout_ms.value} />
        <ConfigRow name="batch_size" envVar={data.batch_size.envVar} value={data.batch_size.value} />
        <ConfigRow name="max_batches" envVar={data.max_batches.envVar} value={data.max_batches.value} />
        <ConfigRow name="concurrency" envVar={data.concurrency.envVar} value={data.concurrency.value} />
      </div>

      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">System Prompt</span>
          <span className="text-xs text-white/30 font-mono">{data.system_prompt.envVar}</span>
        </div>
        <Textarea
          readOnly
          value={data.system_prompt.value}
          className="min-h-[60px] text-xs text-white/80 bg-black/20 border-white/10 resize-none focus-visible:ring-0 focus-visible:border-white/20"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">Task Prompt</span>
          <span className="text-xs text-white/30 font-mono">{data.task_prompt.envVar}</span>
        </div>
        <Textarea
          readOnly
          value={data.task_prompt.value}
          className="min-h-[100px] text-xs text-white/80 bg-black/20 border-white/10 resize-none focus-visible:ring-0 focus-visible:border-white/20"
        />
      </div>
    </div>
  );
}

function PromptBlock({
  label,
  data,
}: {
  label: string;
  data: {
    enabled: { value: boolean | '—'; envVar: string };
    provider: { value: string; envVar: string };
    model: { value: string; envVar: string };
    temperature: { value: number | "—"; envVar: string };
    task_prompt: { value: string; envVar: string };
    system_prompt: { value: string; envVar: string };
    timeout_ms: { value: number | "—"; envVar: string };
  } | null;
}) {
  if (!data) {
    return <div className="text-sm text-white/40 italic">{label} — not configured</div>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <EnabledRow envVar={data.enabled.envVar} value={data.enabled.value} />
        <ConfigRow name="provider" envVar={data.provider.envVar} value={data.provider.value} />
        <ConfigRow name="model" envVar={data.model.envVar} value={data.model.value} />
        <ConfigRow name="temperature" envVar={data.temperature.envVar} value={data.temperature.value} />
        <ConfigRow name="timeout_ms" envVar={data.timeout_ms.envVar} value={data.timeout_ms.value} />
      </div>

      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">System Prompt</span>
          <span className="text-xs text-white/30 font-mono">{data.system_prompt.envVar}</span>
        </div>
        <Textarea
          readOnly
          value={data.system_prompt.value}
          className="min-h-[60px] text-xs text-white/80 bg-black/20 border-white/10 resize-none focus-visible:ring-0 focus-visible:border-white/20"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/50 uppercase tracking-wide">Task Prompt</span>
          <span className="text-xs text-white/30 font-mono">{data.task_prompt.envVar}</span>
        </div>
        <Textarea
          readOnly
          value={data.task_prompt.value}
          className="min-h-[100px] text-xs text-white/80 bg-black/20 border-white/10 resize-none focus-visible:ring-0 focus-visible:border-white/20"
        />
      </div>
    </div>
  );
}

function DenoiseConfigBlock({
  label,
  data,
}: {
  label: string;
  data: Record<string, ConfigValue>;
}) {
  const enabledEntry = data.enabled;
  const rest = Object.entries(data).filter(([k]) => k !== 'enabled');

  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold text-white/60 mb-2">{label}</h4>
      {enabledEntry && (
        <EnabledRow envVar={enabledEntry.envVar} value={enabledEntry.value as boolean | string} />
      )}
      {rest.map(([key, cfg]) => (
        <ConfigRow
          key={key}
          name={key}
          envVar={cfg.envVar}
          value={cfg.value}
        />
      ))}
    </div>
  );
}
