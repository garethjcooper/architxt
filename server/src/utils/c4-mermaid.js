/**
 * C4 Model Mermaid export.
 *
 * Produces a Mermaid C4 diagram (.mmd) from the contextual graph using the C4
 * element mappings stored on entity types and the C4 relationship descriptions
 * stored on edge types.
 *
 * Node C4 mappings are rendered with the matching Mermaid C4 macro:
 *   Person         -> Person
 *   SoftwareSystem -> System
 *   Container      -> Container
 *   Component      -> Component
 *
 * Edges are rendered as Rel() / BiRel() between Mermaid aliases.
 *
 * @see https://mermaid.js.org/syntax/c4.html
 */

const C4_ELEMENT_MACRO = {
  Person: 'Person',
  SoftwareSystem: 'System',
  Container: 'Container',
  Component: 'Component',
};

/**
 * Create a valid Mermaid alias from an arbitrary node id.
 *
 * Aliases may contain letters, digits and underscores, must start with a letter,
 * and are case-insensitive. We normalise to lower case and collapse
 * non-alphanumerics to underscores. Leading digits are prefixed with "id_".
 */
function makeAlias(id) {
  if (!id) return 'unknown';
  let sanitized = String(id)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!sanitized) return 'unknown';
  if (/^[0-9]/.test(sanitized)) {
    sanitized = `id_${sanitized}`;
  }
  return sanitized;
}

function escapeMermaidString(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/"/g, '\\"');
}

function nodeLabel(node) {
  return (
    node.properties?.name ||
    node.properties?.display_name ||
    node.properties?.label ||
    node.labels?.find((l) => l !== 'canonical' && l !== 'candidate') ||
    node.labels?.[0] ||
    node.id
  );
}

function edgeDescription(edge, mapping) {
  const raw =
    mapping?.c4Description ||
    edge.type ||
    edge.properties?.label ||
    'relates to';
  return escapeMermaidString(raw);
}

function formatElementMacro(alias, macro, label, description, typeName) {
  const escapedLabel = escapeMermaidString(label);
  const escapedDescription = escapeMermaidString(description || typeName || '');
  const escapedType = escapeMermaidString(typeName || '');

  // Mermaid C4 macros for elements take: alias, "label", "description"[, "technology"]
  if (macro === 'Container' || macro === 'Component') {
    if (escapedType) {
      return `${macro}(${alias}, "${escapedLabel}", "${escapedDescription}", "${escapedType}")`;
    }
    return `${macro}(${alias}, "${escapedLabel}", "${escapedDescription}")`;
  }
  return `${macro}(${alias}, "${escapedLabel}", "${escapedDescription}")`;
}

function formatRelationship(alias1, alias2, description, undirected) {
  const escapedDescription = escapeMermaidString(description);
  if (undirected) {
    return `BiRel(${alias1}, ${alias2}, "${escapedDescription}")`;
  }
  return `Rel(${alias1}, ${alias2}, "${escapedDescription}")`;
}

/**
 * Build a Mermaid C4 diagram representation of the graph.
 *
 * @param {Array<{id: string, labels: string[], properties: Record<string, any>}>} nodes
 * @param {Array<{id: string, source_id: string, target_id: string, type: string | null, properties: Record<string, any>}>} edges
 * @param {Object} meta
 * @param {boolean} undirected
 * @param {Map<string, {c4Element: string | null, archimateElement: string | null, typeName: string | null, defaulted: boolean}>} nodeMap
 * @param {Map<string, {c4Description: string | null, archimateRelationship: string | null, typeName: string | null, defaulted: boolean}>} edgeMap
 * @returns {string}
 */
export function toC4Mermaid(nodes, edges, meta, undirected, nodeMap, edgeMap) {
  const bankName = meta.bank_id || 'export';
  const lines = [];
  lines.push('C4Container');
  lines.push(`    title Container diagram for ${escapeMermaidString(bankName)}`);
  lines.push('');

  const aliases = new Map(); // node.id -> alias

  for (const node of nodes) {
    const mapping = nodeMap.get(node.id) || {};
    const c4Element = mapping.c4Element || null;
    const macro = C4_ELEMENT_MACRO[c4Element] || 'System';
    const alias = makeAlias(node.id);
    aliases.set(node.id, alias);

    const label = nodeLabel(node);
    const description = node.properties?.description || '';
    const typeName = mapping.typeName || '';
    lines.push(`    ${formatElementMacro(alias, macro, label, description, typeName)}`);
  }

  if (edges.length > 0 && nodes.length > 0) {
    lines.push('');
  }

  for (const edge of edges) {
    const sourceAlias = aliases.get(edge.source_id);
    const targetAlias = aliases.get(edge.target_id);
    if (!sourceAlias || !targetAlias) continue;

    const mapping = edgeMap.get(edge.id) || {};
    const description = edgeDescription(edge, mapping);
    const isUndirected = undirected || edge.properties?.directed === false;
    lines.push(`    ${formatRelationship(sourceAlias, targetAlias, description, isUndirected)}`);
  }

  return lines.join('\n');
}

export default toC4Mermaid;
