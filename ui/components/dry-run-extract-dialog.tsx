"use client";

import { useState, useEffect, useMemo, useRef, useId } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Play,
  AlertCircle,
  X,
  FileText,
  ChevronDown,
  Calendar as CalendarIcon,
} from "lucide-react";
import { colorForType } from "@/components/research-canvas";
import {
  ServerBankSelectors,
  SelectorServer,
  SelectorBank,
} from "@/app/research/server-bank-selectors";
import { usePersistentServerBank } from "@/lib/use-persistent-server-bank";
import {
  serversApi,
  contextsApi,
  hindsightApi,
  entitiesApi,
  entityTypesApi,
} from "@/lib/api/client";
import { toast } from "sonner";
import { formatErrorValue } from "@/lib/error-format";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { parseISO, format, isValid } from "date-fns";
import type { Entity, EntityType, Server } from "@/lib/types";

interface MinimalContext {
  id: number;
  description: string;
}

interface DryRunExtractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContent?: string | null;
  initialContext?: string | null;
  initialTimestamp?: string | null;
  contexts?: MinimalContext[];
}

interface EntityLabel {
  key: string;
  tag: boolean;
  type: "multi-values";
  description: string;
  values: { value: string; description: string }[];
  optional: boolean;
}

interface Fact {
  text: string;
  fact_type: string;
  occurred_start: string | null;
  occurred_end: string | null;
  entities: string[];
}

