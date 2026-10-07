'use client';

import { Settings2, Sparkles, RotateCcw } from 'lucide-react';
import {
  DEFAULT_LAYOUT_OPTIONS,
  DEFAULT_ROUTING_TUNABLES,
  DEFAULT_NODE_TUNABLES,
  DEFAULT_BACKGROUND_VARIANT,
  type LayoutOptions,
  type RoutingTunables,
  type NodeTunables,
  type ElkAlgorithm,
  type ElkDirection,
  type ElkEdgeRouting,
  type ElkCrossingMinimization,
  type ElkGreedySwitch,
  type BackgroundVariantOption,
  type EntityNodeTextAlignH,
  type EntityNodeTextAlignV,
} from './view-editor-options';

interface ViewControlsProps {
  layoutOptions: LayoutOptions;
  routingTunables: RoutingTunables;
  nodeTunables?: NodeTunables;
  showEdgeLabels?: boolean;
  onShowEdgeLabelsChange?: (show: boolean) => void;
  showNodeIds?: boolean;
  onShowNodeIdsChange?: (show: boolean) => void;
  showHandles?: boolean;
  onShowHandlesChange?: (show: boolean) => void;
  showNodeColorBar?: boolean;
  onShowNodeColorBarChange?: (show: boolean) => void;
  backgroundVariant?: BackgroundVariantOption;
  onBackgroundVariantChange?: (variant: BackgroundVariantOption) => void;
  onTopKChange?: (value: number) => void;
  topK?: number;
  totalNodes?: number;
  onLayoutOptionsChange: (opts: LayoutOptions) => void;
  onRoutingTunablesChange: (opts: RoutingTunables) => void;
  onNodeTunablesChange?: (opts: NodeTunables) => void;
  onReset?: () => void;
  onAutoLayout?: () => void;
  autoLayouting?: boolean;
}

function selectClassName() {
  return 'h-6 w-full rounded-md border border-border-default bg-surface-panel px-1.5 text-[11px] text-foreground-muted focus:border-focus-ring focus:ring-2 focus:ring-focus-ring-subtle outline-none';
}

function rowClassName() {
  return 'flex items-center gap-1.5 text-[10px] text-foreground-subtle';
}

