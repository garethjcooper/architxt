import { randomUUID } from 'crypto';
import { createBaseCrud } from '../base.js';
import { stmt } from '../../cache.js';
import { createLogger } from '../../utils/logger.js';
import {
  listNodes as listContextualGraphNodes,
  listEdges as listContextualGraphEdges,
} from './contextual-graph.js';
import {
  dbExec,
  requireString,
  requireInt,
  fromJson,
  toJson,
} from '../../utils/db-helpers.js';

const logger = createLogger('views-crud');

const TABLE = 'views';
const PK = 'view_id';
const JSON_FIELDS = [
  'view_graph',
  'view_layout',
  'view_style_defaults',
  'view_timeline',
];

const SNAPSHOT_TABLE = 'view_snapshots';
const SNAPSHOT_JSON_FIELDS = ['vsnap_graph', 'vsnap_layout'];

const base = createBaseCrud(TABLE, PK, JSON_FIELDS, { pkType: 'string' });

function graphFromView(view) {
  return view?.view_graph || { nodes: [], edges: [] };
}

function layoutFromView(view) {
  return view?.view_layout || { positions: {}, viewport: { x: 0, y: 0, zoom: 1 } };
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonicalJson(value[key]);
  }
  return sorted;
}

function nodeKey(n) {
  if (!n || !n.id) return '';
  return JSON.stringify(canonicalJson({
    id: n.id,
    type: n.type,
    label: n.label,
    name: n.name,
    entity_type: n.entity_type,
    ref_id: n.ref_id,
    text: n.text,
    properties: n.properties,
    style: n.style,
  }));
}

function canonicalEdge(e) {
  if (!e || !e.id) return e;
  const source = e.source ?? '';
  const target = e.target ?? '';
  const sourceRef = e.source_ref_id ?? '';
  const targetRef = e.target_ref_id ?? '';
  // Deterministic endpoint ordering: sort by combined (view-node-id, ref-id)
  // so the edge orientation is stable regardless of how the edge was originally
  // stored or how contextual-graph re-fetch orders members.
  const a = [source, sourceRef].join('\0');
  const b = [target, targetRef].join('\0');
  if (a <= b) {
    return {
      ...e,
      source,
      target,
      source_ref_id: sourceRef,
      target_ref_id: targetRef,
    };
  }
  return {
    ...e,
    source: target,
    target: source,
    source_ref_id: targetRef,
    target_ref_id: sourceRef,
  };
}

function edgeKey(e) {
  if (!e || !e.id) return '';
  const c = canonicalEdge(e);
  return JSON.stringify(canonicalJson({
    id: c.id,
    source: c.source,
    target: c.target,
    ref_id: c.ref_id,
    source_ref_id: c.source_ref_id,
    target_ref_id: c.target_ref_id,
    label: c.label,
    edge_type: c.edge_type,
    properties: c.properties,
  }));
}

/**
 * Return a human-readable breakdown of why two canonical keys differ.
 * Useful for sync-churn debugging: it shows which normalized fields changed.
 */
function keyDiffSummary(keyFn, prev, next) {
  const p = keyFn(prev);
  const n = keyFn(next);
  if (p === n) return [];
  try {
    const po = JSON.parse(p);
    const no = JSON.parse(n);
    return objectDiff(po, no, 'key');
  } catch {
    return ['key parse error'];
  }
}

