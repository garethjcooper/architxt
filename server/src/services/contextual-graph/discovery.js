import { createLogger } from '../../utils/logger.js';
import { getMentalModel as getHindsightMentalModel } from '../hindsight/mental-models.js';
import { parseJsonString } from '../../prompts/graph-parser.js';
import {
  deriveEntityContextModel,
  deriveEdgeContextModel,
} from './template-models.js';
import { dedupeCandidates, buildEdgeId } from './identity.js';
import { upsertNode, upsertEdge } from '../../db/crud/contextual-graph.js';

const logger = createLogger('contextual-graph-discovery');

/**
 * Fetch candidates from an existing discover-ctx mental model on Hindsight.
 *
 * The discover-ctx model's content is expected to be the JSON object produced by
 * the discover-ctx prompt template:
 *
 *   { "candidates": [{ id, summary, hypothesized_edges: [{ target, type, evidence }] }] }
 *
 * This is a lightweight, read-only call. No LLM is invoked; the generative work
 * has already been done when Hindsight built the mental model.
 *
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} extId - discover-ctx model external id, e.g. "discover-svc:SVC-005"
 * @returns {Promise<{success: boolean, candidates?: Array, error?: string, code?: string}>}
 */
export async function fetchCandidatesFromModel(serverId, bankId, extId) {
  if (!extId) {
    return { success: false, error: 'extId is required', code: 'MISSING_EXT_ID' };
  }

  const result = await getHindsightMentalModel(serverId, bankId, extId, {
    detail: 'content',
    timeoutMs: 15000,
  });

  if (!result.success) {
    logger.error('Failed to fetch discover-ctx model content', { serverId, bankId, extId, error: result.error });
    return { success: false, error: result.error, code: 'FETCH_FAILED' };
  }

  const mentalModel = result.mentalModel;
  const content = mentalModel?.content ?? mentalModel?.reflect_response?.content ?? null;
  if (!content) {
    return { success: false, error: 'discover-ctx model has no content yet', code: 'MODEL_NOT_READY' };
  }

  const parsed = parseJsonString(content);
  if (!parsed || typeof parsed !== 'object') {
    logger.warn('discover-ctx model content was not valid JSON', { serverId, bankId, extId, content: String(content).slice(0, 500) });
    return { success: false, error: 'discover-ctx content was not valid JSON', code: 'PARSE_FAILED' };
  }

  const candidates = normalizeCandidates(parsed.candidates);
  return { success: true, candidates };
}

function normalizeCandidates(rawCandidates) {
  if (!Array.isArray(rawCandidates)) return [];

  return rawCandidates
    .map((c) => {
      const id = typeof c.id === 'string' && c.id.length > 0 ? c.id : null;
      const displayName = typeof c.summary === 'string' && c.summary.length > 0
        ? c.summary
        : (typeof c.name === 'string' ? c.name : (typeof c.displayName === 'string' ? c.displayName : id));
      if (!id || !displayName) return null;

      const hypothesizedEdges = (Array.isArray(c.hypothesized_edges)
        ? c.hypothesized_edges
        : (Array.isArray(c.hypothesizedEdges) ? c.hypothesizedEdges : []))
        .map((he) => ({
          target: typeof he.target === 'string' ? he.target : null,
          type: typeof he.type === 'string' ? he.type : 'co-occurs',
          evidence: typeof he.evidence === 'string' ? he.evidence : '',
        }))
        .filter((he) => he.target);

      return {
        id,
        displayName,
        aliases: Array.isArray(c.aliases) ? c.aliases.filter((a) => typeof a === 'string') : [],
        hypothesizedEdges,
      };
    })
    .filter(Boolean);
}

/**
 * Ingest a list of approved candidates into the working graph.
 *
 * - Creates or updates candidate nodes.
 * - Creates hypothesized edges to existing targets.
 * - Derives entity-ctx / edge-ctx mental-model specs for the new nodes and edges.
 * - Does NOT deploy the derived specs; the caller decides whether to queue them.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} seedId
 * @param {Array} candidates - normalized candidate objects from fetchCandidatesFromModel()
 * @param {Object} context
 * @param {object[]} context.existingNodes - working graph nodes for deduplication
 * @returns {Promise<{success: boolean, entity: Array, edge: Array, upserted: { nodes: string[], edges: string[] }, error?: string, code?: string}>}
 */
