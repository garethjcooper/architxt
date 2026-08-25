'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X, Trash2, Edit3, FileText, ChevronDown } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
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
}

interface CuratedPageTabsProps {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  curatedPages: ResearchStepSummary[];
  onSelect: (tabId: string) => void;
  onCreateCuratedPage: (title: string) => Promise<void>;
  onRenameCuratedPage: (stepId: number, title: string) => Promise<void>;
  onDeleteCuratedPage: (stepId: number) => Promise<void>;
  onCloseTab: (tabId: string, kind: TabKind, isEmpty: boolean) => void;
  onAddViewTab?: (label: string, sourceId?: string) => void;
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

export function CuratedPageTabs({
  tabs,
  activeTabId,
  curatedPages,
  onSelect,
  onCreateCuratedPage,
  onRenameCuratedPage,
  onDeleteCuratedPage,
  onCloseTab,
}: CuratedPageTabsProps) {
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ stepId: number; title: string } | null>(null);

  useEffect(() => {
    if (editingTabId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTabId]);

  const startRename = useCallback((tab: WorkspaceTab) => {
    if (tab.kind !== 'curated' || tab.stepId == null) return;
    setEditingTabId(tab.id);
    setEditingValue(tab.label);
  }, []);

  const commitRename = useCallback(async () => {
    if (!editingTabId) return;
    const tab = tabs.find((t) => t.id === editingTabId);
    if (!tab || tab.kind !== 'curated' || tab.stepId == null) {
      setEditingTabId(null);
      return;
    }
    const trimmed = editingValue.trim();
    if (trimmed && trimmed !== tab.label) {
      await onRenameCuratedPage(tab.stepId, trimmed);
    }
    setEditingTabId(null);
  }, [editingTabId, editingValue, tabs, onRenameCuratedPage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void commitRename();
      } else if (e.key === 'Escape') {
        setEditingTabId(null);
      }
    },
    [commitRename]
  );

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

  const handlePageListRename = useCallback(
    async (stepId: number, current: string) => {
      const next = window.prompt('Rename curated page', current);
      if (!next || next.trim() === current) return;
      await onRenameCuratedPage(stepId, next.trim());
    },
    [onRenameCuratedPage]
  );

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
            <Button variant="ghost" size="sm" onClick={handleCreate} className="h-6 px-2 text-[10px]">
              <Plus className="h-3 w-3 mr-1" /> New
            </Button>
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
                      onSelect(`curated-${page.id}`);
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
                        void handlePageListRename(page.id, page.intent_text || `Page ${page.id}`);
                      }}
                      className="p-1 rounded text-white/40 hover:text-white hover:bg-white/10"
                      title="Rename"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({ stepId: page.id, title: page.intent_text || `Page ${page.id}` });
                      }}
                      className="p-1 rounded text-white/40 hover:text-rose-400 hover:bg-rose-950/30"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
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
              {editingTabId === tab.id && isCurated ? (
                <Input
                  ref={editInputRef}
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={() => void commitRename()}
                  onClick={(e) => e.stopPropagation()}
                  className="h-5 min-w-[6rem] max-w-[12rem] px-1 py-0 text-[11px] bg-black/30 border-white/10"
                />
              ) : (
                <span
                  className="truncate max-w-[10rem]"
                  onClick={(e) => {
                    if (isCurated) {
                      e.stopPropagation();
                      startRename(tab);
                    }
                  }}
                  title={tab.label}
                >
                  {tab.label}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(tab.id, tab.kind, false);
                }}
                className="opacity-0 group-hover/tab:opacity-100 p-0.5 rounded text-white/40 hover:text-white hover:bg-white/10 transition-opacity"
                title={isCurated ? 'Close tab' : 'Close view'}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="rounded-lg border border-white/10 bg-[oklch(0.18_0_0)] p-4 w-80 shadow-lg">
            <div className="text-sm font-medium text-white/90 mb-2">Delete curated page?</div>
            <p className="text-xs text-white/60 mb-4">
              “{confirmDelete.title}” will be removed from the session.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void handleConfirmDelete()}>
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
