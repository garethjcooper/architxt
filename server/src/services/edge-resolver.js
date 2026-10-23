import { listEdges } from '../db/crud/contextual-graph.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('edge-resolver');

/**
 * Validate a resolve-edges request payload.
 */
export function validateResolveEdgesPayload(body) {
  const serverId = Number(body?.server_id);
  const bankId = body?.bank_id;
  const graph = body?.graph;

  if (!Number.isFinite(serverId) || serverId <= 0) {
    return { valid: false, error: 'server_id must be a positive integer', code: 'VALIDATION_ERROR' };
  }
  if (!bankId || typeof bankId !== 'string' || bankId.trim() === '') {
    return { valid: false, error: 'bank_id is required', code: 'VALIDATION_ERROR' };
  }
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.edges)) {
    return { valid: false, error: 'graph.edges must be an array', code: 'VALIDATION_ERROR' };
  }

  const edges = graph.edges
    .map((e, idx) => {
      if (!e || typeof e !== 'object') return null;
      const from = typeof e.from === 'string' ? e.from.trim() : '';
      const to = typeof e.to === 'string' ? e.to.trim() : '';
      if (!from || !to) return null;
      return {
        input_index: idx,
        id: typeof e.id === 'string' ? e.id.trim() : null,
        from,
        to,
        type: typeof e.type === 'string' ? e.type.trim() : null,
        label: typeof e.label === 'string' ? e.label.trim() : null,
        detail: typeof e.detail === 'string' ? e.detail.trim() : null,
        evidence: Array.isArray(e.evidence)
          ? e.evidence.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean)
          : [],
      };
    })
    .filter(Boolean);

  return {
    valid: true,
    serverId,
    bankId: bankId.trim(),
    edges,
  };
}

function edgeLabel(edge) {
  return edge.cge_properties?.label ?? null;
}

function edgeDetail(edge) {
  return edge.cge_properties?.detail ?? null;
}

function edgeEvidence(edge) {
  const raw = edge.cge_properties?.evidence;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean);
}

function endpointsMatch(input, edge) {
  const forward = edge.cge_source_id === input.from && edge.cge_target_id === input.to;
  const reverse = edge.cge_source_id === input.to && edge.cge_target_id === input.from;
  return { matched: forward || reverse, forward };
}

/**
 * Collect all contextual edges that connect the input endpoints, noting whether
 * each edge is in the same orientation as the input or reversed.
 */
function collectOrientedCandidates(input, contextualEdges) {
  return contextualEdges
    .map((edge) => {
      const { matched, forward } = endpointsMatch(input, edge);
      if (!matched) return null;
      return { edge, reversed: !forward };
    })
    .filter(Boolean);
}

function matchesType(input, edge) {
  if (!input.type) return edge.cge_type == null;
  return edge.cge_type === input.type;
}

function matchesLabel(input, edge) {
  if (!input.label) return false;
  return edgeLabel(edge) === input.label;
}

function isCooccurrenceEdge(edge) {
  if (edge.cge_type == null) return true;
  if (typeof edge.cge_id === 'string' && edge.cge_id.startsWith('hindsight')) return true;
  return false;
}

function isCooccurrenceInput(input) {
  return typeof input.id === 'string' && input.id.startsWith('hindsight');
}

function buildResolvedCooccurrence(input) {
  return {
    input_index: input.input_index,
    id: input.id,
    from: input.from,
    to: input.to,
    type: null,
    label: null,
    detail: null,
    match_class: 'id',
    stage: 'id',
    reversed: false,
    candidates: [],
  };
}

function buildResolved(input, edge, matchClass, reversed = false) {
  return {
    input_index: input.input_index,
    id: edge.cge_id,
    from: input.from,
    to: input.to,
    type: edge.cge_type,
    label: edgeLabel(edge),
    detail: edgeDetail(edge),
    match_class: matchClass,
    stage: matchClass,
    reversed,
    candidates: [],
  };
}

function candidateSummary(edge) {
  return {
    id: edge.cge_id,
    from: edge.cge_source_id,
    to: edge.cge_target_id,
    type: edge.cge_type,
    label: edgeLabel(edge),
    detail: edgeDetail(edge),
  };
}

