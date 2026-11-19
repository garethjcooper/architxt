"use client";

import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn } from "@/lib/utils";
import { createLogger } from "@/lib/logger";
import { toast } from "sonner";
import { Sparkles, Check, AlertTriangle } from "lucide-react";
import { ResizeHandle } from "@/app/workspace/_components/panel-layout";
import {
  Upload,
  Loader2,
} from "lucide-react";
import { traceProfilesApi, documentsApi } from "@/lib/api/client";
import {
  DEFAULT_HISTOGRAM_KNOBS,
  PanelControls,
  OutputSamplePanel,
  FieldExtractionPanel,
  FieldsPanel,
} from "./shared";
import { useTraceProfileResizers } from "./use-trace-profile-resizers";
import {
  TraceProfile,
  TraceProfileValidationResult,
  TraceProfileDiscoveryHistogramResult,
  TraceEngineManifest,
  TraceProfileFieldExtractionResult,
  TraceProfileSequencePreviewResult,
  TraceProfileSequenceConfig,
  Document,
} from "@/lib/types";

const logger = createLogger('TraceProfileDialog');

const BLANK_CONFIG: Record<string, any> = {};

/**
 * Strip the parts of a parsed profile config that have no effect on
 * /trace-profiles/validate output, so checkbox flips on sequenceProfile
 * don't trigger a pointless re-parse of the sample.
 */
function normalizeForValidate(config: Record<string, any>): Record<string, any> {
  const parser = config?.parser && typeof config.parser === "object" ? config.parser : {};
  const parserConfig = parser.config && typeof parser.config === "object" ? parser.config : {};
  const { sequenceProfile: _sp, ...restConfig } = parserConfig;
  return { ...config, parser: { ...parser, config: restConfig } };
}

/** Deterministic JSON stringify (object keys sorted) for config comparison. */
function serializeStable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serializeStable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${serializeStable(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Mirror of the server's safeFieldName for delimited header cells. */
function sanitizeFieldName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^[0-9]/, "_$&")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
  return cleaned || "column";
}

/** Quote-aware split mirroring the server's splitDelimited (RFC-4180 style). */
function quoteAwareSplit(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  let fieldStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"' && fieldStart) {
      inQuotes = true; fieldStart = false;
    } else if (ch === delimiter) {
      out.push(cur); cur = ""; fieldStart = true;
    } else {
      cur += ch; fieldStart = false;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Standard parser.config seed for each engine, matching the shapes the
 * suggest-config prompt documents. Selecting an engine replaces
 * parser.config wholesale with this block so the user starts from the
 * engine's canonical structure instead of an empty object.
 */
const ENGINE_STANDARD_CONFIG: Record<string, Record<string, any>> = {
  delimited: {
    input: { encoding: "utf-8", delimiter: "\t", quoteChar: '"', hasHeader: true },
    records: { payloadStitching: null, multilineColumn: null },
  },
  plaintext: {
    input: { encoding: "utf-8" },
    records: { recordStartPattern: "", payloadStitching: null },
  },
  "json-lines": {
    input: { encoding: "utf-8" },
    records: { recordStartPath: "" },
  },
  "json-nd": {
    input: { encoding: "utf-8" },
    records: { recordStartPath: "", recordStartPattern: "" },
  },
  xml: {
    input: { encoding: "utf-8" },
    records: { splitElements: true, recordStartTag: "" },
  },
};

const EMPTY_FORM = {
  name: "",
  description: null as string | null,
  config: BLANK_CONFIG,
};

function formatConfig(config: unknown): string {
  return JSON.stringify(config, null, 2);
}

function parseConfig(json: string): { ok: true; value: Record<string, any> } | { ok: false, error: string } {
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid JSON" };
  }
}

export interface TraceProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TraceProfile | null;
  onSaved: () => void;
}

