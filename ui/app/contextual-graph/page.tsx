'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { InteractiveGraph, type GraphLayout, colorForType } from '@/components/research-canvas';
import { GraphControls } from '@/app/explore/graph-controls';
import { CardControls } from '@/app/explore/card-controls';
import { serversApi, contextualGraphApi, configApi, type GraphNode, type GraphEdge, type GraphCanvas } from '@/lib/api/client';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const logger = createLogger('ContextualGraphPage');

type PatchRole = 'sys_entity_summary' | 'sys_entity_capabilities' | 'sys_edge_context' | 'sys_discovery_context' | string;

type PatchHealth = 'green' | 'orange' | 'red';

const ENTITY_ROLES = ['sys_entity_summary', 'sys_entity_capabilities'];
const EDGE_ROLES = ['sys_edge_context'];
const DISCOVERY_ROLES = ['sys_discovery_context'];

const ROLE_LABELS: Record<string, string> = {
  sys_entity_summary: 'summary',
  sys_entity_capabilities: 'capabilities',
  sys_edge_context: 'edge context',
  sys_discovery_context: 'discovery',
};

function expectedRolesForItem(
  item: GraphNode | GraphEdge,
  enabledRoles: Record<string, boolean>
): string[] {
  if ('from' in item && 'to' in item) {
    return EDGE_ROLES.filter((role) => enabledRoles[role]);
  }
  return ENTITY_ROLES.filter((role) => enabledRoles[role]);
}

type BackendNode = {
  id: string;
  labels: string[];
  properties: Record<string, any>;
};

type BackendEdge = {
  id: string;
  source_id: string;
  target_id: string;
  type: string | null;
  properties: Record<string, any>;
};

function getModelRefRoles(item: GraphNode | GraphEdge): string[] {
  if (!item.modelRefs || !Array.isArray(item.modelRefs)) return [];
  return item.modelRefs.map((r) => r.role).filter((r): r is string => Boolean(r));
}

function computePatchHealth(
  item: GraphNode | GraphEdge,
  enabledRoles: Record<string, boolean>
): { health: PatchHealth; missing: string[]; present: string[]; expected: string[] } {
  const expected = expectedRolesForItem(item, enabledRoles);

  if (expected.length === 0) {
    return { health: 'green', missing: [], present: [], expected };
  }

  const presentRoles = getModelRefRoles(item);
  const present = expected.filter((role) => presentRoles.includes(role));
  const missing = expected.filter((role) => !presentRoles.includes(role));

  if (missing.length === 0) return { health: 'green', missing, present, expected };
  if (present.length === 0) return { health: 'red', missing, present, expected };
  return { health: 'orange', missing, present, expected };
}

function healthColorClass(health: PatchHealth): string {
  switch (health) {
    case 'green':
      return 'bg-emerald-500';
    case 'orange':
      return 'bg-orange-500';
    case 'red':
    default:
      return 'bg-red-500';
  }
}

function backendNodeToGraphNode(node: BackendNode): GraphNode {
  const inferredType = node.labels[0] ?? (typeof node.id === 'string' && node.id.includes(':') ? node.id.split(':')[0] : 'entity');
  return {
    id: node.id,
    type: inferredType,
    label: node.properties.label ?? node.properties.name ?? node.id,
    name: node.properties.name ?? node.properties.label ?? node.id,
    provenance: node.properties.provenance ?? 'known',
    source: node.properties.generated_by === 'contextual_graph' ? 'mental_model' : 'hindsight',
    mental_model_applied: !!node.properties.provenance?.model_refs && Array.isArray(node.properties.provenance.model_refs) && node.properties.provenance.model_refs.length > 0,
    modelRefs: node.properties.provenance?.model_refs,
  };
}

