'use client';

import { ArrowRight } from 'lucide-react';
import type { GraphEdge, GraphNode } from '@/lib/api/client';
import { formatEdgeToken } from './query-tokens';
import { colorForType } from '@/components/research-canvas';

export interface EdgeTableProps {
  edges: Array<GraphEdge & { inScope?: boolean }>;
  nodeMap: Map<string, GraphNode>;
  onInsertToken: (token: string) => void;
}

export function EdgeTable({
  edges,
  nodeMap,
  onInsertToken,
}: EdgeTableProps) {
  const labelFor = (id: string) => nodeMap.get(id)?.label || id;
  const qualifiedFor = (id: string) => {
    const node = nodeMap.get(id);
    return node?.type && !id.startsWith(`${node.type}:`) ? `${node.type}:${id}` : id;
  };

  return (
    <div className="space-y-1">
      {edges.map((e) => {
        const key = `${e.source}|${e.target}|${e.label || e.relationship_type || ''}`;
        const inScope = e.inScope ?? true;
        return (
          <button
            key={key}
            type="button"
            onDoubleClick={() => onInsertToken(formatEdgeToken(e.source, e.target, e.label || e.relationship_type || 'edge'))}
            className={`w-full flex items-center justify-between gap-2 rounded border px-2 py-1.5 min-h-[2.8125rem] text-left transition-colors ${
              inScope
                ? 'border-white/5 bg-black/20 hover:bg-white/5'
                : 'border-white/5 bg-black/10 opacity-60 hover:bg-white/5 hover:opacity-80'
            }`}
            style={{ borderLeftColor: colorForType(e.relationship_type || undefined), borderLeftWidth: 3 }}
          >
            <div className="min-w-0 flex-1 flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5 text-xs text-white/90 truncate">
                <span className="text-white/90 truncate">{labelFor(e.source)}</span>
                <span className="text-white/40">—</span>
                {e.relationship_type && (
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded border shrink-0 ${
                      e.edge_source === 'synthesize'
                        ? 'border-violet-500/30 bg-violet-900/20 text-violet-300'
                        : 'border-white/10 bg-white/5 text-white/50'
                    }`}
                    title="Relationship type"
                  >
                    {e.relationship_type}
                  </span>
                )}
                <span className="text-emerald-300/80 truncate">{e.label || e.relationship_type || 'edge'}</span>
                <ArrowRight className="w-3 h-3 text-white/40 shrink-0" />
                <span className="text-white/90 truncate">{labelFor(e.target)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {e.label_long && (
                  <div
                    className="text-[10px] text-white/50 font-mono truncate"
                    title={e.label_long}
                  >
                    {e.label_long}
                  </div>
                )}
                <div className="text-[10px] text-white/40 font-mono truncate ml-auto" title={`${qualifiedFor(e.source)} → ${qualifiedFor(e.target)}`}>
                  {qualifiedFor(e.source)} → {qualifiedFor(e.target)}
                </div>
              </div>
            </div>
            {!inScope && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-white/50 shrink-0">
                not in graph
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
