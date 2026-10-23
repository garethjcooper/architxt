import { listEntitiesForDetection } from '../db/crud/entities.js';
import { scanForEntityMatches } from '../utils/entity-matcher.js';
import { buildTag } from '@architxt/entity-matcher';
import { getActiveFormat } from '../entity-tag-format.js';
import { createLogger } from '../utils/logger.js';
import {
  resolveEntitiesFromText,
  groupResolvedEntities,
} from './agent/entity-resolver.js';

const logger = createLogger('graph-entity-resolver');

function normalizeText(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

function buildCanonicalReference(name, entityId, typeName) {
  const formatKey = getActiveFormat().key;
  return buildTag(name, name, entityId, typeName, formatKey);
}

function buildCanonicalId(entityId, typeName) {
  if (!typeName) return entityId;
  return `${typeName}:${entityId}`;
}

function setAlias(aliases, rawKey, canonicalId) {
  if (rawKey == null) return;
  const key = normalizeText(rawKey);
  if (!key) return;
  aliases.set(key, canonicalId);
}

/**
 * Resolve the nodes of an input graph to canonical catalog entities.
 *
 * Each node is tried in order:
 *   1. Exact canonical entity_id match (case-insensitive)
 *   2. Name/alias match via the entity matcher over the node's id + name
 *
 * The result is deduplicated by canonical entity_id, so two raw node ids that
 * point to the same entity (e.g. "sparkcrm" and "a-com:COM-024") collapse to a
 * single row.
 *
 * @param {Object} db
 * @param {Array<{id: string, name?: string}>} nodes
 * @returns {Promise<{
 *   success: boolean,
 *   nodes?: Array<{
 *     id: number,
 *     db_id: number,
 *     entity_id: string,
 *     canonical_id: string,
 *     name: string,
 *     type_name: string,
 *     canonical_reference: string,
 *     matched_text: string,
 *     from_tag: boolean,
 *   }>,
 *   aliases?: Record<string, string>,
 *   error?: string,
 *   code?: string,
 * }>}
 */
export async function resolveGraphEntities(db, nodes) {
  if (!Array.isArray(nodes)) {
    return { success: false, error: 'nodes must be an array', code: 'VALIDATION_ERROR' };
  }

  const entitiesResult = await listEntitiesForDetection(db);
  if (!entitiesResult.success) {
    return { success: false, error: entitiesResult.error, code: entitiesResult.code || 'DATABASE_ERROR' };
  }

  const entities = entitiesResult.data || [];
  if (entities.length === 0) {
    return { success: true, nodes: [], aliases: {} };
  }

  const resolvedByEntityId = new Map();
  const aliases = new Map();

  for (const node of nodes) {
    if (!node || typeof node.id !== 'string') continue;
    const rawId = node.id.trim();
    if (!rawId) continue;

    const text = [rawId, node.name].filter(Boolean).join(' ');
    const matches = scanForEntityMatches(entities, text);
    if (matches.length === 0) {
      logger.debug('Could not resolve graph node to catalog entity', { rawId, name: node.name });
      continue;
    }

    const match = matches[0];
    const entity = entities.find((e) => e.entity_id === match.entity_id);
    if (!entity) continue;

    const canonicalId = buildCanonicalId(entity.entity_id, entity.type_name);
    const matchedText = match.matchedText;

    setAlias(aliases, rawId, canonicalId);
    setAlias(aliases, node.name, canonicalId);
    setAlias(aliases, matchedText, canonicalId);
    setAlias(aliases, entity.entity_id, canonicalId);
    setAlias(aliases, entity.name, canonicalId);
    for (const alias of entity.aliases || []) {
      setAlias(aliases, alias, canonicalId);
    }

    if (!resolvedByEntityId.has(entity.entity_id)) {
      resolvedByEntityId.set(entity.entity_id, {
        id: entity.id,
        db_id: entity.id,
        entity_id: entity.entity_id,
        canonical_id: canonicalId,
        name: entity.name,
        type_name: entity.type_name,
        canonical_reference: buildCanonicalReference(entity.name, entity.entity_id, entity.type_name),
        matched_text: matchedText,
        from_tag: false,
      });
    }
  }

  return {
    success: true,
    nodes: Array.from(resolvedByEntityId.values()),
    aliases: Object.fromEntries(aliases),
  };
}

/**
 * Resolve catalog entities mentioned in arbitrary text and return them in the
 * same canonical node shape used by graph resolution.
 *
 * This lets tables, diagrams, and narratives share the same node-resolution
 * path as graph sections. Edges are not expected from plain text.
 *
 * @param {Object} db
 * @param {string} text
 * @returns {Promise<{
 *   success: boolean,
 *   nodes?: Array<{
 *     id: number,
 *     db_id: number,
 *     entity_id: string,
 *     canonical_id: string,
 *     name: string,
 *     type_name: string,
 *     canonical_reference: string,
 *     matched_text: string,
 *     from_tag: boolean,
 *   }>,
 *   aliases?: Record<string, string>,
 *   error?: string,
 *   code?: string,
 * }>}
 */
export async function resolveTextEntitiesToGraphNodes(db, text) {
  const result = await resolveEntitiesFromText(db, text);
  if (!result.success) {
    return { success: false, error: result.error, code: result.code };
  }

  const grouped = groupResolvedEntities(result.data);
  const nodes = grouped.map((entity) => {
    const canonicalId = buildCanonicalId(entity.entity_id, entity.type_name);
    return {
      id: entity.db_id,
      db_id: entity.db_id,
      entity_id: entity.entity_id,
      canonical_id: canonicalId,
      name: entity.name,
      type_name: entity.type_name,
      canonical_reference: buildCanonicalReference(entity.name, entity.entity_id, entity.type_name),
      matched_text: entity.matched_text,
      from_tag: entity.from_tag,
    };
  });

  return { success: true, nodes, aliases: {} };
}

/**
 * Rewrite edge endpoints using a raw-id → canonical entity_id alias map.
 *
 * Preserves edges whose endpoints cannot be resolved so the edge resolver can
 * report them as unresolved.
 *
 * @param {Array<{from: string, to: string}>} edges
 * @param {Record<string, string>} aliases
 * @returns {Array<{from: string, to: string}>}
 */
export function rewriteEdgeEndpoints(edges, aliases) {
  if (!Array.isArray(edges)) return [];

  const lookup = new Map();
  for (const [key, value] of Object.entries(aliases || {})) {
    const normalized = normalizeText(key);
    if (normalized && !lookup.has(normalized)) {
      lookup.set(normalized, value);
    }
  }

  return edges.map((edge) => {
    if (!edge || typeof edge !== 'object') return edge;
    const from = typeof edge.from === 'string' ? edge.from.trim() : '';
    const to = typeof edge.to === 'string' ? edge.to.trim() : '';
    return {
      ...edge,
      from: from ? (lookup.get(normalizeText(from)) || from) : from,
      to: to ? (lookup.get(normalizeText(to)) || to) : to,
    };
  });
}

export default {
  resolveGraphEntities,
  resolveTextEntitiesToGraphNodes,
  rewriteEdgeEndpoints,
};
