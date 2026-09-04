import { createLogger } from '../../utils/logger.js';
import { getNode, listNodes, listEdges } from '../../db/crud/contextual-graph.js';
import {
  deriveEntitySummaryModel,
  deriveEntityCapabilitiesModel,
  deriveEdgeContextModel,
  deriveDiscoverContextModel,
  CONTEXTUAL_GRAPH_ROLES,
} from './template-models.js';

const logger = createLogger('contextual-graph-specs');

const KNOWN_ROLES = new Set([
  CONTEXTUAL_GRAPH_ROLES.entitySummary,
  CONTEXTUAL_GRAPH_ROLES.entityCapabilities,
  CONTEXTUAL_GRAPH_ROLES.edge,
  CONTEXTUAL_GRAPH_ROLES.discover,
]);

function isKnownRole(role) {
  return typeof role === 'string' && KNOWN_ROLES.has(role);
}

function nodeIsGroundedOrCanonical(labels) {
  return labels?.includes('grounded') || labels?.includes('canonical');
}

function nodeIsCandidate(labels) {
  return labels?.includes('candidate');
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
 * @param {object} ref - model_ref entry with explicit role and scope
 * @returns {Promise<object|null>} spec or null if the backing node/edge is gone
 */
export async function deriveSpecForRef(db, serverId, bankId, ref) {
  if (!ref?.role || !isKnownRole(ref.role)) {
    logger.warn('Cannot derive spec for ref with missing/unknown role', { ref });
    return null;
  }

  const scope = ref.scope || {};

  if (ref.role === CONTEXTUAL_GRAPH_ROLES.entitySummary) {
    const nodeId = scope.node_id;
    if (!nodeId) {
      logger.warn('Missing node_id in entity-summary ref scope', { ref });
      return null;
    }
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) {
      logger.warn('Dropping stale entity-summary ref; node not found', { serverId, bankId, ref });
      return null;
    }
    if (nodeIsCandidate(node.cgn_labels)) {
      logger.warn('Dropping entity-summary ref for candidate node; promotion required', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsGroundedOrCanonical(node.cgn_labels)) {
      logger.warn('Dropping entity-summary ref for non-grounded/non-canonical node', { serverId, bankId, ref, labels: node.cgn_labels });
      return null;
    }
    return deriveEntitySummaryModel(db, {
      id: nodeId,
      displayName: node.cgn_properties?.display_name || nodeId,
    });
  }

  if (ref.role === CONTEXTUAL_GRAPH_ROLES.entityCapabilities) {
    const nodeId = scope.node_id;
    if (!nodeId) {
      logger.warn('Missing node_id in entity-capabilities ref scope', { ref });
      return null;
    }
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) {
      logger.warn('Dropping stale entity-capabilities ref; node not found', { serverId, bankId, ref });
      return null;
    }
    if (nodeIsCandidate(node.cgn_labels)) {
      logger.warn('Dropping entity-capabilities ref for candidate node; promotion required', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsGroundedOrCanonical(node.cgn_labels)) {
      logger.warn('Dropping entity-capabilities ref for non-grounded/non-canonical node', { serverId, bankId, ref, labels: node.cgn_labels });
      return null;
    }
    return deriveEntityCapabilitiesModel(db, {
      id: nodeId,
      displayName: node.cgn_properties?.display_name || nodeId,
    });
  }

  if (ref.role === CONTEXTUAL_GRAPH_ROLES.edge) {
    const sourceId = scope.source_id;
    const targetId = scope.target_id;
    if (!sourceId || !targetId) {
      logger.warn('Missing source_id/target_id in edge-ctx ref scope', { ref });
      return null;
    }

    const nodes = listNodes(db, serverId, bankId, { limit: 10000 })?.data || [];
    const sourceNode = nodes.find((n) => n.cgn_id === sourceId);
    const targetNode = nodes.find((n) => n.cgn_id === targetId);
    if (!sourceNode || !targetNode) {
      logger.warn('Dropping stale edge-ctx ref; endpoint missing', { serverId, bankId, ref, sourceId, targetId });
      return null;
    }
    if (nodeIsCandidate(sourceNode.cgn_labels) || nodeIsCandidate(targetNode.cgn_labels)) {
      logger.warn('Dropping edge-ctx ref because an endpoint is a candidate; promotion required', { serverId, bankId, ref });
      return null;
    }

    const edges = listEdges(db, serverId, bankId, { limit: 10000 })?.data || [];
    const pairEdges = edges.filter(
      (e) =>
        (e.cge_source_id === sourceId &&
          e.cge_target_id === targetId) ||
        (e.cge_source_id === targetId &&
          e.cge_target_id === sourceId),
    );
    const groundedPairEdges = pairEdges.filter((e) =>
      e.cge_properties?.labels?.includes('grounded'),
    );
    if (groundedPairEdges.length === 0) {
      logger.warn('Dropping edge-ctx ref because no grounded edge exists between endpoints', { serverId, bankId, ref });
      return null;
    }

    return deriveEdgeContextModel(db, {
      id: sourceId,
      displayName: sourceNode.cgn_properties?.display_name || sourceId,
    }, {
      id: targetId,
      displayName: targetNode.cgn_properties?.display_name || targetId,
    });
  }

  if (ref.role === CONTEXTUAL_GRAPH_ROLES.discover) {
    const seedId = scope.seed_id;
    if (!seedId) {
      logger.warn('Missing seed_id in discover ref scope', { ref });
      return null;
    }
    const seedNode = getNode(db, serverId, bankId, seedId)?.data;
    if (!seedNode) {
      logger.warn('Dropping stale discover ref; seed node not found', { serverId, bankId, ref });
      return null;
    }
    if (nodeIsCandidate(seedNode.cgn_labels)) {
      logger.warn('Dropping discover ref for candidate seed; promotion required', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsGroundedOrCanonical(seedNode.cgn_labels)) {
      logger.warn('Dropping discover ref for non-grounded/non-canonical seed', { serverId, bankId, ref, labels: seedNode.cgn_labels });
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
 * @param {Map<string, {type: 'node'|'edge', id: string, ref: object}>} refsByExtId - result of extractModelRefsFromDb
 * @returns {Promise<Array<{extId: string, spec: object}>>}
 */
export async function deriveSpecsForRefs(db, serverId, bankId, refsByExtId) {
  const results = [];
  for (const [extId, { ref }] of refsByExtId) {
    const spec = await deriveSpecForRef(db, serverId, bankId, ref);
    if (spec) results.push({ extId, spec });
  }
  return results;
}
