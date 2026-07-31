import { createLogger } from '../../utils/logger.js';
import { getEntityGraph, listBankEntities } from '../hindsight/index.js';
import { listEntitiesWithType } from '../../db/crud/entities.js';
import { pairKey } from './entities.js';

const logger = createLogger('research-halo');

/**
 * Fetch and normalise the full Hindsight entity graph for a bank.
 *
 * This is the global skeleton: no focus filtering, no halo BFS. Every node
 * returned by Hindsight is mapped to an architxt entity when possible and
 * given a normalised source.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} db
 * @param {Object} options
 * @returns {Promise<{success: boolean, nodes?: GraphNode[], edges?: GraphEdge[], error?: string, code?: string}>}
 */
export async function normalizeHindsightGraph(serverId, bankId, db, options = {}, fetchGraph = getEntityGraph) {
  if (!serverId || !bankId) return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };

  // Hindsight's /entities/graph endpoint does not honour the `limit` query
  // parameter; it returns every entity for the bank. Passing `limit` only
  // produces a misleading URL and warning noise, so we omit it here.
  const graphResult = await fetchGraph(serverId, bankId, {
    min_count: options.min_count,
  });
  if (!graphResult.success || !graphResult.data) {
    logger.warn('Hindsight entity graph unavailable', { error: graphResult.error });
    return { success: false, error: graphResult.error, code: graphResult.code || 'HINDSIGHT_ENTITY_GRAPH_FAILED' };
  }

  const rawNodes = Array.isArray(graphResult.data.nodes) ? graphResult.data.nodes : [];
  const rawEdges = Array.isArray(graphResult.data.edges) ? graphResult.data.edges : [];

  if (rawNodes.length === 0) {
    return { success: true, nodes: [], edges: [] };
  }

  const { findArchitxtEntity } = await buildArchitxtLookups(db);

  const hindsightIdToEntityId = new Map();
  const nodeDataByHindsightId = new Map();

  for (const n of rawNodes) {
    const data = n?.data;
    if (!data || !data.id || !data.label) continue;
    const parts = String(data.label).split(':');
    if (parts.length < 2) continue;
    const entityId = parts.slice(1).join(':');
    const arch = findArchitxtEntity(entityId, data.label);

    // Only surface Hindsight graph nodes that resolve to a canonical Architxt
    // entity. Hindsight-only labels should not appear as addable entities in the
    // Explore toolbox.
    if (!arch) continue;

    const label = arch.ent_name;
    const type = arch.et_type_name;
    const resolvedId = arch.ent_entity_id;

    hindsightIdToEntityId.set(data.id, resolvedId);
    nodeDataByHindsightId.set(data.id, {
      id: resolvedId,
      name: label,
      label,
      type,
      source: 'hindsight',
    });
  }

  const edgeDataByPair = new Map();
  let edgeIdx = 0;

  for (const e of rawEdges) {
    const data = e?.data;
    if (!data || !data.source || !data.target) continue;
    const sourceEntityId = hindsightIdToEntityId.get(data.source);
    const targetEntityId = hindsightIdToEntityId.get(data.target);
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId) continue;

    const key = pairKey(sourceEntityId, targetEntityId);
    if (edgeDataByPair.has(key)) continue;
    const linkType = typeof data.linkType === 'string' ? data.linkType : 'cooccurrence';
    edgeDataByPair.set(key, {
      id: `edge-${edgeIdx++}`,
      from: sourceEntityId,
      to: targetEntityId,
      label: linkType,
      type: linkType,
      weight: typeof data.weight === 'number' ? data.weight : 1,
    });
  }

  // Keep only nodes that participate in at least one edge to avoid isolated noise.
  const connectedHindsightIds = new Set();
  for (const e of edgeDataByPair.values()) {
    const s = [...hindsightIdToEntityId.entries()].find(([, v]) => v === e.from)?.[0];
    const t = [...hindsightIdToEntityId.entries()].find(([, v]) => v === e.to)?.[0];
    if (s) connectedHindsightIds.add(s);
    if (t) connectedHindsightIds.add(t);
  }

  const nodes = [];
  for (const [hindsightId, data] of nodeDataByHindsightId) {
    if (connectedHindsightIds.has(hindsightId)) {
      nodes.push(data);
    }
  }

  const edges = Array.from(edgeDataByPair.values());

  return { success: true, nodes, edges };
}

/**
 * Fetch and normalise the full Hindsight entity list for a bank.
 *
 * Unlike `normalizeHindsightGraph`, this uses the paginated `/entities` endpoint,
 * so it returns every bank entity regardless of whether it has co-occurrence
 * edges. Each item is mapped to a canonical architxt entity when possible.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} db
 * @param {Object} options
 * @returns {Promise<{success: boolean, nodes?: GraphNode[], edges?: GraphEdge[], error?: string, code?: string}>}
 */
export async function normalizeHindsightEntities(serverId, bankId, db, options = {}, fetchEntities = listBankEntities) {
  if (!serverId || !bankId) return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };

  const entitiesResult = await fetchEntities(serverId, bankId, {
    limit: options.limit,
  });
  if (!entitiesResult.success || !entitiesResult.data) {
    logger.warn('Hindsight entity list unavailable', { error: entitiesResult.error });
    return { success: false, error: entitiesResult.error, code: entitiesResult.code || 'HINDSIGHT_LIST_ENTITIES_FAILED' };
  }

  const rawItems = Array.isArray(entitiesResult.data.items) ? entitiesResult.data.items : [];
  if (rawItems.length === 0) {
    return { success: true, nodes: [], edges: [] };
  }

  const { findArchitxtEntity } = await buildArchitxtLookups(db);

  const nodes = [];
  const seenIds = new Set();

  for (const item of rawItems) {
    const canonicalName = item?.canonical_name;
    const hindsightId = item?.id;
    if (!canonicalName || !hindsightId) continue;

    const parts = String(canonicalName).split(':');
    const entityId = parts.length >= 2 ? parts.slice(1).join(':') : canonicalName;
    const arch = findArchitxtEntity(entityId, canonicalName);

    // Only surface Hindsight entities that resolve to a canonical Architxt entity.
    if (!arch) continue;

    const resolvedId = arch.ent_entity_id;
    if (seenIds.has(resolvedId)) continue;
    seenIds.add(resolvedId);

    nodes.push({
      id: resolvedId,
      name: arch.ent_name,
      label: arch.ent_name,
      type: arch.et_type_name,
      source: 'hindsight',
      mention_count: typeof item.mention_count === 'number' ? item.mention_count : undefined,
    });
  }

  return { success: true, nodes, edges: [] };
}

async function buildArchitxtLookups(db) {
  const entityListResult = await listEntitiesWithType(db);
  const architxtEntities = entityListResult.success ? entityListResult.data : [];

  const byEntityId = new Map();
  const byName = new Map();
  const byAlias = new Map();

  for (const e of architxtEntities) {
    byEntityId.set(e.ent_entity_id, e);
    byName.set(String(e.ent_name).toLowerCase(), e);
    for (const alias of e.ent_aliases || []) {
      byAlias.set(String(alias).toLowerCase(), e);
    }
  }

  function findArchitxtEntity(rawId, rawLabel) {
    const byId = rawId ? byEntityId.get(rawId) : undefined;
    if (byId) return byId;
    const namePart = rawLabel ? String(rawLabel).split(':').pop() : rawId;
    if (!namePart) return undefined;
    const key = namePart.toLowerCase();
    return byName.get(key) || byAlias.get(key);
  }

  return { findArchitxtEntity };
}
