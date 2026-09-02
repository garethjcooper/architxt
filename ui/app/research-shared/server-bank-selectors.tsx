'use client';

import { Server, Database } from 'lucide-react';

export type SelectorServer = {
  id: number;
  name?: string;
  base_url?: string;
};

export type SelectorBank = {
  bank_id: string;
  name?: string;
};

export interface ServerBankSelectorsProps {
  servers: SelectorServer[];
  selectedServerId: string;
  setSelectedServerId: (id: string) => void;
  banks: SelectorBank[];
  selectedBankId: string;
  setSelectedBankId: (id: string) => void;
  loadingBanks?: boolean;
  disabled?: boolean;
}

export function ServerBankSelectors({
  servers,
  selectedServerId,
  setSelectedServerId,
  banks,
  selectedBankId,
  setSelectedBankId,
  loadingBanks,
  disabled,
}: ServerBankSelectorsProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-white/40" />
        <select
          value={selectedServerId}
          onChange={(e) => setSelectedServerId(e.target.value)}
          disabled={disabled || servers.length === 0}
          className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:opacity-50"
        >
          <option value="">Select server...</option>
          {servers.map((s, idx) => (
            <option key={s.id ?? `server-${idx}`} value={s.id}>
              {s.name || s.base_url || `Server ${s.id}`}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-white/40" />
        <select
          value={selectedBankId}
          onChange={(e) => setSelectedBankId(e.target.value)}
          disabled={disabled || !selectedServerId || loadingBanks || banks.length === 0}
          className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:opacity-50"
        >
          <option value="">
            {loadingBanks ? 'Loading...' : banks.length === 0 ? 'No banks' : 'Select bank...'}
          </option>
          {banks.map((b, idx) => (
            <option key={b.bank_id ?? `bank-${idx}`} value={b.bank_id}>
              {b.name || b.bank_id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
