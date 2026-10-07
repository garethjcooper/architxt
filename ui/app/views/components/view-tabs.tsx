'use client';

import { Plus, X, Trash2, Pencil, Clock, Undo2, Redo2, Search, LayoutTemplate } from 'lucide-react';
import { ViewExportMenu } from './view-export-menu';
import type { Node, Edge } from '@xyflow/react';
import { useCallback, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { View } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PanelHeader } from '@/app/workspace/_components/panel-layout';
import type { LayoutOptions, RoutingTunables, NodeTunables, BackgroundVariantOption, EdgeMergeMode } from './view-editor-options';
import { ViewControls } from './view-controls';

export interface ViewTab {
  id: string;
  viewId?: string;
  label: string;
}

export function generateNewViewName(tabs: ViewTab[], views: View[]): string {
  const base = 'View';
  let index = 1;
  const existing = new Set([
    ...tabs.map((t) => t.label),
    ...views.map((v) => v.name),
  ]);
  while (existing.has(`${base} ${index}`)) {
    index++;
  }
  return `${base} ${index}`;
}

interface ViewTabsProps {
  tabs: ViewTab[];
  activeTabId: string | null;
  views: View[];
  deletingTabIds: string[];
  layoutOptions: LayoutOptions;
  routingTunables: RoutingTunables;
  nodeTunables?: NodeTunables;
  onLayoutOptionsChange: (opts: LayoutOptions) => void;
  onRoutingTunablesChange: (opts: RoutingTunables) => void;
  onNodeTunablesChange?: (opts: NodeTunables) => void;
  onResetControls?: () => void;
  onAutoLayout?: () => void;
  autoLayouting?: boolean;
  showEdgeLabels?: boolean;
  onShowEdgeLabelsChange?: (value: boolean) => void;
  showNodeIds?: boolean;
  onShowNodeIdsChange?: (value: boolean) => void;
  showHandles?: boolean;
  onShowHandlesChange?: (value: boolean) => void;
  showNodeColorBar?: boolean;
  onShowNodeColorBarChange?: (value: boolean) => void;
  backgroundVariant?: BackgroundVariantOption;
  onBackgroundVariantChange?: (value: BackgroundVariantOption) => void;
  topK?: number;
  onTopKChange?: (value: number) => void;
  totalNodes?: number;
  onSelect: (tabId: string) => void;
  onSelectView: (viewId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreate: () => void;
  onRename: (tab: ViewTab, nextLabel: string) => void;
  onDelete: (tab: ViewTab) => void;
  onToggleTimeline?: () => void;
  onDeleteNotes: () => void;
  onFind: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canDeleteNotes?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  canFind?: boolean;
  exportNodes?: Node[];
  exportEdges?: Edge[];
  exportContainer?: HTMLElement | null;
  onSendToWorkspace?: () => void;
  hasWorkspaceSession?: boolean;
}

export function ViewTabs({
  tabs,
  activeTabId,
  views,
  deletingTabIds,
  layoutOptions,
  routingTunables,
  nodeTunables,
  onLayoutOptionsChange,
  onRoutingTunablesChange,
  onNodeTunablesChange,
  onResetControls,
  onAutoLayout,
  autoLayouting,
  showEdgeLabels,
  onShowEdgeLabelsChange,
  showNodeIds,
  onShowNodeIdsChange,
  showHandles,
  onShowHandlesChange,
  showNodeColorBar,
  onShowNodeColorBarChange,
  backgroundVariant,
  onBackgroundVariantChange,
  topK,
  onTopKChange,
  totalNodes,
  onSelect,
  onSelectView,
  onCloseTab,
  onCreate,
  onRename,
  onDelete,
  onToggleTimeline,
  onDeleteNotes,
  onFind,
  onUndo,
  onRedo,
  canDeleteNotes,
  canUndo,
  canRedo,
  canFind,
  exportNodes,
  exportEdges,
  exportContainer,
  onSendToWorkspace,
  hasWorkspaceSession,
}: ViewTabsProps) {
  const [renaming, setRenaming] = useState<ViewTab | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ViewTab | null>(null);
  const [controlsOpen, setControlsOpen] = useState(false);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleStartRename = useCallback(() => {
    if (!activeTab) return;
    setRenaming(activeTab);
    setRenameValue(activeTab.label);
  }, [activeTab]);

  const handleConfirmRename = useCallback(() => {
    if (!renaming) return;
    const next = renameValue.trim();
    if (next && next !== renaming.label) {
      onRename(renaming, next);
    }
    setRenaming(null);
  }, [renaming, renameValue, onRename]);

  const handleStartDelete = useCallback(() => {
    if (!activeTab) return;
    setConfirmDelete(activeTab);
  }, [activeTab]);

  const openViewIds = new Set(tabs.filter((t) => t.viewId).map((t) => t.viewId!));
  const availableViews = views.filter((v) => v.id && !openViewIds.has(v.id));

  const handleConfirmDelete = useCallback(() => {
    if (!confirmDelete) return;
    onDelete(confirmDelete);
    setConfirmDelete(null);
  }, [confirmDelete, onDelete]);

  const exportContainerResolved = exportContainer ?? null;

  return (
    <div className="relative flex flex-col shrink-0 border-b border-border-default bg-surface-overlay">
      <PanelHeader
        title="Views"
        actions={
          <label className="flex items-center gap-1.5 text-[10px] text-accent-primary-fg cursor-pointer select-none">
            <Switch
              checked={controlsOpen}
              onCheckedChange={(checked) => setControlsOpen(Boolean(checked))}
              size="sm"
            />
            Controls
          </label>
        }
      />
      {controlsOpen && (
        <ViewControls
          layoutOptions={layoutOptions}
          routingTunables={routingTunables}
          nodeTunables={nodeTunables}
          showEdgeLabels={showEdgeLabels}
          onShowEdgeLabelsChange={onShowEdgeLabelsChange}
          showNodeIds={showNodeIds}
          onShowNodeIdsChange={onShowNodeIdsChange}
          showHandles={showHandles}
          onShowHandlesChange={onShowHandlesChange}
          showNodeColorBar={showNodeColorBar}
          onShowNodeColorBarChange={onShowNodeColorBarChange}
          backgroundVariant={backgroundVariant}
          onBackgroundVariantChange={onBackgroundVariantChange}
          topK={topK}
          onTopKChange={onTopKChange}
          totalNodes={totalNodes}
          onLayoutOptionsChange={onLayoutOptionsChange}
          onRoutingTunablesChange={onRoutingTunablesChange}
          onNodeTunablesChange={onNodeTunablesChange}
          onReset={onResetControls}
          onAutoLayout={onAutoLayout}
          autoLayouting={autoLayouting}
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
                <span className="truncate min-w-0" title={tab.label}>
                  {tab.label}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded text-foreground-subtle hover:text-foreground-default hover:bg-surface-panel transition-opacity opacity-0 group-hover/tab:opacity-100"
                  title="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 shrink-0 pl-2 border-l border-border-default">
          <select
            value={activeTabId ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              if (tabs.some((t) => t.id === value)) {
                onSelect(value);
              } else if (value.startsWith('view-')) {
                const viewId = value.slice('view-'.length);
                if (viewId) {
                  onSelectView(viewId);
                }
              }
            }}
            className="h-6 rounded-md border border-border-default bg-surface-panel px-1.5 text-[11px] text-foreground-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none min-w-[6rem] max-w-[10rem]"
          >
            <option value="">Views...</option>
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
            {views
              .filter((v) => availableViews.some((av) => av.id === v.id))
              .map((v) => (
                <option key={`view-${v.id}`} value={`view-${v.id}`}>
                  {v.name || `View ${v.id}`}
                </option>
              ))}
          </select>

          <button
            type="button"
            onClick={handleStartRename}
            disabled={!activeTab}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors"
            title="Rename active view"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={handleStartDelete}
            disabled={!activeTab || deletingTabIds.includes(activeTab?.id ?? '')}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-destructive-fg hover:bg-destructive-bg-hover hover:border-destructive-bd disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:border-border-default transition-colors"
            title="Delete active view"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onCreate}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default transition-colors"
            title="New view"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>

          <div className="w-px h-5 bg-border-subtle mx-1" />

          {onToggleTimeline && (
            <button
              type="button"
              onClick={onToggleTimeline}
              className="h-6 px-2 inline-flex items-center justify-center gap-1 rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default transition-colors text-[11px]"
              title="Toggle timeline"
            >
              <Clock className="h-3.5 w-3.5" /> Timeline
            </button>
          )}

          <button
            type="button"
            onClick={onDeleteNotes}
            disabled={!canDeleteNotes}
            className="h-6 px-2 inline-flex items-center justify-center gap-1 rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors text-[11px]"
            title={canDeleteNotes ? 'Delete selected (Del)' : 'Select an item to delete'}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>

          <button
            type="button"
            onClick={onFind}
            disabled={!canFind}
            className="h-6 px-2 inline-flex items-center justify-center gap-1 rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors text-[11px]"
            title={canFind ? 'Find in entities panel (F3)' : 'Select an item to find'}
          >
            <Search className="h-3.5 w-3.5" /> Find
          </button>

          <select
            value={layoutOptions.edgeMergeMode}
            onChange={(e) => onLayoutOptionsChange({ ...layoutOptions, edgeMergeMode: e.target.value as EdgeMergeMode })}
            className="h-6 rounded-md border border-border-default bg-surface-panel px-1.5 text-[11px] text-foreground-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none"
            title="Edge merge mode"
          >
            <option value="full">Merge: Full</option>
            <option value="byType">Merge: Type</option>
            <option value="all">Merge: None</option>
          </select>

          <ViewExportMenu
            container={exportContainerResolved}
            nodes={exportNodes ?? []}
            edges={exportEdges ?? []}
            mermaidDirection={layoutOptions.direction}
            mermaidTitle={activeTab?.label}
          />

          <button
            type="button"
            onClick={() => {
              onSendToWorkspace?.();
            }}
            disabled={!onSendToWorkspace || !hasWorkspaceSession}
            className="h-6 px-2 inline-flex items-center justify-center gap-1 rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors text-[11px]"
            title={hasWorkspaceSession ? 'Send view to workspace page' : 'Select a server/bank to enable workspace export'}
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            Save to...
          </button>

          <div className="w-px h-5 bg-border-subtle mx-1" />

          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors"
            title="Undo (Ctrl/Cmd+Z)"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="h-6 w-6 inline-flex items-center justify-center rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors"
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Delete view"
        description={confirmDelete ? `Are you sure you want to delete "${confirmDelete.label}"? This cannot be undone.` : ''}
        onConfirm={handleConfirmDelete}
        variant="destructive"
        confirmLabel="Delete"
      />

      {renaming && (
        <Dialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
          <DialogContent showCloseButton={false} className="max-w-md">
            <DialogHeader>
              <DialogTitle>Rename view</DialogTitle>
            </DialogHeader>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleConfirmRename();
                } else if (e.key === 'Escape') {
                  setRenaming(null);
                }
              }}
              autoFocus
            />
            <DialogFooter showCloseButton={false}>
              <Button variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmRename}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
