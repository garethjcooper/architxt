/**
 * Escape a string for use in XML text content or attribute values.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Replace characters that are not legal in an XML NMTOKEN with an underscore.
 *
 * GraphML requires the values of id/source/target attributes and key ids to be
 * NMTOKENs. XML escaping changes the serialized text but not the parsed value,
 * so characters such as whitespace, '<', '&' or quotes must be removed.
 *
 * @param {string} value
 * @returns {string}
 */
function toNmtoken(value) {
  if (value === null || value === undefined) return '';
  // Allow ASCII letters, digits, '.', '-', '_', ':' which are always valid
  // NameChars. Drop everything else.
  return String(value).replace(/[^A-Za-z0-9._:-]/g, '_');
}

/**
 * Convert a value to a GraphML attribute type.
 *
 * Supported GraphML types: boolean, int, long, float, double, string.
 *
 * @param {any} value
 * @returns {{ type: string, value: string, scalar: boolean }}
 */
function graphmlTypeAndValue(value) {
  if (value === null || value === undefined) {
    return { type: 'string', value: '', scalar: true };
  }
  if (typeof value === 'boolean') {
    return { type: 'boolean', value: value ? 'true' : 'false', scalar: true };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { type: 'long', value: String(value), scalar: true };
    }
    return { type: 'double', value: String(value), scalar: true };
  }
  if (typeof value === 'string') {
    return { type: 'string', value: escapeXml(value), scalar: true };
  }
  // Objects and arrays: keep the structure by JSON-stringifying them. The key
  // will be declared as a string and every value for that key will be a JSON
  // string, which avoids mixing typed and untyped values.
  return { type: 'string', value: escapeXml(JSON.stringify(value)), scalar: false };
}

/**
 * Build a GraphML 1.0 document from the exported graph.
 *
 * Node labels are exported as a comma-separated string under the `labels` key,
 * and a display-friendly `label` key is derived from either `properties.name`,
 * `properties.label` or the node id. Edge `type` is exported under the `type`
 * key and also as a display-friendly `label` key. These two keys help graph
 * visualisers such as Gephi and yEd show meaningful names by default.
 * All other node/edge properties are flattened into individual `<data>` keys.
 *
 * Reserved built-in keys use ids prefixed with `architxt-` so that user
 * properties named `label`, `labels`, or `type` cannot collide with them.
 *
 * @param {Array<{id: string, labels: string[], properties: Record<string, any>}>} nodes
 * @param {Array<{id: string, source_id: string, target_id: string, type: string | null, properties: Record<string, any>}>} edges
 * @param {Object} meta
 * @param {boolean} undirected
 * @returns {string}
 */
