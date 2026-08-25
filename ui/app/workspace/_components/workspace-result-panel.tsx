'use client';

import { EnvelopeViewer } from '@/components/envelope-viewer';
import type { DiscoverStepResponse, ResearchStepSummary } from '@/lib/api/client';

interface WorkspaceResultPanelProps {
  result: DiscoverStepResponse | ResearchStepSummary | null;
  loading?: boolean;
  error?: string | null;
  sessionName?: string;
  keyPrefix?: string;
}

export function WorkspaceResultPanel({
  result,
  loading,
  error,
  sessionName,
  keyPrefix,
}: WorkspaceResultPanelProps) {
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-red-300/90 whitespace-pre-wrap p-4">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-white/50">
        Loading...
      </div>
    );
  }

  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-white/40">
        Select a step or model to view its content.
      </div>
    );
  }

  return (
    <EnvelopeViewer
      envelope={result}
      title={sessionName || 'Workspace'}
      keyPrefix={keyPrefix}
      className="h-full"
    />
  );
}
