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

// Raw shape returned by the standard `/research/mental-models/content` API.
type HindsightContentResult = {
  found?: boolean;
  content?: string | object | null;
  content_hash?: string | null;
  updated_at?: string | null;
};

type EntityInfoWithContent = EntityInfo;

function isGroundedNodeForWorkspace(node: DisplayNode): boolean {
  return isGroundedNode(node) && !isCandidateNode(node);
}

function isGroundedEdgeForWorkspace(edge: DisplayEdge): boolean {
  return isGroundedEdge(edge) && !isCandidateEdge(edge);
}

function parseMentalModelContent(raw: HindsightContentResult): MentalModelContent {
  let parsed: any = null;
  const rawContent = raw.content;

  if (typeof rawContent === 'string' && rawContent.trim()) {
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = null;
    }
  } else if (rawContent && typeof rawContent === 'object' && !Array.isArray(rawContent)) {
    parsed = rawContent;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ext_id: '',
      narrative: typeof rawContent === 'string' ? rawContent : '',
      concatenation: undefined,
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    };
  }

  return {
    ext_id: '',
    narrative: typeof parsed.narrative === 'string' ? parsed.narrative : '',
    concatenation: undefined,
    graph: (parsed.graph ?? { nodes: [], edges: [] }) as { nodes: GraphNode[]; edges: GraphEdge[] },
    tables: Array.isArray(parsed.tables) ? parsed.tables : [],
    diagrams: Array.isArray(parsed.diagrams) ? parsed.diagrams : [],
  };
}

/** Build a synthetic step summary from a raw mental-model content result so it can
 *  be previewed with the same ResearchResultPanel/WorkspaceResultPanel path as a
 *  session step. */
export function mentalModelContentToStepSummary(name: string, raw: ModelContentCacheEntry): ResearchStepSummary {
  const content = parseMentalModelContent(raw);
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
      narrative: content.narrative || '',
    },
    canvas: {
      graph: (content.graph ?? { nodes: [], edges: [] }) as { nodes: GraphNode[]; edges: GraphEdge[] },
      tables: content.tables ?? [],
      diagrams: content.diagrams ?? [],
      meta: undefined,
    },
  };
}

function getModelContentText(raw: HindsightContentResult | undefined): string {
  if (!raw) return '';
  return parseMentalModelContent(raw).narrative || '';
}

function renderModelContent(entry: HindsightContentResult | undefined): React.ReactNode {
  if (!entry) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-white/40">
        No content available.
      </div>
    );
  }
  if (entry.found === false) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-white/40">
        Model content not found.
      </div>
    );
  }
  const text = getModelContentText(entry);
  if (text) {
    return <NarrativeViewer content={text} title="Content" viewMode="markdown" showIndex={false} className="h-48" />;
  }
  // No narrative: render the full raw content as JSON.
  return (
    <div className="h-48 overflow-auto rounded border border-white/10 bg-black/20 p-2">
      {renderValue(entry.content)}
    </div>
  );
}

const MODEL_TAB_LABELS: Record<string, string> = {
  contextual_refs: 'Context',
  derived_models: 'Derived',
  plain_models: 'Plain',
  edge_contexts: 'Edges',
};

export type ModelContentCacheEntry = {
  content: string | object | null;
  found: boolean;
  loading?: boolean;
  error?: string | null;
};

export type { HindsightContentResult, EntityInfoWithContent };
export {
  isGroundedNodeForWorkspace,
  isGroundedEdgeForWorkspace,
  getModelContentText,
  renderModelContent,
  MODEL_TAB_LABELS,
};
