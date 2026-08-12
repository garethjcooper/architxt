'use client';

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from '@/components/ui/table';

export interface ResultTable {
  name: string;
  columns: string[];
  rows: Record<string, any>[];
}

interface ResultTablesProps {
  tables: ResultTable[];
}

export function ResultTables({ tables }: ResultTablesProps) {
  if (!tables || tables.length === 0) return null;

  return (
    <div className="space-y-4 mt-4">
      {tables.map((t) => {
        if (!t.rows || t.rows.length === 0) return null;
        const columns = t.columns && t.columns.length > 0
          ? t.columns
          : Object.keys(t.rows[0]);

        return (
          <div
            key={t.name}
            className="rounded-md border border-white/[0.08] bg-[oklch(0.18_0_0)] overflow-hidden"
          >
            <Table>
              <TableCaption className="text-[11px] text-white/50 px-3 py-2 border-b border-white/10 bg-black/20 text-left">
                {t.name}
              </TableCaption>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  {columns.map((col) => (
                    <TableHead
                      key={col}
                      className="text-[10px] uppercase tracking-wider text-white/60 font-semibold h-8 px-3 py-1"
                    >
                      {col}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.rows.map((row, rIdx) => (
                  <TableRow
                    key={rIdx}
                    className="border-white/[0.06] hover:bg-white/[0.03] transition-colors"
                  >
                    {columns.map((col) => (
                      <TableCell
                        key={col}
                        className="text-[11px] text-white/70 px-3 py-1.5"
                      >
                        {typeof row[col] === 'string' || typeof row[col] === 'number'
                          ? String(row[col])
                          : JSON.stringify(row[col])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
    </div>
  );
}