function backendEdgeToGraphEdge(edge: BackendEdge): GraphEdge {
  return {
    id: edge.id,
    from: edge.source_id,
    to: edge.target_id,
    type: edge.type ?? undefined,
    label: edge.properties.label ?? edge.type ?? undefined,
    detail: edge.properties.detail,
    weight: typeof edge.properties.weight === 'number' ? edge.properties.weight : 1,
    provenance: edge.properties.provenance ?? 'known',
    source: edge.properties.generated_by === 'contextual_graph' ? 'mental_model' : 'hindsight',
    modelRefs: edge.properties.provenance?.model_refs,
  };
}

function normalizeGraphCanvas(nodes: BackendNode[], edges: BackendEdge[]): GraphCanvas {
  return { nodes: nodes.map(backendNodeToGraphNode), edges: edges.map(backendEdgeToGraphEdge) };
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n+/g, ' ')
    .trim();
}

function buildEntityCompiledMarkdown(entities: GraphNode[]): string {
  return entities
    .map((entity) => {
      const label = entity.label || entity.name || entity.id;
      const typeLine = entity.type && !entity.id.startsWith(`${entity.type}:`)
        ? `${entity.type}:${entity.id}`
        : entity.id;
      const summary = entitySummaryText(entity);
      return `# ${escapeMdCell(label)} (${escapeMdCell(typeLine)})\n\n${escapeMdCell(summary)}`;
    })
    .join('\n\n');
}

function buildEdgeMarkdownTable(edges: GraphEdge[], nodeById: Map<string, GraphNode>): string {
  const rows = ['| Source | Target | Label | Source ID | Target ID |', '| --- | --- | --- | --- | --- |'];
  for (const e of edges) {
    const source = nodeById.get(e.from);
    const target = nodeById.get(e.to);
    rows.push(
      `| ${source?.name || source?.label || e.from} | ${target?.name || target?.label || e.to} | ${e.detail || e.label || e.type || ''} | ${e.from} | ${e.to} |`
    );
  }
  return rows.join('\n');
}

function escapeMdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
}

interface GraphNodeWithSummary extends GraphNode {
  summaryText?: string;
}

function entitySummaryText(entity: GraphNode): string {
  const withSummary = entity as GraphNodeWithSummary;
  if (withSummary.summaryText) return withSummary.summaryText;
  const raw = (entity as any).properties?.summary || (entity as any).properties?.description;
  if (typeof raw === 'string' && raw.trim().length > 0) return stripMarkdown(raw);
  return 'No summary available.';
}

