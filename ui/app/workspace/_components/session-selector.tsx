'use client';

import { MessageSquare, Loader2 } from 'lucide-react';
import type { ResearchSession } from '@/lib/api/client';

export interface SessionSelectorProps {
  sessions: ResearchSession[];
  activeSessionId?: number | null;
  loading?: boolean;
  disabled?: boolean;
  onSelect: (sessionId: number) => void;
}

export function SessionSelector({
  sessions,
  activeSessionId,
  loading = false,
  disabled = false,
  onSelect,
}: SessionSelectorProps) {
  return (
    <div className="flex items-center gap-2">
      <MessageSquare className="h-4 w-4 text-white/40" />
      <select
        value={activeSessionId ?? ''}
        onChange={(e) => {
          const value = e.target.value;
          if (value) onSelect(Number(value));
        }}
        disabled={disabled || loading || sessions.length === 0}
        className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:opacity-50 min-w-[10rem]"
      >
        <option value="">{loading ? 'Loading...' : sessions.length === 0 ? 'No sessions' : 'Select session...'}</option>
        {sessions.map((session, idx) => (
          <option key={session.id ?? `session-${idx}`} value={session.id}>
            {session.title || `Session ${session.id}`}
          </option>
        ))}
      </select>
    </div>
  );
}
