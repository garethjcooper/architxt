'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  EntityInfoWithContent,
  MODEL_TAB_LABELS,
  renderModelContent,
} from './model-content-utils';

interface EntityInfoCardProps {
  id: string;
  info: EntityInfoWithContent;
  onDetach: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  selectedModelKey: string | null;
  onSelectModel: (key: string) => void;
  origin?: 'scope' | 'manual' | 'derived';
}


function EntityInfoCard({
  id,
  info,
  onDetach,
  expanded,
  onToggleExpand,
  selectedModelKey,
  onSelectModel,
  origin = 'manual',
}: EntityInfoCardProps) {
  const contentMap = info.content;
  const tabs = useMemo(() => {
    const list: { key: string; label: string; items: { key: string; label: string; extId?: string }[] }[] = [];
    if (info.contextual_refs.length > 0) {
      list.push({
        key: 'contextual_refs',
        label: MODEL_TAB_LABELS.contextual_refs,
        items: info.contextual_refs.map((ref, i) => ({
          key: `contextual-${ref.role}-${ref.ext_id || i}`,
          label: ref.ext_id || ref.role || 'ref',
          extId: ref.ext_id,
        })),
      });
    }
    if (info.derived_models.length > 0) {
      list.push({
        key: 'derived_models',
        label: MODEL_TAB_LABELS.derived_models,
        items: info.derived_models.map((m) => ({
          key: `derived-${m.id || m.ext_id}`,
          label: m.name || m.ext_id || 'derived model',
          extId: m.ext_id,
        })),
      });
    }
    if (info.plain_models.length > 0) {
      list.push({
        key: 'plain_models',
        label: MODEL_TAB_LABELS.plain_models,
        items: info.plain_models.map((m) => ({
          key: `plain-${m.id || m.ext_id}`,
          label: m.name || m.ext_id || 'plain model',
          extId: m.ext_id,
        })),
      });
    }
    if (info.edge_contexts.length > 0) {
      list.push({
        key: 'edge_contexts',
        label: MODEL_TAB_LABELS.edge_contexts,
        items: info.edge_contexts.map((ctx, i) => ({
          key: `edge-${ctx.edge_id || i}`,
          label: `${ctx.source_id} → ${ctx.target_id}`,
          extId: ctx.refs[0]?.ext_id,
        })),
      });
    }
    return list;
  }, [info]);

  const activeTab = useMemo(() => {
    const preferred = selectedModelKey ? tabs.find((t) => t.key === selectedModelKey || t.items.some((i) => i.key === selectedModelKey)) : undefined;
    return preferred || tabs[0];
  }, [tabs, selectedModelKey]);

  const selectedItem = useMemo(() => {
    if (!activeTab) return null;
    return activeTab.items.find((i) => i.key === selectedModelKey) || activeTab.items[0] || null;
  }, [activeTab, selectedModelKey]);

  const selectedContent = useMemo(() => {
    if (!selectedItem?.extId || !contentMap) return undefined;
    return contentMap[selectedItem.extId];
  }, [selectedItem, contentMap]);

  const hasModels = tabs.length > 0;

  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 text-left"
          title={expanded ? 'Collapse model content' : 'Expand model content'}
        >
          <div className="text-sm font-medium text-emerald-200 truncate">
            {info.catalog?.name || info.graph_node?.display_name || id}
          </div>
          <div className="text-xs text-white/50 truncate">{id}</div>
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-white/40 hover:text-white shrink-0"
          onClick={onDetach}
        >
          ×
        </Button>
      </div>

      {info.catalog?.description && (
        <div className="text-xs text-white/70 line-clamp-2">{info.catalog.description}</div>
      )}

      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
          {origin === 'scope' ? 'session scope' : origin === 'manual' ? 'attached' : 'derived'}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1">
        {info.contextual_refs.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.contextual_refs.length} refs
          </Badge>
        )}
        {info.derived_models.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.derived_models.length} derived
          </Badge>
        )}
        {info.plain_models.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.plain_models.length} plain
          </Badge>
        )}
        {info.edge_contexts.length > 0 && (
          <Badge variant="outline" className="text-[10px] h-4 px-1 border-white/20">
            {info.edge_contexts.length} edges
          </Badge>
        )}
      </div>

      {hasModels && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-6 text-[11px] text-white/60 hover:text-white/90 justify-between px-1"
          onClick={onToggleExpand}
        >
          <span>{expanded ? 'Hide' : 'Show'} model content</span>
          <span className="text-[10px] text-white/40">
            {tabs.reduce((acc, t) => acc + t.items.length, 0)} items
          </span>
        </Button>
      )}

      {expanded && hasModels && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-1">
            {tabs.map((tab) => (
              <Button
                key={tab.key}
                variant={activeTab?.key === tab.key ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-6 text-[10px] px-2',
                  activeTab?.key === tab.key ? 'bg-emerald-900/30 text-emerald-200' : 'text-white/50 hover:text-white/90'
                )}
                onClick={() => onSelectModel(tab.items[0]?.key || tab.key)}
              >
                {tab.label}
                <span className="ml-1 text-[9px] text-white/50">{tab.items.length}</span>
              </Button>
            ))}
          </div>

          {activeTab && (
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-0.5">
                {activeTab.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onSelectModel(item.key)}
                    className={cn(
                      'text-left rounded px-2 py-1 text-[11px] transition-colors truncate',
                      selectedItem?.key === item.key
                        ? 'bg-emerald-500/15 text-emerald-200'
                        : 'text-white/70 hover:bg-white/5'
                    )}
                    title={item.label}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {renderModelContent(selectedContent)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export { EntityInfoCard, type EntityInfoCardProps };
