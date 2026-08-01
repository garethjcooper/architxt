const EDGE_CTX_SCHEMA = {
  relationships: [
    {
      type: 'calls|sends|reads|writes|depends-on',
      source_id: 'source node id',
      target_id: 'target node id',
      confidence: 0.85,
      label: 'human-readable label',
      evidence: ['memory-id'],
    },
  ],
};

const VALID_EDGE_TYPES = new Set(['calls', 'sends', 'reads', 'writes', 'depends-on']);

/**
 * Compose an edge-context mental model specification for a pair of nodes.
 *
 * The actual prompt template will be defined later; this function returns a stable
 * model contract (ext_id, name, source_query, output schema) that the deployment
 * service can persist and push to Hindsight.
 *
 * @param {Object} options
 * @param {string} options.sourceId
 * @param {string} options.targetId
 * @param {string} options.bankId
 * @param {string} [options.sourceName]
 * @param {string} [options.targetName]
 * @param {number} [options.maxTokens]
 * @returns {{ ext_id: string, name: string, source_query: string, returns: string, dimension: string, max_tokens: number, tags: string[] }}
 */
export function composeEdgeContextModel({
  sourceId,
  targetId,
  bankId,
  sourceName,
  targetName,
  maxTokens = 4096,
}) {
  const safeSource = sourceName || sourceId;
  const safeTarget = targetName || targetId;
  const pairKey = [sourceId, targetId].sort().join('|');
  const extId = `edge-ctx-${pairKey}`;

  const sourceQuery = [
    `Edge context request between "${safeSource}" (${sourceId}) and "${safeTarget}" (${targetId}) in bank ${bankId}.`,
    `Return only the following JSON object. Each relationship must use one of these types: ${Array.from(VALID_EDGE_TYPES).join(', ')}.`,
    JSON.stringify(EDGE_CTX_SCHEMA, null, 2),
  ].join('\n');

  return {
    ext_id: extId,
    name: `Edge context: ${safeSource} ↔ ${safeTarget}`,
    source_query: sourceQuery,
    returns: 'summary',
    dimension: 'summary',
    max_tokens: maxTokens,
    tags: [`ctx-${bankId}`, `edge-ctx`, `pair-${pairKey}`],
  };
}

/**
 * Return the expected JSON output schema for edge-ctx models.
 */
export function getEdgeContextSchema() {
  return EDGE_CTX_SCHEMA;
}

/**
 * Return the set of valid directed relationship types.
 */
export function getValidEdgeTypes() {
  return Array.from(VALID_EDGE_TYPES);
}
