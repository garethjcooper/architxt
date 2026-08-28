'use client';

import { useState } from 'react';
import { MessageSquare, Plus, Trash2, X, ChevronDown, Loader2 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ResearchSession } from '@/lib/api/client';
import { cn } from '@/lib/utils';

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
  const [open, setOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeLabel = activeSession?.title || (activeSession ? `Session ${activeSession.id}` : 'Select session...');

  const handleCreate = async () => {
    setCreating(true);
    try {
      await onCreate();
      setOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (sessionId: number) => {
    setDeletingId(sessionId);
    try {
      await onDelete(sessionId);
      setConfirmDeleteId(null);
      setOpen(false);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-white/40" />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className="h-8 min-w-[10rem] rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none disabled:opacity-50 flex items-center justify-between gap-2">
            <span className="truncate">{loading ? 'Loading...' : activeLabel}</span>
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-white/40" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-white/40" />
            )}
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-72 p-0 bg-[oklch(0.18_0_0)] border-white/10 text-white/90"
          >
            <div className="max-h-64 overflow-y-auto py-1">
              {sessions.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-white/40">No sessions for this bank.</div>
              )}
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const confirming = confirmDeleteId === session.id;
                const deleting = deletingId === session.id;
                return (
                  <div
                    key={session.id}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1.5 group',
                      isActive ? 'bg-emerald-500/10' : 'hover:bg-white/5'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(session.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex-1 text-left text-[11px] truncate',
                        isActive ? 'text-emerald-300' : 'text-white/70'
                      )}
                      title={session.title || `Session ${session.id}`}
                    >
                      {session.title || `Session ${session.id}`}
                    </button>
                    {confirming ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(session.id);
                          }}
                          disabled={deleting}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50"
                        >
                          {deleting ? '...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10"
                          title="Cancel"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(session.id);
                        }}
                        className="p-1 rounded text-white/40 hover:text-rose-400 hover:bg-rose-950/30 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete session"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

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
