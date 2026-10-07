'use client';

import { memo, useMemo } from 'react';
import { BaseEdge, type EdgeProps, type Edge } from '@xyflow/react';
import { useRoutedEdgePath } from 'reactflow-edge-routing';

export type AvoidedEdgeData = {
  routing?: 'ORTHOGONAL' | 'POLYLINE' | 'SPLINES';
  bundledCount?: number;
  bidirectional?: boolean;
  parallelIndex?: number;
  parallelTotal?: number;
  parallelDirection?: 'horizontal' | 'vertical';
  status?: 'added' | 'updated' | 'removed' | null;
};

function buildFallbackPath(sourceX: number, sourceY: number, targetX: number, targetY: number, connectorType: string): string {
  if (connectorType === 'bezier') {
    const cX = (sourceX + targetX) / 2;
    return `M ${sourceX},${sourceY} C ${cX},${sourceY} ${cX},${targetY} ${targetX},${targetY}`;
  }
  if (connectorType === 'polyline') {
    return `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  }
  // orthogonal: L-shaped with a midpoint
  const midX = (sourceX + targetX) / 2;
  return `M ${sourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`;
}

function AvoidedEdgeInner(props: EdgeProps<Edge<AvoidedEdgeData>>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    style,
    markerEnd,
    markerStart,
    label,
    labelStyle,
    data,
  } = props;

  const connectorType =
    data?.routing === 'SPLINES'
      ? 'bezier'
      : data?.routing === 'POLYLINE'
      ? 'polyline'
      : 'orthogonal';

  const parallelIndex = data?.parallelIndex ?? 0;
  const parallelTotal = data?.parallelTotal ?? 1;
  const parallelDirection = data?.parallelDirection ?? 'horizontal';
  const spacing = 10;
  let offsetSourceX = sourceX;
  let offsetSourceY = sourceY;
  let offsetTargetX = targetX;
  let offsetTargetY = targetY;
  if (parallelTotal > 1) {
    const offset = (parallelIndex - (parallelTotal - 1) / 2) * spacing;
    if (parallelDirection === 'horizontal') {
      offsetSourceY += offset;
      offsetTargetY += offset;
    } else {
      offsetSourceX += offset;
      offsetTargetX += offset;
    }
  }

  const [routedPath, routedLabelX, routedLabelY] = useRoutedEdgePath({
    id,
    sourceX: offsetSourceX,
    sourceY: offsetSourceY,
    targetX: offsetTargetX,
    targetY: offsetTargetY,
    connectorType,
  });

  const { path, labelX, labelY } = useMemo(() => {
    if (!routedPath) {
      return { path: buildFallbackPath(sourceX, sourceY, targetX, targetY, connectorType), labelX: (sourceX + targetX) / 2, labelY: (sourceY + targetY) / 2 };
    }
    return { path: routedPath, labelX: routedLabelX, labelY: routedLabelY };
  }, [routedPath, routedLabelX, routedLabelY, sourceX, sourceY, targetX, targetY, connectorType]);

  return (
    <BaseEdge
      id={id}
      path={path}
      labelX={labelX}
      labelY={labelY}
      style={style}
      markerEnd={markerEnd}
      markerStart={markerStart}
      label={label}
      labelStyle={labelStyle}
    />
  );
}

export const AvoidedEdge = memo(AvoidedEdgeInner);
AvoidedEdge.displayName = 'AvoidedEdge';
