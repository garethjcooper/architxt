'use client';

import mermaid from 'mermaid';
import { ensureMermaidInitialized } from '@/lib/mermaid-init';

export interface MermaidNode {
  /** Mermaid node id (may be a short alias or an entity id). */
  id: string;
  /** Display label extracted from the diagram. */
  name: string;
  /** Mermaid shape / node type, if meaningful. */
  shape?: string;
}

export interface MermaidEdge {
  from: string;
  to: string;
  /** Edge label / message text, when present. */
  label?: string;
}

export interface MermaidGraph {
  diagramType: string;
  nodes: MermaidNode[];
  edges: MermaidEdge[];
}

interface MermaidVertex {
  id: string;
  text?: string;
  label?: string;
  type?: string;
}

interface MermaidFlowEdge {
  start: string;
  end: string;
  text?: string;
}

function vertexName(v: MermaidVertex): string {
  return v.text || v.label || v.id;
}

function normalizeLabel(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function parseFlowchart(db: any): MermaidGraph {
  const nodes: MermaidNode[] = [];
  for (const [id, v] of db.getVertices().entries()) {
    nodes.push({ id, name: vertexName(v), shape: v.type });
  }
  const edges: MermaidEdge[] = (db.getEdges() || [])
    .filter((e: MermaidFlowEdge) => e.start && e.end)
    .map((e: MermaidFlowEdge) => ({
      from: e.start,
      to: e.end,
      label: normalizeLabel(e.text),
    }));
  return { diagramType: 'flowchart', nodes, edges };
}

function parseSequence(db: any): MermaidGraph {
  const nodes: MermaidNode[] = [];
  for (const [id, actor] of db.getActors().entries()) {
    nodes.push({ id, name: actor.description || actor.name || id });
  }
  // Message types 10/11 are loop/alt/rect markers, not actor-to-actor messages.
  const edges: MermaidEdge[] = (db.getMessages() || [])
    .filter((m: any) => m.from && m.to && m.type !== 10 && m.type !== 11)
    .map((m: any) => ({
      from: m.from,
      to: m.to,
      label: normalizeLabel(m.message),
    }));
  return { diagramType: 'sequenceDiagram', nodes, edges };
}

function parseER(db: any): MermaidGraph {
  const entities = db.getEntities ? new Map(db.getEntities()) : new Map();
  const byDomId = new Map<string, string>();
  const nodes: MermaidNode[] = [];
  for (const [name, entity] of entities) {
    const label = entity.label || name;
    nodes.push({ id: name, name: label });
    if (entity.id) {
      byDomId.set(entity.id, name);
    }
  }
  const edges: MermaidEdge[] = (db.getRelationships ? db.getRelationships() : [])
    .filter((r: any) => r.entityA && r.entityB)
    .map((r: any) => ({
      from: byDomId.get(r.entityA) || r.entityA,
      to: byDomId.get(r.entityB) || r.entityB,
      label: normalizeLabel(r.roleA),
    }));
  return { diagramType: 'erDiagram', nodes, edges };
}

function parseClass(db: any): MermaidGraph {
  const classes = db.getClasses ? new Map(db.getClasses()) : new Map();
  const nodes: MermaidNode[] = [];
  for (const [id, cls] of classes) {
    nodes.push({ id, name: cls.label || cls.text || id });
  }
  const edges: MermaidEdge[] = (db.getRelations ? db.getRelations() : [])
    .filter((r: any) => r.id1 && r.id2)
    .map((r: any) => ({
      from: r.id1,
      to: r.id2,
      label: normalizeLabel(r.title),
    }));
  return { diagramType: 'classDiagram', nodes, edges };
}

function parseState(db: any): MermaidGraph {
  const nodes: MermaidNode[] = [];
  for (const [, node] of db.nodes || new Map()) {
    nodes.push({ id: node.id, name: node.label || node.id, shape: node.shape });
  }
  const edges: MermaidEdge[] = (db.edges || [])
    .filter((e: any) => e.start && e.end)
    .map((e: any) => ({
      from: e.start,
      to: e.end,
      label: normalizeLabel(e.label),
    }));
  return { diagramType: 'stateDiagram-v2', nodes, edges };
}

function collectMindmap(node: any, nodes: MermaidNode[], edges: MermaidEdge[], parentId?: string) {
  if (!node) return;
  const id = node.nodeId || node.id || node.descr;
  if (!id) return;
  nodes.push({ id, name: node.descr || id });
  if (parentId) {
    edges.push({ from: parentId, to: id });
  }
  for (const child of node.children || []) {
    collectMindmap(child, nodes, edges, id);
  }
}

function parseMindmap(db: any): MermaidGraph {
  const nodes: MermaidNode[] = [];
  const edges: MermaidEdge[] = [];
  const root = db.getMindmap ? db.getMindmap() : null;
  if (root) {
    collectMindmap(root, nodes, edges);
  }
  return { diagramType: 'mindmap', nodes, edges };
}

const SUPPORTED_DIAGRAMS = new Set([
  'flowchart',
  'flowchart-v2',
  'graph',
  'sequenceDiagram',
  'erDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'mindmap',
]);

/**
 * Parse a Mermaid source string into a generic `{ nodes, edges }` graph.
 *
 * Edges intentionally omit a `type` field: diagram edges are usually
 * co-occurrence-like, and the edge resolver matches them by endpoints + label.
 *
 * Returns `null` when the source cannot be parsed or the diagram type is not
 * yet supported.
 */
export async function mermaidToGraph(content: string): Promise<MermaidGraph | null> {
  if (!content || !content.trim()) return null;

  ensureMermaidInitialized();

  let diagram: any;
  try {
    diagram = await mermaid.mermaidAPI.getDiagramFromText(content.trim());
  } catch {
    return null;
  }

  const diagramType = diagram.type;
  if (!SUPPORTED_DIAGRAMS.has(diagramType)) {
    return null;
  }

  try {
    switch (diagramType) {
      case 'flowchart':
      case 'flowchart-v2':
      case 'graph':
        return parseFlowchart(diagram.db);
      case 'sequenceDiagram':
        return parseSequence(diagram.db);
      case 'erDiagram':
        return parseER(diagram.db);
      case 'classDiagram':
        return parseClass(diagram.db);
      case 'stateDiagram-v2':
        return parseState(diagram.db);
      case 'mindmap':
        return parseMindmap(diagram.db);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** Merge multiple parsed diagrams into a single graph, deduplicating nodes by id. */
export function mergeMermaidGraphs(graphs: MermaidGraph[]): MermaidGraph {
  const nodeById = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  for (const g of graphs) {
    for (const n of g.nodes) {
      if (!nodeById.has(n.id)) {
        nodeById.set(n.id, n);
      }
    }
    edges.push(...g.edges);
  }
  return { diagramType: 'merged', nodes: Array.from(nodeById.values()), edges };
}
