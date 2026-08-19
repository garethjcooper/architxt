'use client';

import { NarrativeViewer } from '@/components/narrative-viewer';
import { type EntityInfo, type MentalModelContent } from '@/lib/api/client';
import {
  DisplayNode,
  DisplayEdge,
  isGroundedNode,
  isCandidateNode,
  isGroundedEdge,
  isCandidateEdge,
  renderValue,
} from '@/lib/contextual-graph/display';

type ModelContentEntry = { found: boolean; error?: string; mental_model?: MentalModelContent };

type EntityInfoWithContent = EntityInfo & { content?: Record<string, ModelContentEntry> };


function isGroundedNodeForWorkspace(node: DisplayNode): boolean {
  return isGroundedNode(node) && !isCandidateNode(node);
}

function isGroundedEdgeForWorkspace(edge: DisplayEdge): boolean {
  return isGroundedEdge(edge) && !isCandidateEdge(edge);
}


function extractReflectNarrative(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result !== 'object') return String(result);
  const obj = result as Record<string, unknown>;
  const candidateKeys = ['response', 'narrative', 'content', 'answer', 'output', 'structured_output', 'text', 'markdown'];
  for (const key of candidateKeys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  // Hindsight sometimes nests under data.
  if (typeof obj.data === 'string' && obj.data.trim()) return obj.data;
  if (typeof obj.data === 'object' && obj.data != null) {
    const data = obj.data as Record<string, unknown>;
    for (const key of candidateKeys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return JSON.stringify(result, null, 2);
}


function getModelContentText(content: MentalModelContent | undefined): string {
  if (!content) return '';
  if (typeof content.narrative === 'string' && content.narrative.trim()) return content.narrative;
  if (typeof content.concatenation === 'string' && content.concatenation.trim()) return content.concatenation;
  return '';
}


function renderModelContent(entry: ModelContentEntry | undefined): React.ReactNode {
  if (!entry) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-white/40">
        No content available.
      </div>
    );
  }
  if (entry.error) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-red-400">
        {entry.error}
      </div>
    );
  }
  if (!entry.found || !entry.mental_model) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-white/40">
        Model content not found.
      </div>
    );
  }
  const text = getModelContentText(entry.mental_model);
  if (text) {
    return <NarrativeViewer content={text} title="Content" viewMode="markdown" showIndex={false} className="h-48" />;
  }
  // No narrative/concatenation: render the full structured content as JSON.
  return (
    <div className="h-48 overflow-auto rounded border border-white/10 bg-black/20 p-2">
      {renderValue(entry.mental_model)}
    </div>
  );
}


const MODEL_TAB_LABELS: Record<string, string> = {
  contextual_refs: 'Context',
  derived_models: 'Derived',
  plain_models: 'Plain',
  edge_contexts: 'Edges',
};


export type { ModelContentEntry, EntityInfoWithContent };
export {
  isGroundedNodeForWorkspace,
  isGroundedEdgeForWorkspace,
  extractReflectNarrative,
  getModelContentText,
  renderModelContent,
  MODEL_TAB_LABELS,
};
