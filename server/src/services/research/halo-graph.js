import { createLogger } from '../../utils/logger.js';
import { getEntityGraph } from '../hindsight/index.js';
import { listEntitiesWithType } from '../../db/crud/entities.js';
import { mapTypeName } from './entity-seed.js';
import { pairKey } from './entities.js';

const logger = createLogger('research-halo');

/**
 * Fetch and normalise the full Hindsight entity graph for a bank.
 *
 * This is the global skeleton: no focus filtering, no halo BFS. Every node
 * returned by Hindsight is mapped to an architxt entity when possible and
 * given a normalised source/depth/prominence.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} db
 * @param {Object} options
 * @returns {Promise<{success: boolean, nodes?: GraphNode[], edges?: GraphEdge[], error?: string, code?: string}>}
 */
export async function normalizeHindsightGraph(serverId, bankId, db, options = {}) {
  if (!serverId || !bankId) return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };

  const graphResult = await getEntityGraph(serverId, bankId, {
    limit: options.limit ?? 1000,
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
    const typeName = parts[0];
    const arch = findArchitxtEntity(entityId, data.label);

    const label = arch ? arch.ent_name : data.label;
    const type = arch ? arch.et_type_name : typeName;
    const category = mapTypeName(type);
    const resolvedId = arch ? arch.ent_entity_id : entityId;

    hindsightIdToEntityId.set(data.id, resolvedId);
    nodeDataByHindsightId.set(data.id, {
      id: resolvedId,
      label,
      type,
      category,
      hindsight_id: data.id,
      mention_count: typeof data.mentionCount === 'number' ? data.mentionCount : 1,
      source: 'hindsight',
      depth: 0,
    });
  }

  const edgeDataByPair = new Map();

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
      source: sourceEntityId,
      target: targetEntityId,
      label: linkType,
      relationship_type: linkType,
      weight: typeof data.weight === 'number' ? data.weight : 1,
      link_type: linkType,
      edge_source: 'co_occurrence',
    });
  }

  // Keep only nodes that participate in at least one edge to avoid isolated noise.
  const connectedHindsightIds = new Set();
  for (const e of edgeDataByPair.values()) {
    const s = [...hindsightIdToEntityId.entries()].find(([, v]) => v === e.source)?.[0];
    const t = [...hindsightIdToEntityId.entries()].find(([, v]) => v === e.target)?.[0];
    if (s) connectedHindsightIds.add(s);
    if (t) connectedHindsightIds.add(t);
  }

  let nodes = [];
  for (const [hindsightId, data] of nodeDataByHindsightId) {
    if (connectedHindsightIds.size === 0 || connectedHindsightIds.has(hindsightId)) {
      nodes.push(data);
    }
  }

  computeProminence(nodes);

  const edges = [];
  let edgeIdx = 0;
  for (const edgeData of edgeDataByPair.values()) {
    edges.push({ id: `edge-${edgeIdx++}`, ...edgeData });
  }

  return { success: true, nodes, edges };
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

function computeProminence(nodes) {
  const counts = nodes.map((n) => n.mention_count).filter((c) => c > 0);
  const minCount = counts.length ? Math.min(...counts) : 1;
  const maxCount = counts.length ? Math.max(...counts) : 1;
  const logMin = Math.log10(Math.max(1, minCount));
  const logMax = Math.log10(Math.max(1, maxCount));
  const logRange = logMax - logMin || 1;

  for (const n of nodes) {
    const logCount = Math.log10(Math.max(1, n.mention_count));
    n.prominence = Math.max(0, Math.min(1, (logCount - logMin) / logRange));
  }
}
