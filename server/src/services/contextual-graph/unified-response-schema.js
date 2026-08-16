/**
 * Unified contextual-graph response schema.
 *
 * Used for any Hindsight call whose output should be parsed into the standard
 * contextual-graph envelope: narrative + graph + tables + diagrams. This schema
 * is shared by the Reflect handler and by mental-model create/update payloads
 * so every contextual-graph-producing call path has the same contract.
 */

export const UNIFIED_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    narrative: { type: 'string' },
    graph: {
      type: 'object',
      properties: {
        nodes: { type: 'array' },
        edges: { type: 'array' },
      },
      required: ['nodes', 'edges'],
    },
    tables: { type: 'array' },
    diagrams: { type: 'array' },
  },
  required: ['narrative', 'graph', 'tables', 'diagrams'],
};

/**
 * True if the given schema object looks like the unified contextual-graph
 * envelope. Useful for debug logging or for deciding whether a stored schema
 * needs to be refreshed.
 */
export function isUnifiedResponseSchema(schema) {
  if (!schema || schema.type !== 'object') return false;
  const required = new Set(schema.required || []);
  return (
    required.has('narrative') &&
    required.has('graph') &&
    required.has('tables') &&
    required.has('diagrams')
  );
}
