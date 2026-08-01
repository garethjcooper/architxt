const ENTITY_CTX_SCHEMA = {
  aliases: ['array of alternate names for the node'],
  artifacts: [
    { name: 'artifact name', artifact_type: 'endpoint|table|file|function|schema|event|queue|dependency', evidence: ['memory-id'] },
  ],
  mentions: [
    { node_id: 'related node id', context: 'brief co-occurrence context', evidence: ['memory-id'] },
  ],
  summary: 'evidence-backed summary of the node',
  evidence: ['memory-id-1'],
};

/**
 * Compose an entity-context mental model specification for a working-graph node.
 *
 * The actual prompt template will be defined later; this function returns a stable
 * model contract (ext_id, name, source_query, output schema) that the deployment
 * service can persist and push to Hindsight.
 *
 * @param {Object} options
 * @param {string} options.nodeId
 * @param {string} options.bankId
 * @param {string} [options.displayName]
 * @param {string[]} [options.labels]
 * @param {number} [options.maxTokens]
 * @returns {{ ext_id: string, name: string, source_query: string, returns: string, dimension: string, max_tokens: number, tags: string[] }}
 */
export function composeEntityContextModel({ nodeId, bankId, displayName, labels = [], maxTokens = 4096 }) {
  const safeName = displayName || nodeId;
  const extId = `entity-ctx-${nodeId}`;

  const sourceQuery = [
    `Entity context request for "${safeName}" (${nodeId}) in bank ${bankId}.`,
    `Labels: ${labels.join(', ') || 'none'}.`,
    'Return only the following JSON object:',
    JSON.stringify(ENTITY_CTX_SCHEMA, null, 2),
  ].join('\n');

  return {
    ext_id: extId,
    name: `Entity context: ${safeName}`,
    source_query: sourceQuery,
    returns: 'summary',
    dimension: 'summary',
    max_tokens: maxTokens,
    tags: [`ctx-${bankId}`, `entity-ctx`, `node-${nodeId}`],
  };
}

/**
 * Return the expected JSON output schema for entity-ctx models.
 */
export function getEntityContextSchema() {
  return ENTITY_CTX_SCHEMA;
}
