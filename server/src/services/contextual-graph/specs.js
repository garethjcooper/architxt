import { createLogger } from '../../utils/logger.js';
import { getNode, listNodes, listEdges } from '../../db/crud/contextual-graph.js';
import {
  deriveEntitySummaryModel,
  deriveEntityCapabilitiesModel,
  deriveEdgeContextModel,
  deriveDiscoverContextModel,
} from './template-models.js';

const logger = createLogger('contextual-graph-specs');

const ROLE_PREFIXES = [
  { role: 'sys_entity_summary', prefix: 'entity-summary-' },
  { role: 'sys_entity_capabilities', prefix: 'entity-capabilities-' },
  { role: 'sys_edge_context', prefix: 'edge-ctx-' },
  { role: 'sys_discovery_context', prefix: 'discover-' },
];

/**
 * Infer the contextual-graph role for an ext_id based on its prefix.
 * @param {string} extId
 * @returns {string|null}
 */
export function inferRole(extId) {
  for (const { role, prefix } of ROLE_PREFIXES) {
    if (extId?.startsWith(prefix)) return role;
  }
  return null;
}

function parseIdAfterPrefix(extId, prefix) {
  if (!extId?.startsWith(prefix)) return null;
  return extId.slice(prefix.length);
}

function parseNodeIdFromExtId(extId, role) {
  const { prefix } = ROLE_PREFIXES.find((r) => r.role === role) || {};
  return parseIdAfterPrefix(extId, prefix);
}

/**
 * Parse the pair from an edge-ctx ext_id. The canonical ext_id format is
 * `edge-ctx-{source}|{target}` and uses the raw endpoint IDs (not sorted),
 * matching the system-template definition in ensure-schema.js.
 *
 * @param {string} extId
 * @returns {{sourceId: string, targetId: string}|null}
 */
function parseEdgePairFromExtId(extId) {
  const pairPart = parseIdAfterPrefix(extId, 'edge-ctx-');
  if (!pairPart) return null;
  const parts = pairPart.split('|');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { sourceId: parts[0], targetId: parts[1] };
}

/**
 * Derive a mental-model spec for a single model_ref attached to the working graph.
 * This is the single source of truth used by add-context, sync-config, and
 * refresh. It rebuilds the spec from the current working-graph node/edge and the
 * current system template, so callers only compare against Hindsight.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} extId
 * @returns {Promise<object|null>} spec or null if the backing node/edge is gone
 */
export async function deriveSpecForExtId(db, serverId, bankId, extId) {
  const role = inferRole(extId);
  if (!role) return null;

  if (role === 'sys_entity_summary') {
    const nodeId = parseNodeIdFromExtId(extId, role);
    if (!nodeId) return null;
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) {
      logger.warn('Dropping stale entity-summary ref; node not found', { serverId, bankId, extId });
      return null;
    }
    return deriveEntitySummaryModel(db, {
      id: nodeId,
      displayName: node.cgn_properties?.display_name || nodeId,
    });
  }

  if (role === 'sys_entity_capabilities') {
    const nodeId = parseNodeIdFromExtId(extId, role);
    if (!nodeId) return null;
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) {
      logger.warn('Dropping stale entity-capabilities ref; node not found', { serverId, bankId, extId });
      return null;
    }
    return deriveEntityCapabilitiesModel(db, {
      id: nodeId,
      displayName: node.cgn_properties?.display_name || nodeId,
    });
  }

  if (role === 'sys_edge_context') {
    const pair = parseEdgePairFromExtId(extId);
    if (!pair) {
      logger.warn('Malformed edge-ctx ext_id; cannot derive spec', { serverId, bankId, extId });
      return null;
    }
    const nodes = listNodes(db, serverId, bankId, { limit: 10000 })?.data || [];
    const sourceNode = nodes.find((n) => n.cgn_id === pair.sourceId);
    const targetNode = nodes.find((n) => n.cgn_id === pair.targetId);
    if (!sourceNode || !targetNode) {
      logger.warn('Dropping stale edge-ctx ref; endpoint missing', { serverId, bankId, extId, sourceId: pair.sourceId, targetId: pair.targetId });
      return null;
    }
    return deriveEdgeContextModel(db, {
      id: pair.sourceId,
      displayName: sourceNode.cgn_properties?.display_name || pair.sourceId,
    }, {
      id: pair.targetId,
      displayName: targetNode.cgn_properties?.display_name || pair.targetId,
    });
  }

  if (role === 'sys_discovery_context') {
    const seedId = parseNodeIdFromExtId(extId, role);
    if (!seedId) return null;
    const seedNode = getNode(db, serverId, bankId, seedId)?.data;
    if (!seedNode) {
      logger.warn('Dropping stale discover ref; seed node not found', { serverId, bankId, extId });
      return null;
    }
    return deriveDiscoverContextModel(db, {
      id: seedId,
      displayName: seedNode.cgn_properties?.display_name || seedId,
    }, []);
  }

  return null;
}

/**
 * Derive specs for every contextual-graph mental model currently referenced by
 * the working graph.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Map<string, object>} refsByExtId - result of extractModelRefsFromDb
 * @returns {Promise<Array<{extId: string, spec: object}>>}
 */
export async function deriveSpecsForRefs(db, serverId, bankId, refsByExtId) {
  const results = [];
  for (const [extId] of refsByExtId) {
    const spec = await deriveSpecForExtId(db, serverId, bankId, extId);
    if (spec) results.push({ extId, spec });
  }
  return results;
}
