'use client';

import { useState, useCallback } from 'react';
import { Plus, X, Trash2, Pencil, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { ResearchStepSummary } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export type TabKind = 'curated' | 'view';

export interface WorkspaceTab {
  /** Unique local id for React keys. */
  id: string;
  kind: TabKind;
  /** Display label. */
  label: string;
  /** For curated tabs: the underlying step id. */
  stepId?: number;
  /** For view tabs: optional source identifier for restoring selection. */
  sourceId?: string;
  /** Pinned tabs cannot be closed by the user. */
  pinned?: boolean;
  /** For curated tabs: true when the page has unsaved edits. */
  dirty?: boolean;
}

export const ANCHOR_TAB_ID = 'view-anchor';

export function makeAnchorTab(label = 'Preview'): WorkspaceTab {
  return { id: ANCHOR_TAB_ID, kind: 'view', label, pinned: true };
}

interface CuratedPageTabsProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  curatedPages: ResearchStepSummary[];
  onSelect: (tabId: string) => void;
  onSelectCuratedPage: (stepId: number) => void;
  onCreateCuratedPage: (title: string) => Promise<void>;
  onRenameCuratedPage: (stepId: number, title: string) => Promise<void>;
  onDeleteCuratedPage: (stepId: number) => Promise<void>;
  onCloseTab: (tabId: string, kind: TabKind, isEmpty: boolean) => void;
  onCloseAllViews?: () => void;
  /** Whether the active curated page has pending changes. */
  activePageDirty?: boolean;
  /** Called when the user clicks the Save button for the active curated page. */
  onSaveActivePage?: () => void;
}

export function CuratedPageTabs({
  tabs,
  activeTabId,
  curatedPages,
  onSelect,
  onSelectCuratedPage,
  onCreateCuratedPage,
  onRenameCuratedPage,
  onDeleteCuratedPage,
  onCloseTab,
  onCloseAllViews,
  activePageDirty = false,
  onSaveActivePage,
}: CuratedPageTabsProps) {
  const [confirmDelete, setConfirmDelete] = useState<{ stepId: number; title: string } | null>(null);
  const [renamingPage, setRenamingPage] = useState<{ stepId: number; title: string } | null>(null);

  const activeCuratedTab = tabs.find((t) => t.id === activeTabId && t.kind === 'curated' && t.stepId != null);

  const curatedTabIds = new Set(
    tabs.filter((t) => t.kind === 'curated' && t.stepId != null).map((t) => t.stepId!)
  );

  const handleCreate = useCallback(async () => {
    const base = 'Page';
    let index = 1;
    while (
      tabs.some((t) => t.kind === 'curated' && t.label === `${base} ${index}`) ||
      curatedPages.some((p) => p.intent_text === `${base} ${index}`)
    ) {
      index++;
    }
    await onCreateCuratedPage(`${base} ${index}`);
  }, [tabs, curatedPages, onCreateCuratedPage]);

  const handleConfirmRename = useCallback(async () => {
    if (!renamingPage) return;
    const next = renamingPage.title.trim();
    if (!next) {
      setRenamingPage(null);
      return;
    }
    await onRenameCuratedPage(renamingPage.stepId, next);
    setRenamingPage(null);
  }, [renamingPage, onRenameCuratedPage]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    await onDeleteCuratedPage(confirmDelete.stepId);
    setConfirmDelete(null);
  }, [confirmDelete, onDeleteCuratedPage]);

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-surface-overlay min-h-10">
      <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto custom-scrollbar">
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          const isCurated = tab.kind === 'curated';
          return (
            <div
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className={cn(
                'group/tab relative flex items-center gap-1.5 pr-7 pl-2 py-1 rounded border text-[11px] cursor-pointer shrink-0 select-none transition-colors max-w-[18rem]',
                isActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-black/20 border-white/5 text-white/60 hover:bg-white/5 hover:text-white/80'
              )}
            >
              <span
                className={cn(
                  'absolute left-0 top-1 bottom-1 w-[3px] rounded-l shrink-0',
                  isCurated ? 'bg-emerald-400' : 'bg-white/30'
                )}
              />
              <span className={cn('truncate min-w-0', tab.kind === 'curated' && tab.dirty && 'italic pr-1')} title={tab.label}>
                {tab.label}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (tab.pinned) return;
                  onCloseTab(tab.id, tab.kind, false);
                }}
                className={cn(
                  'absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-opacity',
                  tab.pinned ? 'opacity-0 cursor-default pointer-events-none' : 'opacity-0 group-hover/tab:opacity-100'
                )}
                title={tab.pinned ? 'Pinned' : isCurated ? 'Close tab' : 'Close view'}
                disabled={tab.pinned}
              >
                {tab.pinned ? null : <X className="h-3 w-3" />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-white/10">
        {onCloseAllViews && (
          <button
            type="button"
            onClick={() => onCloseAllViews()}
            disabled={tabs.filter((t) => t.kind === 'view' && !t.pinned).length === 0}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors"
            title="Close all view tabs"
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
            } else if (value.startsWith('page-')) {
              const pageId = Number(value.slice('page-'.length));
              if (!Number.isNaN(pageId)) {
                onSelectCuratedPage(pageId);
              }
            }
          }}
          className="h-6 rounded-md border border-white/10 bg-surface-panel px-1.5 text-[11px] text-white/80 focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none min-w-[6rem] max-w-[10rem]"
        >
          <option value="">Pages...</option>
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
          {curatedPages
            .filter((p) => p.id != null && !curatedTabIds.has(p.id))
            .map((p) => (
              <option key={`page-${p.id}`} value={`page-${p.id}`}>
                {p.intent_text || `Page ${p.id}`}
              </option>
            ))}
        </select>
        <button
          type="button"
          onClick={() => onSaveActivePage?.()}
          disabled={!activeCuratedTab || !activePageDirty}
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-white/10 text-emerald-400 hover:bg-emerald-950/30 hover:border-emerald-500/30 disabled:opacity-30 transition-colors"
          title="Save active page"
        >
          <Save className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!activeCuratedTab?.stepId) return;
            setConfirmDelete({ stepId: activeCuratedTab.stepId, title: activeCuratedTab.label });
          }}
          disabled={!activeCuratedTab}
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-white/10 text-rose-400 hover:bg-rose-950/30 hover:border-rose-500/30 disabled:opacity-30 transition-colors"
          title="Delete active page"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (!activeCuratedTab?.stepId) return;
            setRenamingPage({ stepId: activeCuratedTab.stepId, title: activeCuratedTab.label });
          }}
          disabled={!activeCuratedTab}
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors"
          title="Rename active page"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          title="Add page"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
        title="Delete curated page?"
        description={confirmDelete ? `“${confirmDelete.title}” will be removed from the session.` : ''}
        confirmLabel="Delete"
        onConfirm={() => void handleConfirmDelete()}
        variant="destructive"
      />

      {renamingPage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-lg border border-white/10 bg-surface-overlay p-4 w-80 shadow-lg">
            <div className="text-sm font-medium text-white/90 mb-2">Rename curated page</div>
            <input
              type="text"
              value={renamingPage.title}
              onChange={(e) => setRenamingPage({ ...renamingPage, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleConfirmRename();
                } else if (e.key === 'Escape') {
                  setRenamingPage(null);
                }
              }}
              className="w-full px-2 py-1.5 mb-4 rounded bg-black/30 border border-white/10 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-focus-ring/80"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRenamingPage(null)}>
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
