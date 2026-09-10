'use client';

import { MessageSquare, Loader2 } from 'lucide-react';
import type { ResearchSession } from '@/lib/api/client';

function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

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
        className="h-8 rounded-md border border-white/10 bg-surface-card px-2.5 text-sm text-white/80 focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none disabled:opacity-50 min-w-[10rem]"
      >
        <option value="">{loading ? 'Loading...' : sessions.length === 0 ? 'No sessions' : 'Select session...'}</option>
        {sessions.map((session, idx) => (
          <option key={session.id ?? `session-${idx}`} value={session.id}>
            {formatSessionDate(session.created_at)}{session.title ? ` - ${session.title}` : ` - Session ${session.id}`}
          </option>
        ))}
      </select>
    </div>
  );
}
