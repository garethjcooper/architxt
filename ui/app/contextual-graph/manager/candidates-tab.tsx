'use client';

import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';
import { formatRelative, getLastRefreshedAt, MODEL_ROLE_LABELS, isCandidateNode, isCandidateEdge } from '@/lib/contextual-graph/display';
import type { DisplayNode, DisplayEdge } from './page';

const ROLE_LABELS = MODEL_ROLE_LABELS;

export interface CandidatesTabProps {
  nodes: DisplayNode[];
  edges: DisplayEdge[];
  nodeById: Map<string, DisplayNode>;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
  loading?: boolean;
}

type CandidateFilter = 'all' | 'nodes' | 'edges';

export function CandidatesTab({
  nodes,
  edges,
  nodeById,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
  loading,
}: CandidatesTabProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CandidateFilter>('all');

  const discoveredNodes = useMemo(
    () => nodes.filter((n) => isCandidateNode(n)).sort((a, b) => a.label.localeCompare(b.label)),
    [nodes]
  );
  const discoveredEdges = useMemo(
    () =>
      edges
        .filter((e) => isCandidateEdge(e))
        .sort((a, b) => {
          const aKey = `${a.source_id}|${a.target_id}`;
          const bKey = `${b.source_id}|${b.target_id}`;
          return aKey.localeCompare(bKey);
        }),
    [edges]
  );

  const filteredNodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return discoveredNodes;
    return discoveredNodes.filter(
      (n) =>
        n.label.toLowerCase().includes(q) ||
        n.id.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q)
    );
  }, [discoveredNodes, search]);

  const filteredEdges = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return discoveredEdges;
    return discoveredEdges.filter((e) => {
      const source = nodeById.get(e.source_id)?.label || e.source_id;
      const target = nodeById.get(e.target_id)?.label || e.target_id;
      const text = `${e.detail || ''} ${e.label || ''} ${e.type || ''} ${source} ${target}`.toLowerCase();
      return text.includes(q);
    });
  }, [discoveredEdges, search, nodeById]);

  const showNodes = filter === 'all' || filter === 'nodes';
  const showEdges = filter === 'all' || filter === 'edges';

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-3 pb-2 border-b border-white/10 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidates..."
            className="h-8 pl-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/40"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as CandidateFilter)}
          className="h-8 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2.5 text-sm text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
        >
          <option value="all">All</option>
          <option value="nodes">Nodes</option>
          <option value="edges">Edges</option>
        </select>
        <span className="text-[11px] text-white/50 ml-auto">
          {filteredNodes.length} node{filteredNodes.length !== 1 ? 's' : ''} / {filteredEdges.length} edge
          {filteredEdges.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex mt-2 gap-2">
        <div className="min-h-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col flex-1">
          {showNodes && (
            <>
              <div className="h-10 px-3 border-b border-white/10 bg-amber-900/20 text-amber-300 flex items-center justify-between shrink-0">
                <span className="font-medium text-sm">Discovered nodes</span>
                <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-amber-300 font-mono">
                  {filteredNodes.length}
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                {loading ? (
                  <div className="p-3 space-y-2">
                    <Skeleton className="h-10 w-full bg-white/10" />
                    <Skeleton className="h-10 w-full bg-white/10" />
                  </div>
                ) : filteredNodes.length === 0 ? (
                  <div className="text-[11px] text-white/40 px-2 py-3">No discovered nodes.</div>
                ) : (
                  filteredNodes.map((node) => {
                    const active = selectedNodeId === node.id;
                    const typeLine = node.type && !node.id.startsWith(`${node.type}:`) ? `${node.type}:${node.id}` : node.id;
                    const lastRefreshed = getLastRefreshedAt(node.modelRefs);
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => onSelectNode(node.id)}
                        className={cn(
                          'w-full rounded border bg-black/10 px-1.5 py-1 text-left transition-colors',
                          active ? 'border-amber-500/50 bg-amber-900/30' : 'border-white/5 hover:bg-white/5'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-col gap-0 min-w-0">
                            <div className="text-xs text-white/90 truncate">{node.label}</div>
                            <div className="text-[10px] text-white/40 truncate">{typeLine}</div>
                          </div>
                          <span className="text-[10px] text-white/30 shrink-0">{formatRelative(lastRefreshed)}</span>
                        </div>
                        {node.modelRefs.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            {node.modelRefs.map((ref, i) => (
                              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-white/50">
                                {ROLE_LABELS[ref.role || ''] || ref.role}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {showEdges && (
            <>
              {showNodes && <div className="h-px bg-white/10" />}
              <div className="h-10 px-3 border-b border-white/10 bg-amber-900/20 text-amber-300 flex items-center justify-between shrink-0">
                <span className="font-medium text-sm">Discovered edges</span>
                <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-amber-300 font-mono">
                  {filteredEdges.length}
                </span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
                {loading ? (
                  <div className="p-3 space-y-2">
                    <Skeleton className="h-10 w-full bg-white/10" />
                    <Skeleton className="h-10 w-full bg-white/10" />
                  </div>
                ) : filteredEdges.length === 0 ? (
                  <div className="text-[11px] text-white/40 px-2 py-3">No discovered edges.</div>
                ) : (
                  filteredEdges.map((edge) => {
                    const active = selectedEdgeId === edge.id;
                    const source = nodeById.get(edge.source_id);
                    const target = nodeById.get(edge.target_id);
                    const lastRefreshed = getLastRefreshedAt(edge.modelRefs);
                    return (
                      <button
                        key={edge.id}
                        type="button"
                        onClick={() => onSelectEdge(edge.id)}
                        className={cn(
                          'w-full text-left rounded border px-1.5 py-1 transition-colors',
                          active ? 'bg-amber-900/30 border-amber-500/50' : 'bg-black/10 border-white/5 hover:bg-white/5'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs text-white/90 truncate">{edge.detail || edge.label || edge.type || 'Edge'}</div>
                            <div className="text-[10px] text-white/40 truncate">
                              {source?.label || edge.source_id} → {target?.label || edge.target_id}
                            </div>
                          </div>
                          <span className="text-[10px] text-white/30 shrink-0">{formatRelative(lastRefreshed)}</span>
                        </div>
                        {edge.modelRefs.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            {edge.modelRefs.map((ref, i) => (
                              <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 border-white/10 text-white/50">
                                {ROLE_LABELS[ref.role || ''] || ref.role}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
