import { listEntitiesWithType } from '../../db/crud/entities.js';
import { getNode, listNodes } from '../../db/crud/contextual-graph.js';

/**
 * Build lookup maps for Architxt canonical entities.
 *
 * @param {Object} db
 * @returns {Promise<{
 *   byEntityId: Map<string,Object>,
 *   byName: Map<string,Object>,
 *   byAlias: Map<string,Object>,
 *   find: Function
 * }>}
 */
export async function buildArchitxtLookups(db) {
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

  function find(rawId, rawLabel) {
    if (!rawId && !rawLabel) return undefined;
    const byId = rawId ? byEntityId.get(rawId) : undefined;
    if (byId) return byId;

    const namePart = rawLabel ? String(rawLabel).split(':').pop() : rawId;
    if (!namePart) return undefined;
    const key = namePart.toLowerCase();
    return byName.get(key) || byAlias.get(key);
  }

  return { byEntityId, byName, byAlias, find };
}

/**
 * Normalize a label/value into a stable node id for uncanonical nodes.
 * Lowercase, keep alphanumerics, dash, underscore, colon. Spaces and
 * punctuation collapse to single dashes. Trim leading/trailing dashes.
 *
 * @param {string} label
 * @returns {string}
 */
export function normalizeNodeId(label) {
  if (!label || typeof label !== 'string') return 'unknown';
  return label
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build a working-graph node id from a Hindsight node.
 *
 * @param {Object} options
 * @param {string} options.label - raw Hindsight label/value
 * @param {string} [options.canonicalId] - resolved canonical entity id
 * @returns {string}
 */
export function buildNodeId({ label, canonicalId }) {
  if (canonicalId) return canonicalId;
  return `uncanonical:${normalizeNodeId(label)}`;
}

/**
 * Resolve a Hindsight node against canonical catalog + working graph.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} lookups - result from buildArchitxtLookups(db)
 * @param {Object} input
 * @param {string} [input.hindsightId] - Hindsight internal node id (not used for matching)
 * @param {string} input.label - Hindsight node label/value
 * @returns {Promise<{
 *   id: string,
 *   taxonomy: 'canonical' | 'uncanonical-grounded' | 'new',
 *   canonicalEntity?: Object,
 *   existingNode?: Object,
 *   displayName: string
 * }>}
 */
export async function resolveHindsightNode(db, serverId, bankId, lookups, { label }) {
  const displayName = label;
  const rawTypeLabel = extractTypeLabel(label);

  // 1. Canonical match
  const parts = String(label).split(':');
  const candidateEntityId = parts.length >= 2 ? parts.slice(1).join(':') : label;
  const canonicalEntity = lookups.find(candidateEntityId, label);
  if (canonicalEntity) {
    return {
      id: canonicalEntity.ent_entity_id,
      taxonomy: 'canonical',
      canonicalEntity,
      displayName: canonicalEntity.ent_name,
      typeLabel: canonicalEntity.et_type_name || rawTypeLabel || null,
    };
  }

  // 2. Existing uncanonical-grounded or uncanonical-discovered node
  const normalizedId = buildNodeId({ label });
  const existingNode = await getNode(db, serverId, bankId, normalizedId);
  if (existingNode?.data) {
    const node = existingNode.data;
    return {
      id: normalizedId,
      taxonomy: node.labels?.includes('grounded') ? 'uncanonical-grounded' : 'uncanonical-discovered',
      existingNode: node,
      displayName,
      typeLabel: rawTypeLabel,
    };
  }

  // 3. New uncanonical node
  return {
    id: normalizedId,
    taxonomy: 'new',
    displayName,
    typeLabel: rawTypeLabel,
  };
}

/**
 * Extract a type prefix from a Hindsight label such as "svc:SVC-005".
 * Returns null if there is no prefix.
 *
 * @param {string} label
 * @returns {string|null}
 */
function extractTypeLabel(label) {
  if (!label || typeof label !== 'string') return null;
  const parts = label.split(':');
  if (parts.length >= 2) {
    const prefix = parts[0].trim();
    if (prefix) return prefix.toLowerCase();
  }
  return null;
}

/**
 * Deduplicate a batch of discovered candidates against canonical catalog,
 * existing working-graph nodes, and other candidates in the same batch.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} lookups - from buildArchitxtLookups(db)
 * @param {Array<{id: string, name: string, [aliases]: string[]}>} candidates
 * @returns {Promise<{
 *   unique: Array,
 *   merged: Array,
 *   mergedIntoExisting: Array
 * }>}
 */
export async function dedupeCandidates(db, serverId, bankId, lookups, candidates) {
  const unique = [];
  const merged = [];
  const mergedIntoExisting = [];
  const seenBatchIds = new Set();

  for (const candidate of candidates) {
    const candidateName = candidate.summary || candidate.name || candidate.id;
    const names = [candidateName, ...(candidate.aliases || [])];
    const normalizedName = normalizeNodeId(candidateName);
    const candidateId = `candidate:${normalizedName}`;

    let canonicalMatch = null;
    let existingMatch = null;

    for (const name of names) {
      if (!canonicalMatch) canonicalMatch = lookups.find(null, name);
      if (!existingMatch) {
        const match = await getNode(db, serverId, bankId, buildNodeId({ label: name }));
        if (match?.data) {
          existingMatch = match.data;
        }
      }
    }

    if (canonicalMatch) {
      mergedIntoExisting.push({
        candidate,
        target: { type: 'canonical', id: canonicalMatch.ent_entity_id },
      });
      continue;
    }

    if (existingMatch) {
      mergedIntoExisting.push({
        candidate,
        target: { type: 'existing', id: existingMatch.cgn_id || existingMatch.id },
      });
      continue;
    }

    if (seenBatchIds.has(candidateId)) {
      const existing = unique.find((u) => u.id === candidateId);
      if (existing) {
        existing.aliases = [...new Set([...(existing.aliases || []), normalizedName])];
      }
      merged.push({ candidate, target: { type: 'batch', id: candidateId } });
      continue;
    }

    seenBatchIds.add(candidateId);
    unique.push({
      id: candidateId,
      displayName: candidateName,
      aliases: [normalizedName],
      hypothesizedEdges: candidate.hypothesized_edges || [],
      summary: candidate.summary || '',
    });
  }

  return { unique, merged, mergedIntoExisting };
}

/**
 * Build a deterministic edge id.
 *
 * @param {string} sourceId
 * @param {string} targetId
 * @param {string|null} type
 * @param {string} [provenance] - e.g. 'hindsight', 'edge-ctx', 'discover'
 */
export function buildEdgeId(sourceId, targetId, type = null, provenance = 'manual') {
  const sorted = [sourceId, targetId].sort();
  const typePart = type ? `:${type}` : '';
  return `${provenance}:${sorted[0]}|${sorted[1]}${typePart}`;
}
