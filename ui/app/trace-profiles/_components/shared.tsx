"use client";

import * as React from "react";
import { useState, useEffect, useRef, memo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ResizeHandle } from "@/app/workspace/_components/panel-layout";
import {
  Check,
  Copy,
  AlertTriangle,
  Loader2,
  WrapText,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Workflow,
  HelpCircle,
  Plus,
  Search,
  X,
} from "lucide-react";
import {
  TraceProfileValidationResult,
  TraceProfileFieldExtractionResult,
  TraceProfileFieldStat,
  TraceProfileSequencePreviewResult,
  TraceProfileSequenceConfig,
  TraceProfileDiscoveryHistogramResult,
} from "@/lib/types";

/**
 * PageUp/PageDown scroll a pane by ~one viewport. Attach via onKeyDown on the
 * scrollable container (tabIndex={0} makes it focusable so it receives keys).
 * Ignored when the event originates in an input/textarea/select/contentEditable.
 */
export function panePageKeyHandler(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== "PageUp" && e.key !== "PageDown") return;
  const target = e.target as HTMLElement | null;
  if (target && (target.closest("input, textarea, select, [contenteditable='true']"))) return;
  const el = e.currentTarget;
  const delta = el.clientHeight * (e.key === "PageDown" ? 0.9 : -0.9);
  el.scrollBy({ top: delta, behavior: "smooth" });
  e.preventDefault();
}

