export type ElkAlgorithm = 'layered' | 'stress' | 'mrtree' | 'radial' | 'force';
export type ElkDirection = 'DOWN' | 'UP' | 'LEFT' | 'RIGHT';
export type ElkEdgeRouting = 'ORTHOGONAL' | 'POLYLINE' | 'SPLINES';
export type ElkCrossingMinimization = 'LAYER_SWEEP' | 'MEDIAN_LAYER_SWEEP' | 'INTERACTIVE' | 'NONE';
export type ElkGreedySwitch = 'TWO_SIDED' | 'ONE_SIDED' | 'OFF';
export type EdgeMergeMode = 'full' | 'byType' | 'all';
export type BackgroundVariantOption = 'off' | 'dots' | 'lines' | 'cross';
export type EntityNodeTextAlignH = 'left' | 'center' | 'right';
export type EntityNodeTextAlignV = 'top' | 'center' | 'bottom';

export const DEFAULT_BACKGROUND_VARIANT: BackgroundVariantOption = 'dots';

export interface LayoutOptions {
  algorithm: ElkAlgorithm;
  direction: ElkDirection;
  edgeRouting: ElkEdgeRouting;
  crossingMinimization: ElkCrossingMinimization;
  greedySwitch: ElkGreedySwitch;
  edgeMergeMode: EdgeMergeMode;
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  algorithm: 'layered',
  direction: 'RIGHT',
  edgeRouting: 'ORTHOGONAL',
  crossingMinimization: 'NONE',
  greedySwitch: 'OFF',
  edgeMergeMode: 'full',
};

export interface RoutingTunables {
  edgeToEdgeSpacing: number;
  edgeToNodeSpacing: number;
  handleSpacing: number;
  stubSize: number;
  hateCrossings: boolean;
  routeOnlyWhenBlocked: boolean;
  elkNodeNodeSpacing: number;
  elkNodeNodeBetweenLayers: number;
  elkEdgeEdgeBetweenLayers: number;
  elkEdgeNodeBetweenLayers: number;
}

export const DEFAULT_ROUTING_TUNABLES: RoutingTunables = {
  edgeToEdgeSpacing: 16,
  edgeToNodeSpacing: 14,
  handleSpacing: 9,
  stubSize: 25,
  hateCrossings: false,
  routeOnlyWhenBlocked: false,
  elkNodeNodeSpacing: 100,
  elkNodeNodeBetweenLayers: 100,
  elkEdgeEdgeBetweenLayers: 48,
  elkEdgeNodeBetweenLayers: 48,
};

export interface NodeTunables {
  entityNodeMinWidth: number;
  entityNodeMinHeight: number;
  entityNodeTextAlignH: EntityNodeTextAlignH;
  entityNodeTextAlignV: EntityNodeTextAlignV;
}

export const DEFAULT_NODE_TUNABLES: NodeTunables = {
  entityNodeMinWidth: 180,
  entityNodeMinHeight: 100,
  entityNodeTextAlignH: 'left',
  entityNodeTextAlignV: 'center',
};
