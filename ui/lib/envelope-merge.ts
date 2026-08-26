import type { DiscoverStepResponse, ResearchStepSummary, GraphNode, GraphEdge } from '@/lib/api/client';

export interface TableItem {
  name: string;
  columns?: string[];
  rows: Record<string, unknown>[];
}

export interface DiagramItem {
  name: string;
  type: string;
  content: string;
}

type EnvelopeLike = {
  synthesis?: { narrative?: string | null } | null;
  canvas?: {
    graph?: { nodes?: GraphNode[]; edges?: GraphEdge[] } | null;
    tables?: TableItem[] | null;
    diagrams?: DiagramItem[] | null;
  } | null;
};

export interface GraphMergeResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  addedNodes: number;
  addedEdges: number;
  skippedNodes: number;
  skippedEdges: number;
}

function nodeId(n: GraphNode): string {
  return n.id;
}

function edgeKey(e: GraphEdge): string {
  const from = e.from || '';
  const to = e.to || '';
  const type = e.type || '';
  const label = e.label || '';
  return `${from}|${to}|${type}|${label}`;
}

function edgeEndpoints(e: GraphEdge): Set<string> {
  const set = new Set<string>();
  if (e.from) set.add(e.from);
  if (e.to) set.add(e.to);
  return set;
}

/**
 * Merge source graph nodes/edges into a target graph.
 *
 * Rules:
 * - Nodes are keyed by `id`. First occurrence wins; later duplicates are skipped.
 * - Edges are keyed by `(from, to, type, label)`. First occurrence wins.
 * - After merging, orphan nodes (nodes with no incident edge) are removed.
 *
 * Returns the merged graph plus counts for UX feedback.
 */
export function mergeGraphs(
  target: { nodes: GraphNode[]; edges: GraphEdge[] },
  source: { nodes: GraphNode[]; edges: GraphEdge[] }
): GraphMergeResult {
  const nodeMap = new Map<string, GraphNode>();
  const edgeMap = new Map<string, GraphEdge>();

  for (const n of target.nodes) {
    nodeMap.set(nodeId(n), n);
  }
  for (const e of target.edges) {
    edgeMap.set(edgeKey(e), e);
  }

  let addedNodes = 0;
  let skippedNodes = 0;
  for (const n of source.nodes) {
    const id = nodeId(n);
    if (nodeMap.has(id)) {
      skippedNodes++;
    } else {
      nodeMap.set(id, n);
      addedNodes++;
    }
  }

  let addedEdges = 0;
  let skippedEdges = 0;
  for (const e of source.edges) {
    const key = edgeKey(e);
    if (edgeMap.has(key)) {
      skippedEdges++;
    } else {
      edgeMap.set(key, e);
      addedEdges++;
    }
  }

  // Filter out orphan nodes — every node must have at least one incident edge.
  const connectedNodeIds = new Set<string>();
  for (const e of edgeMap.values()) {
    for (const id of edgeEndpoints(e)) {
      connectedNodeIds.add(id);
    }
  }

  const nodes: GraphNode[] = [];
  let removedOrphans = 0;
  for (const n of nodeMap.values()) {
    if (connectedNodeIds.has(nodeId(n))) {
      nodes.push(n);
    } else {
      removedOrphans++;
    }
  }

  const edges = Array.from(edgeMap.values());

  return {
    nodes,
    edges,
    addedNodes,
    addedEdges,
    skippedNodes,
    skippedEdges: skippedEdges + removedOrphans,
  };
}

function normalizeSpacing(text: string): string {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parse a markdown table section back into structured table JSON. */
export function parseMarkdownTable(name: string, markdown: string): TableItem | null {
  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l.includes('|'));

  // Drop separator lines (| --- | --- |).
  const nonSeparator = lines.filter((l) => !/^\s*\|?\s*[-:]+\s*\|?\s*$/.test(l));
  if (nonSeparator.length < 2) return null;

  const parseRow = (line: string): string[] =>
    line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

  const headers = parseRow(nonSeparator[0]);
  if (headers.length === 0) return null;

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < nonSeparator.length; i++) {
    const cells = parseRow(nonSeparator[i]);
    if (cells.length === 0) continue;
    const row: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const cell = cells[idx];
      row[h] = cell !== undefined ? tryParseJsonCell(cell) : '';
    });
    rows.push(row);
  }

  if (rows.length === 0) return null;
  return { name, columns: headers, rows };
}

function tryParseJsonCell(value: string): unknown {
  if (value === '') return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  // Markdown table cells may contain stringified JSON arrays/objects.
  if ((value.startsWith('[') && value.endsWith(']')) || (value.startsWith('{') && value.endsWith('}'))) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Parse an envelope's rendered markdown back into structured table items.
 * Useful when the source page only stored tables inside `synthesis.narrative`
 * rather than in `canvas.tables`.
 */
export function extractTablesFromMarkdown(markdown: string): TableItem[] {
  const tables: TableItem[] = [];
  const lines = markdown.split('\n');
  let i = 0;
  while (i < lines.length) {
    const headingMatch = lines[i].match(/^#{1,6}\s+Table:\s*(.+)$/i);
    if (headingMatch) {
      const name = headingMatch[1].trim();
      const tableLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].trim().includes('|')) {
        tableLines.push(lines[j]);
        j++;
      }
      const parsed = parseMarkdownTable(name, tableLines.join('\n'));
      if (parsed) tables.push(parsed);
      i = j;
      continue;
    }
    i++;
  }
  return tables;
}
