'use client';

import {
  ResearchResultPanel,
  type ResearchCopyEvent,
} from '@/app/research/research-result-panel';
import { useResearchResultPanel } from '@/app/research/use-research-result-panel';
import type {
  DiscoverStepResponse,
  ResearchStepSummary,
} from '@/lib/api/client';

interface WorkspaceResultPanelProps {
  result: DiscoverStepResponse | ResearchStepSummary | null;
  loading: boolean;
  error: string | null;
  sessionName?: string;
  onCopy?: (event: ResearchCopyEvent) => void;
}

export function WorkspaceResultPanel({
  result,
  loading,
  error,
  sessionName,
  onCopy,
}: WorkspaceResultPanelProps) {
  // Structured-output Reflect steps can carry their payload in canvas.graph while
  // leaving synthesis.narrative empty. Show the diagrams/canvas pane in that
  // case so the workspace viewer consumes the full standard envelope, not just
  // narrative.
  const hasGraph = !!(result?.canvas?.graph?.nodes?.length);

  const panelState = useResearchResultPanel({
    nodes: result?.canvas?.graph?.nodes,
    edges: result?.canvas?.graph?.edges,
  });

  return (
    <ResearchResultPanel
      loading={loading}
      error={error}
      result={result}
      viewMode="step"
      resultView="narrative"
      sessionName={sessionName || 'reflect'}
      onCopy={onCopy}
      showCanvas={hasGraph}
      {...panelState}
    />
  );
}
