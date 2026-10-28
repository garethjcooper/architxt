import { listEntityTypes } from '../db/crud/entity-types.js';
import { listEdgeTypes } from '../db/crud/edge-types.js';

/**
 * Default architecture mapping for nodes/edges that have no explicit mapping.
 */
const DEFAULT_EDGE_ARCHIMATE_RELATIONSHIP = 'association';
const DEFAULT_EDGE_C4_DESCRIPTION = 'relates to';

/**
 * Resolve C4 and ArchiMate metadata for a set of contextual-graph nodes and edges.
 *
 * Node mapping: the contextual graph stores node labels that include the entity
 * type name for canonical/grounded nodes (e.g. `a-com`). We also try to infer
 * the type from a `type_name` property or from the `cgn_id` prefix. If no
 * mapping is found, the node is returned as unmapped.
 *
 * Edge mapping: edge `type` values are matched against the `edge_types` catalog.
 * If an edge has no type or no catalog mapping, it defaults to a generic
 * `association` (ArchiMate) / `relates to` (C4) and is flagged as defaulted.
 *
 * @param {Object} db
 * @param {Array<{id: string, labels?: string[], properties?: Record<string, any>}>} nodes
 * @param {Array<{id: string, type?: string | null, properties?: Record<string, any>}>} edges
 * @returns {{
 *   nodeMap: Map<string, { c4Element: string | null, archimateElement: string | null, typeName: string | null, defaulted: boolean }>,
 *   edgeMap: Map<string, { c4Description: string | null, archimateRelationship: string | null, typeName: string | null, defaulted: boolean }>
 * }}
 */
export async function resolveArchitectureMetadata(db, nodes, edges) {
  const entityTypesResult = await listEntityTypes(db, { limit: 10000, offset: 0 });
  const edgeTypesResult = await listEdgeTypes(db, { limit: 10000, offset: 0 });

  const entityTypesByName = new Map();
  for (const type of entityTypesResult.success ? entityTypesResult.data : []) {
    entityTypesByName.set(type.et_type_name, type);
  }

  const edgeTypesByName = new Map();
  for (const type of edgeTypesResult.success ? edgeTypesResult.data : []) {
    edgeTypesByName.set(type.edt_type_name, type);
  }

  function resolveNodeTypeName(node) {
    const labels = node.labels || [];
    // Most canonical/grounded nodes have their entity type name in labels.
    for (const label of labels) {
      if (entityTypesByName.has(label)) return label;
    }
    // Allow an explicit property override.
    if (node.properties?.type_name && entityTypesByName.has(node.properties.type_name)) {
      return node.properties.type_name;
    }
    // Fallback: parse "type_name:local-id" from the node id.
    if (typeof node.id === 'string' && node.id.includes(':')) {
      const prefix = node.id.split(':')[0];
      if (entityTypesByName.has(prefix)) return prefix;
    }
    return null;
  }

  const nodeMap = new Map();
  for (const node of nodes) {
    const typeName = resolveNodeTypeName(node);
    const type = typeName ? entityTypesByName.get(typeName) : null;
    const c4Element = type?.et_c4_element || null;
    const archimateElement = type?.et_archimate_element || null;
    nodeMap.set(node.id, {
      c4Element,
      archimateElement,
      typeName,
      defaulted: !typeName,
    });
  }

  const edgeMap = new Map();
  for (const edge of edges) {
    const typeName = edge.type || null;
    const type = typeName ? edgeTypesByName.get(typeName) : null;
    const c4Description = type?.edt_c4_description || (typeName ? DEFAULT_EDGE_C4_DESCRIPTION : null);
    const archimateRelationship = type?.edt_archimate_relationship || (typeName ? DEFAULT_EDGE_ARCHIMATE_RELATIONSHIP : null);
    edgeMap.set(edge.id, {
      c4Description,
      archimateRelationship,
      typeName,
      defaulted: !type,
    });
  }

  return { nodeMap, edgeMap };
}