export function toGraphML(nodes, edges, meta, undirected = false) {
  const edgeDefault = undirected ? 'undirected' : 'directed';

  // Built-in keys use a reserved id prefix so user properties never collide.
  // The display label is split into node and edge keys because many simple
  // GraphML parsers do not handle for="all" correctly.
  const reservedKeys = {
    nodeLabel: { id: 'architxt-node-label', for: 'node', name: 'label' },
    labels: { id: 'architxt-labels', for: 'node', name: 'labels' },
    edgeLabel: { id: 'architxt-edge-label', for: 'edge', name: 'label' },
    type: { id: 'architxt-type', for: 'edge', name: 'type' },
  };

  // Generate a unique, NMTOKEN-safe key id for every property. We keep the
  // original property name as attr.name so visualisers display something human
  // readable, but the key id used in data/@key must be a valid NMTOKEN.
  function makeKeyRegistry(defaults) {
    const registry = new Map();
    const usedIds = new Set(Object.values(reservedKeys).map((k) => k.id));

    function register(name) {
      if (registry.has(name)) {
        return registry.get(name);
      }
      if (reservedKeys[name]) {
        registry.set(name, { ...reservedKeys[name] });
        return registry.get(name);
      }
      let baseId = toNmtoken(name);
      if (!baseId) baseId = 'key';
      let id = baseId;
      let counter = 1;
      while (usedIds.has(id)) {
        id = `${baseId}_${counter}`;
        counter += 1;
      }
      usedIds.add(id);
      registry.set(name, { id, for: defaults, name });
      return registry.get(name);
    }

    return { get: (name) => registry.get(name), register };
  }

  const nodeKeys = makeKeyRegistry('node');
  const edgeKeys = makeKeyRegistry('edge');

  // Collect property types. If any value for a key is non-scalar, force the
  // whole column to string so the type declaration stays consistent.
  function collectPropertyTypes(items) {
    const types = new Map();
    for (const item of items) {
      const props = item.properties || {};
      for (const [key, value] of Object.entries(props)) {
        const { type, scalar } = graphmlTypeAndValue(value);
        const current = types.get(key);
        if (!current) {
          types.set(key, { type, scalar });
        } else if (!scalar || !current.scalar) {
          types.set(key, { type: 'string', scalar: false });
        }
      }
    }
    return types;
  }

  const nodePropertyTypes = collectPropertyTypes(nodes);
  const edgePropertyTypes = collectPropertyTypes(edges);
  if (edges.some((e) => e.type)) {
    edgePropertyTypes.set('type', { type: 'string', scalar: true });
  }

  // Generate NMTOKEN-safe node ids and keep a map for edge endpoints.
  const nodeIdMap = new Map();
  const usedNodeIds = new Set();
  const seenNodeIds = new Set();
  for (const node of nodes) {
    if (seenNodeIds.has(node.id)) {
      continue;
    }
    seenNodeIds.add(node.id);
    let safe = toNmtoken(node.id);
    if (!safe) safe = 'n';
    let counter = 1;
    const base = safe;
    while (usedNodeIds.has(safe)) {
      safe = `${base}_${counter}`;
      counter += 1;
    }
    usedNodeIds.add(safe);
    nodeIdMap.set(node.id, safe);
  }

  function safeNodeId(id) {
    return nodeIdMap.get(id) ?? toNmtoken(id);
  }

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<graphml xmlns="http://graphml.graphdrawing.org/xmlns"');
  lines.push('         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('         xsi:schemaLocation="http://graphml.graphdrawing.org/xmlns');
  lines.push('                             http://graphml.graphdrawing.org/xmlns/1.0/graphml.xsd">');

  // Declare keys.
  for (const key of Object.values(reservedKeys)) {
    lines.push(`  <key id="${key.id}" for="${key.for}" attr.name="${escapeXml(key.name)}" attr.type="string"/>`);
  }
  for (const [key, { type }] of nodePropertyTypes) {
    if (reservedKeys[key]) continue;
    const reg = nodeKeys.register(key);
    lines.push(`  <key id="${reg.id}" for="node" attr.name="${escapeXml(reg.name)}" attr.type="${type}"/>`);
  }
  for (const [key, { type }] of edgePropertyTypes) {
    if (reservedKeys[key]) continue;
    const reg = edgeKeys.register(key);
    lines.push(`  <key id="${reg.id}" for="edge" attr.name="${escapeXml(reg.name)}" attr.type="${type}"/>`);
  }

  // Graph element.
  lines.push(`  <graph id="${escapeXml(meta.bank_id || 'G')}" edgedefault="${edgeDefault}">`);

  function emitData(registry, propertyTypes, key, value) {
    const entry = registry.get(key) ?? registry.register(key);
    const columnType = propertyTypes.get(key)?.type ?? 'string';
    const { value: serialized } = graphmlTypeAndValue(value);
    if (value === null || value === undefined) {
      // Only emit empty data for string keys; typed keys cannot be empty.
      if (columnType === 'string') {
        lines.push(`      <data key="${entry.id}"></data>`);
      }
      return;
    }
    lines.push(`      <data key="${entry.id}">${serialized}</data>`);
  }

  // Nodes.
  const emittedNodes = new Set();
  for (const node of nodes) {
    if (emittedNodes.has(node.id)) continue;
    emittedNodes.add(node.id);
    const nodeId = safeNodeId(node.id);
    lines.push(`    <node id="${nodeId}">`);
    const displayLabel = node.properties?.name
      || node.properties?.label
      || (node.labels || [])[0]
      || node.id;
    lines.push(`      <data key="${reservedKeys.nodeLabel.id}">${escapeXml(displayLabel)}</data>`);
    const labels = (node.labels || []).join(',');
    if (labels) {
      lines.push(`      <data key="${reservedKeys.labels.id}">${escapeXml(labels)}</data>`);
    }
    const props = node.properties || {};
    for (const [key, value] of Object.entries(props)) {
      if (key === 'label') continue;
      if (reservedKeys[key] && key === 'labels') continue;
      emitData(nodeKeys, nodePropertyTypes, key, value);
    }
    lines.push('    </node>');
  }

  // Edges.
  const usedEdgeIds = new Set();
  for (const edge of edges) {
    const sourceId = safeNodeId(edge.source_id);
    const targetId = safeNodeId(edge.target_id);

    let edgeId = toNmtoken(edge.id);
    if (!edgeId) edgeId = 'e';
    let counter = 1;
    const baseEdgeId = edgeId;
    while (usedEdgeIds.has(edgeId)) {
      edgeId = `${baseEdgeId}_${counter}`;
      counter += 1;
    }
    usedEdgeIds.add(edgeId);

    const edgeDirected = edge.properties?.directed;
    const directedAttr = typeof edgeDirected === 'boolean'
      ? ` directed="${edgeDirected ? 'true' : 'false'}"`
      : '';
    lines.push(`    <edge id="${edgeId}" source="${sourceId}" target="${targetId}"${directedAttr}>`);

    const edgeDisplayLabel = edge.type
      || edge.properties?.label
      || `${edge.source_id} → ${edge.target_id}`;
    lines.push(`      <data key="${reservedKeys.edgeLabel.id}">${escapeXml(edgeDisplayLabel)}</data>`);
    if (edge.type) {
      lines.push(`      <data key="${reservedKeys.type.id}">${escapeXml(edge.type)}</data>`);
    }
    const props = edge.properties || {};
    for (const [key, value] of Object.entries(props)) {
      if (key === 'label') continue;
      if (reservedKeys[key] && key === 'type') continue;
      emitData(edgeKeys, edgePropertyTypes, key, value);
    }
    lines.push('    </edge>');
  }

  lines.push('  </graph>');
  lines.push('</graphml>');

  return lines.join('\n');
}

export default toGraphML;