function objectDiff(prev, next, prefix = '') {
  const changes = [];
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) {
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      changes.push(`${prefix}: ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
    }
    return changes;
  }
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const key of keys) {
    const p = prev?.[key];
    const n = next?.[key];
    if (key === 'edge_type' && (p == null || n == null)) {
      // Treat null and undefined as equivalent for edge_type.
      if (p !== n && !(p == null && n == null)) {
        changes.push(`${prefix}.${key}: ${JSON.stringify(p)} -> ${JSON.stringify(n)}`);
      }
      continue;
    }
    if (typeof p === 'object' && typeof n === 'object' && p !== null && n !== null && !Array.isArray(p) && !Array.isArray(n)) {
      changes.push(...objectDiff(p, n, `${prefix}.${key}`));
    } else if (JSON.stringify(p) !== JSON.stringify(n)) {
      changes.push(`${prefix}.${key}: ${JSON.stringify(p)} -> ${JSON.stringify(n)}`);
    }
  }
  return changes;
}

/**
 * Strip volatile refresh timestamps and view-local provenance metadata from a
 * graph copy before diffing. The view sync diff should reflect semantic graph
 * changes (labels, names, types, structure), not when models were re-fetched.
 * Also canonicalize edge endpoints so orientation is stable.
 */
function normalizeGraphForDiff(graph) {
  const normalizeProperties = (properties) => {
    if (!properties || typeof properties !== 'object') return properties;
    const { last_seen_at, updated_at, provenance, ...rest } = properties;
    return rest;
  };

  const normalizeNode = (node) => ({
    ...node,
    properties: normalizeProperties(node.properties),
  });

  const normalizeEdge = (edge) => {
    const c = canonicalEdge(edge);
    return {
      ...c,
      edge_type: c.edge_type == null ? undefined : c.edge_type,
      properties: normalizeProperties(c.properties),
    };
  };

  return {
    nodes: (graph.nodes || []).map(normalizeNode),
    edges: (graph.edges || []).map(normalizeEdge),
  };
}

function diffGraphs(prev, next) {
  const prevNodes = new Map((prev.nodes || []).map((n) => [n.id, n]));
  const nextNodes = new Map((next.nodes || []).map((n) => [n.id, n]));
  const prevEdges = new Map((prev.edges || []).map((e) => [e.id, e]));
  const nextEdges = new Map((next.edges || []).map((e) => [e.id, e]));

  const added = [];
  const updated = [];
  const removed = [];

  for (const [id, n] of nextNodes) {
    if (!prevNodes.has(id)) {
      added.push({ kind: 'node', id, entity_type: n.entity_type, label: n.label });
    } else if (nodeKey(prevNodes.get(id)) !== nodeKey(n)) {
      const prevNode = prevNodes.get(id);
      const keyChanges = keyDiffSummary(nodeKey, prevNode, n);
      logger.info({
        service: 'views-diff',
        kind: 'node',
        id,
        entityType: n.entity_type,
        label: n.label,
        keyDiff: keyChanges.slice(0, 20),
        diff: objectDiff(prevNode, n, 'node').slice(0, 20),
      }, `Node ${id} differs`);
      logger.debug({
        service: 'views-diff',
        kind: 'node',
        id,
        before: normalizeGraphForDiff({ nodes: [prevNode], edges: [] }).nodes[0],
        after: normalizeGraphForDiff({ nodes: [n], edges: [] }).nodes[0],
      }, `Node ${id} normalized before/after`);
      updated.push({ kind: 'node', id, entity_type: n.entity_type, label: n.label });
    }
  }
  for (const [id, n] of prevNodes) {
    if (!nextNodes.has(id)) {
      removed.push({ kind: 'node', id, entity_type: n.entity_type, label: n.label });
    }
  }

  for (const [id, e] of nextEdges) {
    if (!prevEdges.has(id)) {
      added.push({ kind: 'edge', id, label: e.label, edge_type: e.edge_type });
    } else if (edgeKey(prevEdges.get(id)) !== edgeKey(e)) {
      const prevEdge = prevEdges.get(id);
      const keyChanges = keyDiffSummary(edgeKey, prevEdge, e);
      logger.info({
        service: 'views-diff',
        kind: 'edge',
        id,
        label: e.label,
        edgeType: e.edge_type,
        keyDiff: keyChanges.slice(0, 20),
        diff: objectDiff(prevEdge, e, 'edge').slice(0, 20),
      }, `Edge ${id} differs`);
      logger.debug({
        service: 'views-diff',
        kind: 'edge',
        id,
        before: normalizeGraphForDiff({ nodes: [], edges: [prevEdge] }).edges[0],
        after: normalizeGraphForDiff({ nodes: [], edges: [e] }).edges[0],
      }, `Edge ${id} normalized before/after`);
      updated.push({ kind: 'edge', id, label: e.label, edge_type: e.edge_type });
    }
  }
  for (const [id, e] of prevEdges) {
    if (!nextEdges.has(id)) {
      removed.push({ kind: 'edge', id, label: e.label, edge_type: e.edge_type });
    }
  }

  const addedNodes = added.filter((x) => x.kind === 'node').length;
  const updatedNodes = updated.filter((x) => x.kind === 'node').length;
  const removedNodes = removed.filter((x) => x.kind === 'node').length;
  const addedEdges = added.filter((x) => x.kind === 'edge').length;
  const updatedEdges = updated.filter((x) => x.kind === 'edge').length;
  const removedEdges = removed.filter((x) => x.kind === 'edge').length;

  return {
    added,
    updated,
    removed,
    counts: {
      added_nodes: addedNodes,
      updated_nodes: updatedNodes,
      removed_nodes: removedNodes,
      added_edges: addedEdges,
      updated_edges: updatedEdges,
      removed_edges: removedEdges,
    },
    changed: added.length + updated.length + removed.length > 0,
  };
}

export const deleteView = base.del;

/**
 * Delete every view for a server/bank scope.
 * @param {Object} db
 * @param {{ server_id: number, bank_id: string }} params
 */
export const deleteAllViewsByBank = (db, { server_id, bank_id }) => dbExec(() => {
  const sid = requireInt('server_id', server_id);
  const bid = requireString('bank_id', bank_id);
  const sql = `DELETE FROM ${TABLE}
    WHERE view_server_id = ? AND view_bank_id = ?`;
  const result = stmt(db, sql).run(sid, bid);
  return { deleted: result.changes };
}, `${TABLE}.deleteAllViewsByBank`);

// Generic operations
export const getView = base.get;

/**
 * List all views for a server/bank, ordered by most recently updated.
 * @param {Object} db
 * @param {{ server_id: number, bank_id: string }} params
 */
export const listViewsByBank = (db, { server_id, bank_id }) => dbExec(() => {
  const sid = requireInt('server_id', server_id);
  const bid = requireString('bank_id', bank_id);
  const sql = `SELECT * FROM ${TABLE}
    WHERE view_server_id = ? AND view_bank_id = ?
    ORDER BY view_updated_at DESC, view_created_at DESC`;
  const rows = stmt(db, sql).all(sid, bid);
  return rows.map((r) => fromJson(r, JSON_FIELDS));
}, `${TABLE}.listViewsByBank`);

/**
 * Create a new view.
 * @param {Object} db
 * @param {Object} data
 * @param {number} data.server_id
 * @param {string} data.bank_id
 * @param {string} data.name
 * @param {string} [data.diagram_type='flowchart']
 * @param {Object} [data.graph]
 * @param {Object} [data.layout]
 * @param {Object} [data.style_defaults]
 * @param {Array} [data.timeline]
 */
export const createView = (db, data) => dbExec(() => {
  requireInt('server_id', data.server_id);
  requireString('bank_id', data.bank_id);
  requireString('name', data.name);

  const viewId = data.view_id ?? randomUUID();
  const diagramType = data.diagram_type ?? 'flowchart';
  const nowIso = new Date().toISOString();

  const graph = data.graph ?? { nodes: [], edges: [] };
  const layout = data.layout ?? {
    positions: {},
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const prepared = toJson(
    {
      view_graph: graph,
      view_layout: layout,
      view_style_defaults: data.style_defaults ?? null,
      view_timeline: data.timeline ?? [],
    },
    JSON_FIELDS
  );

  const sql = `INSERT INTO ${TABLE} (
    view_id, view_server_id, view_bank_id, view_name, view_diagram_type,
    view_graph, view_layout, view_style_defaults, view_timeline,
    view_created_at, view_updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  stmt(db, sql).run(
    viewId,
    data.server_id,
    data.bank_id,
    data.name,
    diagramType,
    prepared.view_graph,
    prepared.view_layout,
    prepared.view_style_defaults,
    prepared.view_timeline,
    data.created_at ?? nowIso,
    data.updated_at ?? nowIso
  );

  return viewId;
}, `${TABLE}.createView`);

/**
 * Update a view. Layout-only updates do not touch graph; graph-only updates do
 * not touch layout. Only supplied fields are written.
 * @param {Object} db
 * @param {string} viewId
 * @param {Object} data
 */
export const updateView = (db, viewId, data) => dbExec(() => {
  const id = requireString('viewId', viewId);
  const allowedFields = new Set([
    'view_name',
    'view_diagram_type',
    'view_graph',
    'view_layout',
    'view_style_defaults',
    'view_timeline',
  ]);
  const entries = Object.entries(data).filter(([key]) => allowedFields.has(key));
  if (entries.length === 0) {
    throw new Error('No allowed fields to update');
  }
  if (data.view_diagram_type !== undefined && !isValidDiagramType(data.view_diagram_type)) {
    throw new Error(`view_diagram_type must be one of the supported types; got: ${data.view_diagram_type}`);
  }

  const prepared = toJson(Object.fromEntries(entries), JSON_FIELDS);
  const columns = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([key]) => prepared[key] ?? data[key]);
  const sql = `UPDATE ${TABLE} SET ${columns}, view_updated_at = CURRENT_TIMESTAMP WHERE ${PK} = ?`;
  const result = stmt(db, sql).run(...values, id);
  return result.changes > 0 ? true : null;
}, `${TABLE}.updateView`);