function buildUnresolved(input, stage, candidates = []) {
  return {
    input_index: input.input_index,
    id: null,
    from: input.from,
    to: input.to,
    type: input.type,
    label: input.label,
    detail: input.detail,
    match_class: null,
    stage,
    reversed: false,
    candidates,
  };
}

function evidenceOverlap(inputEvidence, candidateEvidence) {
  if (inputEvidence.length === 0 || candidateEvidence.length === 0) return 0;
  const inputSet = new Set(inputEvidence);
  let count = 0;
  for (const id of candidateEvidence) {
    if (inputSet.has(id)) count += 1;
  }
  return count;
}

function tryEvidenceTieBreak(input, candidates) {
  const scored = candidates.map(({ edge, reversed }) => ({
    edge,
    reversed,
    score: evidenceOverlap(input.evidence, edgeEvidence(edge)),
  }));
  const maxScore = Math.max(...scored.map((s) => s.score));
  if (maxScore === 0) return null;
  const best = scored.filter((s) => s.score === maxScore);
  if (best.length !== 1) return null;
  return best[0];
}

function tryResolveOrientation(input, contextualEdges, contextualById) {
  if (input.id) {
    const exact = contextualById.get(input.id);
    if (exact) {
      return { match: exact, matchClass: 'id', reversed: false };
    }
  }

  const candidates = collectOrientedCandidates(input, contextualEdges);
  if (candidates.length === 0) {
    return { stage: 'no_endpoints' };
  }

  const endpointEdges = candidates.map(({ edge }) => edge);

  // If the input carries a type, prefer a full endpoints + type + label match.
  if (input.type) {
    const typeCandidates = candidates.filter(({ edge }) => matchesType(input, edge));

    if (typeCandidates.length === 0) {
      // No contextual edge has the requested type. A label match between two
      // nodes is usually robust, so fall back to label-only resolution across the
      // endpoint candidates (both orientations).
      if (input.label) {
        const labelCandidates = candidates.filter(({ edge }) => matchesLabel(input, edge));
        if (labelCandidates.length === 1) {
          return { match: labelCandidates[0].edge, matchClass: 'label', reversed: labelCandidates[0].reversed };
        }
        if (labelCandidates.length > 1) {
          const tieBreak = tryEvidenceTieBreak(input, labelCandidates);
          if (tieBreak) {
            return { match: tieBreak.edge, matchClass: 'evidence', reversed: tieBreak.reversed };
          }
          return { stage: 'ambiguous_label', candidates: labelCandidates.map(({ edge }) => edge) };
        }
      }
      return { stage: 'no_type', candidates: endpointEdges };
    }

    if (input.label) {
      const labelCandidates = typeCandidates.filter(({ edge }) => matchesLabel(input, edge));
      if (labelCandidates.length === 1) {
        return { match: labelCandidates[0].edge, matchClass: 'full', reversed: labelCandidates[0].reversed };
      }
      const pool = labelCandidates.length > 1 ? labelCandidates : typeCandidates;
      const tieBreak = tryEvidenceTieBreak(input, pool);
      if (tieBreak) {
        return { match: tieBreak.edge, matchClass: 'evidence', reversed: tieBreak.reversed };
      }
      const stage = labelCandidates.length > 1 ? 'ambiguous_label' : 'no_label_match';
      return { stage, candidates: pool.map(({ edge }) => edge) };
    }

    if (typeCandidates.length === 1) {
      return { match: typeCandidates[0].edge, matchClass: 'partial', reversed: typeCandidates[0].reversed };
    }

    const tieBreak = tryEvidenceTieBreak(input, typeCandidates);
    if (tieBreak) {
      return { match: tieBreak.edge, matchClass: 'evidence', reversed: tieBreak.reversed };
    }

    return { stage: 'ambiguous_type', candidates: typeCandidates.map(({ edge }) => edge) };
  }

  // No input type. If a label is present, resolve by endpoints + label across all
  // contextual edges and orientations. This is the co-occurrence / diagram edge case.
  if (input.label) {
    const labelCandidates = candidates.filter(({ edge }) => matchesLabel(input, edge));
    if (labelCandidates.length === 1) {
      return { match: labelCandidates[0].edge, matchClass: 'label', reversed: labelCandidates[0].reversed };
    }
    if (labelCandidates.length > 1) {
      const tieBreak = tryEvidenceTieBreak(input, labelCandidates);
      if (tieBreak) {
        return { match: tieBreak.edge, matchClass: 'evidence', reversed: tieBreak.reversed };
      }
      return { stage: 'ambiguous_label', candidates: labelCandidates.map(({ edge }) => edge) };
    }
  }

  return { stage: 'no_type', candidates: endpointEdges };
}

