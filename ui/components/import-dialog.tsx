'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, AlertTriangle, CheckCircle2, Download, FileUp, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { parseCsv, stripQuotes } from '@/lib/csv-parser';

export interface ImportItem {
  valid: boolean;
  error?: string;
  raw: string;
  data: Record<string, any>;
}

export type ImportParser = (input: string) => ImportItem[];

export interface ImportResult {
  item: ImportItem;
  success: boolean;
  error?: string;
}

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  parser: ImportParser;
  onImport: (item: ImportItem) => Promise<void>;
  onDone?: (results: ImportResult[]) => void;
  columns: { key: string; label: string; width?: string }[];
}

export function ImportDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  parser,
  onImport,
  onDone,
  columns,
}: ImportDialogProps) {
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ImportItem[]>([]);
  const [phase, setPhase] = useState<'input' | 'preview' | 'running' | 'done'>('input');
  const [progress, setProgress] = useState({ current: 0, total: 0, succeeded: 0, failed: 0 });
  const [results, setResults] = useState<ImportResult[]>([]);

  /* ── Reset on open ─────────────────────── */
  useEffect(() => {
    if (open) {
      setRaw('');
      setParsed([]);
      setPhase('input');
      setProgress({ current: 0, total: 0, succeeded: 0, failed: 0 });
      setResults([]);
    }
  }, [open]);

  /* ── Live parse ────────────────────────── */
  useEffect(() => {
    if (!raw.trim()) {
      setParsed([]);
      return;
    }
    try {
      setParsed(parser(raw));
    } catch {
      setParsed([]);
    }
  }, [raw, parser]);

  const validItems = parsed.filter((p) => p.valid);
  const invalidItems = parsed.filter((p) => !p.valid);

  /* ── Run import with progress ──────────── */
  const handleRun = useCallback(async () => {
    if (validItems.length === 0) return;
    setPhase('running');
    setProgress({ current: 0, total: validItems.length, succeeded: 0, failed: 0 });
    setResults([]);

    const all: ImportResult[] = [];

    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      try {
        await onImport(item);
        all.push({ item, success: true });
        setProgress((prev) => ({
          ...prev,
          current: i + 1,
          succeeded: prev.succeeded + 1,
        }));
      } catch (err: any) {
        const msg = err?.message || String(err) || 'Failed';
        all.push({ item, success: false, error: msg });
        setProgress((prev) => ({
          ...prev,
          current: i + 1,
          failed: prev.failed + 1,
        }));
        // Toast each failure immediately so the user sees what's happening
        toast.error(`Import failed: ${msg}`);
      }
    }

    setResults(all);
    setPhase('done');
    onDone?.(all);

    const { succeeded, failed } = all.reduce(
      (acc, r) => {
        if (r.success) acc.succeeded++;
        else acc.failed++;
        return acc;
      },
      { succeeded: 0, failed: 0 }
    );

    if (failed === 0) {
      toast.success(`${succeeded} items imported successfully`);
    } else if (succeeded === 0) {
      toast.error(`All ${failed} items failed to import`);
    } else {
      toast.warning(`${succeeded} imported, ${failed} failed`);
    }
  }, [validItems, onImport, onDone]);

  /* ── Dismiss guard ─────────────────────── */
  const handleOpenChange = (v: boolean) => {
    if (!v && phase === 'running') return;
    if (!v) onOpenChange(false);
  };

  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const doneSuccess = phase === 'done' && progress.failed === 0;
  const doneMixed = phase === 'done' && progress.failed > 0 && progress.succeeded > 0;
  const doneFailed = phase === 'done' && progress.succeeded === 0 && progress.failed > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* ── Header ───────────────────────── */}
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl font-semibold text-white flex items-center gap-2">
            <Download className="h-5 w-5 text-emerald-400" />
            {title}
          </DialogTitle>
          {description && (
            <p className="text-sm text-white/60 mt-1">{description}</p>
          )}
        </DialogHeader>

        {/* ── Body ─────────────────────────── */}
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">

          {/* Input / textarea — visible in input + preview phases */}
          {(phase === 'input' || phase === 'preview') && (
            <div className="shrink-0 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase text-white/50 font-medium">
                  Paste CSV or Drop File
                </Label>
                <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                  <FileUp className="h-3.5 w-3.5" />
                  <span>Upload file</span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => setRaw(String(ev.target?.result || ''));
                      reader.readAsText(file);
                    }}
                  />
                </label>
              </div>
              <Textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={placeholder}
                className="h-[160px] !rounded-lg !border !border-white/20 !bg-transparent !text-white !placeholder:text-white/40 focus:!border-emerald-400 focus:!ring-2 font-mono text-xs overflow-auto leading-relaxed resize-none"
                style={{
                  '--tw-ring-color': 'rgb(52, 211, 153)',
                  '--tw-ring-opacity': '0.4',
                } as React.CSSProperties}
              />
            </div>
          )}

          {/* Parse status */}
          {(phase === 'input' || phase === 'preview') && parsed.length > 0 && (
            <div className="shrink-0 flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="font-medium">{validItems.length} valid</span>
              </div>
              {invalidItems.length > 0 && (
                <div className="flex items-center gap-1.5 text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span className="font-medium">{invalidItems.length} invalid</span>
                </div>
              )}
            </div>
          )}

          {/* Error band */}
          {(phase === 'input' || phase === 'preview') && invalidItems.length > 0 && (
            <div className="shrink-0 max-h-[100px] overflow-y-auto rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 space-y-1.5">
              {invalidItems.slice(0, 10).map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-300">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span className="break-all">
                    <span className="font-mono text-white/60">{item.raw}</span>
                    {item.error && <span className="ml-1">— {item.error}</span>}
                  </span>
                </div>
              ))}
              {invalidItems.length > 10 && (
                <p className="text-xs text-white/40">+ {invalidItems.length - 10} more errors</p>
              )}
            </div>
          )}

          {/* Preview table */}
          {(phase === 'preview' || phase === 'running') && validItems.length > 0 && (
            <div className="flex-1 min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col">
              <div className="px-3 py-1.5 bg-emerald-900/20 border-b border-emerald-500/30 shrink-0">
                <span className="text-xs font-medium text-emerald-400">
                  {phase === 'running'
                    ? `Importing ${progress.current} of ${progress.total}…`
                    : `Preview — ${validItems.length} items to import`}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full table-fixed">
                  <thead className="sticky top-0 bg-[oklch(0.23_0_0)] z-10">
                    <tr className="border-b border-white/10">
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          className="text-[10px] uppercase text-white/50 font-medium py-1.5 px-3 text-left"
                          style={{ width: col.width }}
                        >
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validItems.slice(0, 50).map((item, idx) => (
                      <tr key={idx} className="border-b border-white/5">
                        {columns.map((col) => (
                          <td
                            key={col.key}
                            className="py-1 px-3 text-xs text-white/70 truncate"
                            style={{ maxWidth: col.width || '160px' }}
                            title={item.data[col.key] !== undefined ? String(item.data[col.key]) : ''}
                          >
                            {item.data[col.key] !== undefined ? String(item.data[col.key]) : (
                              <span className="text-white/20">-</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {validItems.length > 50 && (
                      <tr>
                        <td colSpan={columns.length} className="py-2 px-3 text-xs text-white/40 text-center">
                          + {validItems.length - 50} more items
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Running progress bar */}
          {phase === 'running' && (
            <div className="shrink-0 space-y-1.5">
              <div className="flex justify-between text-xs text-white/60">
                <span>Processing {progress.current} of {progress.total}…</span>
                <span className="font-mono">{progress.current}/{progress.total}</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 bg-emerald-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span className="font-medium">{progress.succeeded} succeeded</span>
                </div>
                {progress.failed > 0 && (
                  <div className="flex items-center gap-1.5 text-red-400">
                    <XCircle className="h-3.5 w-3.5" />
                    <span className="font-medium">{progress.failed} failed</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Done summary */}
          {phase === 'done' && (
            <div className="shrink-0 space-y-3">
              {/* Status header */}
              <div className="flex items-center gap-3">
                {doneSuccess ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-900/30">
                    <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                  </div>
                ) : doneFailed ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-900/30">
                    <XCircle className="h-5 w-5 text-red-400" />
                  </div>
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-900/30">
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-white">
                    {doneSuccess
                      ? 'Import Complete'
                      : doneFailed
                        ? 'Import Failed'
                        : 'Import Partial'}
                  </p>
                  <p className="text-xs text-white/60">
                    {progress.succeeded} succeeded · {progress.failed} failed · {progress.total} total
                  </p>
                </div>
              </div>

              {/* Failure list */}
              {results.some((r) => !r.success) && (
                <div className="max-h-[140px] overflow-y-auto rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 space-y-1.5">
                  {results
                    .filter((r) => !r.success)
                    .map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-red-300">
                        <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span className="break-all">
                          <span className="font-mono text-white/60">
                            {columns[0] && r.item.data[columns[0].key] !== undefined
                              ? String(r.item.data[columns[0].key])
                              : r.item.raw}
                          </span>
                          {r.error && <span className="ml-1">— {r.error}</span>}
                        </span>
                      </div>
                    ))}
                </div>
              )}
              {/* Original CSV — copyable for fixing */}
              <div className="rounded-lg border border-white/10 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/10">
                  <span className="text-[10px] uppercase text-white/50 font-medium">Original CSV</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(raw);
                      toast.success('CSV copied to clipboard');
                    }}
                    className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    Copy
                  </button>
                </div>
                <pre className="max-h-[160px] overflow-auto p-3 text-[10px] font-mono text-white/60 whitespace-pre-wrap leading-relaxed">{raw}</pre>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer buttons ───────────────── */}
        <div className="shrink-0 flex justify-end gap-3 pt-4 border-t border-white/10">
          {phase === 'input' && (
            <>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-white/70 hover:text-white hover:bg-white/5"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  if (validItems.length === 0) {
                    toast.error('No valid items to import.');
                    return;
                  }
                  setPhase('preview');
                }}
                disabled={validItems.length === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                Preview Import
              </Button>
            </>
          )}

          {phase === 'preview' && (
            <>
              <Button
                variant="ghost"
                onClick={() => setPhase('input')}
                className="text-white/70 hover:text-white hover:bg-white/5"
              >
                Back
              </Button>
              <Button
                onClick={handleRun}
                disabled={validItems.length === 0}
                className="bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                Import {validItems.length} Item{validItems.length !== 1 ? 's' : ''}
              </Button>
            </>
          )}

          {phase === 'running' && (
            <Button
              disabled
              className="bg-emerald-600/50 text-white flex items-center gap-2 cursor-not-allowed"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              Importing…
            </Button>
          )}

          {phase === 'done' && (
            <Button
              onClick={() => onOpenChange(false)}
              className={`text-white flex items-center gap-2 ${
                doneSuccess
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : doneFailed
                    ? 'bg-red-600 hover:bg-red-500'
                    : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {doneSuccess ? (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Close
                </>
              ) : doneFailed ? (
                <>
                  <XCircle className="h-4 w-4" /> Close
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4" /> Close
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───── Parsers per resource type ───── */

/** Tags: one column — tag_name (with or without header) */
export function parseTagImport(input: string): ImportItem[] {
  const { headers, rows } = parseCsv(input, ['tag_name', 'name']);
  const nameIndex = headers.length > 0
    ? headers.findIndex((h) => h.toLowerCase() === 'tag_name' || h.toLowerCase() === 'name')
    : -1;

  return rows.map((row) => {
    const raw = row.join(',');
    const name = nameIndex >= 0 ? stripQuotes(row[nameIndex] || '') : stripQuotes(row[0] || '');
    if (!name.trim()) {
      return { valid: false, error: 'Empty tag name', raw, data: {} };
    }
    return { valid: true, raw, data: { tag_name: name.trim() } };
  });
}

/** Contexts: one column — context_description (with or without header) */
export function parseContextImport(input: string): ImportItem[] {
  const { headers, rows } = parseCsv(input, ['context_description', 'description']);
  const descIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'context_description' ||
        h.toLowerCase() === 'description' ||
        h.toLowerCase() === 'context'
      )
    : -1;

  return rows.map((row) => {
    const raw = row.join(',');
    const desc = descIndex >= 0 ? stripQuotes(row[descIndex] || '') : stripQuotes(row[0] || '');
    if (!desc.trim()) {
      return { valid: false, error: 'Empty context description', raw, data: {} };
    }
    return { valid: true, raw, data: { context_description: desc.trim() } };
  });
}

/** Directives: directive_name, directive_statement. Optional: is_active, priority */
export function parseDirectiveImport(input: string): ImportItem[] {
  const { headers, rows } = parseCsv(input, ['directive_name', 'name']);
  const nameIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'directive_name' ||
        h.toLowerCase() === 'name' ||
        h.toLowerCase() === 'directive id'
      )
    : 0;
  const statementIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'directive_statement' ||
        h.toLowerCase() === 'statement' ||
        h.toLowerCase() === 'description'
      )
    : 1;
  const isActiveIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'is_active' ||
        h.toLowerCase() === 'active'
      )
    : -1;
  const priorityIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'priority'
      )
    : -1;

  return rows.map((row) => {
    const raw = row.join(',');
    const name = stripQuotes(row[nameIndex] || '');
    const statement = stripQuotes(row[statementIndex] || '');
    const rawActive = isActiveIndex >= 0 ? stripQuotes(row[isActiveIndex] || '').toLowerCase() : '';
    const rawPriority = priorityIndex >= 0 ? stripQuotes(row[priorityIndex] || '') : '';

    const is_active = rawActive ? ['true', 'yes', '1', 'active'].includes(rawActive) : undefined;
    const parsedPriority = rawPriority ? parseInt(rawPriority, 10) : undefined;
    const priority = Number.isFinite(parsedPriority) ? parsedPriority : undefined;

    const errors: string[] = [];
    if (!name.trim()) errors.push('Empty directive name');
    if (!statement.trim()) errors.push('Empty directive statement');
    if (rawPriority && !Number.isFinite(parsedPriority)) errors.push(`Invalid priority: ${rawPriority}`);

    return {
      valid: errors.length === 0,
      error: errors.join('; ') || undefined,
      raw,
      data: { directive_name: name.trim(), directive_statement: statement.trim(), is_active, priority }
    };
  });
}

/** Metadata: two columns — key, value (with or without header) */
export function parseMetadataImport(input: string): ImportItem[] {
  const { headers, rows } = parseCsv(input, ['key', 'meta_key']);
  const keyIndex = headers.length > 0
    ? headers.findIndex((h) => h.toLowerCase() === 'key' || h.toLowerCase() === 'meta_key')
    : 0;
  const valIndex = headers.length > 0
    ? headers.findIndex((h) => h.toLowerCase() === 'value' || h.toLowerCase() === 'meta_value')
    : 1;

  return rows.map((row) => {
    const raw = row.join(',');
    const key = stripQuotes(row[keyIndex] || '');
    const value = stripQuotes(row[valIndex] || '');
    if (!key.trim()) {
      return { valid: false, error: 'Empty key', raw, data: {} };
    }
    return { valid: true, raw, data: { key: key.trim(), value: value.trim() || undefined } };
  });
}

/** Entities: entity_id, entity_name, entity_type, entity_description, entity_aliases */
export function parseEntityImport(
  input: string,
  entityTypes: { type_name: string; id: number }[]
): ImportItem[] {
  const { headers, rows } = parseCsv(input, ['entity_id', 'entity_name', 'entity_type']);

  const idIndex = headers.length > 0
    ? headers.findIndex((h) => h.toLowerCase() === 'entity_id')
    : 0;
  const nameIndex = headers.length > 0
    ? headers.findIndex((h) => h.toLowerCase() === 'entity_name' || h.toLowerCase() === 'name')
    : 1;
  const typeIndex = headers.length > 0
    ? headers.findIndex((h) => h.toLowerCase() === 'entity_type' || h.toLowerCase() === 'type')
    : 2;
  const descIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'entity_description' ||
        h.toLowerCase() === 'description' ||
        h.toLowerCase() === 'desc'
      )
    : 3;
  const aliasIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'entity_aliases' ||
        h.toLowerCase() === 'aliases'
      )
    : 4;
  const caseMatchIndex = headers.length > 0
    ? headers.findIndex((h) =>
        h.toLowerCase() === 'case_match' ||
        h.toLowerCase() === 'match' ||
        h.toLowerCase() === 'case'
      )
    : -1;

  const typeMap = new Map(entityTypes.map((t) => [t.type_name.toLowerCase(), t.id]));

  return rows.map((row) => {
    const raw = row.join(',');
    const entityId = stripQuotes(row[idIndex] || '');
    const name = stripQuotes(row[nameIndex] || '');
    const typeName = stripQuotes(row[typeIndex] || '');
    const description = descIndex >= 0 ? stripQuotes(row[descIndex] || '') : '';
    const aliasField = aliasIndex >= 0 ? stripQuotes(row[aliasIndex] || '') : '';
    const caseMatchRaw = caseMatchIndex >= 0 ? stripQuotes(row[caseMatchIndex] || '').toLowerCase() : '';

    if (!entityId.trim()) {
      return { valid: false, error: 'Empty entity_id', raw, data: {} };
    }
    if (!name.trim()) {
      return { valid: false, error: 'Empty entity_name', raw, data: {} };
    }
    if (!typeName.trim()) {
      return { valid: false, error: 'Empty entity_type', raw, data: {} };
    }

    const typeId = typeMap.get(typeName.toLowerCase());
    if (!typeId) {
      return {
        valid: false,
        error: `Unknown entity_type "${typeName}"`,
        raw,
        data: {},
      };
    }

    let case_match: 'insensitive' | 'sensitive' | undefined;
    if (caseMatchRaw) {
      if (caseMatchRaw === 'sensitive' || caseMatchRaw === 's') {
        case_match = 'sensitive';
      } else if (caseMatchRaw === 'insensitive' || caseMatchRaw === 'i') {
        case_match = 'insensitive';
      } else {
        return {
          valid: false,
          error: `Invalid case_match "${caseMatchRaw}" — must be "insensitive" or "sensitive"`,
          raw,
          data: {},
        };
      }
    }

    let aliases: string[] = [];
    if (aliasField.trim()) {
      const aliasResult = parseCsv(aliasField);
      aliases = aliasResult.rows[0]?.map(stripQuotes).filter(Boolean) || [];
    }

    return {
      valid: true,
      raw,
      data: {
        entity_id: entityId.trim(),
        entity_name: name.trim(),
        type_id: typeId,
        type_name: typeName.trim(),
        description: description.trim() || undefined,
        aliases,
        case_match,
      },
    };
  });
}

export { parseCsv, stripQuotes };
