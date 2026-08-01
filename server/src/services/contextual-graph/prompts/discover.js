const DISCOVER_SCHEMA = {
  candidates: [
    {
      id: 'stable normalized id for the candidate',
      summary: 'short evidence-backed summary of the candidate',
      hypothesized_edges: [
        {
          target: 'id of an existing related node',
          type: 'calls|sends|reads|writes|depends-on|co-occurs',
          evidence: 'memory-id or short corpus evidence',
        },
      ],
    },
  ],
};

/**
 * Compose a discovery mental model specification for a seed node.
 *
 * The actual prompt template will be defined later; this function returns a stable
 * model contract (ext_id, name, source_query, output schema) that the deployment
 * service can persist and push to Hindsight.
 *
 * @param {Object} options
 * @param {string} options.seedId
 * @param {string} options.bankId
 * @param {string} [options.seedName]
 * @param {string[]} [options.neighborIds]
 * @param {number} [options.maxTokens]
 * @returns {{ ext_id: string, name: string, source_query: string, returns: string, dimension: string, max_tokens: number, tags: string[] }}
 */
export function composeDiscoverModel({ seedId, bankId, seedName, neighborIds = [], maxTokens = 4096 }) {
  const safeName = seedName || seedId;
  const batchTs = Date.now();
  const extId = `discover-${seedId}-${batchTs}`;

  const sourceQuery = [
    `Discovery request around seed node "${safeName}" (${seedId}) in bank ${bankId}.`,
    neighborIds.length > 0 ? `Known neighbors: ${neighborIds.join(', ')}.` : 'Known neighbors: none.',
    'Return only the following JSON object:',
    JSON.stringify(DISCOVER_SCHEMA, null, 2),
  ].join('\n');

  return {
    ext_id: extId,
    name: `Discover around ${safeName}`,
    source_query: sourceQuery,
    returns: 'summary',
    dimension: 'summary',
    max_tokens: maxTokens,
    tags: [`ctx-${bankId}`, `discover`, `seed-${seedId}`],
  };
}

/**
 * Return the expected JSON output schema for discover models.
 */
export function getDiscoverSchema() {
  return DISCOVER_SCHEMA;
}