function resolveSingleEdge(input, contextualEdges, contextualById) {
  if (isCooccurrenceInput(input)) {
    return buildResolvedCooccurrence(input);
  }

  const primary = tryResolveOrientation(input, contextualEdges, contextualById);
  if (primary.match) {
    return buildResolved(input, primary.match, primary.matchClass, primary.reversed);
  }

  return buildUnresolved(input, primary.stage, (primary.candidates || []).map(candidateSummary));
}

/**
 * Resolve a list of graph edges against the contextual-graph edge table.
 *
 * Each returned edge carries a `match_class`:
 *   - 'id'    : the input edge.id matched a contextual edge id exactly
 *   - 'full'  : exactly one contextual edge matched from/to/type/label
 *   - 'label' : exactly one contextual edge matched from/to/label (input had no type; robust for co-occurrence edges)
 *   - 'partial': exactly one contextual edge matched from/to/type (input had no label)
 *   - 'evidence': tie-broken from an ambiguous set by shared evidence ids
 *   - null    : no unambiguous match found
 *
 * For unresolved edges, `stage` explains where resolution failed:
 *   - 'no_endpoints'    : no contextual edge shares these endpoints
 *   - 'no_type'         : endpoints matched, but no edge had the requested type
 *   - 'ambiguous_type'  : multiple edges matched from/to/type; input had no label
 *   - 'no_label_match'  : input had a label but no edge matched it exactly
 *   - 'ambiguous_label' : multiple edges matched from/to/label (co-occurrence input) or from/to/type/label
 *   - 'ambiguous_evidence' : evidence tie-break did not produce a unique winner
 *
 * Returned from/to always reflects the input orientation, not the stored
 * orientation, so the caller can build a view that matches the source graph.
 * If a match was only possible by flipping orientation, `reversed: true` is set.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   edges?: Array<{
 *     input_index: number,
 *     id: string | null,
 *     from: string,
 *     to: string,
 *     type: string | null,
 *     label: string | null,
 *     detail: string | null,
 *     match_class: 'id' | 'full' | 'label' | 'partial' | 'evidence' | null,
 *     stage: string,
 *     reversed: boolean,
 *     candidates: Array<{id: string, from: string, to: string, type: string | null, label: string | null, detail: string | null}>,
 *   }>,
 *   error?: string,
 *   code?: string,
 * }>}
 */
export async function resolveGraphEdges(db, serverId, bankId, graph) {
  const validation = validateResolveEdgesPayload({ server_id: serverId, bank_id: bankId, graph });
  if (!validation.valid) {
    return { success: false, error: validation.error, code: validation.code };
  }

  const inputEdges = validation.edges;
  if (inputEdges.length === 0) {
    return { success: true, edges: [] };
  }

  const edgesResult = await listEdges(db, serverId, bankId, { limit: 10000 });
  if (!edgesResult.success) {
    logger.warn('Failed to load contextual edges', { serverId, bankId, error: edgesResult.error });
    return { success: false, error: edgesResult.error, code: edgesResult.code || 'DATABASE_ERROR' };
  }

  const contextualEdges = (edgesResult.data || []).filter((e) => !isCooccurrenceEdge(e));
  const contextualById = new Map(contextualEdges.map((e) => [e.cge_id, e]));

  const resolved = inputEdges.map((input) => resolveSingleEdge(input, contextualEdges, contextualById));

  return { success: true, edges: resolved };
}

export default {
  resolveGraphEdges,
  validateResolveEdgesPayload,
};
