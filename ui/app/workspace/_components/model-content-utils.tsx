'use client';

import { NarrativeViewer } from '@/components/narrative-viewer';
import { type EntityInfo, type MentalModelContent, type ResearchStepSummary, type GraphNode, type GraphEdge } from '@/lib/api/client';
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


function getModelContentText(content: MentalModelContent | undefined): string {
  if (!content) return '';
  if (typeof content.narrative === 'string' && content.narrative.trim()) return content.narrative;
  if (typeof content.concatenation === 'string' && content.concatenation.trim()) return content.concatenation;
  return '';
}


/** Build a synthetic step summary from a mental model's content so it can be
 *  previewed with the same ResearchResultPanel/WorkspaceResultPanel path as a
 *  session step. */
export function mentalModelContentToStepSummary(name: string, content: MentalModelContent): ResearchStepSummary {
  const now = new Date().toISOString();
  return {
    id: -1,
    session_id: -1,
    parent_step_id: null,
    intent_text: name,
    raw_query: null,
    action_type: 'curated_page',
    parameters: null,
    created_at: now,
    status: 'completed',
    error_message: null,
    tool_calls_used: 0,
    viewpoint_ids: [],
    selections: [],
    calls: [],
    synthesis: {
      narrative: content.narrative ?? content.concatenation ?? '',
    },
    canvas: {
      graph: (content.graph ?? { nodes: [], edges: [] }) as { nodes: GraphNode[]; edges: GraphEdge[] },
      tables: content.tables ?? [],
      diagrams: content.diagrams ?? [],
      meta: undefined,
    },
  };
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
  getModelContentText,
  renderModelContent,
  MODEL_TAB_LABELS,
};
