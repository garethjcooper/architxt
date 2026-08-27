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
    narrative_name: { type: 'string' },
    graph: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nodes: { type: 'array' },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              type: { type: 'string' },
              label: { type: 'string' },
              detail: { type: 'string' },
              properties: {
                type: 'object',
                properties: {
                  dataObjects: { type: 'array', items: { type: 'string' } },
                  protocol: { type: 'string' },
                  format: { type: 'string' },
                  frequency: { type: 'string' },
                  intermediaries: { type: 'array', items: { type: 'string' } },
                  reliability: { type: 'string' },
                  auth: { type: 'string' },
                  encryption: { type: 'string' },
                },
              },
              evidence: { type: 'array', items: { type: 'string' } },
            },
            required: ['from', 'to', 'type', 'label', 'detail'],
          },
        },
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
