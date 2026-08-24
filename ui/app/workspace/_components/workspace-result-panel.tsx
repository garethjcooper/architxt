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
  /** Optional key namespace passed through to ResearchResultPanel/NarrativeViewer. */
  keyPrefix?: string;
  narrativeWidth?: number;
  onResizeNarrativeStart?: (e: React.MouseEvent) => void;
  onResizeNarrativeReset?: () => void;
}

export function WorkspaceResultPanel({
  result,
  loading,
  error,
  sessionName,
  onCopy,
  keyPrefix,
  narrativeWidth,
  onResizeNarrativeStart,
  onResizeNarrativeReset,
}: WorkspaceResultPanelProps) {
  // Graph data is now rendered as markdown tables inside the narrative, so the
  // dedicated canvas panel stays hidden by default. It can still be opted-in by
  // passing showCanvas={true} if needed.
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
      showCanvas={false}
      keyPrefix={keyPrefix}
      narrativeWidth={narrativeWidth}
      onResizeNarrativeStart={onResizeNarrativeStart}
      onResizeNarrativeReset={onResizeNarrativeReset}
      {...panelState}
    />
  );
}
