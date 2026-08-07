import { createLogger } from '../../utils/logger.js';
import { getEntityGraph } from '../hindsight/research.js';
import { buildArchitxtLookups, resolveHindsightNode, buildUndirectedEdgeId } from './identity.js';
import { upsertNode, upsertEdge, listNodes, listEdges, getNode, getEdge } from '../../db/crud/contextual-graph.js';

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
 * @param {number} [options.top_k_nodes] - only import the top K nodes by raw graph degree
 * @param {string[]} [options.include_patterns] - regex/label patterns; if provided, only import matching labels
 * @param {string[]} [options.exclude_patterns] - regex/label patterns; drop matching labels
 * @param {Function} [options.fetchGraph] - override for testing
 * @returns {Promise<{success: boolean, imported?: {nodes: number, edges: number}, skipped?: {nodes: number}, error?: string, code?: string}>}
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

  const { includePatterns, excludePatterns } = buildPatternMatchers(options);

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

  // Pre-compute raw degrees for top-k filtering.
  const rawDegrees = new Map();
  for (const e of rawEdges) {
    const source = e?.data?.source;
    const target = e?.data?.target;
    if (source) rawDegrees.set(source, (rawDegrees.get(source) || 0) + 1);
    if (target) rawDegrees.set(target, (rawDegrees.get(target) || 0) + 1);
  }

  let candidateNodes = rawNodes.filter((n) => {
    const label = n?.data?.label;
    return typeof label === 'string' && label.trim() !== '';
  });

  // Apply label filters before ranking.
  let skippedByFilter = 0;
  candidateNodes = candidateNodes.filter((n) => {
    const label = n.data.label;
    if (excludePatterns.some((p) => p.test(label))) {
      skippedByFilter += 1;
      return false;
    }
    if (includePatterns.length > 0 && !includePatterns.some((p) => p.test(label))) {
      skippedByFilter += 1;
      return false;
    }
    return true;
  });

  // Apply top-k by degree if configured.
  if (typeof options.top_k_nodes === 'number' && options.top_k_nodes > 0) {
    candidateNodes = candidateNodes
      .map((n) => ({ n, degree: rawDegrees.get(n.data.id) || 0 }))
      .sort((a, b) => b.degree - a.degree || a.n.data.label.localeCompare(b.n.data.label))
      .slice(0, options.top_k_nodes)
      .map(({ n }) => n);
  }

  const allowedRawIds = new Set(candidateNodes.map((n) => n.data.id));

  const lookups = await buildArchitxtLookups(db);

  const hindsightIdToResolved = new Map();
  const seenNodeIds = new Set();
  let importedNodes = 0;

  for (const n of candidateNodes) {
    const data = n?.data;
    if (!data || !data.id || !data.label) continue;

    if (!allowedRawIds.has(data.id)) continue;

    const resolved = await resolveHindsightNode(db, serverId, bankId, lookups, { label: data.label });
    if (!resolved) continue;

    const isCanonical = resolved.taxonomy === 'canonical';
    const labels = isCanonical
      ? ['canonical', 'active', resolved.typeLabel].filter(Boolean)
      : ['grounded', 'active', resolved.typeLabel].filter(Boolean);

    const properties = {
      display_name: resolved.displayName,
      aliases: buildAliases(resolved, data.label),
      provenance: {
        source: 'hindsight',
      },
      last_seen_at: now,
      updated_at: now,
    };

    const existing = await getNode(db, serverId, bankId, resolved.id);
    const existingNode = existing.success ? existing.data : null;
    const mergedProperties = existingNode
      ? mergeProperties(existingNode.cgn_properties, properties)
      : properties;

    // Preserve discovery status on existing nodes. The skeleton importer must
    // never promote or demote nodes; it only adds labels for brand-new nodes or
    // re-activates existing non-candidate nodes.
    const mergedLabels = existingNode
      ? [...new Set(
          existingNode.labels?.includes('candidate')
            ? [...existingNode.labels, 'active'].filter((l) => l !== 'stale')
            : [...labels, ...existingNode.labels].filter((l) => l !== 'stale'),
        )]
      : labels;

    const upsertResult = upsertNode(db, serverId, bankId, resolved.id, mergedLabels, mergedProperties);
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
    seenNodeIds.add(resolved.id);
    importedNodes += 1;
  }

  const seenEdgeIds = new Set();
  let importedEdges = 0;

  for (const e of rawEdges) {
    const data = e?.data;
    if (!data || !data.source || !data.target) continue;

    // Skip edges whose endpoints were filtered out by top-k / include / exclude.
    if (!allowedRawIds.has(data.source) || !allowedRawIds.has(data.target)) continue;

    const sourceId = hindsightIdToResolved.get(data.source);
    const targetId = hindsightIdToResolved.get(data.target);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    const weight = typeof data.weight === 'number' ? data.weight : 1;
    if (weight < minWeight) continue;

    const edgeId = buildUndirectedEdgeId(sourceId, targetId, null, 'hindsight');
    if (seenEdgeIds.has(edgeId)) continue;
    seenEdgeIds.add(edgeId);

    const incomingEdgeProperties = {
      directed: false,
      weight,
      labels: ['grounded'],
      provenance: {
        source: 'hindsight',
      },
      last_seen_at: now,
      updated_at: now,
    };

    const existingEdge = await getEdge(db, serverId, bankId, edgeId);
    const existingEdgeProperties = existingEdge?.data?.cge_properties;
    const properties = existingEdgeProperties
      ? mergeProperties(existingEdgeProperties, incomingEdgeProperties)
      : incomingEdgeProperties;

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

  // Mark Hindsight-sourced nodes/edges absent from this import as stale;
  // restore active for ones that reappeared.
  let staleNodes = 0;
  let staleEdges = 0;
  let restoredNodes = 0;
  let restoredEdges = 0;

  const existingNodesResult = listNodes(db, serverId, bankId, { limit: 100000 });
  const existingEdgesResult = listEdges(db, serverId, bankId, { limit: 100000 });

  if (existingNodesResult.success) {
    for (const row of existingNodesResult.data) {
      const id = row.cgn_id;
      const labels = Array.isArray(row.cgn_labels) ? row.cgn_labels : [];
      const source = row.cgn_properties?.provenance?.source;
      if (source !== 'hindsight') continue;

      const isSeen = seenNodeIds.has(id);
      const hasStale = labels.includes('stale');
      const hasActive = labels.includes('active');

      if (!isSeen && !hasStale) {
        const newLabels = labels.filter((l) => l !== 'active').concat('stale');
        const newProperties = {
          ...row.cgn_properties,
          updated_at: now,
        };
        upsertNode(db, serverId, bankId, id, newLabels, newProperties);
        staleNodes += 1;
      } else if (isSeen && hasStale) {
        const newLabels = labels.filter((l) => l !== 'stale').concat('active');
        const newProperties = {
          ...row.cgn_properties,
          updated_at: now,
        };
        upsertNode(db, serverId, bankId, id, newLabels, newProperties);
        restoredNodes += 1;
      } else if (isSeen && !hasActive) {
        const newLabels = labels.includes('active') ? labels : labels.concat('active');
        const newProperties = {
          ...row.cgn_properties,
          updated_at: now,
        };
        upsertNode(db, serverId, bankId, id, newLabels, newProperties);
      }
    }
  }

  if (existingEdgesResult.success) {
    for (const row of existingEdgesResult.data) {
      const id = row.cge_id;
      const source = row.cge_properties?.provenance?.source;
      if (source !== 'hindsight') continue;

      const isSeen = seenEdgeIds.has(id);
      const properties = row.cge_properties || {};
      const labels = Array.isArray(properties.labels) ? properties.labels : [];
      const hasStale = labels.includes('stale');
      const hasActive = labels.includes('active');

      if (!isSeen && !hasStale) {
        const newLabels = labels.filter((l) => l !== 'active').concat('stale');
        const newProperties = {
          ...properties,
          labels: newLabels,
          updated_at: now,
        };
        upsertEdge(db, serverId, bankId, id, row.cge_source_id, row.cge_target_id, row.cge_type, newProperties);
        staleEdges += 1;
      } else if (isSeen && hasStale) {
        const newLabels = labels.filter((l) => l !== 'stale').concat('active');
        const newProperties = {
          ...properties,
          labels: newLabels,
          updated_at: now,
        };
        upsertEdge(db, serverId, bankId, id, row.cge_source_id, row.cge_target_id, row.cge_type, newProperties);
        restoredEdges += 1;
      } else if (isSeen && !hasActive) {
        const newLabels = labels.includes('active') ? labels : labels.concat('active');
        const newProperties = {
          ...properties,
          labels: newLabels,
          updated_at: now,
        };
        upsertEdge(db, serverId, bankId, id, row.cge_source_id, row.cge_target_id, row.cge_type, newProperties);
      }
    }
  }

  logger.info('Imported Hindsight skeleton', {
    serverId,
    bankId,
    importedNodes,
    importedEdges,
    staleNodes,
    staleEdges,
    restoredNodes,
    restoredEdges,
    rawNodes: rawNodes.length,
    rawEdges: rawEdges.length,
    skippedByFilter,
  });

  return {
    success: true,
    imported: { nodes: importedNodes, edges: importedEdges },
    skipped: { nodes: skippedByFilter },
    stale: { nodes: staleNodes, edges: staleEdges },
    restored: { nodes: restoredNodes, edges: restoredEdges },
  };
}

function buildPatternMatchers(options) {
  const includePatterns = (options.include_patterns || [])
    .map((p) => compilePattern(p, 'include_patterns'))
    .filter(Boolean);
  const excludePatterns = (options.exclude_patterns || [])
    .map((p) => compilePattern(p, 'exclude_patterns'))
    .filter(Boolean);
  return { includePatterns, excludePatterns };
}

function compilePattern(raw, fieldName) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new RegExp(trimmed, 'i');
  } catch (err) {
    logger.warn('Invalid restriction pattern, ignoring', { fieldName, pattern: raw, error: err.message });
    return null;
  }
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

  // Deep-merge provenance so model-derived metadata (summary, confidence,
  // evidence, model_refs) is preserved while the source is refreshed.
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
