/**
 * @typedef {object} EntityCatalogEntry
 * @property {string} id
 * @property {string} type
 * @property {string} name
 * @property {string} [description]
 * @property {string[]} [aliases]
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('normalize-graph');

const KNOWN_ID_RE = /^[a-z][a-z0-9-]*:[A-Za-z0-9._-]+$/;
const MAX_SLUG_LENGTH = 64;

const VALID_EDGE_TYPES = new Set(['calls', 'sends', 'reads', 'writes', 'depends-on']);
const VALID_PROVENANCE = new Set(['known', 'discovered', 'inferred']);

/**
 * Normalize a graph object.
 *
 * @param {{nodes: object[], edges: object[]}} graph
 * @param {object} [options]
 * @param {string} [options.activity='reflect'] - Producing activity: 'reflect', 'synthesize', or 'mental-model'.
 * @param {Map<string, EntityCatalogEntry>} [options.knownCatalog] - Known entity catalog for conflict resolution, validation warnings, and endpoint completion.
 * @returns {{nodes: object[], edges: object[]}}
 */
export function normalizeGraph(graph, { activity = 'reflect', knownCatalog = new Map() } = {}) {
  if (!graph || typeof graph !== 'object') {
    return { nodes: [], edges: [] };
  }

  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];

  const nodeById = new Map();

  for (const n of rawNodes) {
    if (!n || typeof n !== 'object') continue;

    let id = typeof n.id === 'string' ? n.id.trim() : null;
    if (!id) {
      logger.warn('Skipping node without id', { node: n });
      continue;
    }

    let name = typeof n.name === 'string' && n.name.trim().length > 0 ? n.name.trim() : null;

    if (!name) {
      logger.warn('Node missing name', { id });
      name = id;
    }

    if (nodeById.has(id)) {
      const existing = nodeById.get(id);
      // Known catalog wins for name conflicts.
      const knownEntry = knownCatalog.get(id);
      if (knownEntry && name !== existing.name) {
        logger.warn('Known catalog name overrides model name', { id, oldName: existing.name, newName: name });
      } else if (existing.name === id && name !== id) {
        existing.name = name;
      }
      continue;
    }

    if (KNOWN_ID_RE.test(id) && !knownCatalog.has(id)) {
      // Only warn when the catalog explicitly does not contain the id; do not
      // treat valid data-driven type prefixes (e.g. "System:Singleview") as
      // suspicious just because the regex is lowercase-only.
      logger.warn('Node id uses known format but is not in catalog', { id });
    }

    // Slug-normalize only plain discovered slugs, preserving explicit type ids
    // and legacy `found:` ids for backward compatibility.
    if (!id.includes(':')) {
      id = normalizeSlug(id);
    }

    nodeById.set(id, {
      id,
      name: name || id,
      label: n.label,
      type: n.type,
      provenance: n.provenance,
      source: n.source,
    });
  }

  // Collapse discovered nodes that share the same name but have different slugs.
  // This prevents the model from emitting both "found:payment-gateway" and
  // "payment-gateway" as separate nodes.
  const discoveredNameCollisions = new Map();
  for (const [id, node] of nodeById) {
    if (node.provenance !== 'discovered' && !id.startsWith('found:')) continue;
    const key = node.name.toLowerCase().replace(/\W+/g, '-');
    if (discoveredNameCollisions.has(key)) {
      const firstId = discoveredNameCollisions.get(key);
      if (firstId !== id) {
        logger.warn('Discovered nodes with same name but different ids; collapsing', { id, firstId, name: node.name });
        nodeById.delete(id);
      }
    } else {
      discoveredNameCollisions.set(key, id);
    }
  }

  const edgeByKey = new Map();

  for (const e of rawEdges) {
    if (!e || typeof e !== 'object') continue;

    let from = normalizeEdgeEndpoint(e.from);
    let to = normalizeEdgeEndpoint(e.to);
    if (!from || !to) {
      logger.warn('Skipping edge with missing endpoint', { edge: e });
      continue;
    }

    // Complete missing known endpoint nodes that the model omitted from the nodes array.
    // This is explicit contract enforcement, not a silent fallback: we warn every time.
    for (const [id, role] of [[from, 'from'], [to, 'to']]) {
      if (!nodeById.has(id) && knownCatalog.has(id)) {
        const entity = knownCatalog.get(id);
        nodeById.set(id, {
          id,
          name: entity?.name || id,
          label: entity?.name || id,
          type: entity?.type,
          provenance: 'known',
          source: 'known',
        });
        logger.warn('Completed missing known endpoint node from catalog', { id, role, edge: e });
      }
    }

    if (!nodeById.has(from) || !nodeById.has(to)) {
      logger.warn('Skipping edge with unresolved endpoint', { from, to, edge: e });
      continue;
    }

    const type = typeof e.type === 'string' ? e.type.trim().toLowerCase() : null;
    if (!type) {
      logger.warn('Skipping edge without type', { edge: e });
      continue;
    }
    if (!VALID_EDGE_TYPES.has(type)) {
      logger.warn('Unknown edge type; keeping but flagged', { type });
    }

    const label = typeof e.label === 'string' ? e.label.trim() : '';
    const detail = typeof e.detail === 'string' ? e.detail.trim() : '';

    const key = `${from}|${to}|${type}`;
    const provenance = deriveProvenance(from, to, activity, nodeById);

    if (edgeByKey.has(key)) {
      const existing = edgeByKey.get(key);
      existing.label = mergeField(existing.label, label);
      existing.detail = mergeField(existing.detail, detail);
      existing.provenance = mergeProvenance(existing.provenance, provenance);
    } else {
      edgeByKey.set(key, { from, to, type, provenance, label, detail });
    }
  }

  return {
    nodes: Array.from(nodeById.values()),
    edges: Array.from(edgeByKey.values()),
  };
}

function normalizeEdgeEndpoint(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id) return null;
  return id;
}

function deriveProvenance(from, to, activity, nodeById) {
  const fromNode = nodeById.get(from);
  const toNode = nodeById.get(to);
  if (from.startsWith('found:') || to.startsWith('found:')) return 'discovered';
  if (fromNode?.provenance === 'discovered' || toNode?.provenance === 'discovered') return 'discovered';
  if (activity === 'synthesize') return 'inferred';
  return 'known';
}

function mergeField(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing === incoming) return existing;
  return [existing, incoming].join('; ');
}

function mergeProvenance(a, b) {
  if (a === 'known' || b === 'known') return 'known';
  if (a === 'discovered' || b === 'discovered') return 'discovered';
  return a || b || 'known';
}

export function normalizeSlug(slug, fallbackName = '') {
  const base = (slug || fallbackName || 'unknown').trim();
  let normalized = base
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized === '') {
    normalized = 'unknown';
  }
  return normalized.slice(0, MAX_SLUG_LENGTH);
}

export { VALID_EDGE_TYPES, VALID_PROVENANCE, KNOWN_ID_RE };
