'use client';

import { useState } from 'react';
import { MessageSquare, Plus, Trash2, X, Loader2 } from 'lucide-react';
import type { ResearchSession } from '@/lib/api/client';

export interface SessionSelectorProps {
  sessions: ResearchSession[];
  activeSessionId?: number | null;
  loading?: boolean;
  disabled?: boolean;
  onSelect: (sessionId: number) => void;
  onCreate: () => void | Promise<void>;
  onDelete: (sessionId: number) => void | Promise<void>;
}

export function SessionSelector({
  sessions,
  activeSessionId,
  loading = false,
  disabled = false,
  onSelect,
  onCreate,
  onDelete,
}: SessionSelectorProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creating, setCreating] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const canDelete = activeSessionId != null;

  const handleCreate = async () => {
    setCreating(true);
    try {
      await onCreate();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!activeSessionId) return;
    setDeleting(true);
    try {
      await onDelete(activeSessionId);
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
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

      {confirmingDelete ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting || !canDelete}
            className="h-8 px-2 rounded text-xs font-medium bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {deleting ? '...' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(false)}
            className="h-8 w-8 inline-flex items-center justify-center rounded border border-white/10 bg-[oklch(0.23_0_0)] text-white/40 hover:text-white hover:bg-white/10"
            title="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={!canDelete}
          className="h-8 w-8 inline-flex items-center justify-center rounded border border-white/10 bg-[oklch(0.23_0_0)] text-white/40 hover:text-rose-400 hover:border-rose-500/30 hover:bg-rose-950/20 disabled:opacity-30 transition-colors"
          title="Delete selected session"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={disabled || creating}
        className="inline-flex items-center gap-2 h-8 px-3 rounded text-sm font-medium bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/50 transition-colors disabled:opacity-50"
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add Session
      </button>
    </div>
  );
}
