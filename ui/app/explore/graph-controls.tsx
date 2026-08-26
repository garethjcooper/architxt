import { useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { InteractiveGraph, colorForType, type GraphLayout } from '@/components/research-canvas';
import type { GraphNode, GraphEdge } from '@/components/research-canvas';
import { sanitizeFilenameBase } from '@/lib/utils';
import cytoscape from 'cytoscape';

function downloadBlob(content: string | Blob, filename: string, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mime });
}

function escapeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function generateMermaid(nodes: GraphNode[], edges: GraphEdge[]): string {
  const nodeById = new Map<string, GraphNode>();
  for (const n of nodes) {
    if (n?.id) nodeById.set(n.id, n);
  }

  const seenEdgeKeys = new Set<string>();
  const visibleEdges = edges.filter((e) => {
    if (!e?.from || !e?.to) return false;
    if (!nodeById.has(e.from) || !nodeById.has(e.to)) return false;
    const label = e.label || e.type || '';
    const key = `${e.from}|${e.to}|${label}`;
    if (seenEdgeKeys.has(key)) return false;
    seenEdgeKeys.add(key);
    return true;
  });

  const lines: string[] = [];
  lines.push('flowchart LR');

  for (const n of nodeById.values()) {
    const id = escapeMermaidId(n.id);
    const label = (n.name || n.label || id).replace(/["]/g, '#quot;');
    lines.push(`    ${id}(("${label}"))`);
  }

  for (const e of visibleEdges) {
    const source = escapeMermaidId(e.from);
    const target = escapeMermaidId(e.to);
    const label = (e.label || e.type || '').replace(/["]/g, '#quot;');
    if (label) {
      lines.push(`    ${source} -->|${label}| ${target}`);
    } else {
      lines.push(`    ${source} --> ${target}`);
    }
  }

  return lines.join('\n');
}

export interface GraphControlsProps {
  cy: cytoscape.Core | null;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layout: GraphLayout;
  setLayout: (v: GraphLayout) => void;
  layoutAnimate: boolean;
  setLayoutAnimate: (v: boolean) => void;
  showEdgeLabels: boolean;
  setShowEdgeLabels: (v: boolean) => void;
  nodeFilters: Set<string>;
  toggleNodeFilter: (type: string) => void;
  edgeFilters: Set<string>;
  toggleEdgeFilter: (type: string) => void;
  /** Filter nodes/edges by contextual-graph patch health. */
  healthFilters?: Set<'green' | 'orange' | 'red'>;
  toggleHealthFilter?: (health: 'green' | 'orange' | 'red') => void;
  /** If true, the filter set represents types to hide rather than show. */
  hideMode?: boolean;
  sessionName?: string;
}

const HEALTH_LABELS: Record<'green' | 'orange' | 'red', { label: string; color: string; bg: string; border: string; text: string }> = {
  green: { label: 'all', color: '#10b981', bg: 'bg-emerald-500/20', border: 'border-emerald-500/50', text: 'text-emerald-300' },
  orange: { label: 'some', color: '#f97316', bg: 'bg-orange-500/20', border: 'border-orange-500/50', text: 'text-orange-300' },
  red: { label: 'none', color: '#ef4444', bg: 'bg-red-500/20', border: 'border-red-500/50', text: 'text-red-300' },
};
const HEALTH_ORDER: Array<'green' | 'orange' | 'red'> = ['green', 'orange', 'red'];

export function GraphControls({
  cy,
  nodes,
  edges,
  layout,
  setLayout,
  layoutAnimate,
  setLayoutAnimate,
  showEdgeLabels,
  setShowEdgeLabels,
  nodeFilters,
  toggleNodeFilter,
  edgeFilters,
  toggleEdgeFilter,
  healthFilters,
  toggleHealthFilter,
  hideMode = false,
  sessionName = 'explore',
}: GraphControlsProps) {
  const nodeTypes = useMemo(() => {
    return Array.from(new Set(nodes.map((n) => n.type || (typeof n.id === 'string' && n.id.includes(':') ? n.id.split(':')[0] : undefined)).filter((t): t is string => Boolean(t) && t !== 'system'))).sort();
  }, [nodes]);

  const edgeTypes = useMemo(() => {
    return Array.from(new Set(edges.map((e) => e.type).filter((t): t is string => Boolean(t)))).sort();
  }, [edges]);

  const savePng = () => {
    if (!cy || cy.destroyed()) return;
    const date = new Date().toISOString().split('T')[0];
    const sanitized = sanitizeFilenameBase(sessionName);
    const filename = `${sanitized}-graph-${date}.png`;
    const dataUrl = (cy as any).png({ full: true, bg: 'transparent', scale: 4 });
    downloadBlob(dataUrlToBlob(dataUrl), filename, 'image/png');
    toast.success(`Diagram saved as ${filename}`);
  };

  const saveSvg = async () => {
    if (!cy || cy.destroyed()) return;
    const date = new Date().toISOString().split('T')[0];
    const sanitized = sanitizeFilenameBase(sessionName);
    const filename = `${sanitized}-graph-${date}.svg`;
    const cytoscapeSvg = await import('cytoscape-svg');
    const registerSvg = (cytoscapeSvg as any).default ?? cytoscapeSvg;
    registerSvg(cytoscape);
    const svg = (cy as any).svg({ full: true });
    downloadBlob(svg, filename, 'image/svg+xml');
    toast.success(`Diagram saved as ${filename}`);
  };

  const saveJson = () => {
    const date = new Date().toISOString().split('T')[0];
    const sanitized = sanitizeFilenameBase(sessionName);
    const filename = `${sanitized}-graph-${date}.json`;
    const payload = {
      meta: {
        exportedAt: new Date().toISOString(),
        sessionName,
        view: 'graph',
      },
      nodes,
      edges,
    };
    downloadBlob(JSON.stringify(payload, null, 2), filename, 'application/json');
    toast.success(`Diagram data saved as ${filename}`);
  };

  const saveMermaid = () => {
    const date = new Date().toISOString().split('T')[0];
    const sanitized = sanitizeFilenameBase(sessionName);
    const filename = `${sanitized}-graph-${date}.mmd`;
    const mermaid = generateMermaid(nodes, edges);
    downloadBlob(mermaid, filename, 'text/plain');
    toast.success(`Mermaid diagram saved as ${filename}`);
  };

  return (
    <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/75 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[220px]">
      <div className="flex items-center gap-2">
        <select
          value={layout}
          onChange={(e) => setLayout(e.target.value as GraphLayout)}
          className="h-7 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2 text-[10px] text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
          aria-label="Graph layout"
        >
          <option value="fcose">Force (fCoSE)</option>
          <option value="avsdf">AVSDF</option>
          <option value="cose">Force (CoSE)</option>
          <option value="dagre">Dagre (hierarchical)</option>
          <option value="breadthfirst">Breadth-first</option>
          <option value="concentric">Concentric</option>
          <option value="circle">Circle</option>
        </select>
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
        <Switch
          checked={layoutAnimate}
          onCheckedChange={(checked) => setLayoutAnimate(Boolean(checked))}
          size="sm"
        />
        Animate
      </label>
      <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
        <Switch
          checked={showEdgeLabels}
          onCheckedChange={(checked) => setShowEdgeLabels(Boolean(checked))}
          size="sm"
        />
        Labels
      </label>
      {nodeTypes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/50">Types:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const target = hideMode ? new Set(nodeTypes) : new Set<string>();
                  nodeTypes.forEach((t) => {
                    const inSet = nodeFilters.has(t);
                    if (hideMode ? !inSet : inSet) toggleNodeFilter(t);
                  });
                }}
                className="text-[9px] text-emerald-300/80 hover:text-emerald-300"
              >
                {hideMode ? 'none' : 'all'}
              </button>
              <span className="text-white/20">|</span>
              <button
                type="button"
                onClick={() => {
                  nodeTypes.forEach((t) => {
                    const inSet = nodeFilters.has(t);
                    if (hideMode ? inSet : !inSet) toggleNodeFilter(t);
                  });
                }}
                className="text-[9px] text-white/50 hover:text-white/70"
              >
                {hideMode ? 'all' : 'none'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {nodeTypes.map((type) => {
              const inSet = nodeFilters.has(type);
              const active = hideMode ? !inSet : inSet;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleNodeFilter(type)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    active
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
                  }`}
                  style={{ borderLeftColor: colorForType(type), borderLeftWidth: 3 }}
                  title={active ? (hideMode ? 'Show this node type' : 'Hide this node type') : (hideMode ? 'Hide this node type' : 'Show this node type')}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {edgeTypes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/50">Edges:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  edgeTypes.forEach((t) => {
                    const inSet = edgeFilters.has(t);
                    if (hideMode ? !inSet : inSet) toggleEdgeFilter(t);
                  });
                }}
                className="text-[9px] text-emerald-300/80 hover:text-emerald-300"
              >
                {hideMode ? 'none' : 'all'}
              </button>
              <span className="text-white/20">|</span>
              <button
                type="button"
                onClick={() => {
                  edgeTypes.forEach((t) => {
                    const inSet = edgeFilters.has(t);
                    if (hideMode ? inSet : !inSet) toggleEdgeFilter(t);
                  });
                }}
                className="text-[9px] text-white/50 hover:text-white/70"
              >
                {hideMode ? 'all' : 'none'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {edgeTypes.map((type) => {
              const inSet = edgeFilters.has(type);
              const active = hideMode ? !inSet : inSet;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleEdgeFilter(type)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    active
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
                  }`}
                  style={{ borderLeftColor: colorForType(type), borderLeftWidth: 3 }}
                  title={active ? (hideMode ? 'Show this edge type' : 'Hide this edge type') : (hideMode ? 'Hide this edge type' : 'Show this edge type')}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {toggleHealthFilter && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/50">Health:</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => HEALTH_ORDER.forEach((h) => {
                  if (!healthFilters?.has(h)) toggleHealthFilter(h);
                })}
                className="text-[9px] text-emerald-300/80 hover:text-emerald-300"
              >
                all
              </button>
              <span className="text-white/20">|</span>
              <button
                type="button"
                onClick={() => HEALTH_ORDER.forEach((h) => {
                  if (healthFilters?.has(h)) toggleHealthFilter(h);
                })}
                className="text-[9px] text-white/50 hover:text-white/70"
              >
                none
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {HEALTH_ORDER.map((health) => {
              const active = !!healthFilters?.has(health);
              const style = HEALTH_LABELS[health];
              return (
                <button
                  key={health}
                  type="button"
                  onClick={() => toggleHealthFilter(health)}
                  className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                    active ? `${style.bg} ${style.border} ${style.text}` : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
                  }`}
                  style={{ borderLeftColor: style.color, borderLeftWidth: 3 }}
                  title={active ? 'Hide this health state' : 'Show this health state'}
                >
                  {style.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="h-px bg-white/10" />
      <button
        type="button"
        onClick={savePng}
        className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
      >
        <Download className="h-3 w-3" />
        Save PNG
      </button>
      <button
        type="button"
        onClick={saveSvg}
        className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
      >
        <Download className="h-3 w-3" />
        Save SVG
      </button>
      <button
        type="button"
        onClick={saveJson}
        className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
      >
        <Download className="h-3 w-3" />
        Save JSON
      </button>
      <button
        type="button"
        onClick={saveMermaid}
        className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
      >
        <Download className="h-3 w-3" />
        Save Mermaid
      </button>
    </div>
  );
}