export function DryRunExtractDialog({
  open,
  onOpenChange,
  initialContent = "",
  initialContext = "",
  initialTimestamp = "",
  contexts: propContexts = [],
}: DryRunExtractDialogProps) {
  const [servers, setServers] = useState<SelectorServer[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ facts: Fact[]; usage: any } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [contexts, setContexts] = useState<MinimalContext[]>(propContexts);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const contextComboRef = useRef<HTMLDivElement>(null);
  const contextTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [contextComboWidth, setContextComboWidth] = useState<
    number | undefined
  >(undefined);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const [content, setContent] = useState(initialContent || "");
  const [context, setContext] = useState(initialContext || "");
  const [timestamp, setTimestamp] = useState<string>(initialTimestamp || "");
  const [entityLabelSource, setEntityLabelSource] = useState<
    "bank" | "architxt"
  >("bank");
  const [entitiesAllowFreeForm, setEntitiesAllowFreeForm] = useState(false);
  const [entityFilter, setEntityFilter] = useState<
    "all" | "matched" | "unmatched"
  >("all");
  const [retainExtractionMode, setRetainExtractionMode] = useState<
    "bank" | "concise" | "verbose" | "verbatim"
  >("bank");
  const [bankLabels, setBankLabels] = useState<EntityLabel[]>([]);
  const [architxtLabels, setArchitxtLabels] = useState<EntityLabel[]>([]);
  const [loadingBankLabels, setLoadingBankLabels] = useState(false);
  const [selectedResultEntity, setSelectedResultEntity] = useState<
    string | null
  >(null);
  const [retainMission, setRetainMission] = useState("");
  const freeFormSwitchId = useId();

  useEffect(() => {
    if (open) {
      const newContent = initialContent || "";
      const newContext = initialContext || "";
      setContent(newContent);
      setContext(newContext);
      setTimestamp(initialTimestamp || "");
      setEntityLabelSource("bank");
      setEntitiesAllowFreeForm(false);
      setBankLabels([]);
      setRetainMission("");
      setResults(null);
      setError(null);
      setEntityFilter("all");
      loadServers();
      loadArchitxtLabels();
      if (propContexts.length === 0) {
        loadContexts();
      } else {
        setContexts(propContexts);
      }
    }
  }, [open, initialContent, initialContext, initialTimestamp, propContexts]);

  useEffect(() => {
    if (!open) return;
    const updateWidth = () => {
      if (contextTextareaRef.current) {
        setContextComboWidth(
          contextTextareaRef.current.getBoundingClientRect().width,
        );
      }
    };
    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [open]);

  useEffect(() => {
    if (!selectedServerId) {
      setBanks([]);
      return;
    }
    loadBanks(parseInt(selectedServerId, 10));
  }, [selectedServerId]);

  const loadServers = async () => {
    setLoadingServers(true);
    try {
      const data = await serversApi.list();
      const list = Array.isArray(data) ? data : [];
      setServers(
        list.map((s: Server) => ({
          id: s.id,
          name: s.name,
          base_url: s.base_url,
        })),
      );
    } catch (err) {
      toast.error("Failed to load servers");
    } finally {
      setLoadingServers(false);
    }
  };

  const loadContexts = async () => {
    try {
      const data = await contextsApi.list();
      setContexts(Array.isArray(data) ? data : []);
    } catch (err) {
      setContexts([]);
    }
  };

  const loadBanks = async (serverId: number) => {
    setLoadingBanks(true);
    setBanks([]);
    try {
      const data = await serversApi.listBanks(serverId);
      const list = Array.isArray(data) ? data : [];
      setBanks(
        list.map((b: SelectorBank) => ({ bank_id: b.bank_id, name: b.name })),
      );
    } catch (err) {
      toast.error("Failed to load banks");
    } finally {
      setLoadingBanks(false);
    }
  };

  const loadBankLabels = async (serverId: number, bankId: string) => {
    setLoadingBankLabels(true);
    try {
      const data = await hindsightApi.getBankConfig(serverId, bankId);
      const rawLabels = data?.config?.entity_labels || [];
      const labels = Array.isArray(rawLabels)
        ? rawLabels
            .filter((l: any) => l.type === "multi-values")
            .map((l: any) => ({
              key: l.key || "",
              tag: !!l.tag,
              type: "multi-values" as const,
              description: l.description || l.key || "",
              values: Array.isArray(l.values)
                ? l.values.map((v: any) => ({
                    value: String(v.value ?? ""),
                    description: String(v.description ?? ""),
                  }))
                : [],
              optional: l.optional !== false,
            }))
        : [];
      setBankLabels(labels);
      setRetainMission(data?.config?.retain_mission || "");
    } catch (err) {
      setBankLabels([]);
      setRetainMission("");
    } finally {
      setLoadingBankLabels(false);
    }
  };

  const loadArchitxtLabels = async () => {
    try {
      const [entitiesData, typesData] = await Promise.all([
        entitiesApi.list(),
        entityTypesApi.list(),
      ]);
      const entities = Array.isArray(entitiesData) ? entitiesData : [];
      const types = Array.isArray(typesData) ? typesData : [];
      const typeMap = new Map<number, EntityType>();
      for (const t of types) typeMap.set(t.id, t);

      const byType = new Map<
        string,
        { description: string; entries: { id: string; name: string }[] }
      >();
      for (const e of entities) {
        const typeName = e.type_name;
        const type = typeMap.get(e.type_id);
        if (!byType.has(typeName)) {
          byType.set(typeName, {
            description: type?.description || typeName,
            entries: [],
          });
        }
        byType.get(typeName)!.entries.push({ id: e.entity_id, name: e.name });
      }

      const labels: EntityLabel[] = [];
      for (const [typeName, data] of byType) {
        labels.push({
          key: typeName,
          tag: true,
          type: "multi-values",
          description: data.description || typeName,
          values: data.entries.map((e) => ({
            value: e.id,
            description: e.name || "",
          })),
          optional: true,
        });
      }
      setArchitxtLabels(labels);
    } catch (err) {
      setArchitxtLabels([]);
    }
  };

  useEffect(() => {
    if (!open || !selectedServerId || !selectedBankId) {
      setBankLabels([]);
      return;
    }
    loadBankLabels(parseInt(selectedServerId, 10), selectedBankId);
  }, [open, selectedServerId, selectedBankId]);

  const handleRun = async () => {
    if (!selectedServerId || !selectedBankId) {
      toast.error("Select a server and bank first");
      return;
    }
    if (!content.trim()) {
      toast.error("Content is required for dry-run extraction");
      return;
    }

    setRunning(true);
    setResults(null);
    setError(null);
    setSelectedResultEntity(null);

    try {
      const body: any = { content: content.trim() };
      if (context.trim()) body.context = context.trim();
      if (timestamp.trim()) body.timestamp = timestamp.trim();
      if (entityLabelSource === "bank" && bankLabels.length > 0) {
        body.entity_labels = bankLabels;
      } else if (
        entityLabelSource === "architxt" &&
        architxtLabels.length > 0
      ) {
        body.entity_labels = architxtLabels;
      }
      body.entities_allow_free_form = entitiesAllowFreeForm;
      if (retainExtractionMode !== "bank") {
        body.retain_extraction_mode = retainExtractionMode;
      }

      const result = await hindsightApi.dryRunExtract(
        parseInt(selectedServerId, 10),
        selectedBankId,
        body,
      );
      setResults(result);
      toast.success(
        `Dry-run complete — ${result.facts?.length ?? 0} facts, ${result.usage?.total_tokens ?? 0} tokens`,
      );
    } catch (err) {
      const message = formatErrorValue(err);
      setError(message);
      toast.error(`Dry-run failed: ${message}`);
    } finally {
      setRunning(false);
    }
  };

  const requestClose = () => {
    if (running) {
      setConfirmCloseOpen(true);
    } else {
      onOpenChange(false);
    }
  };

  const canRun =
    !!selectedServerId && !!selectedBankId && content.trim().length > 0;

  const contextOptions = useMemo(() => {
    return contexts.filter((c) => c.description && c.description.trim());
  }, [contexts]);

  const activeEntityLabels =
    entityLabelSource === "bank"
      ? bankLabels
      : entityLabelSource === "architxt"
        ? architxtLabels
        : [];
  const configuredEntitySet = useMemo(() => {
    const set = new Set<string>();
    for (const label of activeEntityLabels) {
      set.add(label.key);
      for (const v of label.values) {
        set.add(v.description);
        set.add(v.value);
      }
    }
    return set;
  }, [activeEntityLabels]);

  const resolveEntity = (
    raw: string,
  ): {
    raw: string;
    label: string;
    type: string | null;
    id: string;
    configured: boolean;
  } => {
    // If the string already has a type:entity_id form, parse it.
    const colonIdx = raw.indexOf(":");
    const hasTypePrefix = colonIdx > 0 && colonIdx < raw.length - 1;
    const prefixType = hasTypePrefix ? raw.slice(0, colonIdx) : null;
    const rest = hasTypePrefix ? raw.slice(colonIdx + 1) : raw;

    // Try to resolve against the active configured labels.
    for (const label of activeEntityLabels) {
      for (const v of label.values) {
        if (v.value === raw || v.description === raw || v.value === rest) {
          const id = v.value;
          const type = label.key;
          return {
            raw,
            label: v.description || v.value,
            type,
            id: id.startsWith(`${type}:`) ? id.slice(type.length + 1) : id,
            configured: true,
          };
        }
      }
    }

    // No configured label match — fall back to whatever we can infer from the raw string.
    if (prefixType) {
      return {
        raw,
        label: raw,
        type: prefixType,
        id: rest,
        configured: false,
      };
    }
    return { raw, label: raw, type: null, id: raw, configured: false };
  };

  const resultEntities = useMemo(() => {
    if (!results?.facts) return [];
    const map = new Map<
      string,
      {
        raw: string;
        label: string;
        type: string | null;
        id: string;
        configured: boolean;
        factCount: number;
      }
    >();
    for (const fact of results.facts) {
      for (const entity of fact.entities ?? []) {
        const existing = map.get(entity);
        if (existing) {
          existing.factCount += 1;
        } else {
          const resolved = resolveEntity(entity);
          map.set(entity, { ...resolved, factCount: 1 });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [results, activeEntityLabels]);

  const filteredResultEntities = useMemo(() => {
    if (entityFilter === "all") return resultEntities;
    if (entityFilter === "matched")
      return resultEntities.filter((e) => e.configured);
    return resultEntities.filter((e) => !e.configured);
  }, [resultEntities, entityFilter]);

  const matchedCount = useMemo(
    () => resultEntities.filter((e) => e.configured).length,
    [resultEntities],
  );
  const unmatchedCount = useMemo(
    () => resultEntities.filter((e) => !e.configured).length,
    [resultEntities],
  );

  const filteredFacts = useMemo(() => {
    if (!results?.facts) return [];
    if (!selectedResultEntity) return results.facts;
    return results.facts.filter((fact) =>
      (fact.entities ?? []).includes(selectedResultEntity),
    );
  }, [results, selectedResultEntity]);

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className="!w-[85vw] !max-w-none h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold text-white">
              Dry-Run Extraction
            </DialogTitle>
          </DialogHeader>

        <div className="flex flex-col gap-4 overflow-hidden flex-1 min-h-0">
          {/* Controls */}
          <div className="flex flex-col gap-2 shrink-0">
            {/* Hindsight server / bank selectors */}
            <div className="shrink-0">
              <ServerBankSelectors
                servers={servers}
                selectedServerId={selectedServerId}
                setSelectedServerId={setSelectedServerId}
                banks={banks}
                selectedBankId={selectedBankId}
                setSelectedBankId={setSelectedBankId}
                loadingBanks={loadingBanks}
                disabled={running}
              />
            </div>

            {/* Options area */}
            <div className="flex gap-3 h-48 overflow-hidden">
              {/* Left: Context */}
              <div className="flex flex-col gap-1.5 h-full w-[28%]">
                {/* Editable context combo */}
                <div className="flex flex-col gap-1.5 h-full">
                  <Label
                    htmlFor="dryrun-context"
                    className="text-xs uppercase text-white/50 font-medium shrink-0"
                  >
                    Context
                  </Label>
                  <div
                    className="relative flex-1 min-h-0 flex gap-1.5 items-start"
                    ref={contextComboRef}
                  >
                    <textarea
                      id="dryrun-context"
                      ref={contextTextareaRef}
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      placeholder="Optional context string"
                      className="flex-1 min-h-0 h-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 resize-none custom-scrollbar"
                    />
                    <Popover
                      open={contextPickerOpen}
                      onOpenChange={setContextPickerOpen}
                    >
                      <PopoverTrigger
                        className={`group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 h-full w-8 focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:border-transparent outline-none ${contextPickerOpen ? "bg-white/10" : ""}`}
                        aria-label="Pick a stored context"
                        title="Pick a stored context"
                      >
                        <ChevronDown
                          className={`h-4 w-4 text-white/70 transition-transform ${contextPickerOpen ? "rotate-180" : ""}`}
                        />
                      </PopoverTrigger>
                      {contextOptions.length > 0 && (
                        <PopoverContent
                          align="start"
                          side="bottom"
                          sideOffset={4}
                          anchor={contextComboRef}
                          className="max-h-60 overflow-y-auto custom-scrollbar rounded-lg border border-white/10 bg-[oklch(0.21_0_0)] p-1 shadow-md"
                          style={{ width: contextComboWidth }}
                        >
                          {contextOptions.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setContext(c.description);
                                setContextPickerOpen(false);
                              }}
                              className="w-full text-left px-3 py-2 text-sm text-white/80 rounded hover:bg-white/10 focus:bg-white/10 focus:outline-none truncate"
                              title={c.description}
                            >
                              {c.description}
                            </button>
                          ))}
                        </PopoverContent>
                      )}
                    </Popover>
                  </div>
                </div>
              </div>

              {/* Middle: Retain Mission + Entity Labels */}
              <div className="flex flex-row gap-[18px] flex-1 min-h-0 overflow-hidden">
                <div className="flex flex-col gap-1.5 w-[70%] min-h-0">
                  <span className="text-xs uppercase text-white/50 font-medium shrink-0">
                    Retain Mission
                  </span>
                  <textarea
                    value={retainMission}
                    onChange={(e) => setRetainMission(e.target.value)}
                    placeholder="No retain mission set for this bank."
                    className="flex-1 min-h-0 h-full w-full rounded-lg border border-white/10 bg-transparent px-3 py-2 text-sm text-white placeholder:text-white/40 resize-none custom-scrollbar focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30"
                  />
                </div>

                <div className="flex flex-col gap-1.5 flex-1 min-h-0">
                  <span className="block text-xs uppercase text-white/50 font-medium">
                    Entity Labels
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex rounded-lg border border-white/10 p-0.5 bg-white/5">
                      {(["bank", "architxt"] as const).map((source) => {
                        const labels =
                          source === "bank"
                            ? bankLabels
                            : source === "architxt"
                              ? architxtLabels
                              : [];
                        const isActive = entityLabelSource === source;
                        const keys = labels.length;
                        const values = labels.reduce(
                          (sum, l) => sum + l.values.length,
                          0,
                        );
                        return (
                          <button
                            key={source}
                            type="button"
                            onClick={() => setEntityLabelSource(source)}
                            disabled={keys === 0}
                            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                              isActive
                                ? "bg-emerald-600 text-white"
                                : "text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/60"
                            }`}
                          >
                            {source === "bank" &&
                              (keys > 0
                                ? `Bank (${keys} keys, ${values} values)`
                                : "Bank")}
                            {source === "architxt" &&
                              (keys > 0
                                ? `Architxt (${keys} keys, ${values} values)`
                                : "Architxt")}
                          </button>
                        );
                      })}
                    </div>
                    {loadingBankLabels && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />
                    )}
                  </div>
                  <label
                    htmlFor={freeFormSwitchId}
                    className="flex items-center gap-2 text-xs text-white/70 cursor-pointer select-none"
                  >
                    <Switch
                      id={freeFormSwitchId}
                      checked={entitiesAllowFreeForm}
                      onCheckedChange={setEntitiesAllowFreeForm}
                      aria-label="Allow free-form entities"
                    />
                    Allow free-form entities
                  </label>
                </div>
              </div>

              {/* Right: Extraction Mode + Document Date */}
              <div className="flex flex-col gap-2 w-56 shrink-0 min-h-0 overflow-hidden">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-white/50 font-medium">
                    Extraction Mode
                  </Label>
                  <select
                    value={retainExtractionMode}
                    onChange={(e) =>
                      setRetainExtractionMode(
                        e.target.value as typeof retainExtractionMode,
                      )
                    }
                    className="w-full h-10 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
                  >
                    <option value="bank">Bank (use bank value)</option>
                    <option value="concise">concise</option>
                    <option value="verbose">verbose</option>
                    <option value="verbatim">verbatim</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-white/50 font-medium">
                    Document Date
                  </Label>
                  <Popover>
                    <PopoverTrigger>
                      <div
                        className={cn(
                          "w-full justify-start text-left font-normal cursor-pointer inline-flex items-center rounded-lg border border-white/20 bg-transparent px-3 py-2 text-white hover:bg-white/5 transition-colors text-sm",
                          !timestamp && "text-white/40",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-white/50 shrink-0" />
                        {timestamp ? (
                          <span className="text-white">
                            {(() => {
                              try {
                                const d = parseISO(timestamp);
                                if (isNaN(d.getTime()))
                                  throw new Error("invalid");
                                return format(d, "dd/MM/yyyy HH:mm:ss");
                              } catch {
                                return timestamp;
                              }
                            })()}
                          </span>
                        ) : (
                          <span>dd/mm/yyyy hh:mm</span>
                        )}
                      </div>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-[oklch(0.20_0_0)] border-white/20">
                      <div className="p-3">
                        <Calendar
                          mode="single"
                          selected={(() => {
                            try {
                              const d = parseISO(timestamp);
                              return isNaN(d.getTime()) ? undefined : d;
                            } catch {
                              return undefined;
                            }
                          })()}
                          onSelect={(date) => {
                            if (date) {
                              const current = (() => {
                                try {
                                  const d = parseISO(timestamp);
                                  return isNaN(d.getTime()) ? undefined : d;
                                } catch {
                                  return undefined;
                                }
                              })();
                              const result = new Date(date);
                              if (current) {
                                result.setHours(
                                  current.getHours(),
                                  current.getMinutes(),
                                  current.getSeconds(),
                                  0,
                                );
                              }
                              setTimestamp(result.toISOString());
                            }
                          }}
                          className="text-white"
                        />
                        {/* Time inputs */}
                        <div className="flex items-center gap-2 px-2 pt-2 border-t border-white/10">
                          <div className="flex items-center gap-1.5">
                            <label className="text-[11px] text-white/40 uppercase">
                              Time
                            </label>
                            <input
                              type="text"
                              pattern="[0-9]{2}:[0-9]{2}:[0-9]{2}"
                              placeholder="HH:MM:SS"
                              value={(() => {
                                try {
                                  const d = parseISO(timestamp);
                                  return isNaN(d.getTime())
                                    ? ""
                                    : format(d, "HH:mm:ss");
                                } catch {
                                  return "";
                                }
                              })()}
                              onChange={(e) => {
                                const [hours, minutes, seconds] = e.target.value
                                  .split(":")
                                  .map(Number);
                                const base = (() => {
                                  try {
                                    const d = parseISO(timestamp);
                                    return isNaN(d.getTime()) ? new Date() : d;
                                  } catch {
                                    return new Date();
                                  }
                                })();
                                base.setHours(
                                  hours || 0,
                                  minutes || 0,
                                  seconds || 0,
                                  0,
                                );
                                setTimestamp(base.toISOString());
                              }}
                              className="bg-[oklch(0.18_0_0)] border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500/50 w-[90px]"
                            />
                          </div>
                          <div className="flex items-center gap-1 ml-auto">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-400 hover:text-blue-300 hover:bg-transparent"
                              onClick={() => setTimestamp("")}
                            >
                              Clear
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-blue-400 hover:text-blue-300 hover:bg-transparent"
                              onClick={() =>
                                setTimestamp(new Date().toISOString())
                              }
                            >
                              Now
                            </Button>
                          </div>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 shrink-0" />

          {/* Lower grid: Extracted Facts + Mission/Content */}
          <div className="grid grid-cols-2 gap-6 overflow-hidden flex-1 min-h-0">
            {/* Left — Extracted Facts */}
            <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
              <div className="flex items-center gap-2 text-sm text-white/70 shrink-0">
                Extracted Facts
              </div>

              {error && (
                <div className="p-3 rounded bg-red-900/20 border border-red-500/30 text-red-300 text-sm flex items-start gap-2 shrink-0">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              {!results && !error && !running && (
                <div className="flex-1 flex items-center justify-center text-white/30 text-sm">
                  Click Run Dry-Run to preview extraction results.
                </div>
              )}

              {running && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-white/40">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-sm">Calling Hindsight...</span>
                </div>
              )}

              {results && (
                <div className="flex-1 flex flex-col gap-3 overflow-hidden">
                  <div className="flex items-center gap-3 text-xs text-white/50 shrink-0">
                    <span className="bg-white/5 px-2 py-1 rounded">
                      {results.facts?.length ?? 0} facts
                    </span>
                    {results.usage && (
                      <span className="bg-white/5 px-2 py-1 rounded">
                        {results.usage.total_tokens ?? 0} tokens
                      </span>
                    )}
                  </div>

                  <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0">
                    {/* Left — Detected Entities */}
                    <div className="flex flex-col min-h-0 rounded-md border border-white/10 bg-[oklch(0.21_0_0)] overflow-hidden">
                      <div className="flex items-center justify-between px-2.5 py-2 border-b border-white/10 bg-emerald-950/30 shrink-0">
                        <span className="text-[11px] font-medium text-emerald-400">
                          ENTITIES
                        </span>
                        <div className="flex items-center gap-1.5">
                          {(
                            [
                              {
                                key: "all",
                                label: "All",
                                count: resultEntities.length,
                              },
                              {
                                key: "matched",
                                label: "Matched",
                                count: matchedCount,
                              },
                              {
                                key: "unmatched",
                                label: "Unmatched",
                                count: unmatchedCount,
                              },
                            ] as const
                          ).map((b) => {
                            const isActive = entityFilter === b.key;
                            return (
                              <button
                                key={b.key}
                                type="button"
                                onClick={() => setEntityFilter(b.key)}
                                className={cn(
                                  "px-2 py-1 text-[10px] rounded transition-colors border",
                                  isActive
                                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300"
                                    : "border-white/10 text-white/50 hover:text-white/80 hover:bg-white/5",
                                )}
                              >
                                {b.label} ({b.count})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
                        {filteredResultEntities.length === 0 ? (
                          <div className="text-white/30 text-xs px-1.5 py-2">
                            No entities found.
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setSelectedResultEntity(null)}
                              className={cn(
                                "w-full text-left px-2 py-1.5 rounded text-xs transition-colors",
                                selectedResultEntity === null
                                  ? "bg-emerald-600/20 text-emerald-300"
                                  : "text-white/70 hover:bg-white/10",
                              )}
                            >
                              All facts
                            </button>
                            {filteredResultEntities.map(
                              ({
                                raw,
                                label,
                                type,
                                id,
                                configured,
                                factCount,
                              }) => {
                                const typeColor = type
                                  ? colorForType(type)
                                  : colorForType("found");
                                const qualifiedId =
                                  type && !id.startsWith(`${type}:`)
                                    ? `${type}:${id}`
                                    : id;
                                return (
                                  <button
                                    key={raw}
                                    type="button"
                                    onClick={() => setSelectedResultEntity(raw)}
                                    className={cn(
                                      "w-full flex items-center gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors",
                                      selectedResultEntity === raw
                                        ? "bg-emerald-900/20 border-emerald-500/30"
                                        : "border-white/5 bg-black/20 hover:bg-white/5",
                                    )}
                                    style={{
                                      borderLeftColor: typeColor,
                                      borderLeftWidth: 3,
                                    }}
                                  >
                                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                                      <div
                                        className={cn(
                                          "text-xs truncate capitalize",
                                          selectedResultEntity === raw
                                            ? "text-emerald-200"
                                            : "text-white/90",
                                        )}
                                        title={label}
                                      >
                                        {label}
                                      </div>
                                      {type && (
                                        <div
                                          className="text-[10px] text-white/50 font-mono truncate"
                                          title={qualifiedId}
                                        >
                                          {qualifiedId}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                      {configured && (
                                        <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                                          label
                                        </span>
                                      )}
                                      <span className="text-[10px] text-white/40 font-mono">
                                        {factCount}
                                      </span>
                                    </div>
                                  </button>
                                );
                              },
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Right — Fact Cards */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 min-h-0">
                      {filteredFacts.length === 0 ? (
                        <div className="text-white/30 text-sm">
                          No facts for this selection.
                        </div>
                      ) : (
                        filteredFacts.map((fact, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-md border border-white/10 bg-[oklch(0.23_0_0)]"
                          >
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] uppercase font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                                {fact.fact_type || "fact"}
                              </span>
                              {fact.occurred_start && (
                                <span className="text-[10px] text-white/40">
                                  {fact.occurred_start}
                                  {fact.occurred_end &&
                                  fact.occurred_end !== fact.occurred_start
                                    ? ` → ${fact.occurred_end}`
                                    : ""}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-white/80 mb-2">
                              {fact.text}
                            </p>
                            {(fact.entities ?? []).length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {fact.entities.map((entity, eIdx) => (
                                  <span
                                    key={eIdx}
                                    className={cn(
                                      "text-[10px] px-1.5 py-0.5 rounded bg-white/5",
                                      selectedResultEntity &&
                                        entity === selectedResultEntity
                                        ? "bg-emerald-500/20 text-emerald-300"
                                        : "text-white/50",
                                    )}
                                  >
                                    {entity}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right — Content */}
            <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
              {/* Content */}
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase text-white/50 font-medium">
                  Content
                </span>
                <span className="text-[10px] text-white/30">
                  {content.length} chars
                </span>
              </div>

              <div className="flex flex-col flex-1 rounded-lg border border-white/20 bg-[oklch(0.18_0_0)] overflow-hidden">
                {content ? (
                  <>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 flex-shrink-0">
                      <span className="text-[10px] text-white/40 font-sans">
                        Document content
                      </span>
                    </div>
                    <textarea
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                      className="flex-1 p-3 bg-transparent text-white/80 font-mono text-[13px] leading-relaxed resize-none outline-none custom-scrollbar"
                      placeholder="Paste or type the content to preview extraction against..."
                      spellCheck={false}
                    />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-white/40">
                    <FileText className="h-8 w-8 mb-2 opacity-50" />
                    <p className="text-sm">No content available</p>
                    <p className="text-xs mt-1">
                      Content appears after extraction
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-white/10 shrink-0">
          <Button
            variant="ghost"
            onClick={requestClose}
            className="text-white/70 hover:text-white hover:bg-white/5 flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            Close
          </Button>
          <Button
            onClick={handleRun}
            disabled={running || !canRun}
            className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 flex items-center gap-2"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {running ? "Running..." : "Run Dry-Run"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

      <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <DialogContent className="!w-auto max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-white">
              Close while running?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/70">
            A dry-run is currently in progress. Closing will not cancel the
            Hindsight request, but you will lose the in-progress results preview.
          </p>
          <div className="flex justify-end gap-3 mt-4">
            <Button
              variant="ghost"
              onClick={() => setConfirmCloseOpen(false)}
              className="text-white/70 hover:text-white hover:bg-white/5"
            >
              Keep running
            </Button>
            <Button
              onClick={() => {
                setConfirmCloseOpen(false);
                onOpenChange(false);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Close anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}