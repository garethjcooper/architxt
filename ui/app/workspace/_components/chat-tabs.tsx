'use client';

import { useState, useCallback } from 'react';
import { Plus, X, Trash2, Pencil, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { AgentChatThread } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PanelHeader } from './panel-layout';

export interface ChatTab {
  /** Unique local id for React keys. */
  id: string;
  /** Chat thread id from the backend. */
  threadId: number;
  /** Display label. */
  label: string;
}

export function generateNewChatName(tabs: ChatTab[]): string {
  const base = 'Chat';
  let index = 1;
  const existing = new Set(tabs.map((t) => t.label));
  while (existing.has(`${base} ${index}`)) {
    index++;
  }
  return `${base} ${index}`;
}

interface ChatTabsProps {
  tabs: ChatTab[];
  activeTabId: string | null;
  threads: AgentChatThread[];
  title?: string;
  historyLoading?: boolean;
  onSelect: (tabId: string) => void;
  onSelectThread: (threadId: number) => void | Promise<void>;
  onCreateChat: (title: string) => Promise<void>;
  onRenameChat: (threadId: number, title: string) => Promise<void>;
  onDeleteChat: (threadId: number) => Promise<void>;
  onCloseTab: (tabId: string, hasMessages: boolean) => void;
  onCloseOthers?: () => void;
}

export function ChatTabs({
  tabs,
  activeTabId,
  threads,
  title,
  historyLoading = false,
  onSelect,
  onSelectThread,
  onCreateChat,
  onRenameChat,
  onDeleteChat,
  onCloseTab,
  onCloseOthers,
}: ChatTabsProps) {
  const [confirmDelete, setConfirmDelete] = useState<{ threadId: number; title: string } | null>(null);
  const [renamingChat, setRenamingChat] = useState<{ threadId: number; title: string } | null>(null);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleCreate = useCallback(async () => {
    await onCreateChat(generateNewChatName(tabs));
  }, [tabs, onCreateChat]);

  const handleConfirmRename = useCallback(async () => {
    if (!renamingChat) return;
    const next = renamingChat.title.trim();
    if (!next) {
      setRenamingChat(null);
      return;
    }
    await onRenameChat(renamingChat.threadId, next);
    setRenamingChat(null);
  }, [renamingChat, onRenameChat]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    await onDeleteChat(confirmDelete.threadId);
    setConfirmDelete(null);
  }, [confirmDelete, onDeleteChat]);

  const threadTabIds = new Set(tabs.map((t) => t.threadId));

  return (
    <div className="flex flex-col shrink-0 border-b border-border-default bg-surface-overlay">
      {(title || historyLoading) && (
        <PanelHeader
          title={title ?? ''}
          actions={historyLoading ? <Loader2 className="h-4 w-4 animate-spin text-accent-primary-fg" /> : undefined}
        />
      )}
      <div className="flex items-stretch gap-1 px-2 h-12">
        <div className="flex-1 min-w-0 flex items-start gap-1 overflow-x-auto custom-scrollbar pt-2 pb-2">
          {tabs.map((tab) => {
            const isActive = activeTabId === tab.id;
            return (
              <div
                key={tab.id}
                onClick={() => onSelect(tab.id)}
                className={cn(
                  'group/tab relative flex items-center gap-1.5 pr-7 pl-2 py-1 rounded border text-[11px] cursor-pointer shrink-0 select-none transition-colors max-w-[18rem]',
                  isActive
                    ? 'bg-accent-primary-bg border-accent-primary-bd text-accent-primary-fg'
                    : 'bg-surface-inset border-border-subtle text-foreground-faint hover:bg-surface-card hover:text-foreground-muted'
                )}
              >
                <span className={cn('absolute left-0 top-0 bottom-0 w-[3px] rounded-l shrink-0 bg-accent-primary-fg')} />
                <span className="truncate min-w-0" title={tab.label}>
                  {tab.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const thread = threads.find((th) => th.act_id === tab.threadId);
                    onCloseTab(tab.id, (thread?.message_count ?? 0) > 0);
                  }}
                  className={cn(
                    'absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-foreground-subtle hover:text-foreground-default hover:bg-surface-panel transition-opacity opacity-0 group-hover/tab:opacity-100'
                  )}
                  title="Close chat tab"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-border-default">
          {onCloseOthers && (
            <button
              type="button"
              onClick={() => onCloseOthers()}
              disabled={tabs.length <= 1}
              className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors"
              title="Close all other chat tabs"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <select
            value={activeTabId ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              if (tabs.some((t) => t.id === value)) {
                onSelect(value);
              } else if (value.startsWith('thread-')) {
                const threadId = Number(value.slice('thread-'.length));
                if (!Number.isNaN(threadId)) {
                  onSelectThread(threadId);
                }
              }
            }}
            className="h-6 rounded-md border border-border-default bg-surface-panel px-1.5 text-[11px] text-foreground-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none min-w-[6rem] max-w-[10rem]"
          >
            <option value="">Chats...</option>
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
            {threads
              .filter((th) => !threadTabIds.has(th.act_id))
              .map((th) => (
                <option key={`thread-${th.act_id}`} value={`thread-${th.act_id}`}>
                  {th.title || `Chat ${th.act_id}`}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={() => {
              if (!activeTab?.threadId) return;
              setRenamingChat({ threadId: activeTab.threadId, title: activeTab.label });
            }}
            disabled={!activeTab}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors"
            title="Rename active chat"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!activeTab?.threadId) return;
              setConfirmDelete({ threadId: activeTab.threadId, title: activeTab.label });
            }}
            disabled={!activeTab}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-destructive-fg hover:bg-destructive-bg-hover hover:border-destructive-bd disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-border-default transition-colors"
            title="Delete active chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default transition-colors"
            title="Add chat"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title="Delete chat?"
        description={confirmDelete ? `“${confirmDelete.title}” and its messages will be removed.` : ''}
        confirmLabel="Delete"
        onConfirm={() => void handleConfirmDelete()}
        variant="destructive"
      />

      {renamingChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-backdrop-strong">
          <div className="rounded-lg border border-border-default bg-surface-overlay p-4 w-80 shadow-lg">
            <div className="text-sm font-medium text-foreground-default mb-2">Rename chat</div>
            <input
              type="text"
              value={renamingChat.title}
              onChange={(e) => setRenamingChat({ ...renamingChat, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleConfirmRename();
                } else if (e.key === 'Escape') {
                  setRenamingChat(null);
                }
              }}
              className="w-full px-2 py-1.5 mb-4 rounded bg-surface-inset border border-border-default text-xs text-foreground-default placeholder:text-foreground-placeholder focus:outline-none focus:border-focus-ring/80"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRenamingChat(null)}>
                Cancel
              </Button>
              <Button variant="default" size="sm" onClick={() => void handleConfirmRename()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
