'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { copyText, tableToCsv, tableToJson } from '@/lib/clipboard-utils';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';

export interface TableFocusModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Initial table data. */
  table: { name: string; columns: string[]; rows: Record<string, any>[] };
  /** Called when Apply is pressed with the updated table. */
  onApply?: (event: EnvelopeCopyEvent) => void;
  /** When true, renders a read-only view with no editing controls. */
  readOnly?: boolean;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.join(', ');
  return JSON.stringify(value);
}

function parseCell(text: string, original: unknown): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  if (typeof original === 'number') {
    const num = Number(trimmed);
    return Number.isNaN(num) ? trimmed : num;
  }
  if (typeof original === 'boolean') {
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return trimmed;
  }
  if (Array.isArray(original)) {
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (original !== null && typeof original === 'object') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

export function TableFocusModal({ open, onOpenChange, table, onApply, readOnly = false }: TableFocusModalProps) {
  const [name, setName] = useState(table.name);
  const [columns, setColumns] = useState<string[]>(table.columns);
  const [rows, setRows] = useState<Record<string, any>[]>(table.rows);

  useEffect(() => {
    setName(table.name);
    setColumns(table.columns);
    setRows(table.rows);
  }, [table.name, table.columns, table.rows]);

  const handleAddColumn = useCallback(() => {
    const base = 'new_column';
    let next = base;
    let i = 1;
    while (columns.includes(next)) {
      next = `${base}_${i}`;
      i++;
    }
    setColumns((prev) => [...prev, next]);
    setRows((prev) => prev.map((row) => ({ ...row, [next]: '' })));
  }, [columns]);

  const handleRenameColumn = useCallback((oldKey: string, newKey: string) => {
    const trimmed = newKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    setColumns((prev) => prev.map((c) => (c === oldKey ? trimmed : c)));
    setRows((prev) =>
      prev.map((row) => {
        const { [oldKey]: value, ...rest } = row;
        return { ...rest, [trimmed]: value };
      })
    );
  }, []);

  const handleRemoveColumn = useCallback((key: string) => {
    setColumns((prev) => prev.filter((c) => c !== key));
    setRows((prev) => prev.map((row) => {
      const { [key]: _, ...rest } = row;
      return rest;
    }));
  }, []);

  const handleAddRow = useCallback(() => {
    const row: Record<string, any> = {};
    for (const c of columns) row[c] = '';
    setRows((prev) => [...prev, row]);
  }, [columns]);

  const handleRemoveRow = useCallback((index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleCellChange = useCallback((rowIndex: number, column: string, text: string) => {
    const original = rows[rowIndex]?.[column];
    setRows((prev) =>
      prev.map((row, i) => (i === rowIndex ? { ...row, [column]: parseCell(text, original) } : row))
    );
  }, [rows]);

  const finalRows = useMemo(() => {
    return rows.map((row) => {
      const cleaned: Record<string, any> = {};
      for (const c of columns) cleaned[c] = row[c] ?? '';
      return cleaned;
    });
  }, [rows, columns]);

  const tablePayload = useMemo(() => ({
    name: name.trim() || table.name,
    columns,
    rows: finalRows,
  }), [name, table.name, columns, finalRows]);

  const handleCopyJson = useCallback(() => {
    copyText(tableToJson(tablePayload), 'Table JSON');
  }, [tablePayload]);

  const handleCopyCsv = useCallback(() => {
    copyText(tableToCsv(finalRows, columns), 'Table CSV');
  }, [finalRows, columns]);

  const handleApply = useCallback(() => {
    onApply?.({
      type: 'tables',
      payload: JSON.stringify([tablePayload], null, 2),
      label: name.trim() || table.name,
    });
    onOpenChange(false);
  }, [tablePayload, name, table.name, onApply, onOpenChange]);

  const emptyColumns = columns.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] h-[90vh] max-w-none sm:max-w-none flex flex-col" showCloseButton>
        <DialogHeader className="shrink-0">
          <DialogTitle>Table: {table.name}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-xs text-white/60">Name:</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-black/30 border border-white/10 text-[12px] text-white/80 focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle disabled:opacity-60 disabled:cursor-not-allowed"
              placeholder="Table name"
            />
          </div>
          <div className="flex-1 min-h-0 overflow-auto custom-scrollbar rounded-md border border-white/10 bg-surface-overlay">
            <div className="px-3 py-2 border-b border-white/10 text-xs font-medium text-white/70 flex items-center justify-between shrink-0 sticky top-0 bg-surface-overlay z-10">
              <span>{emptyColumns ? 'Table' : `${rows.length} row${rows.length === 1 ? '' : 's'}`}</span>
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <span
                    role="button"
                    className="p-1 rounded text-white/40 hover:text-accent-primary-fg hover:bg-accent-secondary-bg/50 transition-colors"
                    title="Copy table"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleCopyJson}>Copy JSON</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCopyCsv}>Copy CSV</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {emptyColumns ? (
              <div className="p-4 text-sm text-white/40">No columns. Add a column to start editing.</div>
            ) : (
              <table className="w-full text-left text-[12px] border-collapse">
                <thead className="sticky top-0 bg-surface-panel z-10">
                  <tr className="border-b border-white/20">
                    <th className="py-2 px-2 w-10"></th>
                    {columns.map((c, i) => (
                      <th key={i} className="py-2 px-2 font-semibold text-white/80 min-w-[8rem]">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={c}
                            onChange={(e) => handleRenameColumn(c, e.target.value)}
                            disabled={readOnly}
                            className="flex-1 min-w-0 px-1 py-0.5 rounded bg-transparent border border-transparent hover:border-white/10 focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle focus:outline-none text-white/80 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => handleRemoveColumn(c)}
                              className="p-0.5 rounded text-white/30 hover:text-destructive-fg hover:bg-destructive-fg/10"
                              title="Remove column"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className="border-b border-white/10">
                      <td className="py-1 px-2 align-middle">
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRow(i)}
                            className="p-1 rounded text-white/30 hover:text-destructive-fg hover:bg-destructive-fg/10"
                            title="Remove row"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                      {columns.map((c, ci) => (
                        <td key={ci} className="py-1 px-2 align-middle">
                          <input
                            type="text"
                            value={formatCell(row[c])}
                            onChange={(e) => handleCellChange(i, c, e.target.value)}
                            disabled={readOnly}
                            className="w-full px-1 py-0.5 rounded bg-black/20 border border-transparent hover:border-white/10 focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle focus:outline-none text-white/70 disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {!readOnly && (
            <div className="shrink-0 flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleAddColumn}>
                <Plus className="h-3 w-3 mr-1" /> Add column
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleAddRow} disabled={emptyColumns}>
                <Plus className="h-3 w-3 mr-1" /> Add row
              </Button>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {readOnly ? 'Close' : 'Cancel'}
          </Button>
          {!readOnly && (
            <Button type="button" size="sm" onClick={handleApply} disabled={emptyColumns}>
              Apply
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
