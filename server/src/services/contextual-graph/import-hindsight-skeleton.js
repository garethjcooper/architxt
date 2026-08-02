import { createLogger } from '../../utils/logger.js';
import { getEntityGraph } from '../hindsight/research.js';
import { buildArchitxtLookups, resolveHindsightNode, buildEdgeId } from './identity.js';
import { upsertNode, upsertEdge, listNodes } from '../../db/crud/contextual-graph.js';

const logger = createLogger('contextual-graph-import');

/**
 * Import a Hindsight entity graph into the working graph.
 *
 * - Resolves Hindsight nodes to canonical or uncanonical-grounded working-graph
 *   nodes.
 * - Imports Hindsight edges as undirected co-occurrence edges (type: null,
 *   properties.directed: false).
 * - Preserves existing working-graph nodes that are absent from the import.
 * - Records provenance and timestamps but never auto-deletes.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {number} [options.min_count] - passed to Hindsight /entities/graph
 * @param {number} [options.min_weight] - minimum edge weight to import
 * @param {Function} [options.fetchGraph] - override for testing
 * @returns {Promise<{success: boolean, imported?: {nodes: number, edges: number}, error?: string, code?: string}>}
 */
export async function importHindsightSkeleton(
  db,
  serverId,
  bankId,
  options = {},
  fetchGraph = getEntityGraph,
) {
  if (!serverId || !bankId) {
    return { success: false, error: 'server_id and bank_id are required', code: 'MISSING_PARAMS' };
  }

  const minWeight = typeof options.min_weight === 'number' ? options.min_weight : 0;
  const now = new Date().toISOString();

  const graphResult = await fetchGraph(serverId, bankId, { min_count: options.min_count });
  if (!graphResult.success || !graphResult.data) {
    logger.warn('Hindsight entity graph unavailable', { serverId, bankId, error: graphResult.error });
    return {
      success: false,
      error: graphResult.error,
      code: graphResult.code || 'HINDSIGHT_ENTITY_GRAPH_FAILED',
    };
  }

  const rawNodes = Array.isArray(graphResult.data.nodes) ? graphResult.data.nodes : [];
  const rawEdges = Array.isArray(graphResult.data.edges) ? graphResult.data.edges : [];

  const lookups = await buildArchitxtLookups(db);

  const hindsightIdToResolved = new Map();
  let importedNodes = 0;

  for (const n of rawNodes) {
    const data = n?.data;
    if (!data || !data.id || !data.label) continue;

    const resolved = await resolveHindsightNode(db, serverId, bankId, lookups, { label: data.label });
    if (!resolved) continue;

    const isCanonical = resolved.taxonomy === 'canonical';
    const labels = isCanonical
      ? ['canonical', 'active', resolved.typeLabel].filter(Boolean)
      : ['uncanonical', 'grounded', 'active', resolved.typeLabel].filter(Boolean);

    const properties = {
      display_name: resolved.displayName,
      aliases: buildAliases(resolved, data.label),
      provenance: {
        source: 'hindsight',
      },
      last_seen_at: now,
      updated_at: now,
    };

    const existing = await listNodes(db, serverId, bankId, {
      idPrefix: resolved.id,
      limit: 1,
    });
    const existingNode = existing.success && existing.data?.[0];
    const mergedProperties = existingNode
      ? mergeProperties(existingNode.cgn_properties, properties)
      : properties;

    const upsertResult = upsertNode(db, serverId, bankId, resolved.id, labels, mergedProperties);
    if (!upsertResult.success) {
      logger.error('Failed to upsert skeleton node', {
        serverId,
        bankId,
        id: resolved.id,
        error: upsertResult.error,
      });
      continue;
    }

    hindsightIdToResolved.set(data.id, resolved.id);
    importedNodes += 1;
  }

  const seenEdgeIds = new Set();
  let importedEdges = 0;

  for (const e of rawEdges) {
    const data = e?.data;
    if (!data || !data.source || !data.target) continue;

    const sourceId = hindsightIdToResolved.get(data.source);
    const targetId = hindsightIdToResolved.get(data.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    const weight = typeof data.weight === 'number' ? data.weight : 1;
    if (weight < minWeight) continue;

    const edgeId = buildEdgeId(sourceId, targetId, null, 'hindsight');
    if (seenEdgeIds.has(edgeId)) continue;
    seenEdgeIds.add(edgeId);

    const properties = {
      directed: false,
      weight,
      provenance: {
        source: 'hindsight',
      },
      last_seen_at: now,
      updated_at: now,
    };

    const upsertResult = upsertEdge(db, serverId, bankId, edgeId, sourceId, targetId, null, properties);
    if (!upsertResult.success) {
      logger.error('Failed to upsert skeleton edge', {
        serverId,
        bankId,
        id: edgeId,
        error: upsertResult.error,
      });
      continue;
    }
    importedEdges += 1;
  }

  logger.info('Imported Hindsight skeleton', {
    serverId,
    bankId,
    importedNodes,
    importedEdges,
    rawNodes: rawNodes.length,
    rawEdges: rawEdges.length,
  });

  return {
    success: true,
    imported: { nodes: importedNodes, edges: importedEdges },
  };
}

function buildAliases(resolved, rawLabel) {
  const aliases = new Set();
  if (resolved.displayName && resolved.displayName !== rawLabel) {
    aliases.add(resolved.displayName);
  }
  aliases.add(rawLabel);
  if (resolved.existingNode?.cgn_properties?.aliases) {
    for (const a of resolved.existingNode.cgn_properties.aliases) {
      aliases.add(a);
    }
  }
  return Array.from(aliases);
}

function mergeProperties(existing, incoming) {
  const merged = { ...existing, ...incoming };

  // Deep-merge provenance so model-derived metadata (model_id, summary,
  // confidence, evidence) is preserved while the source is refreshed.
  const existingProvenance = existing?.provenance || {};
  const incomingProvenance = incoming?.provenance || {};
  merged.provenance = {
    ...existingProvenance,
    ...incomingProvenance,
    evidence: mergeArrays(existingProvenance.evidence, incomingProvenance.evidence),
  };

  // Merge aliases without duplicates.
  merged.aliases = mergeArrays(existing?.aliases, incoming?.aliases);

  return merged;
}

function mergeArrays(a, b) {
  const set = new Set();
  if (Array.isArray(a)) for (const x of a) set.add(x);
  if (Array.isArray(b)) for (const x of b) set.add(x);
  return Array.from(set);
}
