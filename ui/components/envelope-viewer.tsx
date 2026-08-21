'use client';

import { useState, useMemo, useCallback } from 'react';
import { NarrativeViewer } from './narrative-viewer';
import { InteractiveGraph, type GraphLayout } from './research-canvas';
import { MermaidDiagram } from './mermaid-diagram';
import { Copy, Network, Table2, FileText, Shapes } from 'lucide-react';
import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge } from '@/lib/api/client';

type EnvelopeTab = 'narrative' | 'graph' | 'tables' | 'diagrams';

type EnvelopeShape = {
  intent_text?: string | null;
  synthesis?: { narrative?: string | null } | null;
  canvas?: {
    graph?: { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
    tables?: Array<{ name: string; columns?: string[]; rows: Record<string, any>[] }> | null;
    diagrams?: Array<{ name: string; type: string; content: string }> | null;
  } | null;
};

export interface EnvelopeCopyEvent {
  type: 'narrative' | 'graph' | 'tables' | 'diagrams';
  /** Markdown for narrative sections; JSON stringified payloads for structured types. */
  payload: string;
  /** Human-readable label for the copied chunk. */
  label?: string;
}

export interface EnvelopeViewerProps {
  envelope: ResearchStepSummary | DiscoverStepResponse | null;
  title?: string;
  onCopy?: (event: EnvelopeCopyEvent) => void;
  className?: string;
}

function normalizeEnvelope(envelope: ResearchStepSummary | DiscoverStepResponse | null): EnvelopeShape {
  if (!envelope) return {};
  if ('intent_text' in envelope) {
    return envelope as ResearchStepSummary;
  }
  return {
    synthesis: envelope.synthesis,
    canvas: envelope.canvas,
  };
}

function hasData(normalized: EnvelopeShape, tab: EnvelopeTab): boolean {
  switch (tab) {
    case 'narrative':
      return Boolean(normalized.synthesis?.narrative?.trim());
    case 'graph':
      return Boolean(
        (normalized.canvas?.graph?.nodes?.length ?? 0) > 0 ||
          (normalized.canvas?.graph?.edges?.length ?? 0) > 0
      );
    case 'tables':
      return (normalized.canvas?.tables?.length ?? 0) > 0;
    case 'diagrams':
      return (normalized.canvas?.diagrams?.length ?? 0) > 0;
    default:
      return false;
  }
}

export function EnvelopeViewer({ envelope, title = 'Preview', onCopy, className = '' }: EnvelopeViewerProps) {
  const normalized = useMemo(() => normalizeEnvelope(envelope), [envelope]);
  const [activeTab, setActiveTab] = useState<EnvelopeTab>('narrative');
  const [graphLayout, setGraphLayout] = useState<GraphLayout>('fcose');
  const [plainText, setPlainText] = useState(false);
  const [showIndex, setShowIndex] = useState(true);

  const tabs = useMemo<EnvelopeTab[]>(() => {
    const all: EnvelopeTab[] = ['narrative', 'graph', 'tables', 'diagrams'];
    return all.filter((t) => hasData(normalized, t));
  }, [normalized]);

  const activeHasData = hasData(normalized, activeTab);

  const handleCopyNarrative = useCallback(
    (markdown: string, sectionTitle?: string) => {
      onCopy?.({ type: 'narrative', payload: markdown, label: sectionTitle });
    },
    [onCopy]
  );

  const handleCopyAll = useCallback(() => {
    switch (activeTab) {
      case 'narrative': {
        const text = normalized.synthesis?.narrative || '';
        onCopy?.({ type: 'narrative', payload: text, label: normalized.intent_text || 'Narrative' });
        break;
      }
      case 'graph': {
        const payload = JSON.stringify(normalized.canvas?.graph || { nodes: [], edges: [] }, null, 2);
        onCopy?.({ type: 'graph', payload, label: normalized.intent_text || 'Graph' });
        break;
      }
      case 'tables': {
        const payload = JSON.stringify(normalized.canvas?.tables || [], null, 2);
        onCopy?.({ type: 'tables', payload, label: normalized.intent_text || 'Tables' });
        break;
      }
      case 'diagrams': {
        const payload = JSON.stringify(normalized.canvas?.diagrams || [], null, 2);
        onCopy?.({ type: 'diagrams', payload, label: normalized.intent_text || 'Diagrams' });
        break;
      }
    }
  }, [activeTab, normalized, onCopy]);

  const renderContent = () => {
    if (!envelope) {
      return (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          Select a Reflect output or page from the session list.
        </div>
      );
    }
    if (!activeHasData) {
      return (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          No {activeTab} data in the selected item.
        </div>
      );
    }

    switch (activeTab) {
      case 'narrative':
        return (
          <NarrativeViewer
            content={normalized.synthesis?.narrative ?? ''}
            title="Sections"
            viewMode={plainText ? 'plain' : 'markdown'}
            showIndex={showIndex}
            onCopySection={handleCopyNarrative}
            className="h-full"
          />
        );
      case 'graph': {
        const nodes = normalized.canvas?.graph?.nodes || [];
        const edges = normalized.canvas?.graph?.edges || [];
        return (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 flex items-center gap-3 shrink-0">
              <select
                value={graphLayout}
                onChange={(e) => setGraphLayout(e.target.value as GraphLayout)}
                className="h-7 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2 text-[11px] text-white/80 focus:border-emerald-500 outline-none"
                aria-label="Graph layout"
              >
                <option value="fcose">Force (fCoSE)</option>
                <option value="avsdf">AVSDF</option>
                <option value="cose">Force (CoSE)</option>
                <option value="dagre">Dagre</option>
                <option value="breadthfirst">Breadth-first</option>
                <option value="concentric">Concentric</option>
                <option value="circle">Circle</option>
              </select>
              <span className="text-[11px] text-white/50">
                {nodes.length} nodes · {edges.length} edges
              </span>
            </div>
            <div className="flex-1 min-h-0 relative">
              {nodes.length > 0 || edges.length > 0 ? (
                <InteractiveGraph
                  graph={{ nodes: nodes as GraphNode[], edges: edges as GraphEdge[] }}
                  layoutName={graphLayout}
                  showEdgeLabels
                  edgeFilters={new Set()}
                  nodeFilters={new Set()}
                />
              ) : (
                <div className="h-full flex items-center justify-center text-white/40 text-xs">No graph data.</div>
              )}
            </div>
          </div>
        );
      }
      case 'tables': {
        const tables = normalized.canvas?.tables || [];
        return (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-4">
            {tables.map((table, idx) => (
              <div key={idx} className="rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10 bg-emerald-900/10 flex items-center justify-between">
                  <span className="text-sm font-medium text-emerald-300 truncate">{table.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onCopy?.({
                        type: 'tables',
                        payload: JSON.stringify([table], null, 2),
                        label: `Table: ${table.name}`,
                      })
                    }
                    className="p-1 rounded text-white/30 hover:text-emerald-300 hover:bg-white/10 transition-colors"
                    title="Copy table"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <div className="p-3 overflow-x-auto">
                  <table className="w-full text-[11px] text-left text-white/80">
                    <thead>
                      <tr className="border-b border-white/10 text-white/50">
                        {(table.columns?.length ? table.columns : Object.keys(table.rows[0] || {})).map((col) => (
                          <th key={col} className="px-2 py-1 font-medium whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row: Record<string, any>, ridx: number) => (
                        <tr key={ridx} className="border-b border-white/5 last:border-0">
                          {(table.columns?.length ? table.columns : Object.keys(row)).map((col: string) => {
                            const val = row[col];
                            const str = val === undefined || val === null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
                            return (
                              <td key={col} className="px-2 py-1 whitespace-nowrap">
                                {str}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        );
      }
      case 'diagrams': {
        const diagrams = normalized.canvas?.diagrams || [];
        return (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-4">
            {diagrams.map((diagram, idx) => (
              <div key={idx} className="rounded-md border border-white/10 bg-[oklch(0.18_0_0)] overflow-hidden">
                <div className="px-3 py-2 border-b border-white/10 bg-emerald-900/10 flex items-center justify-between">
                  <span className="text-sm font-medium text-emerald-300 truncate">{diagram.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      onCopy?.({
                        type: 'diagrams',
                        payload: JSON.stringify([diagram], null, 2),
                        label: `Diagram: ${diagram.name}`,
                      })
                    }
                    className="p-1 rounded text-white/30 hover:text-emerald-300 hover:bg-white/10 transition-colors"
                    title="Copy diagram"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
                <div className="p-3">
                  <MermaidDiagram content={diagram.content} type={diagram.type} />
                </div>
              </div>
            ))}
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className={`flex flex-col min-h-0 ${className}`}>
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors ${
                activeTab === tab
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-white/60 hover:bg-white/5 hover:text-white/90'
              }`}
            >
              {tab === 'narrative' && <FileText className="h-3 w-3" />}
              {tab === 'graph' && <Network className="h-3 w-3" />}
              {tab === 'tables' && <Table2 className="h-3 w-3" />}
              {tab === 'diagrams' && <Shapes className="h-3 w-3" />}
              <span className="capitalize">{tab}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {activeTab === 'narrative' && (
            <>
              <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showIndex}
                  onChange={(e) => setShowIndex(e.target.checked)}
                  className="rounded border-white/10 bg-black/20 text-emerald-500 focus:ring-emerald-500/30"
                />
                Index
              </label>
              <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={plainText}
                  onChange={(e) => setPlainText(e.target.checked)}
                  className="rounded border-white/10 bg-black/20 text-emerald-500 focus:ring-emerald-500/30"
                />
                Plain
              </label>
            </>
          )}
          {activeHasData && (
            <button
              type="button"
              onClick={handleCopyAll}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-white/70 hover:text-emerald-300 hover:bg-white/10 transition-colors"
              title={`Copy all ${activeTab}`}
            >
              <Copy className="h-3 w-3" />
              Copy all
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{renderContent()}</div>
    </div>
  );
}
