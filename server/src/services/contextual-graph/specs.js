import { createLogger } from '../../utils/logger.js';
import { getNode, listEdges } from '../../db/crud/contextual-graph.js';
import {
  deriveContextualModelSpec,
  SCOPE_VALUES,
} from './template-models.js';
import { getRoleScopeMap } from '../../db/crud/template-roles.js';

const logger = createLogger('contextual-graph-specs');

function nodeIsGroundedOrCanonical(labels) {
  return labels?.includes('grounded') || labels?.includes('canonical');
}

function nodeIsCandidate(labels) {
  return labels?.includes('candidate');
}

function nodeIsActive(labels) {
  return labels?.includes('active');
}

/**
 * Derive a mental-model spec for a single model_ref attached to the working graph.
 *
 * This is the single source of truth used by add-context, sync-config, orphan
 * cleanup, and refresh. It rebuilds the spec from the current working-graph
 * node/edge and the current template for the ref's role.
 *
 * @param {object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {object} ref - model_ref entry with explicit role and scope
 * @returns {Promise<object|null>} spec or null if the backing node/edge is gone
 */
export async function deriveSpecForRef(db, serverId, bankId, ref) {
  if (!ref?.role) {
    logger.warn('Cannot derive spec for ref with missing role', { ref });
    return null;
  }

  const scopeMap = getRoleScopeMap(db);
  const scopeType = scopeMap.get(ref.role);

  if (!scopeType) {
    logger.warn('Cannot derive spec for unknown role', { serverId, bankId, role: ref.role });
    return null;
  }

  const scope = ref.scope || {};

  if (scopeType === 'node') {
    const nodeId = scope.node_id;
    if (!nodeId) {
      logger.warn('Missing node_id in node-scoped ref scope', { ref });
      return null;
    }
    const node = getNode(db, serverId, bankId, nodeId)?.data;
    if (!node) {
      logger.warn('Dropping stale node-scoped ref; node not found', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsActive(node.cgn_labels)) {
      logger.warn('Dropping node-scoped ref for inactive node', { serverId, bankId, ref });
      return null;
    }
    if (nodeIsCandidate(node.cgn_labels)) {
      logger.warn('Dropping node-scoped ref for candidate node; promotion required', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsGroundedOrCanonical(node.cgn_labels)) {
      logger.warn('Dropping node-scoped ref for non-grounded/non-canonical node', { serverId, bankId, ref, labels: node.cgn_labels });
      return null;
    }

    const target = {
      id: nodeId,
      displayName: node.cgn_properties?.display_name || nodeId,
    };
    return deriveContextualModelSpec(db, ref.role, 'node', SCOPE_VALUES.node(target));
  }

  if (scopeType === 'edge') {
    const sourceId = scope.source_id;
    const targetId = scope.target_id;
    if (!sourceId || !targetId) {
      logger.warn('Missing source_id/target_id in edge-scoped ref scope', { ref });
      return null;
    }

    const sourceNode = getNode(db, serverId, bankId, sourceId)?.data;
    const targetNode = getNode(db, serverId, bankId, targetId)?.data;
    if (!sourceNode || !targetNode) {
      logger.warn('Dropping stale edge-scoped ref; endpoint missing', { serverId, bankId, ref, sourceId, targetId });
      return null;
    }
    if (!nodeIsActive(sourceNode.cgn_labels) || !nodeIsActive(targetNode.cgn_labels)) {
      logger.warn('Dropping edge-scoped ref because an endpoint is inactive', { serverId, bankId, ref });
      return null;
    }
    if (nodeIsCandidate(sourceNode.cgn_labels) || nodeIsCandidate(targetNode.cgn_labels)) {
      logger.warn('Dropping edge-scoped ref because an endpoint is a candidate; promotion required', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsGroundedOrCanonical(sourceNode.cgn_labels) || !nodeIsGroundedOrCanonical(targetNode.cgn_labels)) {
      logger.warn('Dropping edge-scoped ref because an endpoint is not grounded/canonical', { serverId, bankId, ref });
      return null;
    }

    const edges = listEdges(db, serverId, bankId, { limit: 10000 })?.data || [];
    const pairEdges = edges.filter(
      (e) =>
        (e.cge_source_id === sourceId && e.cge_target_id === targetId) ||
        (e.cge_source_id === targetId && e.cge_target_id === sourceId),
    );
    const groundedPairEdges = pairEdges.filter((e) =>
      e.cge_properties?.labels?.includes('grounded'),
    );
    if (groundedPairEdges.length === 0) {
      logger.warn('Dropping edge-scoped ref because no grounded edge exists between endpoints', { serverId, bankId, ref });
      return null;
    }

    const sourceTarget = {
      id: sourceId,
      displayName: sourceNode.cgn_properties?.display_name || sourceId,
    };
    const targetTarget = {
      id: targetId,
      displayName: targetNode.cgn_properties?.display_name || targetId,
    };
    return deriveContextualModelSpec(db, ref.role, 'edge', SCOPE_VALUES.edge(sourceTarget, targetTarget));
  }

  if (scopeType === 'seed') {
    const seedId = scope.seed_id;
    if (!seedId) {
      logger.warn('Missing seed_id in seed-scoped ref scope', { ref });
      return null;
    }
    const seedNode = getNode(db, serverId, bankId, seedId)?.data;
    if (!seedNode) {
      logger.warn('Dropping stale seed-scoped ref; seed node not found', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsActive(seedNode.cgn_labels)) {
      logger.warn('Dropping seed-scoped ref for inactive seed', { serverId, bankId, ref });
      return null;
    }
    if (nodeIsCandidate(seedNode.cgn_labels)) {
      logger.warn('Dropping seed-scoped ref for candidate seed; promotion required', { serverId, bankId, ref });
      return null;
    }
    if (!nodeIsGroundedOrCanonical(seedNode.cgn_labels)) {
      logger.warn('Dropping seed-scoped ref for non-grounded/non-canonical seed', { serverId, bankId, ref, labels: seedNode.cgn_labels });
      return null;
    }

    const seedTarget = {
      id: seedId,
      displayName: seedNode.cgn_properties?.display_name || seedId,
    };
    return deriveContextualModelSpec(db, ref.role, 'seed', SCOPE_VALUES.seed(seedTarget, []));
  }

  if (scopeType === 'graph') {
    // Graph-scoped contextual models have no single backing item; they always
    // qualify as long as their role is configured.
    return deriveContextualModelSpec(db, ref.role, 'graph', {});
  }

  logger.warn('Unhandled derivation scope', { serverId, bankId, ref, scopeType });
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
