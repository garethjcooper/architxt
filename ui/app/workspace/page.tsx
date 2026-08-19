'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { AqlEditor, type EntityLike as AqlEntityLike, type EdgeLike as AqlEdgeLike } from '@/components/aql-editor';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { serversApi, contextualGraphApi, entityInfoApi, hindsightApi, type Server, type EntityInfo, type MentalModelContent } from '@/lib/api/client';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import {
  DisplayNode,
  DisplayEdge,
  ModelRef,
  EntityListRow,
  EdgeListRow,
  PatchRefRow,
  backendNodeToDisplayNode,
  backendEdgeToDisplayEdge,
  isGroundedNode,
  isCandidateNode,
  isCandidateEdge,
  isGroundedEdge,
  getContextualPatchRefs,
  Section,
  renderValue,
} from '@/lib/contextual-graph/display';
import { RefreshCw, Plus, FileText, GripVertical, Sparkles } from 'lucide-react';

const logger = createLogger('WorkspacePage');

type ModelContentEntry = { found: boolean; error?: string; mental_model?: MentalModelContent };

type EntityInfoWithContent = EntityInfo & { content?: Record<string, ModelContentEntry> };

function isGroundedNodeForWorkspace(node: DisplayNode): boolean {
  return isGroundedNode(node) && !isCandidateNode(node);
}

function isGroundedEdgeForWorkspace(edge: DisplayEdge): boolean {
  return isGroundedEdge(edge) && !isCandidateEdge(edge);
}

function extractReflectNarrative(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result !== 'object') return String(result);
  const obj = result as Record<string, unknown>;
  const candidateKeys = ['response', 'narrative', 'content', 'answer', 'output', 'structured_output', 'text', 'markdown'];
  for (const key of candidateKeys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  // Hindsight sometimes nests under data.
  if (typeof obj.data === 'string' && obj.data.trim()) return obj.data;
  if (typeof obj.data === 'object' && obj.data != null) {
    const data = obj.data as Record<string, unknown>;
    for (const key of candidateKeys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return JSON.stringify(result, null, 2);
}

function getModelContentText(content: MentalModelContent | undefined): string {
  if (!content) return '';
  if (typeof content.narrative === 'string' && content.narrative.trim()) return content.narrative;
  if (typeof content.concatenation === 'string' && content.concatenation.trim()) return content.concatenation;
  return '';
}

function renderModelContent(entry: ModelContentEntry | undefined): React.ReactNode {
  if (!entry) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-white/40">
        No content available.
      </div>
    );
  }
  if (entry.error) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-red-400">
        {entry.error}
      </div>
    );
  }
  if (!entry.found || !entry.mental_model) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-white/40">
        Model content not found.
      </div>
    );
  }
  const text = getModelContentText(entry.mental_model);
  if (text) {
    return <NarrativeViewer content={text} title="Content" viewMode="markdown" showIndex={false} className="h-48" />;
  }
  // No narrative/concatenation: render the full structured content as JSON.
  return (
    <div className="h-48 overflow-auto rounded border border-white/10 bg-black/20 p-2">
      {renderValue(entry.mental_model)}
    </div>
  );
}

const MODEL_TAB_LABELS: Record<string, string> = {
  contextual_refs: 'Context',
  derived_models: 'Derived',
  plain_models: 'Plain',
  edge_contexts: 'Edges',
};

interface EntityInfoCardProps {
  id: string;
  info: EntityInfoWithContent;
  onDetach: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
  selectedModelKey: string | null;
  onSelectModel: (key: string) => void;
}

function EntityInfoCard({
  id,
  info,
  onDetach,
  expanded,
  onToggleExpand,
  selectedModelKey,
  onSelectModel,
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

function PanelHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
      <div className="text-xs font-medium truncate">{title}</div>
      {count !== undefined && (
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-white/20 text-emerald-200/80">
          {count}
        </Badge>
      )}
    </div>
  );
}

function Panel({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <Card
      className={cn(
        'min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0',
        className
      )}
      style={style}
    >
      {children}
    </Card>
  );
}

function PanelContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <CardContent className={cn('flex-1 min-h-0 p-0 relative', className)}>
      {children}
    </CardContent>
  );
}

