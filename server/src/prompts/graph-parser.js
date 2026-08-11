/**
 * Shared graph parsing utilities.
 *
 * Provides low-level JSON extraction and node/edge normalization helpers that
 * do not enforce a specific extraction strategy. Heading-aware parsing lives
 * in `parse-graph-response.js`; this module is intentionally kept as a helper
 * library for callers that need defensive normalization only.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('graph-parser');

const CODE_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/g;

/**
 * Try to parse a string as JSON, stripping Markdown code fences and falling back
 * to a loose bracket match.
 * @param {string} text
 * @returns {object|null}
 */
export function parseJsonString(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenceFree = trimmed.replace(CODE_FENCE_RE, '$1').trim();
  const candidates = [fenceFree, trimmed];
  const looseMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (looseMatch && !candidates.includes(looseMatch[1])) {
    candidates.push(looseMatch[1]);
  }
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // continue
    }
  }
  return null;
}

function simpleHash(input) {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function edgeHash(edge) {
  const payload = [
    edge.from,
    edge.to,
    edge.type || '',
    edge.label || '',
    edge.detail || '',
    (edge.source_fact_ids || []).join(','),
  ].join('|');
  return simpleHash(payload);
}

export function normalizeNode(n) {
  if (!n || typeof n !== 'object') return null;
  const id = typeof n.id === 'string' && n.id.length > 0 ? n.id : null;
  if (!id) return null;
  const name = typeof n.name === 'string' && n.name.length > 0 ? n.name : null;
  if (!name) {
    logger.warn('Node missing name', { id });
    return null;
  }
  return {
    id,
    name,
    label: typeof n.label === 'string' ? n.label : undefined,
    type: typeof n.type === 'string' ? n.type : undefined,
  };
}

export function normalizeEdge(e) {
  if (!e || typeof e !== 'object') return null;
  const from = typeof e.from === 'string' && e.from.length > 0 ? e.from : null;
  const to = typeof e.to === 'string' && e.to.length > 0 ? e.to : null;
  const type = typeof e.type === 'string' && e.type.length > 0 ? e.type : null;
  if (!from || !to || !type) return null;
  const label = typeof e.label === 'string' && e.label.length > 0 ? e.label : undefined;
  const detail = typeof e.detail === 'string' && e.detail.length > 0 ? e.detail : undefined;
  const source_fact_ids = Array.isArray(e.source_fact_ids) ? e.source_fact_ids : undefined;
  const edge = {
    from,
    to,
    type,
    label,
    detail,
    source_fact_ids,
  };
  edge.id = `${from}|${to}|${type}|${label || ''}|${edgeHash(edge)}`;
  return edge;
}

/**
 * Recursively walk a parsed object/string and return the first graph-shaped
 * payload found. This is a defensive, low-level helper for callers that may
 * receive wrapped objects (e.g. `{ answer: "..." }`) rather than the standard
 * contextual JSON envelope. Envelope-aware extraction should use
 * `parse-graph-response.js` instead.
 *
 * @param {string|object|null} content
 * @returns {{ nodes: object[], edges: object[] } | null}
 */
export function extractGraph(content) {
  if (!content) return null;
  let parsed = content;
  if (typeof content === 'string') {
    parsed = parseJsonString(content);
    if (!parsed) return null;
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const candidates = [parsed];
  const seen = new WeakSet();
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);

    candidates.push(v);
    for (const child of Object.values(v)) {
      if (typeof child === 'string') {
        const p = parseJsonString(child);
        if (p) walk(p);
      } else {
        walk(child);
      }
    }
  }
  walk(parsed);

  for (const candidate of candidates) {
    const nodes = Array.isArray(candidate.nodes)
      ? candidate.nodes.map(normalizeNode).filter(Boolean)
      : [];
    const edges = Array.isArray(candidate.edges)
      ? candidate.edges.map(normalizeEdge).filter(Boolean)
      : [];
    if (nodes.length > 0 || edges.length > 0) {
      return { nodes, edges };
    }
  }
  return null;
}

/**
 * Check whether a mental model's content mentions any of the given entity IDs.
 * @param {string|object} content
 * @param {string[]} entityIds
 * @returns {boolean}
 */
export function modelMatchesEntities(content, entityIds) {
  if (!Array.isArray(entityIds) || entityIds.length === 0) return true;
  const ids = new Set(entityIds);
  if (!content) return false;
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  for (const id of ids) {
    if (text.includes(id)) return true;
  }
  return false;
}
