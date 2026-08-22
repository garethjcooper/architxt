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

function isTableRow(line: string): boolean {
  return (line.match(/\|/g) || []).length >= 2;
}

/** Remove accidental blank lines inside markdown table blocks. This fixes LLM outputs
 *  that insert an empty line between table rows, which would otherwise break GFM table
 *  rendering and show the remaining rows as plain text. */
function normalizeTableBlankLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isTableRow(line)) {
      out.push(line);
      i++;
      let pendingBlanks = 0;
      while (i < lines.length) {
        const cur = lines[i];
        if (cur.trim() === '') {
          pendingBlanks++;
          i++;
          continue;
        }
        if (isTableRow(cur)) {
          // Drop the blanks; the rows belong to the same table.
          out.push(cur);
          pendingBlanks = 0;
          i++;
          continue;
        }
        // Non-table line after blanks — preserve the blanks and exit the table.
        for (let b = 0; b < pendingBlanks; b++) out.push('');
        break;
      }
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

function parseMentalModelContent(raw: HindsightContentResult | ModelContentCacheEntry): MentalModelContent {
  let parsed: any = null;
  const rawContent = raw.content ?? null;

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
      narrative: normalizeTableBlankLines(typeof rawContent === 'string' ? rawContent : ''),
      concatenation: undefined,
      graph: { nodes: [], edges: [] },
      tables: [],
      diagrams: [],
    };
  }

  return {
    ext_id: '',
    narrative: normalizeTableBlankLines(typeof parsed.narrative === 'string' ? parsed.narrative : ''),
    concatenation: undefined,
    graph: (parsed.graph ?? { nodes: [], edges: [] }) as { nodes: GraphNode[]; edges: GraphEdge[] },
    tables: Array.isArray(parsed.tables) ? parsed.tables : [],
    diagrams: Array.isArray(parsed.diagrams) ? parsed.diagrams : [],
  };
}

/** Build a synthetic step summary from a raw mental-model content result so it can
 *  be previewed with the same ResearchResultPanel/WorkspaceResultPanel path as a
 *  session step. */
export function mentalModelContentToStepSummary(name: string, raw: HindsightContentResult | ModelContentCacheEntry): ResearchStepSummary {
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
