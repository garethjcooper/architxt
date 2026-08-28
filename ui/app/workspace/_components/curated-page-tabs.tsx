'use client';

import { useState, useCallback } from 'react';
import { Plus, X, Trash2, Pencil, FileText, ChevronDown } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
}: CuratedPageTabsProps) {
  const [pagesOpen, setPagesOpen] = useState(false);
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
    setPagesOpen(false);
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
    setPagesOpen(false);
  }, [confirmDelete, onDeleteCuratedPage]);

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 bg-[oklch(0.18_0_0)] min-h-10">
      <Popover open={pagesOpen} onOpenChange={setPagesOpen}>
        <PopoverTrigger>
          <span
            className="flex items-center gap-1 text-[10px] text-white/70 hover:text-white px-2 py-1 rounded hover:bg-white/5 shrink-0 cursor-pointer"
          >
            <FileText className="h-3 w-3" />
            Pages
            <ChevronDown className="h-3 w-3" />
          </span>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 p-0 bg-[oklch(0.18_0_0)] border-white/10 text-white/90"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-[11px] font-medium text-white/80">Curated pages</span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {curatedPages.length === 0 && (
              <div className="px-3 py-2 text-[11px] text-white/40">No curated pages yet.</div>
            )}
            {curatedPages.map((page) => {
              const isOpen = page.id != null && curatedTabIds.has(page.id);
              return (
                <div
                  key={page.id}
                  className="flex items-center gap-1 px-2 py-1.5 hover:bg-white/5 group"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onSelectCuratedPage(page.id);
                      setPagesOpen(false);
                    }}
                    className={cn(
                      'flex-1 text-left text-[11px] truncate',
                      isOpen ? 'text-emerald-300' : 'text-white/70'
                    )}
                  >
                    {page.intent_text || `Page ${page.id}`}
                  </button>
                  <div className="flex items-center opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingPage({ stepId: page.id, title: page.intent_text || `Page ${page.id}` });
                      }}
                      className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10"
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto custom-scrollbar">
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          const isCurated = tab.kind === 'curated';
          return (
            <div
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className={cn(
                'group/tab flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] cursor-pointer shrink-0 select-none transition-colors',
                isActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-black/20 border-white/5 text-white/60 hover:bg-white/5 hover:text-white/80',
                isCurated ? 'pl-2.5' : 'pl-2'
              )}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  isCurated ? 'bg-purple-400' : 'bg-emerald-400'
                )}
              />
              <span className="truncate max-w-[10rem]" title={tab.label}>
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
                  'p-0.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-opacity',
                  tab.pinned ? 'opacity-0 cursor-default' : 'opacity-0 group-hover/tab:opacity-100'
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
        <button
          type="button"
          onClick={() => {
            if (!activeCuratedTab?.stepId) return;
            setConfirmDelete({ stepId: activeCuratedTab.stepId, title: activeCuratedTab.label });
          }}
          disabled={!activeCuratedTab}
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-[oklch(0.21_0_0)] border border-white/10 text-rose-400 hover:bg-rose-950/30 hover:border-rose-500/30 disabled:opacity-30 transition-colors"
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
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-[oklch(0.21_0_0)] border border-white/10 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 transition-colors"
          title="Rename active page"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="h-6 w-6 inline-flex items-center justify-center rounded bg-[oklch(0.21_0_0)] border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
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
          <div className="rounded-lg border border-white/10 bg-[oklch(0.18_0_0)] p-4 w-80 shadow-lg">
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
              className="w-full px-2 py-1.5 mb-4 rounded bg-black/30 border border-white/10 text-xs text-white/90 placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
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