export default function ContextualGraphPage() {
  const [servers, setServers] = useState<Array<{ id: number; name?: string; base_url?: string }>>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graph, setGraph] = useState<GraphCanvas>({ nodes: [], edges: [] });
  const [layout, setLayout] = useState<GraphLayout>('cose');
  const [layoutAnimate, setLayoutAnimate] = useState(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [autoScrollEntities, setAutoScrollEntities] = useState(false);
  const [autoScrollEdges, setAutoScrollEdges] = useState(false);
  const [leftFlex, setLeftFlex] = useState(1.0);
  const [patchRoles, setPatchRoles] = useState<Record<string, boolean>>({
    sys_entity_summary: true,
    sys_entity_capabilities: true,
    sys_edge_context: true,
    sys_discovery_context: false,
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const rightFlex = 5 - leftFlex;
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const isHorizontalDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startLeftFlexRef = useRef(1.0);
  const containerWidthRef = useRef(0);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const entityListRef = useRef<HTMLDivElement>(null);
  const edgeListRef = useRef<HTMLDivElement>(null);

  const {
    selectedServerId,
    setSelectedServerId,
    selectedBankId,
    setSelectedBankId,
  } = usePersistentServerBank(servers, banks);

  const serverId = selectedServerId ? Number(selectedServerId) : 0;
  const bankId = selectedBankId;

  useEffect(() => {
    async function loadServers() {
      try {
        setLoadingServers(true);
        const data = await serversApi.list();
        setServers(data.map((s) => ({ id: s.id, name: s.name || s.base_url })));
      } catch (err) {
        logger.error('Failed to load servers', { error: err });
        toast.error('Failed to load servers');
      } finally {
        setLoadingServers(false);
      }
    }
    loadServers();
  }, []);

  useEffect(() => {
    if (!serverId) {
      setBanks([]);
      return;
    }
    async function loadBanks() {
      try {
        setLoadingBanks(true);
        const data = await serversApi.listBanks(serverId);
        setBanks(data.map((b) => ({ bank_id: b.bank_id, name: b.name || b.bank_id })));
      } catch (err) {
        logger.error('Failed to load banks', { error: err, serverId });
        toast.error('Failed to load banks');
      } finally {
        setLoadingBanks(false);
      }
    }
    loadBanks();
  }, [serverId]);

  useEffect(() => {
    async function loadPatchRoles() {
      try {
        const cfg = await configApi.contextualGraph();
        setPatchRoles(cfg.patchRoles);
      } catch (err) {
        logger.error('Failed to load contextual graph config', { error: err });
      }
    }
    loadPatchRoles();
  }, []);

  const loadGraph = useCallback(async () => {
    if (!serverId || !bankId) return;
    try {
      setGraphLoading(true);
      const [nodesData, edgesData] = await Promise.all([
        contextualGraphApi.listNodes(serverId, bankId, { limit: 2000 }),
        contextualGraphApi.listEdges(serverId, bankId, { limit: 2000 }),
      ]);
      const normalized = normalizeGraphCanvas(nodesData, edgesData);
      setGraph(normalized);
    } catch (err: any) {
      logger.error('Failed to load contextual graph', { error: err, serverId, bankId });
      toast.error(`Failed to load graph: ${err.message || err}`);
      setGraph({ nodes: [], edges: [] });
    } finally {
      setGraphLoading(false);
    }
  }, [serverId, bankId]);

  const handleImportGraph = useCallback(async () => {
    if (!serverId || !bankId) return;
    if (!window.confirm(`Import Hindsight skeleton into ${bankId}? This will add nodes and edges to the working graph.`)) return;
    try {
      setActionLoading('import');
      const result = await contextualGraphApi.import(serverId, bankId);
      if (result.success) {
        toast.success(`Imported ${result.imported?.nodes ?? 0} nodes, ${result.imported?.edges ?? 0} edges`);
      } else {
        toast.error(`Import failed: ${result.error || result.code || 'unknown'}`);
      }
      await loadGraph();
    } catch (err: any) {
      logger.error('Failed to import contextual graph', { error: err, serverId, bankId });
      toast.error(`Import failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId, loadGraph]);

  const handleClearGraph = useCallback(async () => {
    if (!serverId || !bankId) return;
    if (!window.confirm(`Clear the working graph for ${bankId}? This removes all contextual nodes and edges but leaves Hindsight mental models intact.`)) return;
    try {
      setActionLoading('clear');
      const result = await contextualGraphApi.clear(serverId, bankId);
      if (result.success) {
        toast.success(`Cleared ${result.cleared?.nodes ?? 0} nodes, ${result.cleared?.edges ?? 0} edges`);
      } else {
        toast.error(`Clear failed: ${result.error || result.code || 'unknown'}`);
      }
      await loadGraph();
    } catch (err: any) {
      logger.error('Failed to clear contextual graph', { error: err, serverId, bankId });
      toast.error(`Clear failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId, loadGraph]);

  const handleClearMentalModels = useCallback(async () => {
    if (!serverId || !bankId) return;
    if (!window.confirm(`Delete attached mental models for ${bankId}? This removes generated models from Hindsight and clears the working graph.`)) return;
    try {
      setActionLoading('delete-generated');
      const result = await contextualGraphApi.deleteGenerated(serverId, bankId, { dry_run: false });
      if (result.success) {
        toast.success(`Deleted ${result.total ?? 0} mental models; cleared ${result.cleared?.nodes ?? 0} nodes, ${result.cleared?.edges ?? 0} edges`);
      } else {
        toast.error(`Delete failed: ${result.error || result.code || 'unknown'}`);
      }
      await loadGraph();
    } catch (err: any) {
      logger.error('Failed to delete generated mental models', { error: err, serverId, bankId });
      toast.error(`Delete failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId, loadGraph]);

  const handleRefreshPatches = useCallback(async (force = false) => {
    if (!serverId || !bankId) return;
    const message = force
      ? `Force refresh ${bankId}? This will re-apply every attached Hindsight mental-model output, even if its content hash has not changed.`
      : `Refresh contextual patches for ${bankId}? This re-applies any Hindsight mental-model outputs whose content has changed.`;
    if (!window.confirm(message)) return;
    try {
      setActionLoading(force ? 'force-refresh' : 'refresh');
      const result = await contextualGraphApi.refresh(serverId, bankId, { force });
      if (result.success) {
        const stats = result.stats;
        toast.success(`${force ? 'Force refresh' : 'Refresh'} complete — fetched ${stats?.fetched ?? 0}, applied ${stats?.applied ?? 0}, unchanged ${stats?.skippedUnchanged ?? 0}, failed ${stats?.failed ?? 0}`);
      } else {
        toast.error(`${force ? 'Force refresh' : 'Refresh'} failed: ${result.error || result.code || 'unknown'}`);
      }
      await loadGraph();
    } catch (err: any) {
      logger.error(`${force ? 'Force refresh' : 'Refresh'} failed`, { error: err, serverId, bankId });
      toast.error(`${force ? 'Force refresh' : 'Refresh'} failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId, loadGraph]);

  useEffect(() => {
    if (serverId && bankId) {
      loadGraph();
    } else {
      setGraph({ nodes: [], edges: [] });
    }
  }, [serverId, bankId, loadGraph]);

  const nodeById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  const sortedNodes = useMemo(() => {
    return [...graph.nodes].sort((a, b) => (a.label || a.name || a.id).localeCompare(b.label || b.name || b.id));
  }, [graph.nodes]);

  const edgeViews = useMemo(() => {
    return graph.edges
      .map((e) => ({ edge: e, sourceNode: nodeById.get(e.from), targetNode: nodeById.get(e.to) }))
      .filter((v) => v.sourceNode && v.targetNode)
      .sort((a, b) => {
        const aKey = `${a.edge.from}|${a.edge.to}`;
        const bKey = `${b.edge.from}|${b.edge.to}`;
        return aKey.localeCompare(bKey);
      });
  }, [graph.edges, nodeById]);

  const [nodeFilters, setNodeFilters] = useState<Set<string>>(new Set());
  const [edgeFilters, setEdgeFilters] = useState<Set<string>>(new Set());
  const [entitySelectMode, setEntitySelectMode] = useState(false);
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());

  const toggleNodeFilter = useCallback((type: string) => {
    setNodeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const toggleEdgeFilter = useCallback((type: string) => {
    setEdgeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  useEffect(() => {
    setNodeFilters(new Set());
    setEdgeFilters(new Set());
    setSelectedEntityIds(new Set());
    setEntitySelectMode(false);
  }, [selectedBankId]);

  const selectOnCanvas = useCallback((id: string) => {
    setSelectedIds([id]);
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    const el = cy.getElementById(id);
    if (el.length === 0) return;
    cy.elements().unselect();
    el.select();
    cy.fit(el, 80);
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    if (entitySelectMode) {
      setSelectedEntityIds((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      });
      return;
    }
    selectOnCanvas(nodeId);
  }, [entitySelectMode, selectOnCanvas]);

  const handleDeployModels = useCallback(async () => {
    if (!serverId || !bankId || selectedEntityIds.size === 0) return;
    if (!window.confirm(`Deploy contextual models for ${selectedEntityIds.size} selected entity${selectedEntityIds.size !== 1 ? 'ies' : 'y'}?`)) return;
    try {
      setActionLoading('deploy');
      const result = await contextualGraphApi.addContext(serverId, bankId, {
        node_ids: Array.from(selectedEntityIds),
        import_skeleton: false,
        run_discovery: false,
      });
      if (result.success) {
        const deployed = result.deployed?.length ?? 0;
        const failed = result.failed?.length ?? 0;
        if (failed > 0) {
          toast.warning(`Deployed ${deployed} models; ${failed} failed`);
        } else {
          toast.success(`Deployed ${deployed} models`);
        }
      } else {
        toast.error(`Deploy failed: ${result.error || result.code || 'unknown'}`);
      }
      setSelectedEntityIds(new Set());
      setEntitySelectMode(false);
      await loadGraph();
    } catch (err: any) {
      logger.error('Failed to deploy contextual models', { error: err, serverId, bankId });
      toast.error(`Deploy failed: ${err.message || err}`);
    } finally {
      setActionLoading(null);
    }
  }, [serverId, bankId, selectedEntityIds, loadGraph]);

  const handleSelectEdge = useCallback((edge: GraphEdge) => {
    selectOnCanvas(edge.id);
  }, [selectOnCanvas]);

  const toggleEntitySelectMode = useCallback(() => {
    setEntitySelectMode((prev) => {
      if (prev) setSelectedEntityIds(new Set());
      return !prev;
    });
  }, []);

  const handleNodeHover = useCallback((nodeId: string | null) => {
    setHoveredNodeId(nodeId);
  }, []);

  const handleEdgeHover = useCallback((edgeId: string | null) => {
    setHoveredEdgeId(edgeId);
  }, []);

  useEffect(() => {
    if (!hoveredNodeId || !entityListRef.current || !autoScrollEntities) return;
    const row = entityListRef.current.querySelector(`[data-node-id="${CSS.escape(hoveredNodeId)}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoveredNodeId, autoScrollEntities]);

  useEffect(() => {
    if (!hoveredEdgeId || !edgeListRef.current || !autoScrollEdges) return;
    const row = edgeListRef.current.querySelector(`[data-edge-id="${CSS.escape(hoveredEdgeId)}"]`) as HTMLElement | null;
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [hoveredEdgeId, autoScrollEdges]);

  const handleHorizontalResizeStart = useCallback((e: React.MouseEvent) => {
    isHorizontalDraggingRef.current = true;
    startXRef.current = e.clientX;
    startLeftFlexRef.current = leftFlex;
    const container = leftPaneRef.current?.parentElement;
    if (container) {
      containerWidthRef.current = container.getBoundingClientRect().width;
    }
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [leftFlex]);

  const handleHorizontalResizeMove = useCallback((e: MouseEvent) => {
    if (!isHorizontalDraggingRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const containerWidth = containerWidthRef.current;
    if (containerWidth > 0) {
      const deltaFlex = (deltaX / containerWidth) * 5;
      const nextLeftFlex = Math.min(Math.max(startLeftFlexRef.current + deltaFlex, 0.5), 4.5);
      setLeftFlex(nextLeftFlex);
    }
  }, []);

  const handleHorizontalResizeEnd = useCallback(() => {
    isHorizontalDraggingRef.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent) => handleHorizontalResizeMove(e);
    const up = () => handleHorizontalResizeEnd();
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
  }, [handleHorizontalResizeMove, handleHorizontalResizeEnd]);

  return (
    <PageShell
      title="Contextual Graph"
      subtitle="Explore the graph enriched with contextual mental-model patches."
      count={graph.nodes.length}
      countLabel="node"
      loading={graphLoading}
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 shrink-0">
          <ServerBankSelectors
            servers={servers}
            selectedServerId={selectedServerId}
            setSelectedServerId={setSelectedServerId}
            banks={banks}
            selectedBankId={selectedBankId}
            setSelectedBankId={setSelectedBankId}
            loadingBanks={loadingBanks}
            disabled={loadingServers}
          />
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={!serverId || !bankId || actionLoading === 'import'}
              onClick={handleImportGraph}
            >
              {actionLoading === 'import' ? 'Importing…' : 'Import'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!serverId || !bankId || actionLoading === 'clear'}
              onClick={handleClearGraph}
            >
              {actionLoading === 'clear' ? 'Clearing…' : 'Clear graph'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!serverId || !bankId || actionLoading === 'delete-generated'}
              onClick={handleClearMentalModels}
            >
              {actionLoading === 'delete-generated' ? 'Deleting…' : 'Clear mental models'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!serverId || !bankId || actionLoading === 'refresh'}
              onClick={() => { handleRefreshPatches(false); }}
            >
              {actionLoading === 'refresh' ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!serverId || !bankId || actionLoading === 'force-refresh'}
              onClick={() => { handleRefreshPatches(true); }}
            >
              {actionLoading === 'force-refresh' ? 'Force refreshing…' : 'Force refresh'}
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 shrink-0">
          <div className="flex items-center gap-3 text-sm text-white/60">
            {Object.entries(patchRoles).filter(([_, enabled]) => enabled).length > 0 && (
              <span
                className="flex items-center gap-2 text-[11px] cursor-help"
                title="Entity health checks summary+capabilities. Edge health checks edge context. Discovery is a separate graph-wide action."
              >
                <span className="text-white/40">Health:</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                  <span>all</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                  <span>some</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                  <span>none</span>
                </span>
              </span>
            )}
            <span>{graph.edges.length} edge{graph.edges.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex mt-2">
          {/* Left: entity list */}
          <div ref={leftPaneRef} className="min-w-0 flex flex-col gap-1" style={{ flex: leftFlex }}>
            <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col" style={{ flex: 1.5 }}>
              <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm truncate">Entities</span>
                  {sortedNodes.length > 0 && (
                    <button
                      type="button"
                      onClick={toggleEntitySelectMode}
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded border h-5 inline-flex items-center transition-colors',
                        entitySelectMode
                          ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                          : 'border-white/10 bg-black/20 text-white/60 hover:text-white/80'
                      )}
                    >
                      {entitySelectMode ? 'Done' : 'Select'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {entitySelectMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px] px-2"
                      disabled={selectedEntityIds.size === 0 || actionLoading === 'deploy'}
                      onClick={handleDeployModels}
                    >
                      {actionLoading === 'deploy' ? 'Deploying…' : `Deploy models (${selectedEntityIds.size})`}
                    </Button>
                  )}
                  <CardControls
                    scroll={autoScrollEntities}
                    onScrollChange={(checked) => setAutoScrollEntities(Boolean(checked))}
                    onCopy={() => {
                      if (sortedNodes.length === 0) {
                        toast.info('No entities to copy');
                        return;
                      }
                      navigator.clipboard.writeText(buildEntityCompiledMarkdown(sortedNodes)).then(() => toast.success('Entities copied to clipboard'));
                    }}
                    onSaveMd={() => {
                      if (sortedNodes.length === 0) {
                        toast.info('No entities to save');
                        return;
                      }
                      const filename = `contextual-graph-entities-${bankId || 'unknown'}.md`;
                      const blob = new Blob([buildEntityCompiledMarkdown(sortedNodes)], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = filename;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast.success(`Entities saved as ${filename}`);
                    }}
                  />
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                    {sortedNodes.length}
                  </span>
                </div>
              </div>
              <div ref={entityListRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                {graphLoading ? (
                  <div className="p-3 space-y-2">
                    <Skeleton className="h-10 w-full bg-white/10" />
                    <Skeleton className="h-10 w-full bg-white/10" />
                    <Skeleton className="h-10 w-full bg-white/10" />
                  </div>
                ) : sortedNodes.length === 0 ? (
                  <div className="text-[11px] text-white/40 px-2 py-3">No entities loaded.</div>
                ) : (
                  sortedNodes.map((entity) => {
                    const active = hoveredNodeId === entity.id;
                    const type = entity.type || (typeof entity.id === 'string' && entity.id.includes(':') ? entity.id.split(':')[0] : 'entity');
                    const typeLine = type && !entity.id.startsWith(`${type}:`) ? `${type}:${entity.id}` : entity.id;
                    const summary = entitySummaryText(entity);
                    const { health, missing, present, expected } = computePatchHealth(entity, patchRoles);
                    const selected = selectedEntityIds.has(entity.id);
                    return (
                      <button
                        key={entity.id}
                        type="button"
                        data-node-id={entity.id}
                        onClick={() => handleNodeClick(entity.id)}
                        onMouseEnter={() => handleNodeHover(entity.id)}
                        onMouseLeave={() => handleNodeHover(null)}
                        className={cn(
                          'w-full flex flex-col gap-1 rounded border bg-black/10 px-2 py-1.5 text-left transition-colors',
                          active ? 'border-emerald-500/30 bg-emerald-900/30' : 'border-white/5 hover:bg-white/5',
                          entitySelectMode && selected ? 'bg-emerald-900/20' : ''
                        )}
                        style={{ borderLeftColor: colorForType(type), borderLeftWidth: 3 }}
                      >
                        <div className="min-w-0 flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {entitySelectMode && (
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedEntityIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(entity.id)) next.delete(entity.id);
                                    else next.add(entity.id);
                                    return next;
                                  });
                                }}
                              >
                                <Checkbox
                                  checked={selected}
                                  onCheckedChange={() => {
                                    setSelectedEntityIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(entity.id)) next.delete(entity.id);
                                      else next.add(entity.id);
                                      return next;
                                    });
                                  }}
                                />
                              </span>
                            )}
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <div className="text-xs text-white/90 truncate">{entity.label || entity.name || entity.id}</div>
                              <div className="text-[10px] text-white/40 truncate">{typeLine}</div>
                            </div>
                          </div>
                          <span
                            title={[
                              `${health.replace('-', ' ')} — checking ${expected.length} role${expected.length === 1 ? '' : 's'}`,
                              present.length > 0 ? `Present: ${present.map((r) => ROLE_LABELS[r] || r).join(', ')}` : '',
                              missing.length > 0 ? `Missing: ${missing.map((r) => ROLE_LABELS[r] || r).join(', ')}` : '',
                            ].filter(Boolean).join(' | ')}
                            className={cn('mt-0.5 w-2 h-2 rounded-full shrink-0 cursor-help', healthColorClass(health))}
                          />
                        </div>
                        <span
                          title={summary.length > 100 ? summary.slice(0, 200) + (summary.length > 200 ? '…' : '') : summary}
                          className="text-[11px] text-white/70 leading-snug line-clamp-4 whitespace-normal break-words text-left w-full"
                        >
                          {summary}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col mt-1" style={{ flex: 1 }}>
              <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
                <span className="font-medium text-sm">Edges</span>
                <div className="flex items-center gap-2">
                  <CardControls
                    scroll={autoScrollEdges}
                    onScrollChange={(checked) => setAutoScrollEdges(Boolean(checked))}
                    onCopy={() => {
                      if (edgeViews.length === 0) {
                        toast.info('No edges to copy');
                        return;
                      }
                      navigator.clipboard.writeText(buildEdgeMarkdownTable(graph.edges, nodeById)).then(() => toast.success('Edges copied to clipboard'));
                    }}
                    onSaveMd={() => {
                      if (edgeViews.length === 0) {
                        toast.info('No edges to save');
                        return;
                      }
                      const filename = `contextual-graph-edges-${bankId || 'unknown'}.md`;
                      const blob = new Blob([buildEdgeMarkdownTable(graph.edges, nodeById)], { type: 'text/markdown' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = filename;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                      toast.success(`Edges saved as ${filename}`);
                    }}
                  />
                  <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                    {edgeViews.length}
                  </span>
                </div>
              </div>
              <div ref={edgeListRef} className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                {edgeViews.length === 0 && (
                  <div className="text-[11px] text-white/40 px-2 py-3">No edges loaded.</div>
                )}
                {edgeViews.map(({ edge, sourceNode, targetNode }) => {
                  const active = hoveredEdgeId === edge.id;
                  const edgeColor = colorForType(edge.type || undefined);
                  const { health, missing, present, expected } = computePatchHealth(edge, patchRoles);
                  return (
                    <button
                      key={edge.id}
                      type="button"
                      data-edge-id={edge.id}
                      onClick={() => handleSelectEdge(edge)}
                      onMouseEnter={() => handleEdgeHover(edge.id)}
                      onMouseLeave={() => handleEdgeHover(null)}
                      className={cn(
                        'w-full text-left rounded border px-2 py-1.5 transition-colors',
                        active ? 'bg-emerald-900/30 border-emerald-500/30' : 'bg-black/10 border-white/5 hover:bg-white/5'
                      )}
                      style={{ borderLeftColor: edgeColor, borderLeftWidth: 3 }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs text-white/90 whitespace-normal break-words leading-snug min-w-0">{edge.detail || edge.label || edge.type || 'Edge'}</div>
                        <span
                          title={[
                            `${health.replace('-', ' ')} — checking ${expected.length} role${expected.length === 1 ? '' : 's'}`,
                            present.length > 0 ? `Present: ${present.map((r) => ROLE_LABELS[r] || r).join(', ')}` : '',
                            missing.length > 0 ? `Missing: ${missing.map((r) => ROLE_LABELS[r] || r).join(', ')}` : '',
                          ].filter(Boolean).join(' | ')}
                          className={cn('mt-0.5 w-2 h-2 rounded-full shrink-0 cursor-help', healthColorClass(health))}
                        />
                      </div>
                      <div className="text-[10px] text-white/40 truncate">
                        {sourceNode?.name || sourceNode?.label || edge.from} → {targetNode?.name || targetNode?.label || edge.to}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            onMouseDown={handleHorizontalResizeStart}
            onDoubleClick={() => setLeftFlex(1.0)}
            className="w-3 shrink-0 cursor-col-resize flex flex-col items-center justify-center group"
            title="Drag to resize left and right panels; double-click to reset"
          >
            <div className="w-1 h-16 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
          </div>

          {/* Right: graph canvas */}
          <Card className="min-h-0 border-white/10 bg-[oklch(0.23_0_0)] flex flex-col overflow-hidden pt-0" style={{ flex: rightFlex }}>
            <div className="h-10 px-3 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0 overflow-hidden">
              <span className="font-medium text-sm">Graph</span>
            </div>
            <CardContent className="flex-1 min-h-0 p-0 relative">
              {serverId && bankId ? (
                <div className="absolute inset-0">
                  <GraphControls
                    cy={cyRef.current}
                    nodes={graph.nodes}
                    edges={graph.edges}
                    layout={layout}
                    setLayout={setLayout}
                    layoutAnimate={layoutAnimate}
                    setLayoutAnimate={setLayoutAnimate}
                    showEdgeLabels={showEdgeLabels}
                    setShowEdgeLabels={setShowEdgeLabels}
                    nodeFilters={nodeFilters}
                    toggleNodeFilter={toggleNodeFilter}
                    edgeFilters={edgeFilters}
                    toggleEdgeFilter={toggleEdgeFilter}
                    hideMode={false}
                    sessionName="contextual-graph"
                  />
                  <InteractiveGraph
                    graph={graph}
                    selectedIds={selectedIds}
                    layoutName={layout}
                    layoutAnimate={layoutAnimate}
                    nodeFilters={nodeFilters}
                    edgeFilters={edgeFilters}
                    filterMode="active"
                    showEdgeLabels={showEdgeLabels}
                    preserveLayoutOnUpdate
                    onNodeClick={handleNodeClick}
                    onNodeHover={handleNodeHover}
                    onEdgeHover={handleEdgeHover}
                    highlightedNodeId={hoveredNodeId}
                    highlightedEdgeId={hoveredEdgeId}
                    onCyReady={(cy) => { cyRef.current = cy; }}
                  />
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/50 text-sm">
                  Select a server and bank to load the contextual graph.
                </div>
              )}
              {graphLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-sm text-white/80">
                  Loading graph…
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