export function TraceProfileDialog({ open, onOpenChange, editing, onSaved }: TraceProfileDialogProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [configJson, setConfigJson] = useState(formatConfig(BLANK_CONFIG));
  // Ref mirror so async callbacks (validate effect) always read the latest config.
  const configJsonRef = useRef(configJson);
  configJsonRef.current = configJson;
  const [configError, setConfigError] = useState<string | null>(null);
  const [engines, setEngines] = useState<TraceEngineManifest[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [sample, setSample] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [wrapJson, setWrapJson] = useState(false);
  const [wrapSample, setWrapSample] = useState(false);
  const [wrapOutput, setWrapOutput] = useState(false);
  const [copiedPane, setCopiedPane] = useState<string | null>(null);
  const [outputSampleResult, setOutputSampleResult] = useState<TraceProfileValidationResult | null>(null);
  const [outputSampleLoading, setOutputSampleLoading] = useState(false);
  const [fieldExtractionResult, setFieldExtractionResult] = useState<TraceProfileFieldExtractionResult | null>(null);
  const [fieldExtractionLoading, setFieldExtractionLoading] = useState(false);
  const [histogramResult, setHistogramResult] = useState<TraceProfileDiscoveryHistogramResult | null>(null);
  const [histogramLoading, setHistogramLoading] = useState(false);
  const [sequencePreviewResult, setSequencePreviewResult] = useState<TraceProfileSequencePreviewResult | null>(null);
  const [sequencePreviewLoading, setSequencePreviewLoading] = useState(false);
  const [wrapSequences, setWrapSequences] = useState(false);
  type ConfigTab = "parser" | "fields" | "sequences";
  const [configTab, setConfigTab] = useState<ConfigTab>("parser");
  // Pending engine change / auto-detect awaiting confirmation. When set, the
  // ConfirmDialog asks before the parser block is replaced, because switching
  // engines invalidates all derived state (found fields, histogram, previews).
  const [pendingEngineChange, setPendingEngineChange] = useState<string | null>(null);
  const [pendingAutoDetect, setPendingAutoDetect] = useState(false);

  const dialogBodyRef = useRef<HTMLDivElement>(null);
  const {
    columnWidths,
    rightSplits,
    fieldSplits,
    seqSplits,
    handleResizeStart,
    handleResizeReset,
    bindContainerRef,
    bindRightColumnRef,
    bindFieldColumnRef,
    bindSeqColumnRef,
  } = useTraceProfileResizers();

  const availableFields = useMemo(() => {
    // Prefer fields discovered by running the sample (works for every engine,
    // including delimited header columns and JSON payload paths). Fall back to
    // the LLM Extract fields result when no sample has been run yet.
    const fromSample = outputSampleResult?.availableFields;
    if (fromSample && fromSample.length > 0) return fromSample;
    if (!fieldExtractionResult?.fieldExtraction) return null;
    const fe = fieldExtractionResult.fieldExtraction;
    const fieldNames = Array.isArray(fe.fields) ? fe.fields.map((f) => f.name) : [];
    const payloadFields = fe.payload.fields.map((f) => f.path);
    const all = Array.from(new Set([...fieldNames, ...payloadFields]));
    return all.length > 0 ? all : null;
  }, [fieldExtractionResult, outputSampleResult]);

  // For the delimited engine the column names are deterministic: real header
  // names when hasHeader is true (and the first line passes the same
  // value-shape/duplicate check the server applies), otherwise
  // column_0..column_N — derived from the first sample line and the
  // configured delimiter, the same naming the server uses. For other
  // engines, detected = the names the Extract run discovered. Never use
  // /validate's availableFields here: it is computed after the config's own
  // field rules are applied, so user-added fields would leak into the
  // detected set.
  const fieldExtractionDetected = useMemo(() => {
    const engine = currentEngineModule();
    const parsed = getParsedConfig();
    const input = parsed?.parser?.config?.input ?? {};
    if (engine === "delimited") {
      const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
      if (!firstLine.trim()) return availableFields;
      const delimiter = typeof input.delimiter === "string" && input.delimiter !== "" ? input.delimiter : "\t";
      const cols = quoteAwareSplit(firstLine, delimiter);
      if (!input.hasHeader) return cols.map((_, i) => `column_${i}`);
      // Mirror the server's looksLikeHeader check so the UI and the server
      // agree on whether line 1 is a real header.
      const cleaned = cols.map((c) => sanitizeFieldName(c));
      const valueShaped = cols.some((c) => /^[0-9a-fA-F]{6,}$/.test(c.trim()) || /^\d+$/.test(c.trim()) || /\d{4}-\d{2}-\d{2}/.test(c) || /\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}/.test(c));
      if (cols.length < 2 || new Set(cleaned).size !== cleaned.length || valueShaped) {
        return cols.map((_, i) => `column_${i}`);
      }
      return cleaned;
    }
    const fromExtract = fieldExtractionResult?.fieldExtraction?.fields?.map((f) => f.name) ?? [];
    if (fromExtract.length > 0) return fromExtract;
    return availableFields;
  }, [configJson, sample, availableFields, fieldExtractionResult]);

  const fieldExtractionDeterministic = currentEngineModule() === "delimited";
  const isPlaintext = currentEngineModule() === "plaintext";

  // Effective histogram knobs for auto-runs: UI defaults merged with whatever
  // is saved in the config (fieldExtraction.histogramKnobs), so the first run
  // uses the same knobs the panel displays instead of server-side defaults.
  function effectiveHistogramKnobs() {
    const parsed = parseConfig(configJson);
    const saved = parsed.ok ? parsed.value.fieldExtraction?.histogramKnobs : null;
    return { ...DEFAULT_HISTOGRAM_KNOBS, ...(saved ?? {}) };
  }

  // Plaintext: the Field Extraction tab drives discovery — when the engine is
  // plaintext and no histogram has been computed yet, populate it immediately
  // with the default knobs.
  const histogramRequestedRef = useRef(false);
  useEffect(() => {
    if (!isPlaintext || histogramRequestedRef.current) return;
    if (histogramResult || histogramLoading) return;
    if (!sample.trim()) return;
    const parsed = parseConfig(configJson);
    if (!parsed.ok) return;
    histogramRequestedRef.current = true;
    handlePreviewHistogram(effectiveHistogramKnobs());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaintext, sample, histogramResult, histogramLoading, configJson]);

  // Unified fieldExtraction.fields lives at the top level: [{ name, source, regex }].
  // `samples` are preview-only and never written into the config.
  function sanitizeFieldExtraction(fe: any): any {
    if (!fe || typeof fe !== "object") return fe;
    return {
      ...fe,
      fields: Array.isArray(fe.fields) ? fe.fields.map(({ samples, ...rest }: any) => rest) : fe.fields,
    };
  }

  function updateFields(mutator: (fields: Array<{ name: string; ordinal: number; source: string | null; regex: string | null; samples?: string[] }>) => Array<{ name: string; ordinal: number; source: string | null; regex: string | null; samples?: string[] }>) {
    const parsed = parseConfig(configJson);
    const base = parsed.ok ? parsed.value : {};
    const fe = sanitizeFieldExtraction(base.fieldExtraction ?? { fields: [], payload: { format: null, fields: [] } });
    fe.fields = mutator(Array.isArray(fe.fields) ? fe.fields : []);
    base.fieldExtraction = fe;
    setConfigJson(formatConfig(base));
  }

  function nextOrdinal(fields: Array<{ ordinal?: number }>): number {
    return fields.reduce((max, f) => Math.max(max, typeof f.ordinal === "number" ? f.ordinal : -1), -1) + 1;
  }

  function handleSetRegex(field: string, regex: string) {
    updateFields((fields) => {
      const idx = fields.findIndex((f) => f.name === field);
      if (idx >= 0) {
        const next = [...fields];
        next[idx] = { ...next[idx], regex };
        return next;
      }
      return [...fields, { name: field, ordinal: nextOrdinal(fields), source: null, regex }];
    });
    toast.success(`Regex updated for ${field}`);
  }

  function handleSetSource(field: string, source: string | null) {
    updateFields((fields) => {
      const idx = fields.findIndex((f) => f.name === field);
      if (idx >= 0) {
        const next = [...fields];
        next[idx] = { ...next[idx], source };
        return next;
      }
      return [...fields, { name: field, ordinal: nextOrdinal(fields), source, regex: null }];
    });
    toast.success(source ? `Field ${field} now extracts from "${source}"` : `Field ${field} now extracts from the whole record`);
  }

  // Added fields always go to the end, with an ordinal past the last real one.
  function handleAddRule(field: string, regex: string, source: string | null = null) {
    updateFields((fields) => [...fields, { name: field, ordinal: nextOrdinal(fields), source, regex }]);
    toast.success(`Added field ${field}`);
  }

  function handleRemoveField(name: string) {
    updateFields((fields) => fields.filter((f) => f.name !== name));
    toast.success(`Removed field ${name}`);
  }

  // The config JSON is the single source of truth: every tab rehydrates from it
  // and writes back into it. Field-extraction fields read from the config so the
  // table always matches the Current config JSON in the left column.
  const configFields = useMemo((): Array<{ name: string; ordinal: number; source: string | null; regex: string | null }> => {
    const parsed = parseConfig(configJson);
    const fe = parsed.ok ? parsed.value?.fieldExtraction : null;
    return Array.isArray(fe?.fields) ? fe.fields : [];
  }, [configJson]);

  // Detected (real) fields vs user-added ones: added fields are those not in the
  // detected list, and always carry an ordinal past the last detected one.
  // Added fields are surfaced/edited on the Format & Fields tab, so only the
  // detected rows are needed here.
  const detectedNames = useMemo(() => new Set(fieldExtractionDetected ?? []), [fieldExtractionDetected]);
  const detectedFieldRows = useMemo(() => {
    return configFields
      .filter((f) => detectedNames.has(f.name))
      .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  }, [configFields, detectedNames]);

  const parsedSequenceProfile = useMemo(() => {
    const parsed = parseConfig(configJson);
    const sp = parsed.ok ? parsed.value?.parser?.config?.sequenceProfile : undefined;
    if (sp && typeof sp === "object" && Array.isArray(sp.orderColumns) && Array.isArray(sp.correlationColumns) && Array.isArray(sp.tokenColumns)) {
      return sp as TraceProfileSequenceConfig;
    }
    return null;
  }, [configJson]);

  // Derived key covering exactly the inputs that affect Output Sample:
  // the parsed config minus sequenceProfile (which validate ignores), plus the
  // sample text. Checkbox flips in Fields only change sequenceProfile, so this
  // string is referentially stable and the effects below never re-run for them.
  const outputSampleKey = useMemo(() => {
    const parsed = parseConfig(configJson);
    if (!parsed.ok) return configError ? `err:${configError}` : "err";
    return `${serializeStable(normalizeForValidate(parsed.value))}\n${sample}`;
  }, [configJson, sample, configError]);

  useEffect(() => {
    if (configError || !sample) {
      setOutputSampleResult(null);
      return;
    }

    const parsed = parseConfig(configJson);
    if (!parsed.ok) {
      setOutputSampleResult(null);
      return;
    }

    let cancelled = false;
    setOutputSampleLoading(true);
    const id = setTimeout(async () => {
      try {
        const result = await traceProfilesApi.validate(parsed.value, sample);
        if (cancelled) return;
        setOutputSampleResult(result);

        // Delimited and other deterministic engines (xml, json-lines, json-nd)
        // auto-write detected fields into the config so the user doesn't have to
        // press Extract fields. Delimited derives column names via Extract fields
        // (needs the raw sample); engine-payload paths are already deterministic
        // in /validate's availableFields, so they are written directly with no
        // LLM call. Only fills when the config has no fields yet, so deliberate
        // edits (delete/rename) are never clobbered.
        const engine = parsed.value?.parser?.module;
        const detected = result.availableFields ?? [];
        const currentFieldNames = Array.isArray(parsed.value?.fieldExtraction?.fields)
          ? parsed.value.fieldExtraction.fields.map((f: any) => f.name)
          : [];
        if (engine === "delimited" && detected.length > 0 && currentFieldNames.length === 0) {
          const discovered = await traceProfilesApi.extractFields(
            null,
            result.records.map((r: any) => ({ raw: typeof r.raw === "string" ? r.raw : JSON.stringify(r) })),
            undefined,
            parsed.value.parser,
            sample
          );
          if (cancelled || !discovered.fieldExtraction) return;
          setFieldExtractionResult(discovered);
          // Merge onto the latest config (configJson may have changed since validate)
          const latest = parseConfig(configJsonRef.current);
          if (latest.ok && discovered.fieldExtraction) {
            const next = { ...latest.value, fieldExtraction: sanitizeFieldExtraction(discovered.fieldExtraction) };
            setConfigJson(formatConfig(next));
          }
        } else if (
          ["xml", "json-lines", "json-nd"].includes(engine) &&
          detected.length > 0 &&
          currentFieldNames.length === 0
        ) {
          // Engine-payload engines (xml, json-lines, json-nd): /validate already
          // returns the deterministic payload paths — write them straight into
          // the config, no Extract-fields call needed.
          setFieldExtractionResult({
            fieldExtraction: {
              fields: detected.map((name, i) => ({ name, ordinal: i, source: null, regex: null })),
              payload: { format: engine === "xml" ? "xml" : "json", fields: [] },
            },
            matched: { payload: {} },
            persisted: false,
          });
          const latest = parseConfig(configJsonRef.current);
          if (latest.ok) {
            const next = {
              ...latest.value,
              fieldExtraction: {
                fields: detected.map((name, i) => ({ name, ordinal: i, source: null, regex: null })),
                payload: { format: engine === "xml" ? "xml" : "json", fields: [] },
              },
            };
            setConfigJson(formatConfig(next));
          }
        }
      } catch (err) {
        logger.warn('Output sample validation failed', { error: err });
        if (!cancelled) setOutputSampleResult(null);
      } finally {
        if (!cancelled) setOutputSampleLoading(false);
      }
    }, 500);
    return () => {
      clearTimeout(id);
      cancelled = true;
    };
    // Keyed on outputSampleKey: sequenceProfile-only edits (Fields checkboxes)
    // leave this string unchanged, so the effect does not re-run at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputSampleKey, configError]);

  // Auto-calculate the discovery histogram as soon as format/row detection
  // finishes (the validate effect above resolves a fresh parsed sample).
  // Runs with the effective knobs (saved histogramKnobs over UI defaults) and
  // fails silently — the user can re-run with custom knobs from the histogram
  // panel in the Field Extraction tab. Keyed on outputSampleKey so Fields-tab
  // checkbox flips (sequenceProfile-only) don't retrigger an expensive histogram.
  useEffect(() => {
    const parsed = parseConfig(configJson);
    if (configError || !parsed.ok || !sample.trim() || !outputSampleResult) return;
    const savedKnobs = parsed.value.fieldExtraction?.histogramKnobs;
    const knobs = { ...DEFAULT_HISTOGRAM_KNOBS, ...(savedKnobs ?? {}) };
    let cancelled = false;
    const run = async () => {
      setHistogramLoading(true);
      try {
        const result = await traceProfilesApi.discoveryHistogram(parsed.value, sample, knobs);
        if (!cancelled) setHistogramResult(result);
      } catch (err) {
        logger.warn('Auto histogram failed', { error: err instanceof Error ? err.message : String(err) });
        if (!cancelled) setHistogramResult(null);
      } finally {
        if (!cancelled) setHistogramLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputSampleKey, configError, outputSampleResult]);

  useEffect(() => {
    const onResize = () => {
      const el = dialogBodyRef.current;
      if (el) bindContainerRef(el);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bindContainerRef]);

  useEffect(() => {
    if (open) {
      if (editing) {
        const { name, description, config } = editing;
        const hydratedConfig = (config && typeof config === 'object') ? config : BLANK_CONFIG;
        setForm({ name, description, config: hydratedConfig });
        setConfigJson(formatConfig(hydratedConfig));
      } else {
        setForm(EMPTY_FORM);
        setConfigJson(formatConfig(BLANK_CONFIG));
      }
      setConfigError(null);
      setSample("");
      setSelectedDocumentId(null);
      // Clear all derived panel state so stale values from the previously
      // open profile don't bleed into the freshly opened modal — each tab
      // rebuilds its own state from the new config/sample as they run.
      setOutputSampleResult(null);
      setOutputSampleLoading(false);
      setFieldExtractionResult(null);
      setFieldExtractionLoading(false);
      setHistogramResult(null);
      setHistogramLoading(false);
      setSequencePreviewResult(null);
      setSequencePreviewLoading(false);
      setConfigTab("parser");
      loadDocumentsForSource();
      loadEngines();
    }
  }, [open, editing]);

  useEffect(() => {
    const parsed = parseConfig(configJson);
    if (parsed.ok) {
      setConfigError(null);
      setForm((prev) => ({ ...prev, config: parsed.value }));
    } else {
      setConfigError(parsed.error);
    }
  }, [configJson]);

  async function loadDocumentsForSource() {
    try {
      const data = await documentsApi.list({ limit: 1000 });
      setDocuments(data);
    } catch (err) {
      toast.error("Failed to load documents for source selection");
      console.error(err);
    }
  }

  const handleCopy = useCallback(async (text: string, pane: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPane(pane);
      toast.success('Copied to clipboard');
      setTimeout(() => setCopiedPane((current) => (current === pane ? null : current)), 1500);
    } catch {
      // ignore
    }
  }, []);

  const handleAddField = useCallback((name: string) => handleAddRule(name, ""), []);

  async function handleDocumentSelect(documentId: number | null) {
    if (documentId == null) {
      setSelectedDocumentId(null);
      return;
    }
    setSelectedDocumentId(documentId);
    try {
      const text = await documentsApi.getSourceText(documentId);
      setSample(text);
    } catch (err) {
      toast.error("Failed to load document source");
      console.error(err);
    }
  }

  function handleSampleUpload(file: File) {
    file
      .text()
      .then((text) => {
        setSample(text);
        setSelectedDocumentId(null);
      })
      .catch((err) => {
        toast.error("Failed to read sample file");
        console.error(err);
      });
  }

  async function loadEngines() {
    try {
      const data = await traceProfilesApi.engines();
      setEngines(data.engines);
    } catch (err) {
      console.error("Failed to load trace engines", err);
    }
  }

  function handleConfigChange(value: string) {
    setConfigJson(value);
  }

  function getParsedConfig(): Record<string, any> | null {
    const parsed = parseConfig(configJson);
    return parsed.ok ? parsed.value : null;
  }

  function currentEngineModule(): string {
    const parsed = getParsedConfig();
    const mod = parsed?.parser?.module;
    return typeof mod === "string" ? mod : "";
  }

  /**
   * Clear all derived panel state that depends on the parser config, so stale
   * fields/histogram/previews never survive an engine switch or auto-detect.
   */
  function resetDerivedState() {
    setOutputSampleResult(null);
    setOutputSampleLoading(false);
    setFieldExtractionResult(null);
    setFieldExtractionLoading(false);
    setHistogramResult(null);
    setHistogramLoading(false);
    setSequencePreviewResult(null);
    setSequencePreviewLoading(false);
    histogramRequestedRef.current = false;
  }

  /**
   * Engine picker change: if a different engine is already configured, ask
   * for confirmation first — applying it replaces the parser block and clears
   * all found fields / histogram / previews.
   */
  function handleEngineSelect(moduleName: string) {
    const current = currentEngineModule();
    if (moduleName === current) return;
    // Any existing engine in the config counts: switching away from it
    // discards the engine-specific settings along with all derived results.
    if (current !== "") {
      setPendingEngineChange(moduleName);
      return;
    }
    applyEngineChange(moduleName);
  }

  function applyEngineChange(moduleName: string) {
    resetDerivedState();
    writeParserModule(moduleName);
  }

  /**
   * Engine-agnostic top-level keys survive an engine change; everything that
   * depends on the parser (field extraction, name maps, histogram knobs,
   * sequence settings, kind/standard-log mappings) is discarded with it.
   */
  const ENGINE_AGNOSTIC_CONFIG_KEYS = new Set(["version"]);

  function stripEngineSpecificConfig(config: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const [key, value] of Object.entries(config)) {
      if (ENGINE_AGNOSTIC_CONFIG_KEYS.has(key)) out[key] = value;
    }
    return out;
  }

  function handleEngineChangeConfirmed() {
    if (pendingEngineChange != null) {
      applyEngineChange(pendingEngineChange);
      setPendingEngineChange(null);
    }
  }

  function handleAutoDetectRequested() {
    if (!sample.trim()) {
      toast.error("Paste or upload a sample first");
      return;
    }
    if (currentEngineModule() !== "") {
      setPendingAutoDetect(true);
      return;
    }
    void handleAutoDetect();
  }

  function handleAutoDetectConfirmed() {
    setPendingAutoDetect(false);
    void handleAutoDetect();
  }

  function writeParserModule(moduleName: string) {
    const parsed = parseConfig(configJson);
    const base = parsed.ok ? stripEngineSpecificConfig(parsed.value) : {};
    const next = { ...base };
    if (!moduleName) {
      delete next.parser;
    } else {
      // Replace the parser block with the engine's standard config shape.
      next.parser = {
        module: moduleName,
        config: JSON.parse(JSON.stringify(ENGINE_STANDARD_CONFIG[moduleName] ?? {})),
      };
    }
    setConfigJson(formatConfig(next));
  }

  function writeParserConfig(mutator: (parserConfig: Record<string, any>) => void) {
    const parsed = parseConfig(configJson);
    const base = parsed.ok ? parsed.value : {};
    const parser = { ...(base.parser ?? {}) };
    parser.config = { ...(parser.config ?? {}) };
    mutator(parser.config);
    base.parser = parser;
    setConfigJson(formatConfig(base));
  }

  function setInputField(key: string, value: string | boolean) {
    writeParserConfig((cfg) => {
      cfg.input = { ...(cfg.input ?? {}), [key]: value };
    });
  }

  function setRecordsField(key: string, value: string | null) {
    writeParserConfig((cfg) => {
      cfg.records = { ...(cfg.records ?? {}), [key]: value };
    });
  }

  function applyMultiLineColumn(columnName: string) {
    writeParserConfig((cfg) => {
      cfg.records = { ...(cfg.records ?? {}), multilineColumn: columnName, payloadStitching: null };
    });
    toast.success(`Set records.multilineColumn to "${columnName}"`);
  }

  function applyPayloadStitching(mode: "xml" | "json") {
    writeParserConfig((cfg) => {
      cfg.records = { ...(cfg.records ?? {}), payloadStitching: mode, multilineColumn: null };
    });
    toast.success(`Set records.payloadStitching to "${mode}"`);
  }

  async function handleAutoDetect() {
    if (!sample.trim()) {
      toast.error("Paste or upload a sample first");
      return;
    }
    setDetecting(true);
    try {
      const result = await traceProfilesApi.suggestConfig(sample);
      if (!result.valid || !result.config) {
        toast.error(result.error || "LLM did not return a valid config");
        return;
      }
      // The detected output supplies the parser block; keep only
      // engine-agnostic top-level keys from the editor — fieldExtraction,
      // nameMap, histogramKnobs etc. belong to the old engine and are dropped.
      const parsed = parseConfig(configJson);
      const base = parsed.ok ? stripEngineSpecificConfig(parsed.value) : {};
      const detectedParser = result.config?.parser;
      const next = { ...base, ...(result.config ?? {}) };
      if (detectedParser) next.parser = detectedParser;
      resetDerivedState();
      setConfigJson(formatConfig(next));
      setConfigTab("parser");
      toast.success("Detected parser format written to config");
    } catch (err) {
      toast.error("Auto-detect request failed");
      console.error(err);
    } finally {
      setDetecting(false);
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Profile name is required");
      return;
    }
    const parsed = parseConfig(configJson);
    if (!parsed.ok) {
      setConfigError(parsed.error);
      toast.error("Fix config JSON errors before saving");
      return;
    }
    if (!parsed.value || Object.keys(parsed.value).length === 0) {
      toast.error("Current config is empty; pick an engine or auto-detect before saving");
      return;
    }
    setSaving(true);
    try {
      // Samples are preview-only — never persist them into the stored config.
      const toSave = { ...parsed.value };
      if (toSave.fieldExtraction) toSave.fieldExtraction = sanitizeFieldExtraction(toSave.fieldExtraction);
      if (editing) {
        await traceProfilesApi.update(editing.id, {
          name: form.name,
          description: form.description,
          config: toSave,
        });
        toast.success("Profile updated");
      } else {
        await traceProfilesApi.create({
          name: form.name,
          description: form.description ?? undefined,
          config: toSave,
        });
        toast.success("Profile created");
      }
      onOpenChange(false);
      await onSaved();
    } catch (err) {
      toast.error("Failed to save profile");
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleExtractFields() {
    const rows = outputSampleResult?.records ?? [];
    if (rows.length === 0) {
      toast.error("Run a sample to generate rows first");
      return;
    }

    const parserConfig = getParsedConfig()?.parser;

    setFieldExtractionLoading(true);
    // Show the result inline in the Field Extraction tab rather than popping a dialog.
    setConfigTab("fields");
    try {
      const currentFe = (() => { const p = parseConfig(configJson); return p.ok ? (p.value.fieldExtraction ?? undefined) : undefined; })();
      const result = await traceProfilesApi.extractFields(
        editing?.id ?? null,
        rows.map((r) => ({ raw: typeof r.raw === "string" ? r.raw : JSON.stringify(r) })),
        currentFe,
        parserConfig,
        sample
      );
      setFieldExtractionResult(result);
      // Write the discovered fields into the config JSON — the config is the
      // source of truth, so the table rehydrates from it (not from this result).
      // Samples stay in the extract response for preview only.
      const parsed = parseConfig(configJson);
      if (parsed.ok && result.fieldExtraction) {
        // Use the server-returned nameMap: it carries the resolved per-group
        // "variance" classification ("enum" | "high"), which the config's own
        // nameMap may not have (auto-detected upstream). Fall back to the
        // previous config nameMap only if the result has none.
        const resultNameMap = Array.isArray(result.fieldExtraction.nameMap) ? result.fieldExtraction.nameMap : null;
        const prevNameMap = Array.isArray(parsed.value.fieldExtraction?.nameMap) ? parsed.value.fieldExtraction.nameMap : [];
        const next = { ...parsed.value, fieldExtraction: { ...sanitizeFieldExtraction(result.fieldExtraction), nameMap: resultNameMap ?? prevNameMap } };
        setConfigJson(formatConfig(next));
      }
      if (result.persisted) {
        toast.success("Field extraction rules discovered and persisted");
      } else {
        toast.success("Field extraction rules discovered (not persisted — profile not saved yet)");
      }
    } catch (err) {
      logger.error("Field extraction failed", { error: (err as Error).message });
      toast.error(`Field extraction failed: ${(err as Error).message}`);
    } finally {
      setFieldExtractionLoading(false);
    }
  }

  function handleAddNameMapGroup(name: string, value: string) {
    const parsed = parseConfig(configJson);
    if (!parsed.ok) { toast.error("Config JSON is not valid"); return; }
    const fe = parsed.value.fieldExtraction && typeof parsed.value.fieldExtraction === 'object' ? parsed.value.fieldExtraction : {};
    // A value belongs to exactly one group: when moving it to a different
    // group, strip it from the previous one first (and drop groups left empty).
    const nameMap = (Array.isArray(fe.nameMap) ? fe.nameMap : [])
      .map((g: { name: string; values: string[] }) => (g.name === name ? g : { ...g, values: g.values.filter((v: string) => v !== value) }))
      .filter((g: { name: string; values: string[] }) => g.values.length > 0 || g.name === name);
    const existing = nameMap.find((g: { name: string; values: string[] }) => g.name === name);
    if (existing) {
      if (!existing.values.includes(value)) existing.values = [...existing.values, value];
    } else {
      nameMap.push({ name, values: [value] });
    }
    setConfigJson(formatConfig({ ...parsed.value, fieldExtraction: { ...fe, nameMap } }));
    toast.success(`Value "${value}" added to group "${name}"`);
  }

  function handleRemoveNameMapValue(name: string, value: string) {
    const parsed = parseConfig(configJson);
    if (!parsed.ok) { toast.error("Config JSON is not valid"); return; }
    const fe = parsed.value.fieldExtraction && typeof parsed.value.fieldExtraction === 'object' ? parsed.value.fieldExtraction : {};
    const nameMap = (Array.isArray(fe.nameMap) ? fe.nameMap : [])
      .map((g: { name: string; values: string[] }) => (g.name === name ? { ...g, values: g.values.filter((v: string) => v !== value) } : g))
      .filter((g: { name: string; values: string[] }) => g.values.length > 0);
    setConfigJson(formatConfig({ ...parsed.value, fieldExtraction: { ...fe, nameMap } }));
  }

  async function handlePreviewHistogram(knobs: { minSupport?: number; minSupportPct?: number; constantRatio?: number; maxEntries?: number; contextChars?: number; minTokenLength?: number; includeShapes?: string[] }) {
    const parsed = parseConfig(configJson);
    if (!parsed.ok) {
      toast.error("Config JSON is not valid — fix it before previewing the histogram");
      return;
    }
    if (!sample.trim()) {
      toast.error("Add an input sample first");
      return;
    }
    // Persist the knobs used into fieldExtraction.histogramKnobs so a saved
    // profile hydrates them back on next open.
    const effective = { ...DEFAULT_HISTOGRAM_KNOBS, ...knobs };
    const { includeShapes, ...persistable } = effective as typeof effective & { includeShapes?: string[] };
    const fe = parsed.value.fieldExtraction && typeof parsed.value.fieldExtraction === 'object' ? parsed.value.fieldExtraction : {};
    setConfigJson(formatConfig({ ...parsed.value, fieldExtraction: { ...fe, histogramKnobs: persistable } }));
    setHistogramLoading(true);
    try {
      const result = await traceProfilesApi.discoveryHistogram(parsed.value, sample, knobs);
      setHistogramResult(result);
    } catch (err) {
      logger.error("Discovery histogram preview failed", { error: (err as Error).message });
      toast.error(`Histogram preview failed: ${(err as Error).message}`);
    } finally {
      setHistogramLoading(false);
    }
  }

  function handleSequenceProfileChange(profile: TraceProfileSequenceConfig) {
    // Write straight into the config JSON (parser.config.sequenceProfile) — the
    // config is the single source of truth, no separate draft or Apply step.
    const parsed = parseConfig(configJson);
    if (!parsed.ok) return;
    const next = { ...parsed.value };
    if (!next.parser) next.parser = {};
    if (!next.parser.config) next.parser.config = {};
    next.parser.config.sequenceProfile = { ...profile };
    setConfigJson(formatConfig(next));
  }

  async function handlePreviewSequences() {
    if (!sample) {
      toast.error("Paste or upload a sample first");
      return;
    }

    const parsed = parseConfig(configJson);
    if (!parsed.ok) {
      toast.error("Fix config JSON before previewing sequences");
      return;
    }

    const parserConfig = parsed.value.parser?.config;
    const activeProfile = parserConfig?.sequenceProfile;
    if (!activeProfile || typeof activeProfile !== "object" || !Array.isArray(activeProfile.orderColumns) || activeProfile.orderColumns.length === 0) {
      toast.error("Configure and apply a sequence profile before previewing");
      return;
    }

    setSequencePreviewLoading(true);
    try {
      // The config JSON already has everything (fieldExtraction is top-level,
      // sequenceProfile under parser.config) — send it as-is.
      const result = await traceProfilesApi.previewSequences(parsed.value, sample);
      setSequencePreviewResult(result);
    } catch (err) {
      logger.error("Sequence preview failed", { error: (err as Error).message });
      toast.error(`Sequence preview failed: ${(err as Error).message}`);
      setSequencePreviewResult(null);
    } finally {
      setSequencePreviewLoading(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="!w-[95vw] !max-w-none h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit trace profile" : "Create trace profile"}</DialogTitle>
            <DialogDescription>
              Versioned config editor: pick a version, edit JSON, run coverage on a sample or document, then save.
            </DialogDescription>
          </DialogHeader>

            <div
              ref={(el) => {
                dialogBodyRef.current = el;
                bindContainerRef(el);
              }}
              className="flex-1 min-h-0 flex flex-row overflow-hidden"
            >
            {/* Profile data pane */}
            <div
              className="flex flex-col gap-4 min-h-0 overflow-hidden pr-2"
              style={{ flex: columnWidths.left, minWidth: 320 }}
            >
              <div className="space-y-2">
                <Label htmlFor="profile-name">Name</Label>
                <Input
                  id="profile-name"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. order-service-csv"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-description">Description</Label>
                <Input
                  id="profile-description"
                  value={form.description || ""}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, description: e.target.value || null }))
                  }
                  placeholder="What does this profile parse?"
                />
              </div>

              <div className="flex flex-col min-h-0 flex-1 overflow-hidden rounded-lg border border-border-default bg-surface-card overflow-hidden">
                {configError ? (
                  <div className="px-3 py-1.5 bg-badge-caution-bg border-b border-badge-caution-bd text-xs text-badge-caution-fg shrink-0 flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {configError}
                  </div>
                ) : (
                  <div className="px-3 py-1.5 bg-accent-success-bg/60 border-b border-accent-success-bd text-xs text-accent-success-fg shrink-0 flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    Valid JSON
                  </div>
                )}
                <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm">Config JSON</span>
                  <div className="flex items-center gap-2">
                    <PanelControls
                      copyText={configJson}
                      pane="config"
                      copiedPane={copiedPane}
                      onCopy={handleCopy}
                      wrap={wrapJson}
                      onWrapChange={setWrapJson}
                    />
                  </div>
                </div>
                <Textarea
                  id="profile-config"
                  value={configJson}
                  onChange={(e) => handleConfigChange(e.target.value)}
                  className="flex-1 min-h-0 font-mono text-xs bg-surface-card border-0 rounded-none resize-none md:text-xs focus-visible:ring-0"
                  spellCheck={false}
                  style={{ whiteSpace: wrapJson ? "pre-wrap" : "pre", overflowWrap: wrapJson ? "break-word" : "normal" }}
                />
              </div>
            </div>

            <ResizeHandle
              direction="vertical"
              onMouseDown={handleResizeStart("col1")}
              onDoubleClick={() => handleResizeReset("col1")}
              title="Drag to resize profile data / build; double-click to reset this handle"
            />

            {/* Build pane: versions sidebar + tabbed config editor */}
            <div
              className="flex flex-col min-h-0 overflow-hidden"
              style={{ flex: columnWidths.middle, minWidth: 360 }}
            >
              <div className="flex-1 overflow-hidden flex min-h-0">
                {/* Config editor column: 3 tabs focused on each part of the parser config */}
                <div className="flex flex-col gap-2 min-h-0 overflow-hidden flex-1 min-w-0">
                  {/* Tab bar — mirrors the Document Details modal tab style */}
                  <div className="flex gap-1 rounded-lg bg-surface-card p-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfigTab("parser")}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        configTab === "parser"
                          ? "bg-surface-panel text-foreground-default"
                          : "text-foreground-subtle hover:text-foreground-faint"
                      }`}
                    >
                      Format &amp; Fields
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfigTab("sequences")}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        configTab === "sequences"
                          ? "bg-surface-panel text-foreground-default"
                          : "text-foreground-subtle hover:text-foreground-faint"
                      }`}
                    >
                      Sequence Configuration
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfigTab("fields")}
                      disabled={currentEngineModule() !== "plaintext"}
                      title={currentEngineModule() !== "plaintext" ? "Field extraction is only available for the Plaintext engine" : undefined}
                      className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        configTab === "fields"
                          ? "bg-surface-panel text-foreground-default"
                          : "text-foreground-subtle hover:text-foreground-faint"
                      } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-foreground-subtle`}
                    >
                      Plaintext Field Extraction
                    </button>
                  </div>

                  {/* Tab content */}
                  <div className="flex flex-col flex-1 rounded-lg border border-border-strong bg-surface-overlay p-3 overflow-hidden min-h-0">
                    {configTab === "parser" ? (
                      /* Format & Fields tab: format pane above the delimiter controls and field list */
                      <div className="flex flex-col gap-2 min-h-0 overflow-hidden h-full">
                        {/* Format pane — standard header like Discovery histogram / Sequence Preview */}
                        <div className="shrink-0 flex flex-col rounded-lg border border-border-default bg-surface-card overflow-hidden">
                          <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
                            <span className="font-medium text-sm">Format</span>
                          </div>
                          <div className="flex items-center gap-2 p-2 flex-wrap">
                            <select
                              id="engine-select"
                              value={currentEngineModule()}
                              onChange={(e) => handleEngineSelect(e.target.value)}
                              className="flex-1 min-w-[140px] h-8 rounded-md border border-border-default bg-surface-card px-2.5 text-sm text-foreground-muted outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle"
                              title="Parser engine — writes parser.module in the config JSON"
                            >
                              <option value="">Select engine…</option>
                              {engines.map((engine) => (
                                <option key={engine.module} value={engine.module}>
                                  {engine.name} ({engine.module})
                                </option>
                              ))}
                            </select>
                            {/* Delimited options are always visible for consistency, disabled unless the delimited engine is active */}
                            <Label htmlFor="delimited-delimiter" className="text-[11px]">Delimiter</Label>
                            <select
                              id="delimited-delimiter"
                              disabled={currentEngineModule() !== "delimited"}
                              value={(() => { const d = getParsedConfig()?.parser?.config?.input?.delimiter; return typeof d === "string" ? d : "\\t"; })()}
                              onChange={(e) => setInputField("delimiter", e.target.value || "\\t")}
                              className="h-8 rounded-md border border-border-default bg-surface-card px-2.5 text-xs font-mono text-foreground-muted outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <option value="\\t">Tab (\\t)</option>
                              <option value=",">Comma (,)</option>
                              <option value="|">Pipe (|)</option>
                              <option value=";">Semicolon (;)</option>
                            </select>
                            <Label htmlFor="delimited-has-header" className="text-[11px] cursor-pointer flex items-center gap-1.5">Header row
                              <Switch
                                id="delimited-has-header"
                                size="sm"
                                disabled={currentEngineModule() !== "delimited"}
                                checked={Boolean(getParsedConfig()?.parser?.config?.input?.hasHeader)}
                                onCheckedChange={(checked) => setInputField("hasHeader", checked)}
                              />
                            </Label>
                            <Label htmlFor="delimited-payload-stitching" className="text-[11px]">Payload stitching</Label>
                            <select
                              id="delimited-payload-stitching"
                              disabled={currentEngineModule() !== "delimited"}
                              value={(() => { const v = getParsedConfig()?.parser?.config?.records?.payloadStitching; return typeof v === "string" ? v : ""; })()}
                              onChange={(e) => setRecordsField("payloadStitching", e.target.value || null)}
                              className="h-8 rounded-md border border-border-default bg-surface-card px-2.5 text-xs text-foreground-muted outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle disabled:opacity-40 disabled:cursor-not-allowed"
                              title="Treat continuation lines as an XML/JSON payload appended to the last column"
                            >
                              <option value="">None</option>
                              <option value="xml">XML</option>
                              <option value="json">JSON</option>
                            </select>
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs"
                              onClick={handleAutoDetectRequested}
                              disabled={detecting || !sample.trim()}
                              title="Detect the parser format from the input sample and write the parser block into the config"
                            >
                              {detecting ? (
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                              ) : (
                                <Sparkles className="h-3 w-3 mr-1" />
                              )}
                              Auto-detect
                            </Button>
                          </div>
                          {currentEngineModule() === "delimited" && (() => {
                            const cols = outputSampleResult?.multiLineColumns ?? [];
                            const currentMulti = getParsedConfig()?.parser?.config?.records?.multilineColumn;
                            const stitching = getParsedConfig()?.parser?.config?.records?.payloadStitching;
                            if (cols.length === 0) return null;
                            return (
                              <div className="flex items-center gap-2 flex-wrap border-t border-border-default p-2">
                                <span className="text-[11px] text-badge-caution-fg">Multi-line columns detected:</span>
                                {cols.map((col) => (
                                  <button
                                    key={col}
                                    type="button"
                                    onClick={() => applyMultiLineColumn(col)}
                                    disabled={currentMulti === col || Boolean(stitching)}
                                    title={`Set records.multilineColumn to "${col}"`}
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.5 rounded border font-mono transition-colors",
                                      currentMulti === col
                                        ? "border-accent-success-bd bg-accent-success-bg/40 text-accent-success-fg"
                                        : "border-badge-caution-bd bg-badge-caution-bg/40 text-badge-caution-fg hover:bg-badge-caution-bg/70",
                                      (currentMulti === col || Boolean(stitching)) && "cursor-default"
                                    )}
                                  >
                                    {col}
                                  </button>
                                ))}
                                <span className="text-[11px] text-foreground-faint">or</span>
                                <button
                                  type="button"
                                  onClick={() => applyPayloadStitching("xml")}
                                  disabled={stitching === "xml" || Boolean(currentMulti)}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-border-default bg-surface-subtle text-foreground-muted hover:bg-surface-hover transition-colors disabled:cursor-default disabled:opacity-60"
                                  title="Stitch continuation lines into the last column as XML"
                                >
                                  stitch as XML
                                </button>
                                <button
                                  type="button"
                                  onClick={() => applyPayloadStitching("json")}
                                  disabled={stitching === "json" || Boolean(currentMulti)}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-border-default bg-surface-subtle text-foreground-muted hover:bg-surface-hover transition-colors disabled:cursor-default disabled:opacity-60"
                                  title="Stitch continuation lines into the last column as JSON"
                                >
                                  stitch as JSON
                                </button>
                              </div>
                            );
                          })()}
                        </div>
                        {/* Fields list — detected + added fields, under the
                            format controls (sequence part stays in Sequence Configuration tab) */}
                        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                          <FieldsPanel
                            variant="list"
                            result={sequencePreviewResult}
                            loading={sequencePreviewLoading}
                            onPreview={handlePreviewSequences}
                            onCopy={handleCopy}
                            copiedPane={copiedPane}
                            wrapMarkdown={wrapSequences}
                            setWrapMarkdown={setWrapSequences}
                            detectedFields={fieldExtractionDetected}
                            configFields={configFields}
                            fieldStats={outputSampleResult?.fieldStats ?? null}
                            sequenceProfile={parsedSequenceProfile}
                            onSequenceProfileChange={handleSequenceProfileChange}
                            onAddField={handleAddField}
                            onRemoveField={handleRemoveField}
                            onSetRegex={handleSetRegex}
                          />
                        </div>
                      </div>
                    ) : configTab === "fields" ? (
                      /* Field Extraction tab */
                      <div ref={bindFieldColumnRef} className="min-h-0 h-full">
                        <FieldExtractionPanel
                          result={fieldExtractionResult}
                          loading={fieldExtractionLoading}
                          onExtract={handleExtractFields}
                          detectedFields={fieldExtractionDetected}
                          fieldStats={outputSampleResult?.fieldStats ?? null}
                          deterministic={fieldExtractionDeterministic}
                          configFields={configFields}
                          detectedFieldRows={detectedFieldRows}
                          detectedFieldNames={fieldExtractionDetected}
                          onSetRegex={handleSetRegex}
                          onSetSource={handleSetSource}
                          histogram={histogramResult}
                          histogramLoading={histogramLoading}
                          onPreviewHistogram={handlePreviewHistogram}
                          nameMap={(() => { const p = parseConfig(configJson); return p.ok ? (p.value.fieldExtraction?.nameMap ?? []) : []; })()}
                          onAddNameMapGroup={handleAddNameMapGroup}
                          onRemoveNameMapValue={handleRemoveNameMapValue}
                          histogramKnobs={(() => { const p = parseConfig(configJson); return p.ok ? (p.value.fieldExtraction?.histogramKnobs ?? null) : null; })()}
                          fieldSplits={fieldSplits}
                          onResizeFieldRowsStart={handleResizeStart("fieldRows")}
                          onResizeFieldRowsReset={() => handleResizeReset("fieldRows")}
                        />
                      </div>
                    ) : (
                      /* Fields tab: field list + sequence settings and preview */
                      <div ref={bindSeqColumnRef} className="min-h-0 h-full">
                        <FieldsPanel
                          variant="full"
                          result={sequencePreviewResult}
                          loading={sequencePreviewLoading}
                          onPreview={handlePreviewSequences}
                          onCopy={handleCopy}
                          copiedPane={copiedPane}
                          wrapMarkdown={wrapSequences}
                          setWrapMarkdown={setWrapSequences}
                          detectedFields={fieldExtractionDetected}
                          configFields={configFields}
                          fieldStats={outputSampleResult?.fieldStats ?? null}
                          sequenceProfile={parsedSequenceProfile}
                          onSequenceProfileChange={handleSequenceProfileChange}
                          onAddField={handleAddField}
                          onRemoveField={handleRemoveField}
                          onSetRegex={handleSetRegex}
                          seqSplits={seqSplits}
                          onResizeSeqRowsStart={handleResizeStart("seqRows")}
                          onResizeSeqRowsReset={() => handleResizeReset("seqRows")}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Right column: Input Sample / Output Sample */}
            <ResizeHandle
              direction="vertical"
              onMouseDown={handleResizeStart("col2")}
              onDoubleClick={() => handleResizeReset("col2")}
              title="Drag to resize build / right column; double-click to reset this handle"
            />

            <div
              ref={bindRightColumnRef}
              className="flex flex-col gap-2 min-h-0 overflow-hidden"
              style={{ flex: columnWidths.right, minWidth: 220 }}
            >
              <div className="flex flex-col min-h-0 overflow-hidden rounded-lg border border-border-default bg-surface-card" style={{ flex: rightSplits.input }}>
                <div className="h-9 px-3 border-b border-border-default bg-accent-primary-bg text-accent-primary-fg flex items-center justify-between shrink-0">
                  <span className="font-medium text-sm">Input Sample</span>
                  <div className="flex items-center gap-2">
                    <PanelControls
                      copyText={sample}
                      pane="sample"
                      copiedPane={copiedPane}
                      onCopy={handleCopy}
                      wrap={wrapSample}
                      onWrapChange={setWrapSample}
                    />
                  </div>
                </div>
                <div className="flex gap-2 p-2 border-b border-border-default shrink-0">
                  {documents.filter((d) => d.source_type === "trace").length === 0 ? (
                    <div className="flex-1 h-8 rounded-lg border border-border-default bg-surface-inset px-3 flex items-center text-xs text-foreground-faint">
                      No trace documents found.
                    </div>
                  ) : (
                    <select
                      id="document-source"
                      value={selectedDocumentId?.toString() ?? ""}
                      onChange={(e) => handleDocumentSelect(e.target.value ? Number(e.target.value) : null)}
                      className="flex-1 h-8 rounded-md border border-border-default bg-surface-card px-2.5 text-sm text-foreground-muted outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle"
                    >
                      <option value="">Select document source</option>
                      {documents
                        .filter((doc) => doc.source_type === "trace")
                        .map((doc) => (
                          <option key={doc.id} value={doc.id.toString()}>
                            {doc.filename || doc.ext_id || `Document ${doc.id}`}
                          </option>
                        ))}
                    </select>
                  )}
                  <label
                    className={cn(
                      buttonVariants({ variant: "outline", size: "icon" }),
                      "shrink-0 cursor-pointer"
                    )}
                    title="Insert from file"
                  >
                    <Upload className="h-4 w-4" />
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleSampleUpload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <Textarea
                  id="sample-input"
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  placeholder="Paste a few representative lines from your trace/log file, or select/upload a sample above..."
                  className="flex-1 min-h-0 font-mono text-xs bg-surface-card border-0 rounded-none resize-none md:text-xs focus-visible:ring-0"
                  spellCheck={false}
                  style={{ whiteSpace: wrapSample ? "pre-wrap" : "pre", overflowWrap: wrapSample ? "break-word" : "normal" }}
                />
              </div>

              <ResizeHandle
                direction="horizontal"
                onMouseDown={handleResizeStart("row4")}
                onDoubleClick={() => handleResizeReset("row4")}
                title="Drag to resize input sample / output sample; double-click to reset this handle"
              />

              {/* Output Sample pane */}
              <div className="flex flex-col gap-2 min-h-0 overflow-hidden" style={{ flex: rightSplits.output }}>
                <OutputSamplePanel
                  result={outputSampleResult}
                  wrapOutput={wrapOutput}
                  setWrapOutput={setWrapOutput}
                  onCopy={handleCopy}
                  copiedPane={copiedPane}
                  loading={outputSampleLoading}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim() || configError !== null || Object.keys(form.config).length === 0}>
              {saving ? "Saving..." : editing ? "Save changes" : "Create profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingEngineChange != null}
        onOpenChange={(o) => { if (!o) setPendingEngineChange(null); }}
        title="Change parser engine?"
        description={`Switching from "${currentEngineModule()}" to "${pendingEngineChange ?? ''}" replaces the parser config and clears all detected fields, the histogram, and sample/sequence previews. Continue?`}
        confirmLabel="Change engine"
        onConfirm={handleEngineChangeConfirmed}
        variant="destructive"
      />
      <ConfirmDialog
        open={pendingAutoDetect}
        onOpenChange={(o) => { if (!o) setPendingAutoDetect(false); }}
        title="Run auto-detect?"
        description={`Auto-detect will replace the current "${currentEngineModule()}" parser config with the detected format and clear all detected fields, the histogram, and sample/sequence previews. Continue?`}
        confirmLabel="Run auto-detect"
        onConfirm={handleAutoDetectConfirmed}
        variant="destructive"
      />
    </>
  );
}