export async function ingestCandidates(db, serverId, bankId, seedId, candidates, context = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { success: true, entity: [], edge: [], upserted: { nodes: [], edges: [] } };
  }

  const existingNodes = context.existingNodes || [];
  const now = new Date().toISOString();
  const entitySpecs = [];
  const edgeSpecs = [];
  const upsertedNodes = [];
  const upsertedEdges = [];

  const lookups = buildLookupsFromGraph(existingNodes);
  const { unique, mergedIntoExisting } = await dedupeCandidates(db, serverId, bankId, lookups, candidates);

  for (const candidate of unique) {
    const labels = ['uncanonical', 'candidate', 'active'];
    const properties = {
      display_name: candidate.displayName,
      provenance: { source: 'discover', seed_id: seedId, discovered_at: now, model_refs: [] },
      aliases: candidate.displayName ? [candidate.displayName] : [],
      last_seen_at: now,
      updated_at: now,
    };
    upsertNode(db, serverId, bankId, candidate.id, labels, properties);
    upsertedNodes.push(candidate.id);

    entitySpecs.push(await deriveEntityContextModel(db, {
      id: candidate.id,
      displayName: candidate.displayName,
    }, bankId));

    if (Array.isArray(candidate.hypothesizedEdges)) {
      for (const he of candidate.hypothesizedEdges) {
        if (!existingNodes.some((n) => n.cgn_id === he.target)) continue;
        const targetNode = existingNodes.find((n) => n.cgn_id === he.target);

        edgeSpecs.push(await deriveEdgeContextModel(db, {
          id: candidate.id,
          displayName: candidate.displayName,
        }, {
          id: he.target,
          displayName: targetNode?.cgn_properties?.display_name || he.target,
        }, bankId));

        const edgeId = buildEdgeId(candidate.id, he.target, null, 'discover');
        const edgeProperties = {
          directed: false,
          type: he.type || 'co-occurs',
          weight: 0.5,
          provenance: { source: 'discover', seed_id: seedId, evidence: he.evidence, model_refs: [] },
          last_seen_at: now,
          updated_at: now,
        };
        upsertEdge(db, serverId, bankId, edgeId, candidate.id, he.target, null, edgeProperties);
        upsertedEdges.push(edgeId);
      }
    }
  }

  for (const { candidate } of mergedIntoExisting) {
    const existing = existingNodes.find((n) => n.cgn_id === candidate.id);
    if (existing && !hasEntityCtxRef(existing.cgn_properties)) {
      entitySpecs.push(await deriveEntityContextModel(db, {
        id: existing.cgn_id,
        displayName: existing.cgn_properties?.display_name || existing.cgn_id,
      }, bankId));
    }

    if (Array.isArray(candidate.hypothesized_edges)) {
      for (const he of candidate.hypothesized_edges) {
        if (!existingNodes.some((n) => n.cgn_id === he.target)) continue;
        const targetNode = existingNodes.find((n) => n.cgn_id === he.target);

        edgeSpecs.push(await deriveEdgeContextModel(db, {
          id: candidate.id,
          displayName: candidate.displayName || candidate.id,
        }, {
          id: he.target,
          displayName: targetNode?.cgn_properties?.display_name || he.target,
        }, bankId));

        const edgeId = buildEdgeId(candidate.id, he.target, null, 'discover');
        const edgeProperties = {
          directed: false,
          type: he.type || 'co-occurs',
          weight: 0.5,
          provenance: { source: 'discover', seed_id: seedId, evidence: he.evidence, model_refs: [] },
          last_seen_at: now,
          updated_at: now,
        };
        upsertEdge(db, serverId, bankId, edgeId, candidate.id, he.target, null, edgeProperties);
        upsertedEdges.push(edgeId);
      }
    }
  }

  return {
    success: true,
    entity: entitySpecs,
    edge: edgeSpecs,
    upserted: { nodes: upsertedNodes, edges: upsertedEdges },
  };
}

function buildLookupsFromGraph(nodes) {
  const byName = new Map();
  const byId = new Map();
  for (const n of nodes) {
    const display = n.cgn_properties?.display_name;
    if (display) byName.set(display.toLowerCase(), n.cgn_id);
    for (const alias of n.cgn_properties?.aliases || []) {
      if (alias) byName.set(alias.toLowerCase(), n.cgn_id);
    }
    byId.set(n.cgn_id, n.cgn_id);
  }
  return {
    find: (nameOrId) => {
      if (!nameOrId) return undefined;
      const id = byId.get(nameOrId) || byName.get(String(nameOrId).toLowerCase());
      if (!id) return undefined;
      return { id };
    },
  };
}

function hasEntityCtxRef(properties) {
  const refs = properties?.provenance?.model_refs;
  if (Array.isArray(refs)) {
    return refs.some((ref) => ref?.role?.startsWith('entity-ctx'));
  }
  return false;
}

/**
 * Backwards-compatible alias used by older tests.
 * @deprecated use fetchCandidatesFromModel()
 */
export async function runDiscovery(db, serverId, bankId, spec, context = {}) {
  logger.warn('runDiscovery() is deprecated; discovery now reads from the discover-ctx mental model content', { seed: spec?.ext_id });
  if (!spec?.ext_id) {
    return { success: false, error: 'spec.ext_id is required', code: 'MISSING_SPEC' };
  }
  return fetchCandidatesFromModel(serverId, bankId, spec.ext_id);
}
