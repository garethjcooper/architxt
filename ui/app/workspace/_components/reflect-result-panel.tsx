'use client';

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { NarrativeViewer } from '@/components/narrative-viewer';
import { PanelHeader, Panel, PanelContent } from './panel-layout';
import { extractReflectNarrative } from './model-content-utils';

interface ReflectResultPanelProps {
  loading: boolean;
  error: string | null;
  result: unknown | null;
}

export function ReflectResultPanel({ loading, error, result }: ReflectResultPanelProps) {
  const hasResult = result != null || error != null;
  return (
    <Panel style={{ width: 320, minWidth: 240, maxWidth: 440 }}>
      <PanelHeader title={hasResult ? 'Reflect result' : 'Workspace pages'} />
      <PanelContent className="p-0">
        <div className="absolute inset-0 flex flex-col">
          {loading && (
            <div className="flex-1 flex items-center justify-center text-white/40 text-xs">Reflecting…</div>
          )}
          {error && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-white/40 text-xs px-4 text-center gap-2">
              <span className="text-red-400">Reflect failed</span>
              <span>{error}</span>
            </div>
          )}
          {result != null && !loading && (
            <NarrativeViewer
              content={extractReflectNarrative(result)}
              title="Response"
              viewMode="markdown"
              showIndex={false}
              className="flex-1 min-h-0"
            />
          )}
          {!loading && !error && result == null && (
            <div className="flex-1 flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/60">Session pages will appear here.</div>
                <Button variant="outline" size="sm" className="gap-1.5" disabled>
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>
      </PanelContent>
    </Panel>
  );
}
