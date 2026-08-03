'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PageShell } from '@/app/components/page-shell';
import { ServerBankSelectors, type SelectorBank } from '@/app/research/server-bank-selectors';
import { InteractiveGraph, type GraphLayout } from '@/components/research-canvas';
import { serversApi, contextualGraphApi, type GraphNode, type GraphEdge, type GraphCanvas } from '@/lib/api/client';
import { usePersistentServerBank } from '@/lib/use-persistent-server-bank';
import { createLogger } from '@/lib/logger';
import { toast } from 'sonner';

const logger = createLogger('ContextualGraphPage');

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

function backendNodeToGraphNode(node: BackendNode): GraphNode {
  const inferredType = node.labels[0] ?? (typeof node.id === 'string' && node.id.includes(':') ? node.id.split(':')[0] : 'entity');
  return {
    id: node.id,
    type: inferredType,
    label: node.properties.label ?? node.properties.name ?? node.id,
    name: node.properties.name ?? node.properties.label ?? node.id,
    provenance: node.properties.provenance ?? 'known',
    source: node.properties.generated_by === 'contextual_graph' ? 'mental_model' : 'hindsight',
    mental_model_applied: !!node.properties.model_refs && Array.isArray(node.properties.model_refs) && node.properties.model_refs.length > 0,
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
  };
}

function normalizeGraphCanvas(nodes: BackendNode[], edges: BackendEdge[]): GraphCanvas {
  const graphNodes = nodes.map(backendNodeToGraphNode);
  const graphEdges = edges.map(backendEdgeToGraphEdge);
  return { nodes: graphNodes, edges: graphEdges };
}

export default function ContextualGraphPage() {
  const [servers, setServers] = useState<Array<{ id: number; name?: string; base_url?: string }>>([]);
  const [banks, setBanks] = useState<SelectorBank[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graph, setGraph] = useState<GraphCanvas>({ nodes: [], edges: [] });
  const [layout, setLayout] = useState<GraphLayout>('cose');

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

  useEffect(() => {
    if (serverId && bankId) {
      loadGraph();
    } else {
      setGraph({ nodes: [], edges: [] });
    }
  }, [serverId, bankId, loadGraph]);

  const nodeFilters = useMemo(() => {
    return new Set(graph.nodes.map((n) => n.type).filter((t): t is string => Boolean(t)));
  }, [graph.nodes]);

  const edgeFilters = useMemo(() => {
    return new Set(graph.edges.map((e) => e.type).filter((t): t is string => Boolean(t)));
  }, [graph.edges]);

  return (
    <PageShell
      title="Contextual Graph"
      subtitle="Explore the graph enriched with contextual mental-model patches."
      count={graph.nodes.length}
      countLabel="node"
      loading={graphLoading}
    >
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
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
          <div className="flex items-center gap-2 text-sm text-white/60">
            <span>{graph.edges.length} edge{graph.edges.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative mt-2 rounded-md border border-white/10 overflow-hidden bg-[oklch(0.18_0_0)]">
          {serverId && bankId ? (
            <InteractiveGraph
              graph={graph}
              layoutName={layout}
              layoutAnimate={false}
              nodeFilters={nodeFilters}
              edgeFilters={edgeFilters}
              filterMode="active"
              showEdgeLabels={false}
              preserveLayoutOnUpdate
            />
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
        </div>
      </div>
    </PageShell>
  );
}
