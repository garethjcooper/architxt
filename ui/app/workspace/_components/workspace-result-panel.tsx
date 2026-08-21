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
      {...panelState}
    />
  );
}
