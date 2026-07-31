'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import {
  researchApi,
  type ResearchSession,
  type ResearchStepSummary,
  type GraphNode,
  type GraphEdge,
} from '@/lib/api/client';
import { InteractiveGraph, type GraphLayout } from '@/components/research-canvas';
import { useResearchGraph } from '@/app/research/use-research-graph';

const logger = createLogger('ExploreResearchImportDialog');

// Stable empty array to avoid useResearchGraph re-computation when global entities
// are not loaded in the import preview context.
const EMPTY_GLOBAL_ENTITIES: GraphNode[] = [];

export interface ResearchImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankId: string;
  globalGraph?: { nodes: GraphNode[]; edges: GraphEdge[] } | null;
  onImport: (graph: { nodes: GraphNode[]; edges: GraphEdge[] }) => void;
}

export function ResearchImportDialog({
  open,
  onOpenChange,
  bankId,
  globalGraph = null,
  onImport,
}: ResearchImportDialogProps) {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [trail, setTrail] = useState<ResearchStepSummary[]>([]);
  const [trailLoading, setTrailLoading] = useState(false);
  const [selectedStepIds, setSelectedStepIds] = useState<Set<number>>(new Set());
  const [activeStepId, setActiveStepId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'step' | 'session'>('step');
  const [previewLayout, setPreviewLayout] = useState<GraphLayout>('cose');
  const [previewKey, setPreviewKey] = useState(0);
  const [importing, setImporting] = useState(false);

  const didAutoSelectRef = useRef(false);

  const loadSessions = useCallback(async () => {
    if (!bankId) return;
    setSessionsLoading(true);
    didAutoSelectRef.current = false;
    try {
      const data = await researchApi.listSessions(bankId);
      const list = Array.isArray(data) ? data : [];
      setSessions(list);
      if (list.length > 0) {
        setSelectedSessionId((prev) => {
          if (prev == null) {
            didAutoSelectRef.current = true;
            return list[0].id;
          }
          return prev;
        });
      } else {
        setSelectedSessionId(null);
      }
    } catch (err) {
      logger.error('Failed to load research sessions', err);
      toast.error('Failed to load research sessions');
      setSessions([]);
      setSelectedSessionId(null);
    } finally {
      setSessionsLoading(false);
    }
  }, [bankId]);

  useEffect(() => {
    if (!open) {
      didAutoSelectRef.current = false;
      return;
    }
    setSelectedSessionId(null);
    setTrail([]);
    setSelectedStepIds(new Set());
    setActiveStepId(null);
    setViewMode('step');
    loadSessions();
  }, [open, loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setTrail([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setTrailLoading(true);
      try {
        const steps = await researchApi.getSessionSteps(selectedSessionId);
        if (cancelled) return;
        const list = Array.isArray(steps) ? steps : [];
        setTrail(list);
        if (viewMode === 'session') {
          setSelectedStepIds(new Set(list.map((s) => s.id)));
          setActiveStepId(null);
        } else if (list.length > 0) {
          setActiveStepId(list[list.length - 1].id);
          setSelectedStepIds(new Set());
        } else {
          setActiveStepId(null);
          setSelectedStepIds(new Set());
        }
      } catch (err) {
        logger.error('Failed to load research trail', err);
        toast.error('Failed to load research trail');
        setTrail([]);
      } finally {
        if (!cancelled) setTrailLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionId, viewMode]);

  const toggleStep = useCallback((stepId: number) => {
    setSelectedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }, []);

  const isMerge = viewMode === 'session';

  const selectedStepIdsForGraph = useMemo(() => {
    if (isMerge) return selectedStepIds;
    return activeStepId != null ? new Set([activeStepId]) : new Set<number>();
  }, [isMerge, selectedStepIds, activeStepId]);

  const activeStepForGraph = useMemo(() => {
    if (isMerge) return null;
    return activeStepId;
  }, [isMerge, activeStepId]);

  const {
    graphNodes,
    graphEdges,
  } = useResearchGraph(
    trail,
    selectedStepIdsForGraph,
    globalGraph,
    EMPTY_GLOBAL_ENTITIES, // globalEntities: not loaded in import preview context
    null, // result
    isMerge ? 'session' : 'step',
    activeStepForGraph,
  );

  const mergedGraph = useMemo(() => {
    return {
      nodes: graphNodes,
      edges: graphEdges,
    };
  }, [graphNodes, graphEdges]);

  useEffect(() => {
    setPreviewKey((k) => k + 1);
  }, [mergedGraph, previewLayout]);

  const hasGraph = mergedGraph.nodes.length > 0 || mergedGraph.edges.length > 0;

  const handleImport = useCallback(async () => {
    if (!hasGraph) {
      toast.info('No graph to import');
      return;
    }
    setImporting(true);
    try {
      onImport({
        nodes: mergedGraph.nodes.map((n) => ({ ...n })),
        edges: mergedGraph.edges.map((e) => ({ ...e })),
      });
      toast.success(`Imported ${mergedGraph.nodes.length} nodes and ${mergedGraph.edges.length} edges`);
      onOpenChange(false);
    } catch (err) {
      logger.error('Failed to import research graph', err);
      toast.error('Import failed');
    } finally {
      setImporting(false);
    }
  }, [hasGraph, mergedGraph, onImport, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] sm:max-w-5xl h-[85vh] min-h-[560px] p-0 overflow-hidden">
        <div className="flex flex-col h-full min-h-0">
          <DialogHeader className="px-4 py-3 border-b border-white/10 shrink-0">
            <DialogTitle>Import from Research</DialogTitle>
            <DialogDescription>
              Select a session and one or more trail steps to add to the Explore canvas.
            </DialogDescription>
          </DialogHeader>

          <div className="px-4 py-2 border-b border-white/10 flex items-center gap-3 shrink-0">
            <label className="text-xs text-white/70">Session</label>
            {sessionsLoading ? (
              <Skeleton className="h-8 w-56 bg-white/10" />
            ) : sessions.length === 0 ? (
              <span className="text-xs text-white/40">No research sessions for this bank.</span>
            ) : (
              <select
                value={selectedSessionId ?? ''}
                onChange={(e) => setSelectedSessionId(Number(e.target.value))}
                className="h-8 w-56 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2 text-xs text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
              >
                <option value="" disabled>Select a session…</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[oklch(0.23_0_0)] text-white">
                    {s.title || `Session ${s.id}`}
                  </option>
                ))}
              </select>
            )}

            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[10px] text-white/70 cursor-pointer select-none">
                <Switch
                  checked={isMerge}
                  onCheckedChange={(checked) => setViewMode(checked ? 'session' : 'step')}
                />
                Merge
              </label>
              <span className="text-[10px] px-2 py-0.5 rounded border border-white/10 bg-black/20 text-emerald-300 font-mono h-5 inline-flex items-center">
                {trail.length} ({isMerge ? selectedStepIds.size : activeStepId ? 1 : 0})
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="w-72 flex flex-col border-r border-white/10 bg-[oklch(0.22_0_0)]">
              <div className="px-3 py-2 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
                <span className="text-xs font-medium">Trail</span>
                {isMerge && trail.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStepIds(
                        selectedStepIds.size === trail.length
                          ? new Set()
                          : new Set(trail.map((s) => s.id))
                      )
                    }
                    className="text-[10px] text-white/50 hover:text-emerald-300"
                  >
                    {selectedStepIds.size === trail.length ? 'none' : 'all'}
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
                {trailLoading ? (
                  <div className="space-y-2 p-2">
                    <Skeleton className="h-10 w-full bg-white/10" />
                    <Skeleton className="h-10 w-full bg-white/10" />
                  </div>
                ) : trail.length === 0 ? (
                  <div className="p-3 text-xs text-white/40">No steps in this session.</div>
                ) : (
                  trail.map((step, idx) => {
                    const isActive = activeStepId === step.id;
                    const isSelected = selectedStepIds.has(step.id);
                    const isSynthesize = step.action_type === 'synthesize';
                    const hasCanvas = Boolean(step.canvas?.graph?.nodes?.length || step.canvas?.graph?.edges?.length);
                    return (
                      <div
                        key={step.id}
                        className={cn(
                          'w-full flex items-center gap-2 rounded border px-2 py-1.5 min-h-[2.5rem] transition-colors',
                          isActive
                            ? 'bg-emerald-900/30 border-emerald-500/30 text-emerald-200'
                            : isSynthesize
                              ? 'bg-violet-900/20 border-violet-500/20 text-violet-100'
                              : 'bg-black/20 border-white/5 text-white/90 hover:bg-white/5'
                        )}
                      >
                        {isMerge && (
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleStep(step.id)}
                            aria-label={`Include step ${idx + 1} in import`}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (isMerge) {
                              toggleStep(step.id);
                            } else {
                              setActiveStepId(step.id);
                              setSelectedStepIds(new Set());
                            }
                          }}
                          className="flex-1 text-left min-w-0 flex flex-col gap-0.5"
                          title={step.intent_text || 'Untitled query'}
                        >
                          <div className="flex items-center justify-between text-xs text-white/90">
                            <span className="truncate">
                              #{idx + 1} · {step.action_type || 'discover'}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1.5 h-4 border-white/30 text-white/90"
                            >
                              {hasCanvas ? 'graph' : 'narrative'}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-white/50 truncate">
                            {step.intent_text || 'Untitled query'}
                          </div>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col bg-[oklch(0.23_0_0)]">
              <div className="px-3 py-2 border-b border-white/10 bg-emerald-900/20 text-emerald-300 flex items-center justify-between shrink-0">
                <span className="text-xs font-medium">Preview</span>
                <div className="flex items-center gap-2">
                  <select
                    value={previewLayout}
                    onChange={(e) => setPreviewLayout(e.target.value as GraphLayout)}
                    className="h-7 rounded-md border border-white/10 bg-[oklch(0.23_0_0)] px-2 text-[10px] text-white/80 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none"
                    aria-label="Preview layout"
                  >
                    <option value="avsdf">AVSDF</option>
                    <option value="fcose">Force (fCoSE)</option>
                    <option value="cose">Force (CoSE)</option>
                    <option value="dagre">Dagre</option>
                    <option value="circle">Circle</option>
                    <option value="concentric">Concentric</option>
                  </select>
                  <span className="text-[10px] text-white/50">
                    {mergedGraph.nodes.length} nodes · {mergedGraph.edges.length} edges
                  </span>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-2 relative">
                {hasGraph ? (
                  <InteractiveGraph
                    key={previewKey}
                    graph={mergedGraph}
                    layoutName={previewLayout}
                    layoutAnimate={false}
                    showEdgeLabels
                    filterMode="hidden"
                    preserveLayoutOnUpdate={false}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-white/40">
                    {trailLoading
                      ? 'Loading preview…'
                      : 'Select a session and steps with graph data to preview.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/10 shrink-0 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-white/70 hover:text-white hover:bg-white/5"
          >
            Close
          </Button>
          <Button
            onClick={handleImport}
            disabled={!hasGraph || importing}
            className="bg-emerald-600 text-white hover:bg-emerald-500"
          >
            {importing ? 'Importing…' : 'Add to canvas'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
