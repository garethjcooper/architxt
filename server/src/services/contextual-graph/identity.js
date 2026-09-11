import { createHash } from 'crypto';
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
 * - If the node resolves to a canonical Architxt entity, use the catalog id
 *   (type:id). The type prefix is data-driven from the entity type registry.
 * - Otherwise use a stable bare normalized slug. Status metadata such as
 *   "uncanonical", "found", or "candidate" lives in node labels, not in the id.
 *
 * @param {Object} options
 * @param {string} options.label - raw Hindsight label/value
 * @param {string} [options.canonicalId] - resolved canonical entity id
 * @param {string} [options.typeLabel] - explicit type prefix from the label
 * @returns {string}
 */
export function buildNodeId({ label, canonicalId, typeLabel }) {
  const inferredType = typeLabel || extractTypeLabel(label);
  if (canonicalId) {
    const localId = stripTypePrefix(canonicalId, inferredType);
    return inferredType ? `${inferredType}:${localId}` : canonicalId;
  }
  const localLabel = inferredType ? stripTypePrefix(label, inferredType) : label;
  const normalized = normalizeNodeId(localLabel);
  if (inferredType) return `${inferredType}:${normalized}`;
  return normalized;
}

function stripTypePrefix(value, typeLabel) {
  if (!typeLabel || !value) return value;
  const prefix = `${typeLabel}:`;
  const lowered = String(value).toLowerCase();
  return lowered.startsWith(prefix) ? value.slice(prefix.length) : value;
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
    const typeLabel = canonicalEntity.et_type_name || null;
    return {
      id: buildNodeId({ canonicalId: canonicalEntity.ent_entity_id, typeLabel }),
      taxonomy: 'canonical',
      canonicalEntity,
      displayName: canonicalEntity.ent_name,
      typeLabel,
    };
  }

  const normalizedId = buildNodeId({ label, typeLabel: rawTypeLabel });
  const existingNode = await getNode(db, serverId, bankId, normalizedId);
  if (existingNode?.data) {
    const node = existingNode.data;
    const isGrounded = node.labels?.includes('grounded');
    const isCanonical = node.labels?.includes('canonical');
    return {
      id: normalizedId,
      taxonomy: isCanonical ? 'canonical' : (isGrounded ? 'uncanonical-grounded' : 'uncanonical-discovered'),
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
/**
 * Strip transient discovery prefixes (`found:`, `candidate:`) from a model-
 * emitted id. These prefixes are not part of the stable node identity; they
 * were historically used as a hint that a node was newly discovered, but that
 * state now lives in node labels. The function is retained so legacy model
 * outputs still resolve correctly during the transition.
 *
 * @param {string} label
 * @returns {string}
 */
export function stripDiscoveryPrefix(label) {
  if (!label || typeof label !== 'string') return '';
  const lowered = label.toLowerCase();
  if (lowered.startsWith('found:')) return label.slice(6);
  if (lowered.startsWith('candidate:')) return label.slice(10);
  return label;
}

/**
 * Normalize a model-emitted node id to a working-graph node id, preserving an
 * explicit type prefix when present. This is intentionally looser than the full
 * `buildNodeId` resolution used during Hindsight skeleton import because models
 * may emit bare names (e.g. "mozart-api") that should resolve to an existing
 * "svc:mozart-api" or bare "mozart-api" node.
 *
 * `found:` and `candidate:` prefixes are stripped for matching; they are
 * transient discovery markers, not distinct identity namespaces. A
 * `found:mozart-api` emitted by a legacy model should resolve to an existing
 * bare "mozart-api" node rather than creating a duplicate.
 *
 * @param {string} label
 * @returns {string}
 */
export function normalizeModelNodeId(label) {
  if (!label || typeof label !== 'string') return 'unknown';
  const bare = stripDiscoveryPrefix(label);
  const typeLabel = extractTypeLabel(bare);
  if (typeLabel) {
    const localId = bare.slice(typeLabel.length + 1);
    return `${typeLabel}:${normalizeNodeId(localId)}`;
  }
  return normalizeNodeId(bare);
}

/**
 * Return lookup keys that a model-emitted id should be matched against. The
 * keys include the normalized bare/typed form of the id, plus display names
 * and aliases when they are passed in. Discovery prefixes (`found:`,
 * `candidate:`) are stripped; they are labels, not identity namespaces.
 *
 * @param {string} label
 * @returns {string[]}
 */
export function modelNodeLookupKeys(label) {
  if (!label || typeof label !== 'string') return [];
  const bare = stripDiscoveryPrefix(label);
  const normalizedBare = normalizeModelNodeId(bare);
  const keys = new Set([normalizedBare]);

  const typeLabel = extractTypeLabel(bare);
  if (!typeLabel) {
    // For backward compatibility with legacy model outputs, also register the
    // bare slug so a `found:mozart-api` input can match an existing bare
    // "mozart-api" node.
    keys.add(normalizeNodeId(bare));
  }

  return Array.from(keys);
}

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
    const candidateId = normalizedName;

    let canonicalMatch = null;
    let existingMatch = null;

    for (const name of names) {
      if (!canonicalMatch) canonicalMatch = lookups.find(null, name);
      if (!existingMatch) {
        const match = await getNode(db, serverId, bankId, buildNodeId({ label: name, typeLabel: extractTypeLabel(name) }));
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
 * Build a short deterministic hash from edge payload fields so parallel
 * edges that share the same source/target/type but differ in label/detail
 * get distinct ids.
 *
 * @param {string} label
 * @param {string} [detail]
 * @returns {string}
 */
function buildEdgeContentHash(label) {
  return createHash('sha256').update(String(label || '')).digest('hex').slice(0, 8);
}

/**
 * Build a deterministic edge id for a directed edge.
 * Direction is preserved: source -> target is different from target -> source.
 * Parallel edges of the same type are separated by a hash of their label.
 *
 * @param {string} sourceId
 * @param {string} targetId
 * @param {string|null} type
 * @param {string} [label] - used to differentiate parallel edges
 * @param {string} [provenance] - e.g. 'edge-ctx', 'manual'
 */
export function buildDirectedEdgeId(sourceId, targetId, type = null, label = '', provenance = 'edge-ctx') {
  const typePart = type ? `-${type}` : '';
  const hash = type ? `-${buildEdgeContentHash(label)}` : '';
  return `${provenance}-${sourceId}-${targetId}${typePart}${hash}`;
}

/**
 * Build a deterministic edge id for an undirected edge.
 * Endpoints are sorted so direction does not matter.
 *
 * @param {string} sourceId
 * @param {string} targetId
 * @param {string|null} type
 * @param {string} [provenance] - e.g. 'hindsight', 'discover', 'manual'
 */
export function buildUndirectedEdgeId(sourceId, targetId, type = null, provenance = 'manual') {
  const sorted = [sourceId, targetId].sort();
  const typePart = type ? `-${type}` : '';
  return `${provenance}-${sorted[0]}-${sorted[1]}${typePart}`;
}
