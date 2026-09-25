import { createLogger } from '../../utils/logger.js';
import { discoverMentalModelsByRoles } from '../../services/research/mental-model-discovery.js';
import { getRoleScopeMap } from '../../db/crud/template-roles.js';

const logger = createLogger('agent-graph-merge-tool');

/**
 * Normalise common Unicode dash / space characters to ASCII so entity IDs
 * copied from LLM output (which likes en-dashes and non-breaking hyphens)
 * still parse correctly.
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeEntityText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\u2011/g, '-')   // non-breaking hyphen
    .replace(/\u2010/g, '-')   // hyphen
    .replace(/\u2013/g, '-')   // en dash
    .replace(/\u2014/g, '-')   // em dash
    .replace(/\u00A0/g, ' '); // non-breaking space
}

/**
 * Merge multiple graph fragments into one standard envelope graph.
 * First-write-wins on node ids and on edge uniqueness by from|to|type|label.
 *
 * @param {Array<{ nodes: object[], edges: object[] }>} graphs
 * @param {string} [name]
 * @returns {{ name: string, nodes: object[], edges: object[] }}
 */
function mergeGraphFragments(graphs, name = '') {
  const nodeById = new Map();
  const edgeKeys = new Set();
  const edges = [];

  for (const graph of graphs) {
    if (!graph || typeof graph !== 'object') continue;
    for (const node of graph.nodes || []) {
      if (node && typeof node.id === 'string' && !nodeById.has(node.id)) {
        nodeById.set(node.id, node);
      }
    }
    for (const edge of graph.edges || []) {
      if (!edge || typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
      const type = edge.type || '';
      const label = edge.label || '';
      const key = `${edge.from}|${edge.to}|${type}|${label}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push(edge);
    }
  }

  return {
    name,
    nodes: Array.from(nodeById.values()),
    edges,
  };
}

/**
 * Build a merged graph from EDGE-context derivation models for the supplied
 * canonical entity refs (e.g. "A-C:MSG-RTR-001"). The refs may come from the
 * user's original message or from the synthesis text. The merged graph is
 * returned in the standard envelope shape used by EnvelopeViewer and
 * GraphViewModal.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string[]} entityRefs
 * @returns {Promise<{ success: boolean, data?: { graph: { name: string, nodes: object[], edges: object[] }, discovered: string[], candidate_count: number, edge_roles: string[] }, error?: string, code?: string }>}
 */
export async function buildMergedGraphForEntityRefs(db, serverId, bankId, entityRefs) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_BANK' };
  }
  if (!Array.isArray(entityRefs) || entityRefs.length === 0) {
    return { success: true, data: { graph: { name: '', nodes: [], edges: [] } } };
  }

  try {
    // Expect canonical type-prefixed ids. Normalise Unicode dashes/spaces and de-duplicate.
    const typePrefixedIds = [...new Set(
      entityRefs
        .filter((raw) => typeof raw === 'string')
        .map((raw) => normalizeEntityText(raw.trim()))
        .filter((clean) => clean.includes(':')),
    )];

    if (typePrefixedIds.length === 0) {
      return { success: true, data: { graph: { name: '', nodes: [], edges: [] } } };
    }

    const scopeMap = getRoleScopeMap(db);
    const edgeRoles = Array.from(scopeMap.entries())
      .filter(([, scope]) => scope === 'edge')
      .map(([roleId]) => roleId);

    if (edgeRoles.length === 0) {
      return { success: true, data: { graph: { name: '', nodes: [], edges: [] } } };
    }

    const discoveryResult = await discoverMentalModelsByRoles(db, serverId, bankId, {
      entities: typePrefixedIds,
      roles: edgeRoles,
      timeoutMs: 15000,
    });

    if (!discoveryResult.success) {
      return { success: false, error: discoveryResult.error, code: discoveryResult.code || 'DISCOVERY_FAILED' };
    }

    const candidateGraphs = [];
    for (const role of edgeRoles) {
      const roleResult = discoveryResult.roles?.[role];
      const roleGraph = roleResult?.result?.graph;
      if (roleGraph && (roleGraph.nodes?.length > 0 || roleGraph.edges?.length > 0)) {
        candidateGraphs.push(roleGraph);
      }
      for (const candidate of roleResult?.candidates || []) {
        if (candidate.found && candidate.content?.graph) {
          candidateGraphs.push(candidate.content.graph);
        }
      }
    }

    const merged = mergeGraphFragments(candidateGraphs, 'Merged edge context');

    const evidenceIds = new Set();
    for (const graph of candidateGraphs) {
      const topLevelEvidence = graph?.evidence;
      if (Array.isArray(topLevelEvidence)) {
        for (const id of topLevelEvidence) {
          if (typeof id === 'string') evidenceIds.add(id);
        }
      }
      for (const edge of graph?.edges || []) {
        for (const id of edge?.evidence || []) {
          if (typeof id === 'string') evidenceIds.add(id);
        }
      }
    }

    logger.info('Built merged graph for entities', {
      serverId,
      bankId,
      entityCount: typePrefixedIds.length,
      edgeRoles,
      candidateCount: candidateGraphs.length,
      nodeCount: merged.nodes.length,
      edgeCount: merged.edges.length,
      evidenceCount: evidenceIds.size,
    });

    return {
      success: true,
      data: {
        graph: merged,
        discovered: typePrefixedIds,
        candidate_count: candidateGraphs.length,
        edge_roles: edgeRoles,
      },
    };
  } catch (err) {
    logger.error('buildMergedGraphForEntityRefs failed', { serverId, bankId, error: err.message, stack: err.stack });
    return { success: false, error: err.message || 'Graph merge failed', code: err.code || 'GRAPH_MERGE_FAILED' };
  }
}

export default {
  buildMergedGraphForEntityRefs,
};