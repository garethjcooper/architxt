'use client';

import { forwardRef, useImperativeHandle, memo } from 'react';
import type { Node, Edge, NodeChange } from '@xyflow/react';
import { useEdgeRouting, type UseEdgeRoutingOptions } from 'reactflow-edge-routing';

export interface EdgeRoutingControllerRef {
  updateRoutingOnNodesChange: (changes: NodeChange<Node>[]) => void;
  resetRouting: () => void;
}

interface EdgeRoutingControllerProps {
  nodes: Node[];
  edges: Edge[];
  options: UseEdgeRoutingOptions;
}

const EdgeRoutingControllerInner = forwardRef<EdgeRoutingControllerRef, EdgeRoutingControllerProps>(
  function EdgeRoutingControllerInner({ nodes, edges, options }, ref) {
    const { updateRoutingOnNodesChange, resetRouting } = useEdgeRouting(nodes, edges, options);

    useImperativeHandle(ref, () => ({
      updateRoutingOnNodesChange,
      resetRouting,
    }), [updateRoutingOnNodesChange, resetRouting]);

    return null;
  }
);

export const EdgeRoutingController = memo(EdgeRoutingControllerInner);
