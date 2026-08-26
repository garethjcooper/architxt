import { useMemo, useRef, useState } from 'react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, Copy, Download } from 'lucide-react';
import { toast } from 'sonner';
import { InteractiveGraph, colorForType, type GraphLayout } from '@/components/research-canvas';
import { ComponentDiagram } from '@/components/component-diagram';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { EnvelopeControls } from '@/components/envelope-controls';
import { buildEnvelopeMarkdown } from '@/lib/envelope-markdown';
import { sanitizeFilenameBase, downloadMarkdown } from '@/lib/utils';
import type { DiscoverStepResponse, GraphNode, GraphEdge, ResearchStepSummary } from '@/lib/api/client';
import type { EnvelopeCopyEvent } from '@/lib/envelope-copy-event';
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

function generateMermaid(
  nodes: GraphNode[],
  edges: GraphEdge[],
  canvasView: CanvasView,
): string {
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
    if (canvasView === 'components') {
      lines.push(`    ${id}["${label}"]`);
    } else {
      lines.push(`    ${id}(("${label}"))`);
    }
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

export type ResultView = 'narrative';
export type CanvasView = 'graph' | 'components';

export interface ResearchCopyEvent {
  type: 'narrative' | 'graph' | 'tables' | 'diagrams';
  /** Markdown for narrative sections; JSON stringified payloads for structured types. */
  payload: string;
  /** Human-readable label for the copied chunk. */
  label?: string;
}

/** Convert internal EnvelopeCopyEvent to the ResearchCopyEvent shape (they are structurally identical). */
function toResearchCopyEvent(event: EnvelopeCopyEvent): ResearchCopyEvent {
  return event;
}

export interface ResearchResultPanelProps {
  loading: boolean;
  error: string | null;
  result: DiscoverStepResponse | ResearchStepSummary | null;
  viewMode: 'step' | 'session';
  trail?: ResearchStepSummary[];
  selectedStepIds?: Set<number>;
  resultView: ResultView;
  canvasView: CanvasView;
  setCanvasView: (v: CanvasView) => void;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  allGraphEdges?: GraphEdge[];
  graphLayout: GraphLayout;
  setGraphLayout: (v: GraphLayout) => void;
  graphLayoutAnimate: boolean;
  setGraphLayoutAnimate: (v: boolean) => void;
  showEdgeLabels: boolean;
  setShowEdgeLabels: (v: boolean) => void;
  edgeFilters: Set<string>;
  toggleEdgeFilter: (type: string) => void;
  nodeFilters: Set<string>;
  toggleNodeFilter: (type: string) => void;
  onGraphAddToQuery?: (selection: { kind: string; ids: string[]; source?: string }) => void;
  bottomFlex?: number;
  narrativeWidth?: number;
  sessionName?: string;
  showNarrativePlain?: boolean;
  setShowNarrativePlain?: (v: boolean) => void;
  onResizeNarrativeStart?: (e: React.MouseEvent) => void;
  onResizeNarrativeReset?: () => void;
  /** If provided, copy actions are delegated to this handler instead of the default clipboard/download behavior. */
  onCopy?: (event: ResearchCopyEvent) => void;
  /** When false, only the narrative pane is rendered (no graph/diagrams panel). */
  showCanvas?: boolean;
  /** Optional key namespace passed through to NarrativeViewer. */
  keyPrefix?: string;
}

export function ResearchResultPanel({
  loading,
  error,
  result,
  viewMode,
  trail: trailProp,
  selectedStepIds: selectedStepIdsProp,
  resultView,
  canvasView,
  setCanvasView,
  graphNodes,
  graphEdges,
  allGraphEdges,
  graphLayout,
  setGraphLayout,
  graphLayoutAnimate,
  setGraphLayoutAnimate,
  showEdgeLabels,
  setShowEdgeLabels,
  edgeFilters,
  toggleEdgeFilter,
  nodeFilters,
  toggleNodeFilter,
  onGraphAddToQuery,
  bottomFlex,
  narrativeWidth = 40,
  sessionName = 'narrative',
  showNarrativePlain = false,
  setShowNarrativePlain,
  onResizeNarrativeStart,
  onResizeNarrativeReset,
  onCopy,
  showCanvas = false,
  keyPrefix,
}: ResearchResultPanelProps) {
  const trail = trailProp ?? [];
  const selectedStepIds = selectedStepIdsProp ?? new Set<number>();
  const [showGraphControls, setShowGraphControls] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(true);
  const [hoveredInfo, setHoveredInfo] = useState<{ kind: 'node' | 'edge'; data: any } | null>(null);
  const [showNarrativeIndex, setShowNarrativeIndex] = useState(true);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const resultQueryDepth = result && 'query_depth' in result ? result.query_depth : undefined;

  const nodeTypes = useMemo(() => {
    return Array.from(new Set(graphNodes.map((n) => n.type).filter((t): t is string => Boolean(t) && t !== 'system'))).sort();
  }, [graphNodes]);

  const edgeTypes = useMemo(() => {
    const source = allGraphEdges ?? graphEdges;
    return Array.from(new Set(source.map((e) => e.type).filter((t): t is string => Boolean(t)))).sort();
  }, [allGraphEdges, graphEdges]);

  const hasActiveFilters = edgeTypes.length > 0;

  const mergedNarrative = useMemo(() => {
    if (viewMode !== 'session') return null;
    const selected = trail.filter((s) => selectedStepIds.has(s.id));
    if (selected.length === 0) return null;
    return selected
      .map((s) => {
        const narrative = s.synthesis?.narrative;
        if (!narrative) return null;
        return narrative;
      })
      .filter(Boolean)
      .join('\n\n---\n\n');
  }, [trail, selectedStepIds, viewMode]);

  const mergedTables = useMemo(() => {
    if (viewMode !== 'session') return null;
    const selected = trail.filter((s) => selectedStepIds.has(s.id));
    if (selected.length === 0) return null;
    const tables: Array<{ name: string; columns: string[]; rows: Record<string, any>[] }> = [];
    for (const s of selected) {
      const stepTables = s.canvas?.tables;
      if (stepTables?.length) tables.push(...stepTables);
    }
    return tables.length > 0 ? tables : null;
  }, [trail, selectedStepIds, viewMode]);

  const mergedDiagrams = useMemo(() => {
    if (viewMode !== 'session') return null;
    const selected = trail.filter((s) => selectedStepIds.has(s.id));
    if (selected.length === 0) return null;
    const diagrams: Array<{ name: string; type: string; content: string }> = [];
    for (const s of selected) {
      const stepDiagrams = s.canvas?.diagrams;
      if (stepDiagrams?.length) diagrams.push(...stepDiagrams);
    }
    return diagrams.length > 0 ? diagrams : null;
  }, [trail, selectedStepIds, viewMode]);

  const mergedGraph = useMemo(() => {
    if (viewMode !== 'session') return null;
    const selected = trail.filter((s) => selectedStepIds.has(s.id));
    if (selected.length === 0) return null;
    const nodes: GraphNode[] = [];
    const nodeIds = new Set<string>();
    const edges: GraphEdge[] = [];
    const edgeKeys = new Set<string>();
    for (const s of selected) {
      const stepGraph = s.canvas?.graph;
      if (!stepGraph) continue;
      for (const n of stepGraph.nodes ?? []) {
        if (n?.id && !nodeIds.has(n.id)) {
          nodeIds.add(n.id);
          nodes.push(n);
        }
      }
      for (const e of stepGraph.edges ?? []) {
        if (!e?.from || !e?.to) continue;
        const key = e.id || `${e.from}|${e.to}|${e.label || e.type || ''}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edges.push(e);
        }
      }
    }
    return nodes.length > 0 || edges.length > 0 ? { nodes, edges } : null;
  }, [trail, selectedStepIds, viewMode]);

  const sourceSteps = useMemo(() => {
    if (result?.action_type !== 'synthesize' || !Array.isArray(result?.parameters?.source_steps)) return [];
    return result.parameters.source_steps
      .filter((s: any) => s && typeof s.intent_text === 'string')
      .map((s: any) => ({
        intent_text: s.intent_text,
        action_type: s.action_type,
      }));
  }, [result?.action_type, result?.parameters?.source_steps]);

  const narrative = useMemo(() => {
    if (viewMode === 'session') {
      const mergedEnvelope = {
        synthesis: { narrative: mergedNarrative || '' },
        canvas: {
          tables: mergedTables ?? undefined,
          diagrams: mergedDiagrams ?? undefined,
          graph: mergedGraph ?? undefined,
        },
      };
      return buildEnvelopeMarkdown(mergedEnvelope);
    }
    return buildEnvelopeMarkdown(result ?? null);
  }, [viewMode, mergedNarrative, mergedTables, mergedDiagrams, mergedGraph, result]);

  return (
    <div className="min-h-0 flex-1 flex flex-row overflow-hidden" style={{ flex: bottomFlex }}>
      {/* Narrative */}
      <div
        className="min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col"
        style={showCanvas ? { width: `${narrativeWidth}%` } : { flex: 1 }}
      >
        <EnvelopeControls
          title="Narrative"
          showIndex={showNarrativeIndex}
          onShowIndexChange={setShowNarrativeIndex}
          plain={showNarrativePlain}
          onPlainChange={(v) => setShowNarrativePlain?.(v)}
          onCopyText={() => {
            if (!narrative) return;
            if (onCopy) {
              onCopy({ type: 'narrative', payload: narrative, label: sessionName });
              return;
            }
            navigator.clipboard.writeText(narrative).then(() => toast.success('Narrative copied to clipboard'));
          }}
          onSaveMd={() => {
            if (!narrative) return;
            if (onCopy) {
              onCopy({ type: 'narrative', payload: narrative, label: sessionName });
              return;
            }
            downloadMarkdown(narrative, sessionName);
          }}
          extraHeaderItems={
            resultQueryDepth ? (
              <span className="text-[10px] text-white/50 px-2 py-0.5 rounded border border-white/10 bg-black/20">
                {resultQueryDepth.replace('_', ' ')}
              </span>
            ) : undefined
          }
        />
        <div className="flex-1 min-h-0 overflow-hidden p-2 relative">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {error && !loading && (
            <Alert variant="destructive" className="bg-red-900/20 border-red-500/30">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
          {!loading && !error && (
            <div className="h-full flex flex-col overflow-hidden">
              {sourceSteps.length > 0 && (
                <div className="mb-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
                  <div className="text-[10px] text-white/50 mb-1">
                    Source steps ({sourceSteps.length})
                  </div>
                  <div className="flex flex-col gap-0.5 max-h-[3.5rem] overflow-y-auto pr-1">
                    {sourceSteps.map((s, idx) => (
                      <div key={idx} className="flex items-center gap-1.5 text-[10px] text-white/70">
                        <span className="px-1 rounded border border-white/10 bg-white/5 text-white/60 uppercase tracking-wide">
                          {s.action_type || 'discover'}
                        </span>
                        <span className="truncate">{s.intent_text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {resultView === 'narrative' && (
                <NarrativeViewer
                  content={narrative}
                  title="Sections"
                  viewMode={showNarrativePlain ? 'plain' : 'markdown'}
                  showIndex={showNarrativeIndex}
                  onCopySection={onCopy ? (event) => onCopy(event) : undefined}
                  onCopyWholeDocument={onCopy ? (events) => events.forEach((event) => onCopy(event)) : undefined}
                  keyPrefix={keyPrefix}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {showCanvas && (
        <div
          className="w-3 shrink-0 cursor-col-resize flex items-center justify-center group"
          onMouseDown={onResizeNarrativeStart}
          onDoubleClick={onResizeNarrativeReset}
          title="Drag to resize Narrative and Diagrams panels; double-click to reset"
        >
          <div className="h-14 w-0.5 rounded-full bg-white/20 group-hover:bg-emerald-500/50 transition-colors" />
        </div>
      )}

      {showCanvas && (
        <div className="flex-1 min-w-0 rounded-md overflow-hidden bg-[oklch(0.23_0_0)] border border-white/[0.08] flex flex-col">
        <div className="px-3 py-2 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Diagrams</span>
            <div className="flex items-center gap-1 overflow-x-auto" role="group" aria-label="Diagram view">
              {(['graph', 'components'] as CanvasView[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setCanvasView(v)}
                  className={`text-[10px] px-2 py-0.5 rounded border transition-colors whitespace-nowrap ${
                    canvasView === v
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-black/20 border-white/10 text-white/50 hover:bg-white/5'
                  }`}
                >
                  {v === 'graph' ? 'Graph' : 'Components'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
              <Switch
                checked={showGraphControls}
                onCheckedChange={(checked) => setShowGraphControls(Boolean(checked))}
              />
              Controls
            </label>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden p-2 relative">
          {showGraphControls && graphNodes.length > 0 && (
            <div className="absolute top-3 right-3 z-10 flex flex-col gap-2 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/75 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[220px]">
              <div className="flex items-center gap-2">
                <select
                  value={graphLayout}
                  onChange={(e) => setGraphLayout(e.target.value as GraphLayout)}
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
                  checked={graphLayoutAnimate}
                  onCheckedChange={(checked) => setGraphLayoutAnimate(Boolean(checked))}
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
              <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
                <Switch
                  checked={showInfoPanel}
                  onCheckedChange={(checked) => setShowInfoPanel(Boolean(checked))}
                  size="sm"
                />
                Inspector
              </label>
              {nodeTypes.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-white/50">Types:</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => nodeTypes.forEach((t) => { if (!nodeFilters.has(t)) toggleNodeFilter(t); })}
                        className="text-[9px] text-emerald-300/80 hover:text-emerald-300"
                      >
                        all
                      </button>
                      <span className="text-white/20">|</span>
                      <button
                        type="button"
                        onClick={() => nodeTypes.forEach((t) => { if (nodeFilters.has(t)) toggleNodeFilter(t); })}
                        className="text-[9px] text-white/50 hover:text-white/70"
                      >
                        none
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {nodeTypes.map((type) => {
                      const active = nodeFilters.has(type);
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
                          title={active ? 'Hide this node type' : 'Show this node type'}
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
                        onClick={() => edgeTypes.forEach((t) => { if (!edgeFilters.has(t)) toggleEdgeFilter(t); })}
                        className="text-[9px] text-emerald-300/80 hover:text-emerald-300"
                      >
                        all
                      </button>
                      <span className="text-white/20">|</span>
                      <button
                        type="button"
                        onClick={() => edgeTypes.forEach((t) => { if (edgeFilters.has(t)) toggleEdgeFilter(t); })}
                        className="text-[9px] text-white/50 hover:text-white/70"
                      >
                        none
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {edgeTypes.map((type) => {
                      const active = edgeFilters.has(type);
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
                          title={active ? 'Hide this edge type' : 'Show this edge type'}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="h-px bg-white/10" />
              <button
                type="button"
                onClick={() => {
                  const cy = cyRef.current;
                  if (!cy || cy.destroyed()) return;
                  const date = new Date().toISOString().split('T')[0];
                  const sanitized = sanitizeFilenameBase(sessionName);
                  const filename = `${sanitized}-${canvasView}-${date}.png`;
                  const dataUrl = (cy as any).png({ full: true, bg: 'transparent', scale: 4 });
                  downloadBlob(dataUrlToBlob(dataUrl), filename, 'image/png');
                  toast.success(`Diagram saved as ${filename}`);
                }}
                className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
              >
                <Download className="h-3 w-3" />
                Save PNG
              </button>
              <button
                type="button"
                onClick={async () => {
                  const cy = cyRef.current;
                  if (!cy || cy.destroyed()) return;
                  const date = new Date().toISOString().split('T')[0];
                  const sanitized = sanitizeFilenameBase(sessionName);
                  const filename = `${sanitized}-${canvasView}-${date}.svg`;
                  const cytoscapeSvg = await import('cytoscape-svg');
                  const registerSvg = (cytoscapeSvg as any).default ?? cytoscapeSvg;
                  registerSvg(cytoscape);
                  const svg = (cy as any).svg({ full: true });
                  downloadBlob(svg, filename, 'image/svg+xml');
                  toast.success(`Diagram saved as ${filename}`);
                }}
                className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
              >
                <Download className="h-3 w-3" />
                Save SVG
              </button>
              <button
                type="button"
                onClick={() => {
                  const date = new Date().toISOString().split('T')[0];
                  const sanitized = sanitizeFilenameBase(sessionName);
                  const filename = `${sanitized}-${canvasView}-${date}.json`;
                  const payload = {
                    meta: {
                      exportedAt: new Date().toISOString(),
                      sessionName,
                      view: canvasView,
                    },
                    nodes: graphNodes,
                    edges: graphEdges,
                  };
                  downloadBlob(JSON.stringify(payload, null, 2), filename, 'application/json');
                  toast.success(`Diagram data saved as ${filename}`);
                }}
                className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
              >
                <Download className="h-3 w-3" />
                Save JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  const date = new Date().toISOString().split('T')[0];
                  const sanitized = sanitizeFilenameBase(sessionName);
                  const filename = `${sanitized}-${canvasView}-${date}.mmd`;
                  const mermaid = generateMermaid(graphNodes, graphEdges, canvasView);
                  downloadBlob(mermaid, filename, 'text/plain');
                  toast.success(`Mermaid diagram saved as ${filename}`);
                }}
                className="flex items-center gap-1.5 text-[10px] text-white/70 hover:text-emerald-300 transition-colors"
              >
                <Download className="h-3 w-3" />
                Save Mermaid
              </button>
            </div>
          )}
          {showInfoPanel && (
            <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 rounded-md border border-white/10 bg-[oklch(0.18_0_0)]/90 backdrop-blur-sm px-3 py-2 shadow-lg max-w-[260px] min-w-[180px]">
              <div className="text-[10px] font-medium text-white/80 flex items-center justify-between">
                <span>Inspector</span>
                {!hoveredInfo && <span className="text-white/40">Hover a node or edge</span>}
              </div>
              {hoveredInfo?.kind === 'node' && (
                <div className="flex flex-col gap-0.5 text-[10px] text-white/70">
                  <div className="font-mono truncate" title={hoveredInfo.data.id}>id: {hoveredInfo.data.id}</div>
                  <div className="whitespace-normal break-words">label: {hoveredInfo.data.fullLabel || hoveredInfo.data.name || hoveredInfo.data.label}</div>
                  {hoveredInfo.data.detail && <div className="whitespace-normal break-words text-white/50">{hoveredInfo.data.detail}</div>}
                  {hoveredInfo.data.properties && Object.keys(hoveredInfo.data.properties).length > 0 && (
                    <div className="flex flex-col gap-0.5 text-white/50">
                      {Object.entries(hoveredInfo.data.properties).map(([k, v]) => (
                        <div key={k} className="whitespace-normal break-words">
                          <span className="text-white/40">{k}:</span>{' '}
                          {Array.isArray(v) ? v.join(', ') : String(v)}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="truncate">type: {hoveredInfo.data.type}</div>
                  {hoveredInfo.data.source && <div className="truncate">source: {hoveredInfo.data.source}</div>}
                  {hoveredInfo.data.mental_model_applied && <div className="text-emerald-300/80">mental model applied</div>}
                </div>
              )}
              {hoveredInfo?.kind === 'edge' && (
                <div className="flex flex-col gap-0.5 text-[10px] text-white/70">
                  <div className="font-mono truncate" title={hoveredInfo.data.id}>id: {hoveredInfo.data.id}</div>
                  <div className="truncate">from: {hoveredInfo.data.from}</div>
                  <div className="truncate">to: {hoveredInfo.data.to}</div>
                  <div className="whitespace-normal break-words">label: {hoveredInfo.data.label}</div>
                  <div className="truncate">type: {hoveredInfo.data.type}</div>
                  {hoveredInfo.data.source && <div className="truncate">source: {hoveredInfo.data.source}</div>}
                  {hoveredInfo.data.detail && <div className="whitespace-normal break-words text-white/50">{hoveredInfo.data.detail}</div>}
                  {hoveredInfo.data.properties && Object.keys(hoveredInfo.data.properties).length > 0 && (
                    <div className="flex flex-col gap-0.5 text-white/50">
                      {Object.entries(hoveredInfo.data.properties).map(([k, v]) => (
                        <div key={k} className="whitespace-normal break-words">
                          <span className="text-white/40">{k}:</span>{' '}
                          {Array.isArray(v) ? v.join(', ') : String(v)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {canvasView === 'graph' && (
            graphNodes.length > 0 ? (
              <InteractiveGraph
                graph={{ nodes: graphNodes, edges: graphEdges }}
                layoutName={graphLayout}
                layoutAnimate={graphLayoutAnimate}
                onAddToQuery={onGraphAddToQuery}
                edgeFilters={edgeFilters}
                nodeFilters={nodeFilters}
                showEdgeLabels={showEdgeLabels}
                onCyReady={(cy) => { cyRef.current = cy; }}
                onHover={setHoveredInfo}
              />
            ) : (
              <p className="text-sm text-white/40 h-full flex items-center justify-center">No graph data.</p>
            )
          )}
          {canvasView === 'components' && (
            graphNodes.length > 0 ? (
              <ComponentDiagram
                nodes={graphNodes}
                edges={graphEdges}
                selectedIds={[]}
                layoutName={graphLayout}
                layoutAnimate={graphLayoutAnimate}
                onAddToQuery={onGraphAddToQuery}
                edgeFilters={edgeFilters}
                nodeFilters={nodeFilters}
                showEdgeLabels={showEdgeLabels}
                onCyReady={(cy) => { cyRef.current = cy; }}
                onHover={setHoveredInfo}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-white/40">No component data.</div>
            )
          )}
        </div>
      </div>
      )}
    </div>
  );
}
