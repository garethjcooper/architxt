'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { MoreHorizontal, Trash2, Pencil } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResearchSession } from '@/lib/api/client';

export interface SessionListProps {
  sessions: ResearchSession[];
  activeSessionId: number | null;
  creating?: boolean;
  onStartCreate?: () => void;
  onCancelCreate?: () => void;
  onSelect: (session: ResearchSession) => void;
  onCreate: (title: string) => void;
  onRename: (sessionId: number, title: string) => void;
  onDelete: (sessionId: number) => void;
  loading?: boolean;
}

function formatSessionDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SessionList({
  sessions,
  activeSessionId,
  creating: creatingProp,
  onStartCreate,
  onCancelCreate,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  loading,
}: SessionListProps) {
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const isCreating = creatingProp ?? creating;

  const startCreate = () => {
    setCreating(true);
    onStartCreate?.();
  };

  const cancelCreate = () => {
    setCreating(false);
    setNewTitle('');
    onCancelCreate?.();
  };

  const handleCreate = () => {
    const title = newTitle.trim();
    if (!title) {
      cancelCreate();
      return;
    }
    onCreate(title);
    setNewTitle('');
    if (creatingProp == null) {
      setCreating(false);
    }
  };

  const startRename = (session: ResearchSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  const commitRename = () => {
    if (renamingId == null) return;
    const title = renameValue.trim();
    if (title) {
      onRename(renamingId, title);
    }
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
        <span className="font-medium text-sm">Sessions</span>
      </div>

      <div className="px-3 py-2 space-y-1 flex-1 min-h-0 overflow-y-auto">
        {isCreating && (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') cancelCreate();
              }}
              onBlur={handleCreate}
              placeholder="Session name"
              className="h-7 text-xs bg-black/20 border-white/10"
            />
          </div>
        )}

        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelect(session)}
            className={[
              'w-full flex items-center justify-between gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] cursor-pointer text-left transition-colors text-xs',
              activeSessionId === session.id
                ? 'bg-emerald-500/20 text-emerald-100 border-emerald-500/30'
                : 'text-white/90 border-white/5 bg-black/20 hover:bg-white/5',
            ].join(' ')}
          >
            {renamingId === session.id ? (
              <Input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') {
                    setRenamingId(null);
                    setRenameValue('');
                  }
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                className="h-6 text-xs bg-black/20 border-white/10"
              />
            ) : (
              <>
                <span
                  className="shrink-0 w-12 text-[10px] text-white/40"
                  title={session.created_at ? new Date(session.created_at).toLocaleString() : undefined}
                >
                  {formatSessionDate(session.created_at)}
                </span>
                <span className="truncate flex-1 min-w-0" title={session.title}>{session.title}</span>
              </>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger>
              <span
                className="h-5 w-5 inline-flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-white/50 hover:text-white hover:bg-white/10 transition-opacity cursor-pointer"
                onClick={(e) => e.stopPropagation()}
                aria-label="Session actions"
                role="button"
              >
                <MoreHorizontal className="h-3 w-3" />
              </span>
            </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(session);
                  }}
                >
                  <Pencil className="h-3 w-3 mr-2" /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-rose-400 focus:text-rose-400 focus:bg-rose-950/30"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingId(session.id);
                  }}
                >
                  <Trash2 className="h-3 w-3 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}

        {sessions.length === 0 && !isCreating && (
          <div className="text-white/40 text-xs px-3 py-2">
            {loading ? 'Loading sessions…' : 'No sessions found. Create one to start.'}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deletingId !== null}
        title="Delete session"
        description="This will delete the session and all its queries. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (deletingId != null) onDelete(deletingId);
          setDeletingId(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeletingId(null);
        }}
      />
    </div>
  );
}