export function FieldExtractionPanel({
  result,
  loading,
  onExtract,
  detectedFields,
  fieldStats,
  deterministic,
  configFields,
  detectedFieldRows,
  detectedFieldNames,
  onSetRegex,
  onSetSource,
  histogram,
  histogramLoading,
  onPreviewHistogram,
  nameMap,
  onAddNameMapGroup,
  onRemoveNameMapValue,
  histogramKnobs,
  fieldSplits,
  onResizeFieldRowsStart,
  onResizeFieldRowsReset,
}: {
  result: TraceProfileFieldExtractionResult | null;
  loading: boolean;
  onExtract: () => void;
  detectedFields?: string[] | null;
  fieldStats?: TraceProfileFieldStat[] | null;
  deterministic?: boolean;
  /** fieldExtraction.fields read from the current config JSON — the source of truth. */
  configFields: Array<{ name: string; ordinal: number; source: string | null; regex: string | null }>;
  /** Detected (real) fields from the config, sorted by ordinal. */
  detectedFieldRows: Array<{ name: string; ordinal: number; source: string | null; regex: string | null }>;
  /** Names of fields discovered by the last Extract/detection run (detected set). */
  detectedFieldNames?: string[] | null;
  onSetRegex?: (field: string, regex: string) => void;
  onSetSource?: (field: string, source: string | null) => void;
  histogram?: TraceProfileDiscoveryHistogramResult | null;
  histogramLoading?: boolean;
  onPreviewHistogram?: (knobs: HistogramKnobs) => void;
  nameMap?: Array<{ name: string; values: string[]; variance?: 'enum' | 'high' }>;
  onAddNameMapGroup?: (name: string, value: string) => void;
  onRemoveNameMapValue?: (name: string, value: string) => void;
  histogramKnobs?: Partial<Record<keyof typeof DEFAULT_HISTOGRAM_KNOBS, number>> | null;
  /** Vertical split between histogram and extracted-fields panes (histogram gets the larger share by default). */
  fieldSplits?: { histogram: number; fields: number };
  onResizeFieldRowsStart?: (e: React.MouseEvent) => void;
  onResizeFieldRowsReset?: () => void;
}) {
  // The pane under the histogram shows what the last Extract run discovered:
  // the nameMap is that ground truth. No nameMap -> nothing to show (no
  // fallback to detected columns). Manually added fields stay on the
  // Format & Fields tab.
  const fields = configFields;
  const configByName = new Map(fields.map((f) => [f.name, f]));
  const allRows = (nameMap ?? [])
    .map((g, i) => {
      const cfg = configByName.get(g.name);
      return { name: g.name, ordinal: cfg?.ordinal ?? i, source: cfg?.source ?? null, regex: cfg?.regex ?? null, detected: true };
    })
    .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const regexFor = (name: string) => fields.find((f) => f.name === name)?.regex ?? null;
  const sourceFor = (name: string) => fields.find((f) => f.name === name)?.source ?? null;
  const statsByField = new Map((fieldStats ?? []).map((s) => [s.field, s]));

  return (
    <div className="flex flex-col gap-2 min-h-0 h-full">
      {/* Discovery pre-stage histogram — auto-calculated on format/row
          detection; re-run with custom knobs here */}
      {onPreviewHistogram && (
        <div
          className="min-h-0 overflow-hidden flex flex-col"
          style={{ flex: fieldSplits?.histogram ?? 0.62 }}
        >
          <HistogramPreview
            histogram={histogram ?? null}
            loading={Boolean(histogramLoading)}
            onPreview={onPreviewHistogram}
            onExtract={onExtract}
            extractLoading={loading}
            nameMap={nameMap ?? []}
            onAddNameMapGroup={onAddNameMapGroup}
            onRemoveNameMapValue={onRemoveNameMapValue}
            savedKnobs={histogramKnobs}
          />
        </div>
      )}
      {onPreviewHistogram && onResizeFieldRowsStart && (
        <ResizeHandle
          direction="horizontal"
          onMouseDown={onResizeFieldRowsStart}
          onDoubleClick={onResizeFieldRowsReset}
          title="Drag to resize discovery histogram / extracted fields; double-click to reset this handle"
        />
      )}
      {/* Extracted fields — populated from the nameMap (what the last Extract
          run discovered); empty when no nameMap exists */}
      <div
        className="min-h-0 flex flex-col rounded-lg border border-border-default bg-surface-card p-0 overflow-hidden"
        style={{ flex: fieldSplits?.fields ?? 0.38 }}
      >
        <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
          <span className="font-medium text-sm">Extracted fields</span>
          <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
            {allRows.length}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface-card z-10">
              <tr className="text-left text-foreground-faint border-b border-border-default">
                <th className="px-2 py-1 font-medium">#</th>
                <th className="px-2 py-1 font-medium">Field</th>
                <th className="px-2 py-1 font-medium text-right">Present</th>
                <th className="px-2 py-1 font-medium text-right">Sparse %</th>
                <th className="px-2 py-1 font-medium text-right">Unique</th>
                <th className="px-2 py-1 font-medium text-right">Uniq %</th>
                <th className="px-2 py-1 font-medium">Regex</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((f) => {
                const stat = statsByField.get(f.name);
                return (
                  <FieldRow
                    key={f.name}
                    name={f.name}
                    ordinal={f.ordinal}
                    existingRegex={regexFor(f.name)}
                    stat={stat}
                    detected={f.detected}
                    onSetRegex={onSetRegex}
                  />
                );
              })}
              {allRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-center text-foreground-faint text-xs">
                    No fields yet — run the sample or Extract fields to discover columns.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RegexCell({
  field,
  existingRegex,
  existingSource,
  onSetRegex,
}: {
  field: string;
  existingRegex: string | null;
  existingSource: string | null;
  onSetRegex: (field: string, regex: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(existingRegex ?? "");

  useEffect(() => {
    setDraft(existingRegex ?? "");
  }, [existingRegex]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== (existingRegex ?? "")) onSetRegex(field, next);
    else setDraft(existingRegex ?? "");
  };

  if (editing) {
    return (
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(existingRegex ?? ""); setEditing(false); }
        }}
        autoFocus
        placeholder="(?&lt;value&gt;...) — paste the raw regex, not the JSON-escaped form"
        title={existingSource ? `Applied within field "${existingSource}". Enter the raw regex (single backslashes, e.g. \\d not \\\\d).` : "Enter the raw regex (single backslashes, e.g. \\d not \\\\d) — applied to the whole record"}
        className="h-6 px-1 text-[11px] font-mono bg-surface-inset w-40"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-[10px] px-1.5 py-0.5 rounded border border-border-default bg-surface-subtle text-foreground-muted hover:bg-surface-hover transition-colors"
      title={existingRegex ? `Regex: ${existingRegex}` : "Set a custom regex for this field (applied within its source)"}
    >
      {existingRegex ? "edit regex" : "+ regex"}
    </button>
  );
}

function FieldRow({
  name,
  ordinal,
  existingRegex,
  stat,
  detected,
  onSetRegex,
}: {
  name: string;
  ordinal: number;
  existingRegex?: string | null;
  stat?: TraceProfileFieldStat;
  /** true = discovered by the last Extract/detection run; false/absent = manually added */
  detected?: boolean;
  onSetRegex?: (field: string, regex: string) => void;
}) {
  return (
    <tr className="border-b border-border-subtle/50 last:border-0 hover:bg-surface-hover/50">
      <td className="px-2 py-1 font-mono text-foreground-faint">{ordinal}</td>
      <td className="px-2 py-1 font-mono text-foreground-default">
        <span className="truncate" title={name}>{name}</span>
        <span
          className={cn(
            "ml-1 text-[9px] px-1 py-px rounded border",
            detected
              ? "border-badge-success-bd text-badge-success-fg"
              : "border-border-default text-foreground-faint"
          )}
          title={detected ? "Discovered by the last Extract/detection run" : "Manually added"}
        >
          {detected ? "detected" : "added"}
        </span>
      </td>
      <td className="px-2 py-1 text-right text-foreground-muted">{stat?.present ?? "—"}</td>
      <td className={cn("px-2 py-1 text-right", (stat?.sparseness ?? 0) > 50 ? "text-badge-caution-fg" : "text-foreground-muted")}>
        {stat ? `${stat.sparseness}%` : "—"}
      </td>
      <td className="px-2 py-1 text-right text-foreground-muted">{stat?.uniqueValues ?? "—"}</td>
      <td className={cn("px-2 py-1 text-right", (stat?.uniquePercent ?? 0) >= 90 ? "text-accent-primary-fg" : "text-foreground-muted")}>
        {stat ? `${stat.uniquePercent}%` : "—"}
      </td>
      {onSetRegex && (
        <td className="px-2 py-1">
          <RegexCell
            field={name}
            existingRegex={existingRegex ?? null}
            existingSource={null}
            onSetRegex={onSetRegex}
          />
        </td>
      )}
    </tr>
  );
}

export function CopyButton({
  text,
  pane,
  copiedPane,
  onCopy,
}: {
  text: string;
  pane: string;
  copiedPane: string | null;
  onCopy: (text: string, pane: string) => void;
}) {
  const copied = copiedPane === pane;
  return (
    <button
      type="button"
      onClick={() => onCopy(text, pane)}
      className={cn(
        "h-6 w-6 inline-flex items-center justify-center rounded text-foreground-subtle hover:text-foreground-default hover:bg-surface-panel transition-colors",
        copied && "text-foreground-default bg-surface-panel"
      )}
      title={copied ? "Copied!" : "Copy contents"}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Standard header "Controls" popout (same pattern as EnvelopeControls on the
 * workspace page): a Controls switch in the header that opens a dropdown with
 * a Line wrap switch, an optional Plain text switch, and a Copy text action.
 */
export function PanelControls({
  copyText,
  pane,
  copiedPane,
  onCopy,
  wrap,
  onWrapChange,
  plain,
  onPlainChange,
  plainLabel = "Plain text",
}: {
  copyText: string;
  pane: string;
  copiedPane: string | null;
  onCopy: (text: string, pane: string) => void;
  wrap: boolean;
  onWrapChange: (checked: boolean) => void;
  plain?: boolean;
  onPlainChange?: (checked: boolean) => void;
  plainLabel?: string;
}) {
  const [controlsOpen, setControlsOpen] = useState(false);
  return (
    <div className="relative flex items-center">
      <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint cursor-pointer select-none">
        <Switch
          checked={controlsOpen}
          onCheckedChange={(checked) => setControlsOpen(Boolean(checked))}
          size="sm"
        />
        Controls
      </label>
      {controlsOpen && (
        <div className="absolute top-full right-0 mt-1 z-30 flex flex-col gap-2 rounded-md border border-border-default bg-surface-overlay/95 backdrop-blur-sm px-3 py-2 shadow-lg w-max max-w-[260px]">
          <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint cursor-pointer select-none">
            <Switch
              checked={wrap}
              onCheckedChange={(checked) => onWrapChange(Boolean(checked))}
              size="sm"
            />
            Line wrap
          </label>
          {plain != null && onPlainChange && (
            <label className="flex items-center gap-1.5 text-[10px] text-foreground-faint cursor-pointer select-none">
              <Switch
                checked={plain}
                onCheckedChange={(checked) => onPlainChange(Boolean(checked))}
                size="sm"
              />
              {plainLabel}
            </label>
          )}
          <div className="h-px bg-surface-panel" />
          <button
            type="button"
            onClick={() => onCopy(copyText, pane)}
            className="flex items-center gap-1.5 text-[10px] text-foreground-faint hover:text-accent-primary-fg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Copy className="h-3 w-3" />
            Copy text
          </button>
        </div>
      )}
    </div>
  );
}

export const OutputSamplePanel = memo(function OutputSamplePanel({
  result,
  wrapOutput,
  setWrapOutput,
  onCopy,
  copiedPane,
  loading,
}: {
  result: TraceProfileValidationResult | null;
  wrapOutput: boolean;
  setWrapOutput: (v: boolean) => void;
  onCopy: (text: string, pane: string) => void;
  copiedPane: string | null;
  loading: boolean;
}) {
  const [viewMode, setViewMode] = useState<"fields" | "json">("fields");
  const output = result?.records ?? null;
  const outputText = output
    ? typeof output === "string"
      ? output
      : JSON.stringify(output, null, 2)
    : "";
  // Records enriched with extracted fields (json/xml engines, or profiles with
  // fieldExtraction rules) get a readable per-record rendering: raw line plus
  // the extracted key/value fields.
  const renderRecord = (rec: any, idx: number) => {
    if (!rec || typeof rec !== "object" || typeof rec.raw !== "string") {
      return JSON.stringify(rec, null, 2);
    }
    const fields = rec.fields && typeof rec.fields === "object" ? Object.entries(rec.fields) : [];
    if (fields.length === 0) return rec.raw;
    return (
      <div key={idx} className="border-b border-border-default/50 pb-1 mb-1 last:border-0">
        <div className="text-foreground-faint break-all">{rec.raw}</div>
        <div className="pl-3">
          {fields.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-accent-primary-fg shrink-0">{k}</span>
              <span className="break-all">{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-2 min-h-0 h-full">
      <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0 rounded-t-lg">
        <span className="font-medium text-sm">Output Sample</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
            {Array.isArray(output)
              ? `${output.length}${result && typeof (result as { totalRecords?: number }).totalRecords === "number" && (result as { totalRecords: number }).totalRecords > output.length ? `/${(result as { totalRecords: number }).totalRecords}` : ""} records`
              : 0} 
          </span>
          <PanelControls
            copyText={outputText}
            pane="output"
            copiedPane={copiedPane}
            onCopy={onCopy}
            wrap={wrapOutput}
            onWrapChange={setWrapOutput}
            plain={viewMode === "json"}
            onPlainChange={(checked) => setViewMode(checked ? "json" : "fields")}
          />
        </div>
      </div>
      <div className="flex-1 min-h-0 relative rounded-b-lg border border-t-0 border-on-dark/[0.08] bg-surface-card p-3 overflow-auto" tabIndex={0} onKeyDown={panePageKeyHandler}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-card/80">
            <Loader2 className="h-5 w-5 animate-spin text-foreground-faint" />
          </div>
        )}
        {result == null ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-foreground-faint">
            <span className="text-sm text-center px-4">
              {loading
                ? "Running extraction..."
                : "Enter a sample and valid editor config to see extracted output."}
            </span>
          </div>
        ) : (
          <div className="space-y-3">
            {result.error && (
              <div className="rounded-md bg-destructive-bg p-2 text-xs text-destructive-fg">{result.error}</div>
            )}

            {result.warnings && result.warnings.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-badge-caution-bg border border-badge-caution-bd p-2">
                <AlertTriangle className="h-4 w-4 text-badge-caution-fg mt-0.5 shrink-0" />
                <ul className="space-y-1 text-xs text-badge-caution-fg">
                  {result.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(output) && viewMode === "fields" ? (
              <div className="text-xs font-mono space-y-1">
                {output.map((rec, i) => renderRecord(rec, i))}
              </div>
            ) : (
              <pre
                className="text-xs font-mono"
                style={{ whiteSpace: wrapOutput ? "pre-wrap" : "pre", overflowWrap: wrapOutput ? "break-word" : "normal" }}
              >
                {output ? outputText : "No output available."}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Fields tab: one unified table of every known field — detected columns
 * (from the sample run / extract) plus user-added rows appended at the
 * bottom like a new row in the same list. Each row carries the sequence
 * profile's Order / Correlate / Token checkboxes. Collapsible sequence
 * settings and the mined-sequences preview sit below. All changes write
 * straight into the config JSON via the callbacks.
 */
export const FieldsPanel = memo(function FieldsPanel({
  result,
  loading,
  onPreview,
  onCopy,
  copiedPane,
  wrapMarkdown,
  setWrapMarkdown,
  detectedFields,
  configFields,
  fieldStats,
  sequenceProfile,
  onSequenceProfileChange,
  onAddField,
  onRemoveField,
  onSetRegex,
  variant = "full",
  seqSplits,
  onResizeSeqRowsStart,
  onResizeSeqRowsReset,
}: {
  result: TraceProfileSequencePreviewResult | null;
  loading: boolean;
  onPreview: () => void;
  onCopy: (text: string, pane: string) => void;
  copiedPane: string | null;
  wrapMarkdown: boolean;
  setWrapMarkdown: (v: boolean) => void;
  /** Detected field names (columns/paths discovered from the sample). */
  detectedFields: string[] | null;
  /** fieldExtraction.fields read from the current config JSON. */
  configFields: Array<{ name: string; ordinal: number; source: string | null; regex: string | null }>;
  fieldStats?: TraceProfileFieldStat[] | null;
  sequenceProfile: TraceProfileSequenceConfig | null;
  onSequenceProfileChange: (profile: TraceProfileSequenceConfig) => void;
  onAddField?: (field: string) => void;
  onRemoveField?: (field: string) => void;
  onSetRegex?: (field: string, regex: string) => void;
  /** "list" = field table only (Format & Fields tab); "full" = also sequence settings + preview. */
  variant?: "list" | "full";
  /** Vertical split between the Fields list and Sequence Preview panes (full variant, 50/50 default). */
  seqSplits?: { fields: number; sequences: number };
  onResizeSeqRowsStart?: (e: React.MouseEvent) => void;
  onResizeSeqRowsReset?: () => void;
}) {
  const markdown = result?.markdown ?? "";
  const [error, setError] = React.useState<string | null>(null);
  const [newFieldName, setNewFieldName] = useState("");

  const profile = sequenceProfile ?? {
    orderColumns: [],
    correlationColumns: [],
    tokenColumns: [],
    separator: "$",
    includeTokenComponents: true,
    excludeMissingTokens: true,
    includeTransitions: false,
    outputFormat: "steps",
    maxExampleKeys: 5,
    minSteps: 2,
    missingValue: "-",
    sortOrder: "frequency-desc",
  };

  const hasProfile =
    profile.orderColumns.length > 0 &&
    profile.correlationColumns.length > 0 &&
    profile.tokenColumns.length > 0 &&
    !!profile.entityColumn &&
    !!profile.directionColumn;

  // Unified row list: detected fields first (sample stats attached), then
  // config fields not in the detected set (added rows), each with an ordinal.
  const statsByField = new Map((fieldStats ?? []).map((s) => [s.field, s]));
  const detectedSet = new Set(detectedFields ?? []);
  const configByName = new Map(configFields.map((f) => [f.name, f]));
  // The config JSON masters the data: detected rows are only shown when the
  // field still exists in configFields — deleting a field from the JSON removes
  // its row even though it remains in the detected list.
  const detectedRows = (detectedFields ?? [])
    .filter((name) => configByName.has(name))
    .map((name, i) => ({
      name,
      ordinal: configByName.get(name)?.ordinal ?? i,
      added: false,
      regex: configByName.get(name)?.regex ?? null,
    }));
  const addedRows = configFields
    .filter((f) => !detectedSet.has(f.name))
    .map((f) => ({ name: f.name, ordinal: f.ordinal, added: true, regex: f.regex ?? null }))
    .sort((a, b) => a.ordinal - b.ordinal);
  const rows = [...detectedRows, ...addedRows];
  const existingNames = new Set(rows.map((r) => r.name));

  function toggle(list: string[], field: string) {
    return list.includes(field) ? list.filter((f) => f !== field) : [...list, field];
  }

  // Every change writes straight through to the config via onChange.
  function update(updates: Partial<TraceProfileSequenceConfig>) {
    const next = { ...profile, ...updates };
    onSequenceProfileChange(next);
    const badToken = next.tokenColumns.find((col) => col.includes(next.separator ?? "$"));
    setError(badToken ? `Token column "${badToken}" contains the separator "${next.separator}".` : null);
  }

  /** Move a column one step up/down within its list to set priority order. */
  function moveColumn(listKey: "orderColumns" | "correlationColumns", field: string, dir: -1 | 1) {
    const list = [...profile[listKey]];
    const i = list.indexOf(field);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    update({ [listKey]: list });
  }

  function handleAddField() {
    const name = newFieldName.trim();
    if (!name) return;
    if (existingNames.has(name)) {
      setError(`Field "${name}" already exists.`);
      return;
    }
    setError(null);
    setNewFieldName("");
    onAddField?.(name);
  }

  return (
    <div className="flex flex-col gap-2 min-h-0 h-full">
      {/* Main field list: detected + added rows in one table */}
      <div
        className={cn(
          "min-h-0 flex flex-col rounded-lg border border-border-default bg-surface-card overflow-hidden",
          variant !== "full" && "flex-1"
        )}
        style={variant === "full" ? { flex: seqSplits?.fields ?? 0.5 } : undefined}
      >
        <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
          <span className="font-medium text-sm">Fields</span>
          <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
            {rows.length}
          </span>
        </div>
        {rows.length === 0 && (
          <div className="px-3 py-2 text-xs text-badge-caution-fg border-b border-border-default bg-badge-caution-bg/40 shrink-0">
            Field list is empty — use Field Extraction (Plaintext engine) to build it.
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-auto custom-scrollbar" tabIndex={0} onKeyDown={panePageKeyHandler}>
          {rows.length === 0 && !onAddField ? (
            <div className="p-3 text-xs text-foreground-faint">
              Run the sample above (or Extract fields) to discover columns.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-card z-10">
                <tr className="text-left text-foreground-faint border-b border-border-default text-[10px] uppercase tracking-wider font-medium">
                  <th className="px-2 py-1 font-medium">#</th>
                  <th className="px-2 py-1 font-medium">Field</th>
                  <th className="px-2 py-1 font-medium text-right">Present</th>
                  <th className="px-2 py-1 font-medium text-right">Sparse %</th>
                  <th className="px-2 py-1 font-medium text-right">Unique</th>
                  <th className="px-2 py-1 font-medium text-right">Uniq %</th>
                  {variant !== "full" && (
                    <th className="px-2 py-1 font-medium">Regex</th>
                  )}
                  {variant !== "full" && (
                    <th className="px-2 py-1 font-medium w-8"></th>
                  )}
                  {variant === "full" && (
                    <>
                      <th className="px-1 py-1 font-medium text-center w-16">
                        <div className="flex items-center justify-center gap-0.5">
                          Order
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-foreground-faint cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top">Sort rows within each correlation group by these columns, in the order listed (use ↑/↓ on checked rows to set priority).</TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      <th className="px-1 py-1 font-medium text-center w-20">
                        <div className="flex items-center justify-center gap-0.5">
                          Correlate
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-foreground-faint cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top">Group rows that share these values into one sequence. Column order only changes how the group key is written, not the grouping.</TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      <th className="px-2 py-1 font-medium text-center w-14">
                        <div className="flex items-center justify-center gap-0.5">
                          Token
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-foreground-faint cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top">Join these column values to form each sequence token.</TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      <th className="px-1 py-1 font-medium text-center w-16">
                        <div className="flex items-center justify-center gap-0.5">
                          Entity
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-foreground-faint cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top">Required — tag one field as the entity (who/what acts). Always the first column of the sequence output table.</TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                      <th className="px-1 py-1 font-medium text-center w-16">
                        <div className="flex items-center justify-center gap-0.5">
                          Direction
                          <Tooltip>
                            <TooltipTrigger>
                              <HelpCircle className="h-3 w-3 text-foreground-faint cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent side="top">Required — tag one field as the direction (e.g. request/response). Always the second column of the sequence output table.</TooltipContent>
                          </Tooltip>
                        </div>
                      </th>
                    </>
                  )}
                  <th className="px-2 py-1 font-medium w-8"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const stat = statsByField.get(row.name);
                  return (
                    <tr key={row.name} className={cn("border-b border-border-subtle last:border-0 hover:bg-surface-hover/50", row.added && "bg-surface-subtle/40")}>
                      <td className="px-2 py-2 font-mono text-xs text-foreground-faint">{row.ordinal}</td>
                      <td className="py-2 px-3">
                        <div className="flex items-center">
                          <span className="text-xs text-foreground-default truncate" title={row.name}>
                            {row.name}
                            <span
                              className={cn(
                                "ml-1 text-[9px] px-1 py-px rounded border",
                                row.added
                                  ? "border-border-default text-foreground-faint"
                                  : "border-badge-success-bd text-badge-success-fg"
                              )}
                              title={row.added ? "Manually added" : "Discovered by the last Extract/detection run"}
                            >
                              {row.added ? "added" : "detected"}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap text-foreground-faint">
                        {stat ? `${stat.present}` : "—"}
                      </td>
                      <td className={cn("px-2 py-1 text-right", (stat?.sparseness ?? 0) > 50 ? "text-badge-caution-fg" : "text-foreground-faint")}>
                        {stat ? `${stat.sparseness}%` : "—"}
                      </td>
                      <td className="px-2 py-1 text-right text-foreground-faint">{stat?.uniqueValues ?? "—"}</td>
                      <td className={cn("px-2 py-1 text-right", (stat?.uniquePercent ?? 0) >= 90 ? "text-accent-primary-fg" : "text-foreground-faint")}>
                        {stat ? `${stat.uniquePercent}%` : "—"}
                      </td>
                      {variant !== "full" && (
                        <td className="px-2 py-1">
                          {onSetRegex && (
                            <RegexCell field={row.name} existingRegex={row.regex} existingSource={null} onSetRegex={onSetRegex} />
                          )}
                        </td>
                      )}
                      {variant === "full" && (
                        <>
                          <td className="px-1 py-1 text-center">
                            <div className="flex items-center justify-center gap-0.5">
                              <span className="relative inline-flex">
                                <Checkbox
                                  checked={profile.orderColumns.includes(row.name)}
                                  onCheckedChange={() => update({ orderColumns: toggle(profile.orderColumns, row.name) })}
                                  className={cn(profile.orderColumns.includes(row.name) && "text-transparent [&_svg]:hidden")}
                                />
                                {profile.orderColumns.includes(row.name) && (
                                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-bold text-foreground-default">
                                    {profile.orderColumns.indexOf(row.name) + 1}
                                  </span>
                                )}
                              </span>
                              {profile.orderColumns.includes(row.name) && (
                                <span className="inline-flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveColumn("orderColumns", row.name, -1)}
                                    disabled={profile.orderColumns.indexOf(row.name) === 0}
                                    className="h-4 w-4 inline-flex items-center justify-center rounded text-foreground-faint hover:text-foreground-default disabled:opacity-30"
                                    title={`Move ${row.name} up in order priority`}
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveColumn("orderColumns", row.name, 1)}
                                    disabled={profile.orderColumns.indexOf(row.name) === profile.orderColumns.length - 1}
                                    className="h-4 w-4 inline-flex items-center justify-center rounded text-foreground-faint hover:text-foreground-default disabled:opacity-30"
                                    title={`Move ${row.name} down in order priority`}
                                  >
                                    <ArrowDown className="h-3 w-3" />
                                  </button>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-1 py-1 text-center">
                            <div className="flex items-center justify-center gap-0.5">
                              <span className="relative inline-flex">
                                <Checkbox
                                  checked={profile.correlationColumns.includes(row.name)}
                                  onCheckedChange={() => update({ correlationColumns: toggle(profile.correlationColumns, row.name) })}
                                  className={cn(profile.correlationColumns.includes(row.name) && "text-transparent [&_svg]:hidden")}
                                />
                                {profile.correlationColumns.includes(row.name) && (
                                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[9px] font-bold text-foreground-default">
                                    {profile.correlationColumns.indexOf(row.name) + 1}
                                  </span>
                                )}
                              </span>
                              {profile.correlationColumns.includes(row.name) && (
                                <span className="inline-flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveColumn("correlationColumns", row.name, -1)}
                                    disabled={profile.correlationColumns.indexOf(row.name) === 0}
                                    className="h-4 w-4 inline-flex items-center justify-center rounded text-foreground-faint hover:text-foreground-default disabled:opacity-30"
                                    title={`Move ${row.name} up in correlate priority`}
                                  >
                                    <ArrowUp className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveColumn("correlationColumns", row.name, 1)}
                                    disabled={profile.correlationColumns.indexOf(row.name) === profile.correlationColumns.length - 1}
                                    className="h-4 w-4 inline-flex items-center justify-center rounded text-foreground-faint hover:text-foreground-default disabled:opacity-30"
                                    title={`Move ${row.name} down in correlate priority`}
                                  >
                                    <ArrowDown className="h-3 w-3" />
                                  </button>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Checkbox
                              checked={profile.tokenColumns.includes(row.name)}
                              onCheckedChange={() => update({ tokenColumns: toggle(profile.tokenColumns, row.name) })}
                            />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <Checkbox
                              checked={profile.entityColumn === row.name}
                              onCheckedChange={(checked) =>
                                update({ entityColumn: checked ? row.name : null })
                              }
                              title={profile.entityColumn === row.name ? `Untag ${row.name} as entity` : `Tag ${row.name} as entity`}
                            />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <Checkbox
                              checked={profile.directionColumn === row.name}
                              onCheckedChange={(checked) =>
                                update({ directionColumn: checked ? row.name : null })
                              }
                              title={profile.directionColumn === row.name ? `Untag ${row.name} as direction` : `Tag ${row.name} as direction`}
                            />
                          </td>
                        </>
                      )}
                      {variant !== "full" && (
                        <td className="px-2 py-1 text-center">
                          {row.added && onRemoveField && (
                            <button
                              type="button"
                              onClick={() => onRemoveField(row.name)}
                              className="text-[10px] px-1 py-0.5 rounded border border-border-default bg-surface-subtle text-foreground-muted hover:text-destructive-fg hover:border-destructive-bd transition-colors"
                              title={`Remove field ${row.name}`}
                            >
                              ×
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {/* Add-field: a new row at the bottom of the same list — list variant only */}
                {variant !== "full" && onAddField && (
                  <tr className="border-t border-border-default bg-surface-inset/60">
                    <td className="px-2 py-1 text-foreground-faint">+</td>
                    <td className="px-2 py-1" colSpan={6}>
                      <Input
                        value={newFieldName}
                        onChange={(e) => setNewFieldName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddField(); }}
                        placeholder="Add field — type a name and press Enter"
                        className="h-6 text-[11px] px-1.5 font-mono"
                      />
                    </td>
                    <td className="px-2 py-1 text-center">
                      <button
                        type="button"
                        onClick={handleAddField}
                        disabled={!newFieldName.trim()}
                        className="h-5 w-5 inline-flex items-center justify-center rounded border border-border-default bg-surface-card text-foreground-muted hover:text-foreground-default hover:bg-surface-hover transition-colors disabled:opacity-50"
                        title="Add field"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        {error && <div className="px-2 py-1 text-[11px] text-destructive-fg border-t border-border-default shrink-0">{error}</div>}
      </div>

      {variant === "full" && onResizeSeqRowsStart && (
        <ResizeHandle
          direction="horizontal"
          onMouseDown={onResizeSeqRowsStart}
          onDoubleClick={onResizeSeqRowsReset}
          title="Drag to resize fields / sequence preview; double-click to reset this handle"
        />
      )}

      {/* Sequence pane (full variant only) — same layout as the Discovery
          Histogram pane: standard header, settings row, right-aligned action
          button, then the output area */}
      {variant === "full" && (
        <div
          className="min-h-0 flex flex-col rounded-lg border border-border-default bg-surface-card overflow-hidden"
          style={{ flex: seqSplits?.sequences ?? 0.5 }}
        >
          <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
            <span className="font-medium text-sm">Sequence Preview</span>
            <div className="flex items-center gap-2">
              {result?.stats && (
                <span className="text-[10px] text-accent-primary-fg">
                  {result.stats.sequenceCount} sequence{result.stats.sequenceCount !== 1 ? "s" : ""} from{" "}
                  {result.stats.eligibleRows} row{result.stats.eligibleRows !== 1 ? "s" : ""}
                  {result.stats.ineligibleRows > 0 && (
                    <span className="text-badge-caution-fg"> ({result.stats.ineligibleRows} ineligible)</span>
                  )}
                </span>
              )}
              <PanelControls
                copyText={markdown}
                pane="sequences"
                copiedPane={copiedPane}
                onCopy={onCopy}
                wrap={wrapMarkdown}
                onWrapChange={setWrapMarkdown}
              />
            </div>
          </div>
          <div className="px-2 py-2 border-b border-border-default shrink-0 flex flex-col gap-2">
            {/* Row 1: text/number inputs */}
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] uppercase tracking-wider text-foreground-faint">Separator</Label>
                <Input
                  value={profile.separator ?? "$"}
                  onChange={(e) => update({ separator: e.target.value || "$" })}
                  className="h-6 w-16 text-xs px-1.5"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="Placeholder rendered for missing token/entity/direction/correlation values">Missing value</Label>
                <Input
                  value={profile.missingValue ?? "-"}
                  onChange={(e) => update({ missingValue: e.target.value || "-" })}
                  className="h-6 w-20 text-xs px-1.5"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] uppercase tracking-wider text-foreground-faint">Max example keys</Label>
                <Input
                  type="number"
                  min={0}
                  value={profile.maxExampleKeys ?? 5}
                  onChange={(e) => update({ maxExampleKeys: Math.max(0, Number(e.target.value) || 0) })}
                  className="h-6 w-16 text-xs px-1.5"
                />
              </div>
              <div className="flex flex-col gap-0.5">
                <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="Drop sequences with fewer steps than this — single-step sequences are usually noise">Min steps</Label>
                <Input
                  type="number"
                  min={1}
                  value={profile.minSteps ?? 2}
                  onChange={(e) => update({ minSteps: Math.max(1, Number(e.target.value) || 1) })}
                  className="h-6 w-16 text-xs px-1.5"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px]">Sort</Label>
                <select
                  value={profile.sortOrder ?? "frequency-desc"}
                  onChange={(e) => update({ sortOrder: e.target.value as TraceProfileSequenceConfig["sortOrder"] })}
                  className="h-6 w-32 rounded-md border border-border-default bg-surface-card px-2 text-xs text-foreground-muted outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle"
                >
                  <option value="frequency-desc">frequency-desc</option>
                  <option value="signature-asc">signature-asc</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-[11px]" title="Steps: one step table per mined sequence. Graph: one Nodes+Edges table per connected component of the observed flows (no sequence signatures)">Output</Label>
                <select
                  value={profile.outputFormat ?? "steps"}
                  onChange={(e) => update({ outputFormat: e.target.value as TraceProfileSequenceConfig["outputFormat"] })}
                  className="h-6 w-32 rounded-md border border-border-default bg-surface-card px-2 text-xs text-foreground-muted outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle"
                >
                  <option value="steps">Sequence Steps</option>
                  <option value="graph">Sequence Graph</option>
                </select>
              </div>
              <div className="flex-1" />
              <Button size="sm" className="h-6 px-2 text-xs" onClick={onPreview} disabled={loading || !hasProfile}>
                {loading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Mining...
                  </>
                ) : (
                  <>
                    <Workflow className="h-3 w-3 mr-1" />
                    Preview sequences
                  </>
                )}
              </Button>
            </div>
            {/* Row 2: switches */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Switch
                  size="sm"
                  id="include-token-components"
                  checked={profile.includeTokenComponents === true}
                  onCheckedChange={(checked) => update({ includeTokenComponents: checked === true })}
                />
                <Label htmlFor="include-token-components" className="text-[11px] cursor-pointer">
                  Include token components
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  size="sm"
                  id="exclude-missing-tokens"
                  checked={profile.excludeMissingTokens !== false}
                  onCheckedChange={(checked) => update({ excludeMissingTokens: checked === true })}
                />
                <Label htmlFor="exclude-missing-tokens" className="text-[11px] cursor-pointer" title="Exclude rows where the entity or direction value is missing (rendered as the missing-value placeholder)">
                  Exclude missing entity/direction
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  size="sm"
                  id="include-transitions"
                  checked={profile.includeTransitions === true}
                  onCheckedChange={(checked) => update({ includeTransitions: checked === true })}
                />
                <Label htmlFor="include-transitions" className="text-[11px] cursor-pointer" title="Append a table of adjacent sequence pairs across traces (one level deep)">
                  Sequence transitions
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  size="sm"
                  id="include-sequence-numbers"
                  checked={profile.includeSequenceNumbers === true}
                  onCheckedChange={(checked) => update({ includeSequenceNumbers: checked === true })}
                />
                <Label htmlFor="include-sequence-numbers" className="text-[11px] cursor-pointer" title="Prefix section headings with an ordinal (Sequence N / Graph N). Off by default — the number is report position, not signal strength">
                  Number sections
                </Label>
              </div>
            </div>
          </div>
          {error && <div className="px-2 py-1 text-[11px] text-destructive-fg border-b border-border-default shrink-0">{error}</div>}
          <div className="flex-1 min-h-0 relative bg-surface-card p-3 overflow-auto" tabIndex={0} onKeyDown={panePageKeyHandler}>
            {result == null ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-foreground-faint">
                <span className="text-sm text-center px-4">
                  {loading
                    ? "Mining sequences from the parsed rows..."
                    : hasProfile
                      ? "Click above to test the sequence profile against the sample."
                      : "Set Order, Correlate and Token columns and tag Entity and Direction fields in the list above, then preview the mined sequences."}
                </span>
              </div>
            ) : result.valid ? (
              <pre
                className="text-xs font-mono"
                style={{ whiteSpace: wrapMarkdown ? "pre-wrap" : "pre", overflowWrap: wrapMarkdown ? "break-word" : "normal" }}
              >
                {markdown || "No sequences found."}
              </pre>
            ) : (
              <div className="rounded-md bg-destructive-bg p-2 text-xs text-destructive-fg">
                {result.error || "Sequence preview failed."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

function HighlightedContext({ context, value }: { context: string; value: string }) {
  if (!value || !context.includes(value)) return <>{context}</>;
  const parts = context.split(value);
  return (
    <>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {p}
          {i < parts.length - 1 && <strong className="font-semibold text-foreground-default">{value}</strong>}
        </React.Fragment>
      ))}
    </>
  );
}

function NameAsCell({
  value,
  nameMap,
  onAdd,
  onRemove,
}: {
  value: string;
  nameMap: Array<{ name: string; values: string[]; variance?: 'enum' | 'high' }>;
  onAdd: (name: string) => void;
  onRemove?: (name: string, value: string) => void;
}) {
  const [newGroupOpen, setNewGroupOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [draftError, setDraftError] = React.useState<string | null>(null);
  const existingGroup = nameMap.find((g) => g.values.includes(value));
  const existingNames = nameMap.map((g) => g.name);
  const canAddNew = draft.trim() !== "" && !existingNames.includes(draft.trim());
  return (
    <div className="flex items-center gap-1">
      <select
        className="h-5 rounded border border-border-default bg-surface-card px-1 text-[10px] text-foreground-muted outline-none focus:border-focus-ring focus:ring-1 focus:ring-focus-ring-subtle"
        value={existingGroup?.name ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__new__") { setDraft(""); setDraftError(null); setNewGroupOpen(true); return; }
          if (v === "") {
            if (existingGroup && onRemove) onRemove(existingGroup.name, value);
            return;
          }
          if (v !== existingGroup?.name) onAdd(v);
        }}
        title="Name as… — pick an existing field group or create a new one; select the placeholder to clear"
      >
        <option value="">Name as…</option>
        {existingNames.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
        <option value="__new__">+ field group…</option>
      </select>
      <Dialog open={newGroupOpen} onOpenChange={(o) => { setNewGroupOpen(o); if (!o) { setDraft(""); setDraftError(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New field group</DialogTitle>
            <DialogDescription>
              Name this group — <span className="font-mono text-xs">{value}</span> will be added to it, and the name will appear in every "Name as…" list.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3 mt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!canAddNew) { setDraftError(existingNames.includes(draft.trim()) ? "A group with this name already exists" : "Name is required"); return; }
              onAdd(draft.trim());
              setNewGroupOpen(false);
              setDraft("");
              setDraftError(null);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-field-group-name">Group name</Label>
              <Input
                id="new-field-group-name"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setDraftError(null); }}
                placeholder="e.g. direction"
                autoFocus
              />
            </div>
            {draftError && <p className="text-xs text-destructive-fg">{draftError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setNewGroupOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!canAddNew}>Add to group</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type HistogramKnobs = { minSupport?: number; minSupportPct?: number; constantRatio?: number; maxEntries?: number; contextChars?: number; minTokenLength?: number; includeShapes?: string[] };

/** UI defaults for the discovery histogram — also written into the config so
 *  the auto-run and the Generate button behave identically, and so a saved
 *  profile hydrates the same knobs next time. */
export const DEFAULT_HISTOGRAM_KNOBS: Required<Omit<HistogramKnobs, "includeShapes">> = {
  minSupport: 2,
  minSupportPct: 0,
  constantRatio: 0.9,
  maxEntries: 200,
  contextChars: 120,
  minTokenLength: 2,
};

function knobStrings(knobs: Partial<Record<keyof typeof DEFAULT_HISTOGRAM_KNOBS, number>> | null | undefined) {
  const k = { ...DEFAULT_HISTOGRAM_KNOBS, ...(knobs ?? {}) };
  return {
    minSupport: String(k.minSupport),
    minSupportPct: String(k.minSupportPct),
    constantRatio: String(k.constantRatio),
    maxEntries: String(k.maxEntries),
    contextChars: String(k.contextChars),
    minTokenLength: String(k.minTokenLength),
  };
}

export function HistogramPreview({
  histogram,
  loading,
  onPreview,
  onExtract,
  extractLoading,
  nameMap = [],
  onAddNameMapGroup,
  onRemoveNameMapValue,
  savedKnobs,
}: {
  histogram: TraceProfileDiscoveryHistogramResult | null;
  loading: boolean;
  onPreview: (knobs: HistogramKnobs) => void;
  onExtract?: () => void;
  extractLoading?: boolean;
  nameMap?: Array<{ name: string; values: string[]; variance?: 'enum' | 'high' }>;
  onAddNameMapGroup?: (name: string, value: string) => void;
  onRemoveNameMapValue?: (name: string, value: string) => void;
  savedKnobs?: Partial<Record<keyof typeof DEFAULT_HISTOGRAM_KNOBS, number>> | null;
}) {
  // Histogram is always expanded — no show/hide.
  // Hydrate from the config's fieldExtraction.histogramKnobs when present.
  const initial = knobStrings(savedKnobs);
  const [minSupport, setMinSupport] = useState(initial.minSupport);
  const [minSupportPct, setMinSupportPct] = useState(initial.minSupportPct);
  const [constantRatio, setConstantRatio] = useState(initial.constantRatio);
  const [maxEntries, setMaxEntries] = useState(initial.maxEntries);
  const [contextChars, setContextChars] = useState(initial.contextChars);
  const [minTokenLength, setMinTokenLength] = useState(initial.minTokenLength);
  const [groupFilter, setGroupFilter] = useState<"all" | "assigned" | "unassigned">("all");
  const [searchText, setSearchText] = useState("");

  const assignedValues = new Set(nameMap.flatMap((g) => g.values ?? []));
  const q = searchText.trim().toLowerCase();
  const visibleEntries = histogram?.entries.filter((e) => {
    if (groupFilter === "assigned" && !assignedValues.has(e.value)) return false;
    if (groupFilter === "unassigned" && assignedValues.has(e.value)) return false;
    if (q && !e.value.toLowerCase().includes(q)) return false;
    return true;
  }) ?? [];

  const num = (s: string) => {
    const n = Number(s);
    return s.trim() !== "" && Number.isFinite(n) ? n : undefined;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-lg border border-border-default bg-surface-card overflow-hidden">
      <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
        <span className="font-medium text-sm">Discovery histogram</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {(["all", "assigned", "unassigned"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setGroupFilter(mode)}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                  groupFilter === mode
                    ? 'bg-accent-secondary-bg border-accent-secondary-bd text-accent-secondary-fg'
                    : 'bg-surface-card border-border-default text-foreground-subtle hover:bg-surface-panel'
                }`}
                title={mode === "all" ? "Show all values" : mode === "assigned" ? "Only values assigned to a field group" : "Only values not yet assigned to a field group"}
              >
                {mode === "all" ? "All" : mode === "assigned" ? "Assigned" : "Unassigned"}
              </button>
            ))}
          </div>
          <span className="text-xs font-mono text-accent-primary-fg bg-surface-inset border border-accent-primary-bd px-2 py-0.5 rounded">
            {histogram
              ? `${visibleEntries.length}/${histogram.totalCandidates}${histogram.truncated ? ' (capped)' : ''}${histogram.totalRecords != null ? ` · ${histogram.totalRecords} records` : ''}`
              : loading ? '…' : '—'}
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        <div className="px-2 py-1.5 border-b border-border-default bg-surface-card shrink-0">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search values…"
              className="h-7 pl-7 pr-7 text-xs rounded-md bg-surface-card border border-border-default text-foreground-default placeholder:text-foreground-placeholder focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring-subtle"
            />
            {searchText && (
              <button
                type="button"
                onClick={() => setSearchText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground-subtle hover:text-foreground-faint"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2 px-2 py-2 border-b border-border-default shrink-0">
            <div className="flex flex-col gap-0.5">
              <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="min rows a value must appear in">minSupport</Label>
              <Input className="h-6 w-20 text-xs px-1.5" value={minSupport} onChange={(e) => setMinSupport(e.target.value)} />
            </div>
            <div className="flex flex-col gap-0.5">
              <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="extra floor: min rows = ceil(rows * this); 0 disables">minSupportPct</Label>
              <Input className="h-6 w-20 text-xs px-1.5" value={minSupportPct} onChange={(e) => setMinSupportPct(e.target.value)} />
            </div>
            <div className="flex flex-col gap-0.5">
              <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="values in >= this fraction of rows are treated as constants">constantRatio</Label>
              <Input className="h-6 w-20 text-xs px-1.5" value={constantRatio} onChange={(e) => setConstantRatio(e.target.value)} />
            </div>
            <div className="flex flex-col gap-0.5">
              <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="max histogram entries returned">maxEntries</Label>
              <Input className="h-6 w-20 text-xs px-1.5" value={maxEntries} onChange={(e) => setMaxEntries(e.target.value)} />
            </div>
            <div className="flex flex-col gap-0.5">
              <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="show this many chars before and after each value in the context column">contextChars</Label>
              <Input className="h-6 w-20 text-xs px-1.5" value={contextChars} onChange={(e) => setContextChars(e.target.value)} />
            </div>
            <div className="flex flex-col gap-0.5">
              <Label className="text-[9px] uppercase tracking-wider text-foreground-faint" title="drop tokens shorter than this">minTokenLength</Label>
              <Input className="h-6 w-20 text-xs px-1.5" value={minTokenLength} onChange={(e) => setMinTokenLength(e.target.value)} />
            </div>
            <div className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={loading}
              onClick={() => onPreview({
                minSupport: num(minSupport),
                minSupportPct: num(minSupportPct),
                constantRatio: num(constantRatio),
                maxEntries: num(maxEntries),
                contextChars: num(contextChars),
                minTokenLength: num(minTokenLength),
              })}
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Generate histogram"}
            </Button>
            {onExtract && (
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                disabled={extractLoading || loading || nameMap.length === 0}
                title={nameMap.length === 0 ? "Name at least one value as a field group first" : undefined}
                onClick={onExtract}
              >
                {extractLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Extract fields
              </Button>
            )}
          </div>
          {histogram?.valid === false && histogram.error && (
            <div className="px-3 py-2 text-xs text-badge-caution-fg border-b border-border-default bg-badge-caution-bg/40 shrink-0">
              Histogram failed: {histogram.error}
            </div>
          )}
          {histogram && histogram.valid !== false && (
            <div className="flex-1 min-h-0 overflow-auto border-t border-border-default">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-foreground-faint border-b border-border-default bg-surface-panel sticky top-0">
                    <th className="px-1.5 py-1 font-medium">Name as…</th>
                    <th className="px-1.5 py-1 font-medium">Value</th>
                    <th className="px-1.5 py-1 font-medium">Shape</th>
                    <th className="px-1.5 py-1 font-medium text-right">Count</th>
                    <th className="px-1.5 py-1 font-medium">Context</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleEntries.map((e, i) => (
                    <tr key={i} className="border-b border-border-default/50 align-top">
                      <td className="px-1.5 py-1 whitespace-nowrap">
                        <NameAsCell
                          value={e.value}
                          nameMap={nameMap}
                          onAdd={(name) => onAddNameMapGroup?.(name, e.value)}
                          onRemove={onRemoveNameMapValue}
                        />
                      </td>
                      <td className="px-1.5 py-1 font-mono break-all max-w-56">{e.value}</td>
                      <td className="px-1.5 py-1 text-foreground-faint">{e.shape}</td>
                      <td className="px-1.5 py-1 text-right whitespace-nowrap">{e.count}/{e.rowCount}</td>
                      <td className="px-1.5 py-1 text-foreground-faint break-all max-w-72">
                        <HighlightedContext context={e.contexts[0] ?? ""} value={e.value} />
                      </td>
                    </tr>
                  ))}
                  {visibleEntries.length === 0 && (
                    <tr><td colSpan={5} className="px-1.5 py-2 text-foreground-faint">
                      {histogram && histogram.entries.length > 0
                        ? `No ${groupFilter === "assigned" ? "assigned" : "unassigned"} values — switch to All to see everything.`
                        : "No repeating variable values found — try lowering minSupport or constantRatio."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
      </div>
    </div>
  );
}