export function ViewControls({
  layoutOptions,
  routingTunables,
  nodeTunables = DEFAULT_NODE_TUNABLES,
  showEdgeLabels = true,
  onShowEdgeLabelsChange,
  showNodeIds = true,
  onShowNodeIdsChange,
  showHandles = false,
  onShowHandlesChange,
  showNodeColorBar = false,
  onShowNodeColorBarChange,
  backgroundVariant = 'dots',
  onBackgroundVariantChange,
  onTopKChange,
  topK,
  totalNodes = 0,
  onLayoutOptionsChange,
  onRoutingTunablesChange,
  onNodeTunablesChange,
  onReset,
  onAutoLayout,
  autoLayouting,
}: ViewControlsProps) {
  const update = <K extends keyof LayoutOptions>(key: K, value: LayoutOptions[K]) => {
    onLayoutOptionsChange({ ...layoutOptions, [key]: value });
  };

  const updateTunable = <K extends keyof RoutingTunables>(key: K, value: RoutingTunables[K]) => {
    onRoutingTunablesChange({ ...routingTunables, [key]: value });
  };

  const updateNodeTunable = <K extends keyof NodeTunables>(key: K, value: NodeTunables[K]) => {
    onNodeTunablesChange?.({ ...nodeTunables, [key]: value });
  };

  const slider = (label: string, key: keyof RoutingTunables, min: number, max: number, step = 1) => (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-foreground-subtle">
        <span>{label}</span>
        <span>{routingTunables[key]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={routingTunables[key] as number}
        onChange={(e) => updateTunable(key, Number(e.target.value) as RoutingTunables[typeof key])}
        className="w-full accent-accent-primary"
      />
    </div>
  );

  const nodeSlider = (label: string, key: keyof NodeTunables, min: number, max: number, step = 1) => (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-[10px] text-foreground-subtle">
        <span>{label}</span>
        <span>{nodeTunables[key]}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={nodeTunables[key] as number}
        onChange={(e) => updateNodeTunable(key, Number(e.target.value) as NodeTunables[typeof key])}
        className="w-full accent-accent-primary"
      />
    </div>
  );

  return (
    <div className="absolute top-full right-3 mt-1 z-30 w-[22rem] rounded-md border border-border-default bg-surface-overlay/95 backdrop-blur-sm px-3 py-3 shadow-lg">
      <div className="flex items-center gap-1.5 mb-2 text-[10px] font-medium text-foreground-subtle uppercase tracking-wide">
        <Settings2 className="h-3.5 w-3.5" />
        Rendering
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <label className={rowClassName()}>
          <span className="w-20 shrink-0">Algorithm</span>
          <select
            className={selectClassName()}
            value={layoutOptions.algorithm}
            onChange={(e) => update('algorithm', e.target.value as ElkAlgorithm)}
          >
            <option value="layered">Layered</option>
            <option value="stress">Stress</option>
            <option value="mrtree">Tree</option>
            <option value="radial">Radial</option>
            <option value="force">Force</option>
          </select>
        </label>

        <label className={rowClassName()}>
          <span className="w-20 shrink-0">Direction</span>
          <select
            className={selectClassName()}
            value={layoutOptions.direction}
            onChange={(e) => update('direction', e.target.value as ElkDirection)}
          >
            <option value="DOWN">Down</option>
            <option value="RIGHT">Right</option>
            <option value="UP">Up</option>
            <option value="LEFT">Left</option>
          </select>
        </label>

        <label className={rowClassName()} title="Parallel edges crossing each other are merged into one">
          <span className="w-20 shrink-0">Routing</span>
          <select
            className={selectClassName()}
            value={layoutOptions.edgeRouting}
            onChange={(e) => update('edgeRouting', e.target.value as ElkEdgeRouting)}
          >
            <option value="POLYLINE">Polyline</option>
            <option value="ORTHOGONAL">Orthogonal</option>
            <option value="SPLINES">Splines</option>
          </select>
        </label>

        <label className={rowClassName()} title="Reduce edge crossings">
          <span className="w-20 shrink-0">Cross min</span>
          <select
            className={selectClassName()}
            value={layoutOptions.crossingMinimization}
            onChange={(e) => update('crossingMinimization', e.target.value as ElkCrossingMinimization)}
          >
            <option value="NONE">None</option>
            <option value="LAYER_SWEEP">Layer sweep</option>
          </select>
        </label>

        <label className={rowClassName()}>
          <span className="w-20 shrink-0">Background</span>
          <select
            className={selectClassName()}
            value={backgroundVariant}
            onChange={(e) => onBackgroundVariantChange?.(e.target.value as BackgroundVariantOption)}
          >
            <option value="off">Off</option>
            <option value="dots">Dots</option>
            <option value="lines">Lines</option>
            <option value="cross">Cross</option>
          </select>
        </label>

        <label className={rowClassName()}>
          <span className="w-20 shrink-0">Greedy</span>
          <select
            className={selectClassName()}
            value={layoutOptions.greedySwitch}
            onChange={(e) => update('greedySwitch', e.target.value as ElkGreedySwitch)}
          >
            <option value="TWO_SIDED">2-sided</option>
            <option value="ONE_SIDED">1-sided</option>
            <option value="OFF">Off</option>
          </select>
        </label>
      </div>

      <div className="h-px bg-border-subtle mb-3" />

      <div className="flex items-center gap-4 text-[10px] text-foreground-subtle mb-3">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showEdgeLabels}
            onChange={(e) => onShowEdgeLabelsChange?.(e.target.checked)}
            className="rounded border-border-default"
          />
          Labels
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showNodeIds}
            onChange={(e) => onShowNodeIdsChange?.(e.target.checked)}
            className="rounded border-border-default"
          />
          IDs
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showHandles}
            onChange={(e) => onShowHandlesChange?.(e.target.checked)}
            className="rounded border-border-default"
          />
          Handles
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showNodeColorBar}
            onChange={(e) => onShowNodeColorBarChange?.(e.target.checked)}
            className="rounded border-border-default"
          />
          Color bar
        </label>
      </div>

      <div className="h-px bg-border-subtle mb-3" />

      {totalNodes > 0 && onTopKChange && (
        <div className="flex flex-col gap-0.5 mb-3">
          <div className="flex justify-between text-[10px] text-foreground-subtle">
            <span title="Show only the N nodes with the most connections">Top nodes</span>
            <span>{topK === undefined || topK >= totalNodes ? `All (${totalNodes})` : `${topK} / ${totalNodes}`}</span>
          </div>
          <input
            type="range"
            min={1}
            max={totalNodes}
            step={1}
            value={topK === undefined || topK > totalNodes ? totalNodes : topK}
            onChange={(e) => onTopKChange(Number(e.target.value))}
            className="w-full accent-accent-primary"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
        {slider('Edge-edge', 'edgeToEdgeSpacing', 4, 40)}
        {slider('Edge-node', 'edgeToNodeSpacing', 4, 32)}
        {slider('Handle', 'handleSpacing', 0, 24)}
        {slider('Stub', 'stubSize', 0, 80)}
        {slider('Node-node', 'elkNodeNodeSpacing', 40, 300)}
        {slider('Layer gap', 'elkNodeNodeBetweenLayers', 40, 400)}
        {slider('Edge-edge (layers)', 'elkEdgeEdgeBetweenLayers', 4, 120)}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
        {nodeSlider('Node min-w', 'entityNodeMinWidth', 80, 320, 10)}
        {nodeSlider('Node min-h', 'entityNodeMinHeight', 40, 320, 10)}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 mb-3">
        <label className={rowClassName()}>
          <span className="w-20 shrink-0">Text H</span>
          <select
            className={selectClassName()}
            value={nodeTunables.entityNodeTextAlignH}
            onChange={(e) => updateNodeTunable('entityNodeTextAlignH', e.target.value as EntityNodeTextAlignH)}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className={rowClassName()}>
          <span className="w-20 shrink-0">Text V</span>
          <select
            className={selectClassName()}
            value={nodeTunables.entityNodeTextAlignV}
            onChange={(e) => updateNodeTunable('entityNodeTextAlignV', e.target.value as EntityNodeTextAlignV)}
          >
            <option value="top">Top</option>
            <option value="center">Center</option>
            <option value="bottom">Bottom</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-4 text-[10px] text-foreground-subtle mb-3">
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={routingTunables.hateCrossings}
            onChange={(e) => updateTunable('hateCrossings', e.target.checked)}
            className="rounded border-border-default"
          />
          Hate crossings
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={routingTunables.routeOnlyWhenBlocked}
            onChange={(e) => updateTunable('routeOnlyWhenBlocked', e.target.checked)}
            className="rounded border-border-default"
          />
          Route when blocked
        </label>
      </div>

      {onReset && (
        <div className="flex justify-end gap-2">
          {onAutoLayout && (
            <button
              type="button"
              onClick={onAutoLayout}
              disabled={autoLayouting}
              className="h-6 px-2 inline-flex items-center justify-center gap-1 rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default disabled:opacity-30 transition-colors text-[11px]"
              title="Auto-layout (ELK)"
            >
              <Sparkles className="h-3.5 w-3.5" /> Auto-layout
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="h-6 px-2 inline-flex items-center justify-center gap-1 rounded bg-surface-panel border border-border-default text-foreground-faint hover:bg-surface-panel hover:text-foreground-default transition-colors text-[11px]"
            title="Reset controls to defaults"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      )}
    </div>
  );
}
