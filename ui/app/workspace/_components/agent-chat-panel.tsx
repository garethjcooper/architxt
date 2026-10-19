'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, User, Trash2, ClipboardPaste } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { ArchitxtIcon } from '@/components/icons/architxt-icon';
import { toast } from 'sonner';
import { researchApi, type AgentChatMessage, type AgentChatThread, type UnifiedEnvelope, type AgentChatQueryState } from '@/lib/api/client';
import { createLogger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import { ChatInput } from './chat-input';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ChatTabs, type ChatTab, generateNewChatName } from './chat-tabs';
import { EnvelopeViewer } from '@/components/envelope-viewer';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
import { ChatContextualItemsCard } from './chat-contextual-items-card';
import type { ModelItem } from './attached-entities-panel';
import React from 'react';

const logger = createLogger('AgentChatPanel');

export interface AgentChatPanelProps {
  sessionId: number | null;
  availableEntities?: import('@/components/aql-editor-completions').EntityLike[];
  availableEdges?: import('@/components/aql-editor-completions').EdgeLike[];
  /** Callback to add an envelope or section to a curated page. */
  onCopyToCuratedPage?: (event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => void;
  /** Callback when the user selects a contextual model item from the chat response. */
  onSelectModel?: (entityId: string, item: ModelItem, openInNewTab?: boolean) => void;
  /** Current Reflect input value; used to warn before overwriting generated AQL. */
  reflectQuery?: string;
  /** Copy generated AQL into the Reflect input. */
  onCopyAqlToReflect?: (aql: string) => void;
}

interface ChatMessage {
  id: number;
  role: 'user' | 'agent';
  content: string;
  model?: string;
  usage?: AgentChatMessage['usage'];
  envelope?: UnifiedEnvelope;
  queryState?: AgentChatQueryState;
  contextualItems?: AgentChatMessage['contextual_items'];
  serverId?: number | null;
  bankId?: string | null;
  createdAt: string;
}

interface PendingDelete {
  type: 'message';
  messageId?: number;
}

interface PendingAqlCopy {
  aql: string;
  onConfirm: () => void;
}

const MemoizedChatMessage = React.memo(function ChatMessageRow({
  m,
  isExpanded,
  onToggleExpand,
  onDelete,
  onCopyToPage,
  onSelectModel,
  onCopyAqlToReflect,
}: {
  m: ChatMessage;
  isExpanded: boolean;
  onToggleExpand: (id: number) => void;
  onDelete: (id: number) => void;
  onCopyToPage?: (event: EnvelopeCopyEvent | EnvelopeCopyEvent[]) => void;
  onSelectModel?: (entityId: string, item: ModelItem, openInNewTab?: boolean) => void;
  onCopyAqlToReflect?: (aql: string) => void;
}) {
  const aqlText = m.envelope?.narratives?.find((n) => n.narrative_name === 'Generated AQL')?.narrative
    ?.replace(/^```aql\n?/, '')
    ?.replace(/\n?```\s*$/, '')
    ?.trim() || m.queryState?.aql || null;

  return (
    <div
      className={cn(
        'flex gap-2 group',
        m.role === 'user' ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      <div
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
          m.role === 'user'
            ? 'bg-accent-primary-bg border-accent-primary-bd'
            : 'bg-surface-inset border-border-default'
        )}
      >
        {m.role === 'user' ? (
          <User className="h-4 w-4 text-accent-primary-fg" />
        ) : (
          <ArchitxtIcon className="h-4 w-4 text-muted-fg" />
        )}
      </div>
      <div
        className={cn(
          'relative rounded-lg px-3 py-2',
          m.role === 'user'
            ? 'text-xs bg-accent-primary-bg text-accent-primary-fg border border-accent-primary-bd max-w-[80%]'
            : 'text-sm bg-surface-inset text-foreground-default border border-border-default flex-1 min-w-0'
        )}
      >
        {m.role === 'agent' && m.envelope ? (
          <div className="flex flex-col gap-2">
            <div
              className={cn(
                'relative',
                isExpanded ? '' : 'max-h-64 overflow-y-auto'
              )}
            >
              <EnvelopeViewer
                envelope={m.envelope}
                title="Agent response"
                headerTitle=""
                showControls
                serverId={m.serverId ?? undefined}
                bankId={m.bankId ?? undefined}
                onAddToPage={onCopyToPage}
                addToPageLabel="Add to page"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleExpand(m.id)}
                className="self-start text-[11px] text-accent-primary-fg hover:underline"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            </div>
            {m.serverId && m.bankId && (((m.queryState?.contextual_items?.length ?? 0) > 0) || ((m.contextualItems?.length ?? 0) > 0)) && onSelectModel && (
              <ChatContextualItemsCard
                contextualItems={m.queryState?.contextual_items ?? m.contextualItems ?? null}
                createdAt={m.queryState?.created_at ?? m.createdAt ?? null}
                serverId={m.serverId}
                bankId={m.bankId}
                onSelectModel={onSelectModel}
              />
            )}
            {m.model && (
              <div className="text-[10px] text-muted-fg border-t border-border-default pt-1 flex items-center gap-1">
                <span>
                  {m.model}
                  {m.usage?.total_tokens != null && ` · ${m.usage.total_tokens} tokens`}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="whitespace-pre-wrap max-w-[80%]">{m.content}</div>
        )}
        <div
          className={cn(
            'absolute -top-2 flex items-center gap-0.5 opacity-0 transition-opacity',
            m.role === 'user' ? 'left-0' : 'right-0',
            'group-hover:opacity-100'
          )}
        >
          {aqlText && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy AQL to Reflect input"
              title="Copy AQL to Reflect input"
              onClick={() => onCopyAqlToReflect?.(aqlText)}
              className="h-5 w-5 text-purple-600 hover:text-purple-700 dark:text-purple-300 dark:hover:text-purple-200"
            >
              <ClipboardPaste className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete message"
            title="Delete"
            disabled={m.id < 0}
            onClick={() => onDelete(m.id)}
            className="h-5 w-5 text-muted-fg hover:text-destructive-fg"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
});

export const AgentChatPanel = React.memo(function AgentChatPanelMemo({ sessionId, availableEntities = [], availableEdges = [], onCopyToCuratedPage, onSelectModel, reflectQuery, onCopyAqlToReflect }: AgentChatPanelProps) {
  const [threads, setThreads] = useState<AgentChatThread[]>([]);
  const [tabs, setTabs] = useState<ChatTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const tabsHydratedRef = useRef(false);

  const chatTabsKey = useMemo(() => {
    if (!sessionId) return null;
    return `architxt:workspace-chat-tabs:${sessionId}`;
  }, [sessionId]);
  const [messagesByThread, setMessagesByThread] = useState<Record<number, ChatMessage[]>>({});
  const [loadingByThread, setLoadingByThread] = useState<Record<number, boolean>>({});
  const [inputByThread, setInputByThread] = useState<Record<number, string>>({});
  const [parseEntitiesByThread, setParseEntitiesByThread] = useState<Record<number, boolean>>({});
  const [contextualListByThread, setContextualListByThread] = useState<Record<number, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [agentConfig, setAgentConfig] = useState<{ provider: string; model: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingAqlCopy, setPendingAqlCopy] = useState<PendingAqlCopy | null>(null);
  const [creatingThread, setCreatingThread] = useState(false);
  const [expandedAgentCards, setExpandedAgentCards] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Hydrate chat tabs from localStorage once thread list is loaded.
  useEffect(() => {
    if (tabsHydratedRef.current) return;
    if (!chatTabsKey) return;
    if (historyLoading) return;

    try {
      const raw = localStorage.getItem(chatTabsKey);
      if (raw) {
        const saved = JSON.parse(raw) as {
          tabs?: ChatTab[];
          activeTabId?: string | null;
        };
        const restoredTabs = Array.isArray(saved.tabs) ? saved.tabs : [];
        const validTabs: ChatTab[] = [];
        for (const t of restoredTabs) {
          if (!t || typeof t.id !== 'string' || typeof t.threadId !== 'number' || typeof t.label !== 'string') continue;
          // Defer pruning against the loaded thread list: if threads are empty,
          // keep the tab and let the sync effect below remove it later.
          if (threads.length > 0 && !threads.some((th) => th.act_id === t.threadId)) continue;
          validTabs.push({
            id: t.id,
            threadId: t.threadId,
            label: t.label,
          });
        }
        if (validTabs.length > 0) {
          setTabs(validTabs);
          if (saved.activeTabId && validTabs.some((t) => t.id === saved.activeTabId)) {
            setActiveTabId(saved.activeTabId);
          }
        }
      }
    } catch (err) {
      logger.error('Failed to hydrate chat tabs', err);
    }

    tabsHydratedRef.current = true;
  }, [chatTabsKey, historyLoading, threads]);

  // Persist chat tabs whenever they change after hydration.
  useEffect(() => {
    if (!tabsHydratedRef.current || !chatTabsKey) return;
    try {
      localStorage.setItem(chatTabsKey, JSON.stringify({ tabs, activeTabId }));
    } catch (err) {
      logger.error('Failed to persist chat tabs', err);
    }
  }, [chatTabsKey, tabs, activeTabId]);

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedAgentCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRequestDelete = useCallback((messageId: number) => {
    setPendingDelete({ type: 'message', messageId });
  }, []);
  const activeThread = useMemo(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return null;
    return threads.find((th) => th.act_id === tab.threadId) ?? null;
  }, [tabs, activeTabId, threads]);

  const activeThreadId = activeThread?.act_id ?? null;

  const messages = activeThreadId != null ? messagesByThread[activeThreadId] ?? [] : [];
  const input = activeThreadId != null ? inputByThread[activeThreadId] ?? '' : '';
  const parseEntities = activeThreadId != null ? parseEntitiesByThread[activeThreadId] ?? true : true;
  const isAqlThread = activeThread?.is_aql ?? false;
  const contextualList = activeThreadId != null && !isAqlThread ? contextualListByThread[activeThreadId] ?? false : false;
  const loading = activeThreadId != null ? loadingByThread[activeThreadId] ?? false : false;

  // Load the thread list for the session.
  useEffect(() => {
    if (sessionId == null) {
      setThreads([]);
      setTabs([]);
      setActiveTabId(null);
      setMessagesByThread({});
      setInputByThread({});
      setLoadingByThread({});
      setParseEntitiesByThread({});
      setContextualListByThread({});
      setAgentConfig(null);
      tabsHydratedRef.current = false;
      return;
    }

    let cancelled = false;
    tabsHydratedRef.current = false;
    setHistoryLoading(true);
    researchApi
      .listChatThreads(sessionId)
      .then((res) => {
        if (cancelled) return;
        setThreads(res.threads);
        setAgentConfig({ provider: res.provider, model: res.model });
        // Do not auto-open a chat tab from the thread list. Tabs are restored from
        // localStorage by the hydration effect, and if the user closed them all
        // they should stay closed on reload.
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Failed to load chat threads', err);
        toast.error(`Failed to load chats: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Load messages when the active thread changes and we don't have them yet.
  useEffect(() => {
    if (sessionId == null || activeThreadId == null) return;
    if (messagesByThread[activeThreadId] !== undefined) return;

    let cancelled = false;
    setHistoryLoading(true);
    researchApi
      .getChatHistory(sessionId, activeThreadId)
      .then((res) => {
        if (cancelled) return;
        const history = res.messages.map((m): ChatMessage => ({
          id: m.acm_id,
          role: m.role,
          content: m.content,
          model: m.model,
          usage: m.usage,
          envelope: m.envelope,
          contextualItems: m.contextual_items,
          serverId: res.server_id ?? undefined,
          bankId: res.bank_id ?? undefined,
          createdAt: m.acm_created_at,
        }));
        setMessagesByThread((prev) => ({ ...prev, [activeThreadId]: history }));
        // Update thread title if it changed on the server.
        setThreads((prev) =>
          prev.map((th) => (th.act_id === res.thread.act_id ? { ...th, ...res.thread } : th))
        );
        setTabs((prev) =>
          prev.map((t) => (t.threadId === res.thread.act_id ? { ...t, label: res.thread.title } : t))
        );
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error('Failed to load chat history', err);
        toast.error(`Failed to load chat history: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, activeThreadId, messagesByThread]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const openThread = useCallback((thread: AgentChatThread) => {
    const id = `chat-${thread.act_id}`;
    setTabs((prev) => {
      if (prev.some((t) => t.id === id)) return prev;
      return [...prev, { id, threadId: thread.act_id, label: thread.title }];
    });
    setActiveTabId(id);
  }, []);

  const handleCreateChat = useCallback(
    async (title: string, isAql?: boolean) => {
      if (sessionId == null) return;
      setCreatingThread(true);
      try {
        const thread = await researchApi.createChatThread(sessionId, title, isAql);
        setThreads((prev) => [thread, ...prev]);
        openThread(thread);
        toast.success(`Created ${thread.title}`);
      } catch (err) {
        logger.error('Failed to create chat thread', err);
        toast.error(`Failed to create chat: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setCreatingThread(false);
      }
    },
    [sessionId, openThread]
  );

  const handleRenameChat = useCallback(
    async (threadId: number, title: string) => {
      if (sessionId == null) return;
      try {
        const updated = await researchApi.renameChatThread(sessionId, threadId, title);
        setThreads((prev) => prev.map((th) => (th.act_id === updated.act_id ? { ...th, ...updated } : th)));
        setTabs((prev) => prev.map((t) => (t.threadId === updated.act_id ? { ...t, label: updated.title } : t)));
        toast.success('Chat renamed');
      } catch (err) {
        logger.error('Failed to rename chat thread', err);
        toast.error(`Failed to rename chat: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [sessionId]
  );

  const handleDeleteChat = useCallback(
    async (threadId: number) => {
      if (sessionId == null) return;
      try {
        await researchApi.deleteChatThread(sessionId, threadId);
        setThreads((prev) => prev.filter((th) => th.act_id !== threadId));
        setTabs((prev) => {
          const remaining = prev.filter((t) => t.threadId !== threadId);
          if (activeTabId != null) {
            const removed = prev.find((t) => t.threadId === threadId);
            if (removed?.id === activeTabId) {
              setActiveTabId(remaining[0]?.id ?? null);
            }
          }
          return remaining;
        });
        setMessagesByThread((prev) => {
          const next = { ...prev };
          delete next[threadId];
          return next;
        });
        toast.success('Chat deleted');
      } catch (err) {
        logger.error('Failed to delete chat thread', err);
        toast.error(`Failed to delete chat: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [sessionId, activeTabId]
  );

  const handleCloseTab = useCallback(
    (tabId: string, hasMessages: boolean) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      if (!hasMessages) {
        // Empty chat: delete the thread when closing, like pages.
        void researchApi.deleteChatThread(sessionId!, tab.threadId).then(() => {
          setThreads((prev) => prev.filter((th) => th.act_id !== tab.threadId));
          setMessagesByThread((prev) => {
            const next = { ...prev };
            delete next[tab.threadId];
            return next;
          });
        });
      }
      setTabs((prev) => prev.filter((t) => t.id !== tabId));
      if (activeTabId === tabId) {
        const remaining = tabs.filter((t) => t.id !== tabId);
        setActiveTabId(remaining[0]?.id ?? null);
      }
    },
    [tabs, activeTabId, sessionId]
  );

  const handleCloseOthers = useCallback(() => {
    setTabs((prev) => {
      const keep = prev.find((t) => t.id === activeTabId);
      return keep ? [keep] : prev;
    });
    setMessagesByThread((prev) => {
      const keepId = activeThreadId;
      if (keepId == null) return {};
      return { [keepId]: prev[keepId] ?? [] };
    });
  }, [activeTabId, activeThreadId]);

  const handleSend = useCallback(async () => {
    if (sessionId == null || activeThreadId == null) return;
    const text = input.trim();
    if (!text || loading) return;

    const optimisticId = -Date.now();
    setMessagesByThread((prev) => ({
      ...prev,
      [activeThreadId]: [
        ...(prev[activeThreadId] ?? []),
        {
          id: optimisticId,
          role: 'user',
          content: text,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    setInputByThread((prev) => ({ ...prev, [activeThreadId]: '' }));
    setLoadingByThread((prev) => ({ ...prev, [activeThreadId]: true }));

    try {
      const res = await researchApi.sendChatMessage(sessionId, activeThreadId, text, {
        parse_entities: parseEntities,
        contextual_list: contextualList,
      });
      const reply = res.reply;
      setAgentConfig((agentCfg) => {
        return agentCfg
          ? { ...agentCfg, model: reply.model ?? agentCfg.model }
          : { provider: 'unknown', model: reply.model ?? 'unknown' };
      });
      setMessagesByThread((prev) => {
        const threadMessages = prev[activeThreadId] ?? [];
        const withRealUserId = threadMessages.map((m) => (m.id === optimisticId ? { ...m, id: res.user_message_id } : m));
        return {
          ...prev,
          [activeThreadId]: [
            ...withRealUserId,
            {
              id: reply.acm_id,
              role: reply.role,
              content: reply.content,
              model: reply.model,
              usage: reply.usage,
              envelope: reply.envelope ?? res.envelope ?? undefined,
              queryState: res.query_state,
              contextualItems: reply.contextual_items,
              serverId: res.server_id ?? undefined,
              bankId: res.bank_id ?? undefined,
              createdAt: reply.acm_created_at,
            },
          ],
        };
      });
      // Bump message count for the thread locally.
      setThreads((prev) =>
        prev.map((th) =>
          th.act_id === activeThreadId
            ? { ...th, message_count: (th.message_count ?? 0) + 2 }
            : th
        )
      );
    } catch (err) {
      logger.error('Failed to send chat message', err);
      toast.error(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`);
      setMessagesByThread((prev) => ({
        ...prev,
        [activeThreadId]: (prev[activeThreadId] ?? []).filter((m) => m.id !== optimisticId),
      }));
    } finally {
      setLoadingByThread((prev) => ({ ...prev, [activeThreadId]: false }));
    }
  }, [input, sessionId, activeThreadId, loading, agentConfig, parseEntities, contextualList]);

  const handleDeleteMessage = useCallback(
    async (messageId: number) => {
      if (sessionId == null || activeThreadId == null) return;
      try {
        await researchApi.deleteChatMessage(sessionId, activeThreadId, messageId);
        setMessagesByThread((prev) => ({
          ...prev,
          [activeThreadId]: (prev[activeThreadId] ?? []).filter((m) => m.id !== messageId),
        }));
      } catch (err) {
        logger.error('Failed to delete chat message', err);
        toast.error(`Failed to delete message: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [sessionId, activeThreadId]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      if (activeThreadId == null) return;
      setInputByThread((prev) => ({ ...prev, [activeThreadId]: value }));
    },
    [activeThreadId]
  );

  const handleCopyAqlToReflect = useCallback(
    (aql: string) => {
      if (!onCopyAqlToReflect) return;
      if (reflectQuery?.trim()) {
        setPendingAqlCopy({
          aql,
          onConfirm: () => {
            onCopyAqlToReflect(aql);
            toast.success('Copied to Reflect input');
          },
        });
        return;
      }
      onCopyAqlToReflect(aql);
      toast.success('Copied to Reflect input');
    },
    [onCopyAqlToReflect, reflectQuery]
  );

  const disabled = sessionId == null || activeThreadId == null || loading || creatingThread;

  return (
    <div className="flex flex-col h-full w-full min-h-0 overflow-hidden">
      <ChatTabs
        tabs={tabs}
        activeTabId={activeTabId}
        threads={threads}
        title="Chat"
        historyLoading={historyLoading}
        onSelect={setActiveTabId}
        onSelectThread={async (threadId) => {
          const thread = threads.find((th) => th.act_id === threadId);
          if (thread) openThread(thread);
        }}
        onCreateChat={handleCreateChat}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        onCloseTab={handleCloseTab}
        onCloseOthers={handleCloseOthers}
      />

      <div className="flex-1 min-h-0 p-0 relative flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 min-h-0 p-3 overflow-y-auto">
          {messages.length === 0 && !historyLoading && (
            <div className="h-full flex flex-col items-center justify-center text-muted-fg text-sm gap-2">
              <ArchitxtIcon className="h-8 w-8 opacity-50" />
              <p>
                {sessionId == null || activeThreadId == null
                  ? 'Select or create a chat to start.'
                  : 'Ask the agent to explore, synthesize, or edit the workspace.'}
              </p>
            </div>
          )}
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <MemoizedChatMessage
                key={m.id}
                m={m}
                isExpanded={expandedAgentCards.has(m.id)}
                onToggleExpand={handleToggleExpand}
                onDelete={handleRequestDelete}
                onCopyToPage={onCopyToCuratedPage}
                onSelectModel={onSelectModel}
                onCopyAqlToReflect={handleCopyAqlToReflect}
              />
            ))}
            {loading && (
              <div className="flex gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-surface-inset border-border-default">
                  <ArchitxtIcon className="h-4 w-4 text-muted-fg" />
                </div>
                <div className="bg-surface-inset text-muted-fg border border-border-default rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking…
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-border-default p-2 flex gap-2 items-end shrink-0">
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-4 px-1">
              <label className="flex items-center gap-2 text-xs text-muted-fg cursor-pointer select-none">
                <Switch
                  size="sm"
                  checked={parseEntities}
                  onCheckedChange={(checked) =>
                    setParseEntitiesByThread((prev) => ({ ...prev, [activeThreadId!]: checked }))
                  }
                  disabled={disabled}
                />
                Parse Entities
              </label>
              <label
                className={cn(
                  "flex items-center gap-2 text-xs cursor-pointer select-none",
                  isAqlThread ? "text-muted-fg/50 cursor-not-allowed" : "text-muted-fg"
                )}
                title={isAqlThread ? "Contextual list is disabled in AQL chats" : undefined}
              >
                <Switch
                  size="sm"
                  checked={contextualList}
                  onCheckedChange={(checked) => {
                    if (isAqlThread) return;
                    setContextualListByThread((prev) => ({ ...prev, [activeThreadId!]: checked }));
                  }}
                  disabled={disabled || isAqlThread}
                />
                Contextual List
              </label>
            </div>
            <ChatInput
              value={input}
              onChange={handleInputChange}
              onSubmit={handleSend}
              placeholder={
                sessionId == null
                  ? 'Select a session…'
                  : activeThreadId == null
                    ? 'Select or create a chat…'
                    : activeThread?.is_aql
                      ? 'Describe the AQL query you want to build. Type [[ to reference entities and edges. Every response generates a structured AQL query.'
                      : 'Ask questions to retrieve summary, graph and contextual data. Type [[ to show entities and edge list.'
              }
              disabled={disabled}
              availableEntities={availableEntities}
              availableEdges={availableEdges}
              className="min-h-[104px] bg-surface-inset text-sm rounded-md border border-input"
            />
          </div>
          <Button
            size="icon"
            onClick={() => void handleSend()}
            disabled={disabled || !input.trim()}
            aria-label="Send message"
            className="shrink-0 h-[104px] w-[56px] bg-accent-primary-solid hover:bg-accent-primary-solid-hover text-foreground-default disabled:opacity-100 disabled:bg-accent-primary-solid/40 disabled:text-foreground-faint"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete?.type === 'message'}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete message"
        description="Remove this chat entry? It will be deleted from the chat history."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (pendingDelete?.type === 'message' && pendingDelete.messageId != null) {
            void handleDeleteMessage(pendingDelete.messageId);
          }
        }}
      />

      <ConfirmDialog
        open={!!pendingAqlCopy}
        onOpenChange={(open) => {
          if (!open) setPendingAqlCopy(null);
        }}
        title="Overwrite Reflect input?"
        description="The Reflect input already contains text. Replacing it will discard the existing query."
        confirmLabel="Replace"
        onConfirm={() => {
          pendingAqlCopy?.onConfirm();
          setPendingAqlCopy(null);
        }}
      />

    </div>
  );
});