/**
 * Create an immutable snapshot of a view. Copies graph, layout, and diagram
 * type into view_snapshots. UI for snapshots is deferred, but the table is
 * available for later phases.
 * @param {Object} db
 * @param {string} viewId
 * @param {{ name: string, mermaid?: string, svg?: string }} params
 */
export const createSnapshot = (db, viewId, { name, mermaid = null, svg = null }) => dbExec(() => {
  const id = requireString('viewId', viewId);
  requireString('name', name);

  const viewResult = getView(db, id);
  if (!viewResult.success || !viewResult.data) {
    throw new Error(`View not found: ${id}`);
  }
  const view = viewResult.data;

  const vsnapId = randomUUID();
  const prepared = toJson(
    {
      vsnap_graph: view.view_graph,
      vsnap_layout: view.view_layout,
    },
    SNAPSHOT_JSON_FIELDS
  );

  const sql = `INSERT INTO ${SNAPSHOT_TABLE} (
    vsnap_id, vsnap_view_id, vsnap_name, vsnap_graph, vsnap_layout,
    vsnap_mermaid, vsnap_svg, vsnap_created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  stmt(db, sql).run(
    vsnapId,
    id,
    name,
    prepared.vsnap_graph,
    prepared.vsnap_layout,
    mermaid,
    svg,
    new Date().toISOString()
  );

  return vsnapId;
}, `${SNAPSHOT_TABLE}.createSnapshot`);

/**
 * Create an immutable snapshot of the current view graph + layout for the
 * timeline. Returns the generated snapshot id without changing the view.
 *
 * @param {Object} db
 * @param {string} viewId
 * @param {Object} graph
 * @param {Object} layout
 * @returns {string}
 */
const createTimelineSnapshot = (db, viewId, graph, layout) => dbExec(() => {
  const id = requireString('viewId', viewId);
  const vsnapId = randomUUID();
  const prepared = toJson(
    { vsnap_graph: graph, vsnap_layout: layout },
    SNAPSHOT_JSON_FIELDS
  );

  const sql = `INSERT INTO ${SNAPSHOT_TABLE} (
    vsnap_id, vsnap_view_id, vsnap_name, vsnap_graph, vsnap_layout,
    vsnap_mermaid, vsnap_svg, vsnap_created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

  stmt(db, sql).run(
    vsnapId,
    id,
    'Timeline snapshot',
    prepared.vsnap_graph,
    prepared.vsnap_layout,
    null,
    null,
    new Date().toISOString()
  );

  return vsnapId;
}, `${SNAPSHOT_TABLE}.createTimelineSnapshot`);

/**
 * Fetch a timeline snapshot by view + snapshot id. Returns the stored graph and
 * layout plus the slice metadata. The caller is responsible for not mutating
 * the returned graph/layout.
 *
 * @param {Object} db
 * @param {string} viewId
 * @param {string} snapshotId
 * @returns {{ graph: Object, layout: Object, slice: Object }}
 */
export const getTimelineSnapshot = (db, viewId, snapshotId) => dbExec(() => {
  const id = requireString('viewId', viewId);
  const sid = requireString('snapshotId', snapshotId);

  const viewResult = getView(db, id);
  if (!viewResult.success || !viewResult.data) {
    throw new Error(`View not found: ${id}`);
  }
  const view = viewResult.data;
  const timeline = Array.isArray(view.view_timeline) ? view.view_timeline : [];
  const slice = timeline.find((s) => s.snapshot_id === sid);
  if (!slice) throw new Error(`Timeline slice not found: ${sid}`);
  if (!slice.snapshot_id) throw new Error(`Timeline slice has no snapshot: ${sid}`);

  const row = stmt(db, `SELECT * FROM ${SNAPSHOT_TABLE} WHERE vsnap_id = ?`).get(slice.snapshot_id);
  if (!row) throw new Error(`Snapshot not found: ${slice.snapshot_id}`);

  return {
    graph: JSON.parse(row.vsnap_graph),
    layout: JSON.parse(row.vsnap_layout),
    slice,
  };
}, `${SNAPSHOT_TABLE}.getTimelineSnapshot`);

/**
 * Delete all timeline snapshots for a view and clear the view_timeline column.
 * Returns the number of deleted snapshot rows.
 *
 * @param {Object} db
 * @param {string} viewId
 * @returns {number}
 */
export const clearViewTimeline = (db, viewId) => dbExec(() => {
  const id = requireString('viewId', viewId);
  const viewResult = getView(db, id);
  if (!viewResult.success || !viewResult.data) {
    throw new Error(`View not found: ${id}`);
  }

  const deleteSnapshots = stmt(db, `DELETE FROM ${SNAPSHOT_TABLE} WHERE vsnap_view_id = ?`);
  const { changes } = deleteSnapshots.run(id);

  stmt(db, 'UPDATE views SET view_timeline = ? WHERE view_id = ?').run('[]', id);

  return changes;
}, 'views.clearViewTimeline');

const SUPPORTED_DIAGRAM_TYPES = [
  'flowchart',
  'sequenceDiagram',
  'erDiagram',
  'classDiagram',
  'stateDiagram',
  'timeline',
];

function isValidDiagramType(value) {
  return SUPPORTED_DIAGRAM_TYPES.includes(value);
}

/**
 * Build a contextual-graph-derived graph for a single view by intersecting the
 * current contextual graph with the entities/edges the view already contains.
 * Native (non-entity) nodes and edges are preserved. Entity nodes/edges are
 * added, updated, or removed to match the contextual graph.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} view
 * @returns {{ graph: Object, layout: Object, added: number, updated: number, removed: number }}
 */
function deriveGraphFromContextualGraph(db, serverId, bankId, view) {
  const existingGraph = graphFromView(view);
  const existingLayout = layoutFromView(view);
  const existingPositions = { ...existingLayout.positions };

  const existingEntityNodes = new Map(
    (existingGraph.nodes || [])
      .filter((n) => n.type === 'entity')
      .map((n) => [n.id, n])
  );
  const existingEntityEdges = new Map(
    (existingGraph.edges || [])
      .filter((e) => e.source?.startsWith?.('entity-') || e.target?.startsWith?.('entity-'))
      .map((e) => [String(e.id), e])
  );

  // If the view has no entity content yet, there is nothing to sync from the
  // contextual graph. We do not auto-populate the view; we only update items
  // that are already on the canvas.
  if (existingEntityNodes.size === 0 && existingEntityEdges.size === 0) {
    return {
      graph: existingGraph,
      layout: existingLayout,
      added: 0,
      updated: 0,
      removed: 0,
    };
  }

  const trackedEntityIds = new Set(existingEntityNodes.keys());
  const trackedEdgeIds = new Set(existingEntityEdges.keys());

  const nodeResult = listContextualGraphNodes(db, serverId, bankId, { limit: 10000 });
  const edgeResult = listContextualGraphEdges(db, serverId, bankId, { limit: 10000 });
  if (!nodeResult.success) throw new Error(`Failed to list contextual graph nodes: ${nodeResult.error}`);
  if (!edgeResult.success) throw new Error(`Failed to list contextual graph edges: ${edgeResult.error}`);
  const contextualNodes = nodeResult.data || [];
  const contextualEdges = edgeResult.data || [];

  const contextualNodeById = new Map(contextualNodes.map((n) => [n.cgn_id, n]));

  const nativeNodes = (existingGraph.nodes || []).filter((n) => n.type !== 'entity');
  const nativeEdges = (existingGraph.edges || []).filter(
    (e) => e.source?.startsWith?.('entity-') === false && e.target?.startsWith?.('entity-') === false
  );

  const entityNodes = [];
  const validEntityIds = new Set();
  let added = 0;
  let updated = 0;

  // Only consider contextual nodes that are already on the view.
  for (let i = 0; i < contextualNodes.length; i += 1) {
    const cgn = contextualNodes[i];
    if (cgn.cgn_labels?.includes('stale')) continue;

    const entityId = `entity-${cgn.cgn_id}`;
    if (!trackedEntityIds.has(entityId)) continue;

    const label = cgn.properties?.name || cgn.properties?.display_name || cgn.cgn_id;
    const name = cgn.properties?.name || label;
    const entityType =
      cgn.properties?.entity_type ||
      (cgn.cgn_id.includes(':') ? cgn.cgn_id.split(':')[0] : null) ||
      cgn.cgn_labels?.[0] ||
      'entity';
    const properties = cgn.properties || {};
    const style = cgn.style || {};
    const existing = existingEntityNodes.get(entityId);

    if (existing) {
      const nodeDiff = objectDiff(existing, {
        label,
        name,
        entity_type: entityType,
        properties,
        style,
      }, 'existing');
      if (nodeDiff.length > 0) {
        updated += 1;
      }
      entityNodes.push({
        ...existing,
        label,
        name,
        entity_type: entityType,
        properties,
        style,
        ref_id: cgn.cgn_id,
      });
    } else {
      entityNodes.push({
        id: entityId,
        type: 'entity',
        ref_id: cgn.cgn_id,
        label,
        name,
        entity_type: entityType,
        properties,
        style,
      });
      if (!existingPositions[entityId]) {
        existingPositions[entityId] = gridPosition(i);
        added += 1;
      }
    }

    validEntityIds.add(entityId);
  }

  const entityNodeIds = new Set(entityNodes.map((n) => n.id));
  const contextualEdgeIds = new Set();
  const entityEdges = [];

  for (const e of contextualEdges) {
    if (e.cge_properties?.labels?.includes('stale')) continue;

    const edgeId = String(e.cge_id);
    if (!trackedEdgeIds.has(edgeId)) continue;

    const sourceNodeId = `entity-${e.cge_source_id}`;
    const targetNodeId = `entity-${e.cge_target_id}`;
    if (!entityNodeIds.has(sourceNodeId) || !entityNodeIds.has(targetNodeId)) continue;

    const label = e.cge_properties?.label || e.cge_type || edgeId;
    contextualEdgeIds.add(edgeId);

    const rawEdge = {
      id: edgeId,
      type: 'default',
      source: sourceNodeId,
      target: targetNodeId,
      ref_id: e.cge_id,
      source_ref_id: e.cge_source_id,
      target_ref_id: e.cge_target_id,
      label,
      edge_type: e.cge_type || undefined,
      properties: e.cge_properties || {},
    };
    const canonical = canonicalEdge(rawEdge);
    const existing = existingEntityEdges.get(edgeId);
    if (existing) {
      const edgeDiff = objectDiff(existing, canonical, 'existing');
      if (edgeDiff.length > 0) {
        updated += 1;
      }
    }
    entityEdges.push(canonical);
  }

  for (const id of Object.keys(existingPositions)) {
    if (id.startsWith('entity-') && !validEntityIds.has(id)) {
      delete existingPositions[id];
    }
  }

  const graph = {
    nodes: [...entityNodes, ...nativeNodes],
    edges: [...entityEdges, ...nativeEdges],
  };

  const layout = {
    positions: existingPositions,
    viewport: existingLayout.viewport || { x: 0, y: 0, zoom: 1 },
  };

  return {
    graph,
    layout,
    added,
    updated,
    removed:
      [...trackedEntityIds].filter((id) => !validEntityIds.has(id)).length +
      [...trackedEdgeIds].filter((id) => !contextualEdgeIds.has(id)).length,
  };
}

function gridPosition(index) {
  const col = index % 10;
  const row = Math.floor(index / 10);
  return { x: 120 + col * 160, y: 120 + row * 100, parent: null };
}

/**
 * Sync every view in a bank against the current contextual graph. For each view,
 * derive what the view would look like from the contextual graph and compute a
 * diff. If there are changes, snapshot the new state, append a timeline slice,
 * and persist the updated graph/layout.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @returns {Promise<{ success: boolean, views: number, changed: number, total_added: number, total_updated: number, total_removed: number, error?: string }>}
 */
export const syncViewsFromContextualGraph = (db, serverId, bankId) => dbExec(() => {
  const sid = requireInt('serverId', serverId);
  const bid = requireString('bankId', bankId);

  const viewsResult = listViewsByBank(db, { server_id: sid, bank_id: bid });
  const views = viewsResult?.success ? viewsResult.data : viewsResult;

  let changedCount = 0;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalRemoved = 0;

  for (const view of views) {
    const prevGraph = graphFromView(view);
    const derived = deriveGraphFromContextualGraph(db, sid, bid, view);
    const diff = diffGraphs(normalizeGraphForDiff(prevGraph), normalizeGraphForDiff(derived.graph));

    if (!diff.changed) continue;

    const snapshotResult = createTimelineSnapshot(db, view.view_id, derived.graph, derived.layout);
    if (!snapshotResult.success) {
      throw new Error(`Failed to create timeline snapshot: ${snapshotResult.error}`);
    }
    const snapshotId = snapshotResult.data;

    const entityNodeCount = derived.graph.nodes.filter((n) => n.type === 'entity').length;
    const entityEdgeCount = derived.graph.edges.filter(
      (e) => e.source?.startsWith?.('entity-') || e.target?.startsWith?.('entity-')
    ).length;

    logger.info({
      service: 'views-diff-summary',
      viewId: view.view_id,
      viewName: view.view_name,
      serverId: sid,
      bankId: bid,
      addedNodes: diff.counts.added_nodes,
      updatedNodes: diff.counts.updated_nodes,
      removedNodes: diff.counts.removed_nodes,
      addedEdges: diff.counts.added_edges,
      updatedEdges: diff.counts.updated_edges,
      removedEdges: diff.counts.removed_edges,
      updatedIds: diff.updated.map((x) => x.id),
      addedIds: diff.added.map((x) => x.id),
      removedIds: diff.removed.map((x) => x.id),
      entityNodeCount,
      entityEdgeCount,
      snapshotId,
    }, `View sync update: ${view.view_name} (${view.view_id}) changed=${diff.changed}`);

    const timeline = Array.isArray(view.view_timeline) ? [...view.view_timeline] : [];
    timeline.push({
      id: randomUUID(),
      type: 'contextual-graph-sync',
      at: new Date().toISOString(),
      summary: `Synced ${entityNodeCount} entities, ${entityEdgeCount} edges`,
      details: {
        ...diff.counts,
      },
      snapshot_id: snapshotId,
    });

    const updateResult = updateView(db, view.view_id, {
      view_graph: derived.graph,
      view_layout: derived.layout,
      view_timeline: timeline,
    });
    if (!updateResult.success) {
      throw new Error(`Failed to update view ${view.view_id}: ${updateResult.error}`);
    }

    changedCount += 1;
    totalAdded += diff.counts.added_nodes + diff.counts.added_edges;
    totalUpdated += diff.counts.updated_nodes + diff.counts.updated_edges;
    totalRemoved += diff.counts.removed_nodes + diff.counts.removed_edges;
  }

  return {
    success: true,
    views: views.length,
    changed: changedCount,
    total_added: totalAdded,
    total_updated: totalUpdated,
    total_removed: totalRemoved,
  };
}, `${TABLE}.syncViewsFromContextualGraph`);