function ResizeHandle({
  direction,
  onMouseDown,
  title,
}: {
  direction: 'vertical' | 'horizontal';
  onMouseDown: (e: React.MouseEvent) => void;
  title?: string;
}) {
  const isHorizontal = direction === 'horizontal';
  return (
    <div
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      aria-label={title || `Resize ${direction} pane`}
      onMouseDown={onMouseDown}
      className={cn(
        'shrink-0 flex items-center justify-center group',
        isHorizontal
          ? 'h-3 cursor-row-resize flex-row'
          : 'w-3 cursor-col-resize flex-col'
      )}
      title={title}
    >
      <div
        className={cn(
          'rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors',
          isHorizontal ? 'w-16 h-1' : 'w-1 h-16'
        )}
      />
    </div>
  );
}

export default function WorkspacePage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingData, setLoadingData] = useState(false);

  const [entities, setEntities] = useState<DisplayNode[]>([]);
  const [edges, setEdges] = useState<DisplayEdge[]>([]);

  const [selectedEntity, setSelectedEntity] = useState<DisplayNode | null>(null);
  const [selectedPatch, setSelectedPatch] = useState<ModelRef | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<DisplayEdge | null>(null);

  const [spineSearch, setSpineSearch] = useState('');
  const [reflectQuery, setReflectQuery] = useState('');
  const [manuallyAttachedIds, setManuallyAttachedIds] = useState<string[]>([]);
  const [entityInfoMap, setEntityInfoMap] = useState<Record<string, EntityInfoWithContent> | null>(null);
  const [loadingEntityInfo, setLoadingEntityInfo] = useState(false);
  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(new Set());
  const [selectedModelKeys, setSelectedModelKeys] = useState<Record<string, string | null>>({});
  const [reflectResult, setReflectResult] = useState<unknown | null>(null);
  const [reflectLoading, setReflectLoading] = useState(false);
  const [reflectError, setReflectError] = useState<string | null>(null);

  const mentionedEntityIds = useMemo(() => {
    const mentioned: string[] = [];
    const tokenRegex = /\[\[((?:[^\[\]]|\[[^\]])+?)\]\]/g;
    let match;
    while ((match = tokenRegex.exec(reflectQuery)) !== null) {
      const inner = match[1];
      const parenMatch = inner.match(/\(([^)]+)\)$/);
      if (parenMatch) {
        mentioned.push(parenMatch[1]);
      } else if (/^[\w-]+:[\w-]+$/.test(inner)) {
        mentioned.push(inner);
      }
    }
    return mentioned;
  }, [reflectQuery]);

  const attachedEntityIds = useMemo(() => {
    return Array.from(new Set([...manuallyAttachedIds, ...mentionedEntityIds]));
  }, [manuallyAttachedIds, mentionedEntityIds]);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  // Layout sizing.
  const [topHeight, setTopHeight] = useState(360);
  const topRowRef = useRef<HTMLDivElement>(null);
  const [topFlex, setTopFlex] = useState({ query: 2, patches: 2, spine: 2, edges: 1 });
  const totalTopFlex = topFlex.query + topFlex.patches + topFlex.spine + topFlex.edges;

  const [resizing, setResizing] = useState<null | 'top' | 'query' | 'patches' | 'spine'>(null);
  const resizeStartRef = useRef({
    x: 0,
    width: 0,
    flex: { query: 2, patches: 2, spine: 2, edges: 1 },
  });

  const handleResizeStart = useCallback(
    (pane: 'top' | 'query' | 'patches' | 'spine') => (e: React.MouseEvent) => {
      setResizing(pane);
      document.body.style.cursor = pane === 'top' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      resizeStartRef.current = {
        x: e.clientX,
        width: topRowRef.current?.getBoundingClientRect().width ?? 0,
        flex: { ...topFlex },
      };
    },
    [topFlex]
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent) => {
      if (!resizing) return;
      if (resizing === 'top') {
        const next = Math.min(Math.max(e.clientY - 180, 160), 560);
        setTopHeight(next);
        return;
      }
      const { x, width, flex } = resizeStartRef.current;
      if (width <= 0) return;
      const deltaPx = e.clientX - x;
      const deltaFlex = (deltaPx / width) * totalTopFlex;
      const MIN_FLEX = 0.4;

      if (resizing === 'query') {
        const nextQuery = Math.max(MIN_FLEX, flex.query + deltaFlex);
        const nextPatches = Math.max(MIN_FLEX, flex.patches - (nextQuery - flex.query));
        setTopFlex((prev) => ({ ...prev, query: nextQuery, patches: nextPatches }));
      } else if (resizing === 'patches') {
        const nextPatches = Math.max(MIN_FLEX, flex.patches + deltaFlex);
        const nextSpine = Math.max(MIN_FLEX, flex.spine - (nextPatches - flex.patches));
        setTopFlex((prev) => ({ ...prev, patches: nextPatches, spine: nextSpine }));
      } else if (resizing === 'spine') {
        const nextSpine = Math.max(MIN_FLEX, flex.spine + deltaFlex);
        const nextEdges = Math.max(MIN_FLEX, flex.edges - (nextSpine - flex.spine));
        setTopFlex((prev) => ({ ...prev, spine: nextSpine, edges: nextEdges }));
      }
    },
    [resizing, totalTopFlex]
  );

  const handleResizeEnd = useCallback(() => {
    setResizing(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => handleResizeMove(e);
    const up = () => handleResizeEnd();
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleResizeMove, handleResizeEnd]);

  const fetchServers = useCallback(async () => {
    try {
      setLoadingServers(true);
      const data = await serversApi.list();
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to load servers', err);
      toast.error('Failed to load servers');
    } finally {
      setLoadingServers(false);
    }
  }, []);

  const fetchBanks = useCallback(async (sid: number) => {
    try {
      setLoadingBanks(true);
      const data = await serversApi.listBanks(sid);
      setBanks(Array.isArray(data) ? data : []);
    } catch (err) {
      logger.error('Failed to load banks', err);
      toast.error('Failed to load banks');
      setBanks([]);
    } finally {
      setLoadingBanks(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    if (!serverId || !bankId) {
      setEntities([]);
      setEdges([]);
      setSelectedEntity(null);
      setSelectedPatch(null);
      setSelectedEdge(null);
      return;
    }
    try {
      setLoadingData(true);
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
      ]);

      const displayNodes = nodesData.map(backendNodeToDisplayNode).filter(isGroundedNodeForWorkspace);
      const displayEdges = edgesData.map(backendEdgeToDisplayEdge).filter(isGroundedEdgeForWorkspace);

      setEntities(displayNodes);
      setEdges(displayEdges);

      setSelectedEntity((prev) => {
        if (!prev) return null;
        return displayNodes.find((n) => n.id === prev.id) || null;
      });
    } catch (err: any) {
      logger.error('Failed to load workspace data', { error: err, serverId, bankId });
      toast.error(`Failed to load workspace data: ${err.message || err}`);
    } finally {
      setLoadingData(false);
    }
  }, [serverId, bankId]);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  useEffect(() => {
    if (!serverId) {
      setBanks([]);
      return;
    }
    fetchBanks(serverId);
  }, [serverId, fetchBanks]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const nodeById = useMemo(() => {
    const map = new Map<string, DisplayNode>();
    entities.forEach((node) => map.set(node.id, node));
    return map;
  }, [entities]);

  const aqlEntities: AqlEntityLike[] = useMemo(() => {
    return entities.map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
    }));
  }, [entities]);

  const aqlEdges: AqlEdgeLike[] = useMemo(() => {
    return edges.map((edge) => ({
      from: edge.source_id,
      to: edge.target_id,
      label: edge.label || edge.type,
      type: edge.type,
    }));
  }, [edges]);

  const spineEntities = useMemo(() => {
    const q = spineSearch.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) =>
      e.label.toLowerCase().includes(q) ||
      e.id.toLowerCase().includes(q) ||
      e.type.toLowerCase().includes(q)
    );
  }, [entities, spineSearch]);

  const selectedEntityPatches = useMemo(() => {
    if (!selectedEntity) return [];
    return getContextualPatchRefs(selectedEntity);
  }, [selectedEntity]);

  const selectedEntityEdges = useMemo(() => {
    if (!selectedEntity) return [];
    return edges.filter(
      (edge) => edge.source_id === selectedEntity.id || edge.target_id === selectedEntity.id
    );
  }, [edges, selectedEntity]);

  const handleSelectEntity = useCallback((entity: DisplayNode) => {
    setSelectedEntity(entity);
    setSelectedPatch(null);
    setSelectedEdge(null);
  }, []);

  const handleSelectPatch = useCallback((ref: ModelRef) => {
    setSelectedPatch(ref);
    setSelectedEdge(null);
  }, []);

  const handleSelectEdge = useCallback((edge: DisplayEdge) => {
    setSelectedEdge(edge);
    setSelectedPatch(null);
  }, []);

  const handleReflect = useCallback(async () => {
    const query = reflectQuery.trim();
    if (!query) return;
    if (!serverId || !bankId) {
      toast.error('Select a server and bank before running Reflect.');
      return;
    }
    try {
      setReflectLoading(true);
      setReflectError(null);
      setReflectResult(null);
      // Phase 1: Reflect sends only the free-text query; corpus integration later.
      const cleanedQuery = query.replace(/\[\[[^\]]+\]\]/g, '').replace(/\s+/g, ' ').trim();
      const result = await hindsightApi.reflect(serverId, bankId, { query: cleanedQuery || query });
      setReflectResult(result);
      toast.success('Reflect response received');
    } catch (err: any) {
      setReflectError(err.message || String(err));
      logger.error('Reflect query failed', { error: err, serverId, bankId, query });
      toast.error(`Reflect failed: ${err.message || err}`);
    } finally {
      setReflectLoading(false);
    }
  }, [reflectQuery, serverId, bankId]);

  const handleAttachEntity = useCallback((entityId: string) => {
    setManuallyAttachedIds((prev) => {
      if (prev.includes(entityId)) return prev;
      return [...prev, entityId];
    });
  }, []);

  const handleDetachEntity = useCallback((entityId: string) => {
    setManuallyAttachedIds((prev) => prev.filter((id) => id !== entityId));
    setExpandedEntityIds((prev) => {
      const next = new Set(prev);
      next.delete(entityId);
      return next;
    });
    setSelectedModelKeys((prev) => {
      const next = { ...prev };
      delete next[entityId];
      return next;
    });
    // If the entity is still present as a [[...]] token, remove that token from the query
    // so the user isn't stuck with an attachment they explicitly removed.
    setReflectQuery((prev) => {
      const tokenRegex = /\[\[((?:[^\[\]]|\[[^\]])+?)\]\]/g;
      return prev.replace(tokenRegex, (match, inner: string) => {
        const parenMatch = inner.match(/\(([^)]+)\)$/);
        const id = parenMatch ? parenMatch[1] : inner;
        return id === entityId ? '' : match;
      });
    });
  }, []);

  const toggleEntityExpanded = useCallback((entityId: string) => {
    setExpandedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  }, []);

  const selectEntityModel = useCallback((entityId: string, key: string) => {
    setSelectedModelKeys((prev) => ({ ...prev, [entityId]: key }));
  }, []);

  useEffect(() => {
    if (!serverId || !bankId || attachedEntityIds.length === 0) {
      setEntityInfoMap(null);
      return;
    }
    let cancelled = false;
    setLoadingEntityInfo(true);
    entityInfoApi
      .info(serverId, bankId, attachedEntityIds)
      .then((result) => {
        if (cancelled) return;
        const contentMap = result.content || {};
        const mergedEntities: Record<string, EntityInfoWithContent> = {};
        for (const [id, info] of Object.entries(result.entities)) {
          mergedEntities[id] = { ...info, content: contentMap };
        }
        setEntityInfoMap(mergedEntities);
      })
      .catch((err: any) => {
        if (cancelled) return;
        logger.error('Failed to load entity info', { error: err, serverId, bankId, entityIds: attachedEntityIds });
        toast.error(`Failed to load entity info: ${err.message || err}`);
        setEntityInfoMap(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingEntityInfo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, bankId, attachedEntityIds]);

  return (
    <PageShell
      title="Workspace"
      subtitle="Discovery and collation workbench."
      count={entities.length}
      countLabel="entity"
      loading={loadingServers || loadingBanks || loadingData}
    >
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <ServerBankSelectors
            servers={servers}
            banks={banks}
            selectedServerId={selectedServerId}
            selectedBankId={selectedBankId}
            setSelectedServerId={setSelectedServerId}
            setSelectedBankId={setSelectedBankId}
            loadingBanks={loadingBanks}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={!serverId || !bankId || loadingData}
            className="gap-1.5"
          >
            <RefreshCw className={cn('w-4 h-4', loadingData && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {/* Top row: reflect query | patches | entity spine | edges */}
        <div ref={topRowRef} className="flex min-h-0" style={{ height: topHeight }}>
          {/* Reflect query */}
          <Panel style={{ flex: topFlex.query, minWidth: 160 }}>
            <PanelHeader title="Reflect query" />
            <PanelContent className="p-3">
              <div className="absolute inset-0 p-3 flex flex-col gap-2">
                <AqlEditor
                  value={reflectQuery}
                  onChange={(value) => setReflectQuery(value)}
                  onSubmit={handleReflect}
                  disabled={false}
                  placeholder="Ask Reflect... Type [[ to reference an entity."
                  availableEntities={aqlEntities}
                  availableEdges={aqlEdges}
                  includeEdges={false}
                  className="flex-1 min-h-0 w-full rounded-lg border border-white/20 bg-transparent"
                />
                {attachedEntityIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {attachedEntityIds.map((id) => (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="gap-1 px-2 py-1 text-xs cursor-pointer hover:bg-white/20"
                        onClick={() => handleDetachEntity(id)}
                        title="Click to remove"
                      >
                        {entityInfoMap?.[id]?.graph_node?.display_name || id}
                        <span className="text-white/50">×</span>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="gap-1.5 flex-1"
                    disabled={!reflectQuery.trim() || !serverId || !bankId}
                    onClick={handleReflect}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Reflect
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={!selectedEntity}
                    onClick={() => selectedEntity && handleAttachEntity(selectedEntity.id)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Attach
                  </Button>
                </div>
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('query')} title="Drag to resize Reflect query pane" />

          {/* Patches */}
          <Panel style={{ flex: topFlex.patches, minWidth: 160 }}>
            <PanelHeader
              title="Patches"
              count={selectedEntity ? selectedEntityPatches.length : undefined}
            />
            <PanelContent>
              <div className="absolute inset-0 overflow-y-auto p-2 space-y-1">
                {!selectedEntity ? (
                  <div className="h-full flex items-center justify-center text-white/40 text-xs px-2 text-center">
                    Select an entity from the spine to see its patches.
                  </div>
                ) : selectedEntityPatches.length === 0 ? (
                  <div className="text-white/40 text-xs px-2 py-3">
                    No patches for this entity
                    {selectedEntity.modelRefs.length > 0 && (
                      <span className="text-white/30"> ({selectedEntity.modelRefs.length} model refs, none contextual)</span>
                    )}
                    .
                  </div>
                ) : (
                  selectedEntityPatches.map((ref: ModelRef, i: number) => (
                    <PatchRefRow
                      key={`${ref.ext_id || ref.role || 'ref'}-${i}`}
                      ref={ref}
                      active={selectedPatch?.ext_id === ref.ext_id && selectedPatch?.role === ref.role}
                      onClick={() => handleSelectPatch(ref)}
                    />
                  ))
                )}
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('patches')} title="Drag to resize patches pane" />

          {/* Entity spine */}
          <Panel style={{ flex: topFlex.spine, minWidth: 180 }}>
            <PanelHeader title="Entity spine" count={spineEntities.length} />
            <PanelContent className="p-0">
              <div className="absolute inset-0 overflow-y-auto">
                <div className="p-2">
                  <Input
                    placeholder="Filter entities..."
                    value={spineSearch}
                    onChange={(e) => setSpineSearch(e.target.value)}
                    className="h-8 text-xs bg-black/20 border-white/10 mb-2"
                  />
                  <div className="space-y-1">
                    {spineEntities.map((entity) => (
                      <EntityListRow
                        key={entity.id}
                        node={entity}
                        active={selectedEntity?.id === entity.id}
                        onClick={() => handleSelectEntity(entity)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('spine')} title="Drag to resize entity spine" />

          {/* Edges */}
          <Panel style={{ flex: topFlex.edges, minWidth: 140 }}>
            <PanelHeader
              title="Edges"
              count={selectedEntity ? selectedEntityEdges.length : undefined}
            />
            <PanelContent>
              <div className="absolute inset-0 overflow-y-auto p-2 space-y-1">
                {!selectedEntity ? (
                  <div className="h-full flex items-center justify-center text-white/40 text-xs px-2 text-center">
                    Select an entity from the spine to see its edges.
                  </div>
                ) : selectedEntityEdges.length === 0 ? (
                  <div className="text-white/40 text-xs px-2 py-3">No edges for this entity.</div>
                ) : (
                  selectedEntityEdges.map((edge) => (
                    <EdgeListRow
                      key={edge.id}
                      edge={edge}
                      sourceLabel={nodeById.get(edge.source_id)?.label}
                      targetLabel={nodeById.get(edge.target_id)?.label}
                      active={selectedEdge?.id === edge.id}
                      onClick={() => handleSelectEdge(edge)}
                    />
                  ))
                )}
              </div>
            </PanelContent>
          </Panel>
        </div>

        <ResizeHandle direction="horizontal" onMouseDown={handleResizeStart('top')} title="Drag to resize top/bottom split" />

        {/* Bottom row: temporary content | workspace pages */}
        <div className="flex-1 min-h-0 flex">
          {/* Temporary content */}
          <Panel className="flex-1">
            <PanelHeader
              title="Attached entities"
              count={attachedEntityIds.length > 0 ? attachedEntityIds.length : undefined}
            />
            <PanelContent className="p-0">
              <div className="absolute inset-0 overflow-y-auto p-3 space-y-2">
                {attachedEntityIds.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-white/40 text-sm px-6 text-center gap-3">
                    <div className="flex items-center gap-2 text-white/50">
                      <FileText className="w-5 h-5" />
                      <span>Attached entity info</span>
                    </div>
                    <p className="text-xs max-w-md">
                      Select an entity in the spine and click Attach, or type an entity id with [[...]] in the query.
                    </p>
                  </div>
                ) : loadingEntityInfo ? (
                  <div className="h-full flex items-center justify-center text-white/40 text-xs">Loading entity info…</div>
                ) : entityInfoMap ? (
                  attachedEntityIds.map((id) => {
                    const info = entityInfoMap[id];
                    if (!info) return null;
                    return (
                      <EntityInfoCard
                        key={id}
                        id={id}
                        info={info}
                        onDetach={() => handleDetachEntity(id)}
                        expanded={expandedEntityIds.has(id)}
                        onToggleExpand={() => toggleEntityExpanded(id)}
                        selectedModelKey={selectedModelKeys[id] ?? null}
                        onSelectModel={(key) => selectEntityModel(id, key)}
                      />
                    );
                  })
                ) : null}
              </div>
            </PanelContent>
          </Panel>

          <ResizeHandle direction="vertical" onMouseDown={handleResizeStart('query')} title="Drag to resize temporary/workspace split" />

          {/* Workspace pages / Reflect result */}
          <Panel style={{ width: 320, minWidth: 240, maxWidth: 440 }}>
            <PanelHeader
              title={(reflectResult != null || reflectError != null) ? 'Reflect result' : 'Workspace pages'}
              count={undefined}
            />
            <PanelContent className="p-0">
              <div className="absolute inset-0 flex flex-col">
                {reflectLoading && (
                  <div className="flex-1 flex items-center justify-center text-white/40 text-xs">Reflecting…</div>
                )}
                {reflectError && !reflectLoading && (
                  <div className="flex-1 flex flex-col items-center justify-center text-white/40 text-xs px-4 text-center gap-2">
                    <span className="text-red-400">Reflect failed</span>
                    <span>{reflectError}</span>
                  </div>
                )}
                {reflectResult != null && !reflectLoading && (
                  <NarrativeViewer
                    content={extractReflectNarrative(reflectResult)}
                    title="Response"
                    viewMode="markdown"
                    showIndex={false}
                    className="flex-1 min-h-0"
                  />
                )}
                {!reflectLoading && !reflectError && reflectResult == null && (
                  <div className="flex-1 flex flex-col gap-3 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-white/60">Session pages will appear here.</div>
                      <Button variant="outline" size="sm" className="gap-1.5" disabled>
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </PanelContent>
          </Panel>
        </div>
      </div>
    </PageShell>
  );
}
