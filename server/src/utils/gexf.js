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
 * Escape a string for use in a double-quoted XML attribute value.
 * Same characters as escapeXml; kept explicit for readability.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeAttr(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Replace characters that are not legal in an XML NMTOKEN with an underscore.
 *
 * GEXF requires id/source/target attributes and attribute ids to be valid
 * NMTOKENs. Escaping changes the text but not the parsed value, so
 * whitespace, '<', '&', quotes and most punctuation must be removed.
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
 * Convert a value to a GEXF 1.3 attribute type and serialized value.
 *
 * Supported GEXF 1.3 types: integer, long, float, double, boolean, string,
 * list-string, anyURI, float, date.
 *
 * @param {any} value
 * @returns {{ type: string, value: string, scalar: boolean }}
 */
function gexfTypeAndValue(value) {
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
  // Objects and arrays: keep the structure by JSON-stringifying them. The
  // attribute will be declared as a string and every value for that attribute
  // will be a JSON string, which avoids mixing typed and untyped values.
  return { type: 'string', value: escapeXml(JSON.stringify(value)), scalar: false };
}

/**
 * Build a GEXF 1.3 document from the exported graph.
 *
 * Node labels are exported as a comma-separated string under the `labels`
 * attribute, and a display-friendly `label` attribute is derived from either
 * `properties.name`, `properties.label` or the node id. Edge `type` is exported
 * under the `type` attribute and also as a display-friendly `label` attribute.
 * All other node/edge properties are flattened into individual `<attvalue>`
 * entries.
 *
 * Reserved built-in attributes use ids prefixed with `architxt-` so that user
 * properties named `label`, `labels`, or `type` cannot collide with them.
 *
 * @param {Array<{id: string, labels: string[], properties: Record<string, any>}>} nodes
 * @param {Array<{id: string, source_id: string, target_id: string, type: string | null, properties: Record<string, any>}>} edges
 * @param {Object} meta
 * @param {boolean} undirected
 * @returns {string}
 */
export function toGEXF(nodes, edges, meta, undirected = false) {
  const defaultEdgeType = undirected ? 'undirected' : 'directed';

  const reservedNodeAttrs = {
    label: { id: 'architxt-node-label', title: 'label', type: 'string' },
    labels: { id: 'architxt-labels', title: 'labels', type: 'string' },
  };

  const reservedEdgeAttrs = {
    label: { id: 'architxt-edge-label', title: 'label', type: 'string' },
    type: { id: 'architxt-type', title: 'type', type: 'string' },
  };

  function makeAttributeRegistry(defaultClass, reserved) {
    const registry = new Map();
    const usedIds = new Map();
    for (const attr of Object.values(reserved)) {
      usedIds.set(attr.id, attr);
    }

    function register(name) {
      if (registry.has(name)) {
        return registry.get(name);
      }
      const reservedAttr = reserved[name];
      if (reservedAttr) {
        registry.set(name, { ...reservedAttr });
        return registry.get(name);
      }
      let baseId = toNmtoken(name);
      if (!baseId) baseId = 'attr';
      let id = baseId;
      let counter = 1;
      while (usedIds.has(id)) {
        id = `${baseId}_${counter}`;
        counter += 1;
      }
      usedIds.set(id, true);
      registry.set(name, { id, title: name, class: defaultClass });
      return registry.get(name);
    }

    return { get: (name) => registry.get(name), register };
  }

  const nodeAttrs = makeAttributeRegistry('node', reservedNodeAttrs);
  const edgeAttrs = makeAttributeRegistry('edge', reservedEdgeAttrs);

  // Collect attribute types. If any value for an attribute is non-scalar, force
  // the whole column to string so the type declaration stays consistent.
  function collectPropertyTypes(items) {
    const types = new Map();
    for (const item of items) {
      const props = item.properties || {};
      for (const [key, value] of Object.entries(props)) {
        const { type, scalar } = gexfTypeAndValue(value);
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
  lines.push('<gexf xmlns="http://www.gexf.net/1.3"');
  lines.push('      xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('      xsi:schemaLocation="http://www.gexf.net/1.3 http://www.gexf.net/1.3/gexf.xsd"');
  lines.push(`      version="1.3"`);
  lines.push(`      variant="static">`);
  lines.push(`  <meta lastmodifieddate="${new Date().toISOString().slice(0, 10)}">`);
  lines.push(`    <creator>architxt</creator>`);
  if (meta.bank_id) {
    lines.push(`    <description>Contextual graph export for bank ${escapeXml(meta.bank_id)}</description>`);
  }
  lines.push('  </meta>');

  // Attribute declarations.
  lines.push('  <graph defaultedgetype="' + defaultEdgeType + '" mode="static">');

  // Node attributes.
  lines.push('    <attributes class="node">');
  for (const attr of Object.values(reservedNodeAttrs)) {
    lines.push(`      <attribute id="${attr.id}" title="${escapeAttr(attr.title)}" type="${attr.type}"/>`);
  }
  for (const [key, { type }] of nodePropertyTypes) {
    if (reservedNodeAttrs[key]) continue;
    const reg = nodeAttrs.register(key);
    lines.push(`      <attribute id="${reg.id}" title="${escapeAttr(reg.title)}" type="${type}"/>`);
  }
  lines.push('    </attributes>');

  // Edge attributes.
  lines.push('    <attributes class="edge">');
  for (const attr of Object.values(reservedEdgeAttrs)) {
    lines.push(`      <attribute id="${attr.id}" title="${escapeAttr(attr.title)}" type="${attr.type}"/>`);
  }
  for (const [key, { type }] of edgePropertyTypes) {
    if (reservedEdgeAttrs[key]) continue;
    const reg = edgeAttrs.register(key);
    lines.push(`      <attribute id="${reg.id}" title="${escapeAttr(reg.title)}" type="${type}"/>`);
  }
  lines.push('    </attributes>');

  function emitAttValue(registry, propertyTypes, key, value) {
    const entry = registry.get(key) ?? registry.register(key);
    const columnType = propertyTypes.get(key)?.type ?? 'string';
    const { value: serialized } = gexfTypeAndValue(value);
    if (value === null || value === undefined) {
      // Only emit empty attvalue for string attributes; typed attributes
      // cannot be empty in GEXF.
      if (columnType === 'string') {
        lines.push(`          <attvalue for="${entry.id}" value=""/>`);
      }
      return;
    }
    lines.push(`          <attvalue for="${entry.id}" value="${serialized}"/>`);
  }

  // Nodes.
  lines.push('    <nodes>');
  const emittedNodes = new Set();
  for (const node of nodes) {
    if (emittedNodes.has(node.id)) continue;
    emittedNodes.add(node.id);
    const nodeId = safeNodeId(node.id);
    const displayLabel = node.properties?.name
      || node.properties?.label
      || (node.labels || [])[0]
      || node.id;
    const labels = (node.labels || []).join(',');
    const labelAttr = labels
      ? ` label="${escapeAttr(displayLabel)}"`
      : ` label="${escapeAttr(displayLabel)}"`;
    lines.push(`      <node id="${nodeId}"${labelAttr}>`);
    lines.push('        <attvalues>');
    lines.push(`          <attvalue for="${reservedNodeAttrs.label.id}" value="${escapeAttr(displayLabel)}"/>`);
    if (labels) {
      lines.push(`          <attvalue for="${reservedNodeAttrs.labels.id}" value="${escapeAttr(labels)}"/>`);
    }
    const props = node.properties || {};
    for (const [key, value] of Object.entries(props)) {
      if (key === 'label') continue;
      if (reservedNodeAttrs[key] && key === 'labels') continue;
      emitAttValue(nodeAttrs, nodePropertyTypes, key, value);
    }
    lines.push('        </attvalues>');
    lines.push('      </node>');
  }
  lines.push('    </nodes>');

  // Edges.
  lines.push('    <edges>');
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
    const edgeType = typeof edgeDirected === 'boolean'
      ? (edgeDirected ? 'directed' : 'undirected')
      : defaultEdgeType;

    const edgeDisplayLabel = edge.type
      || edge.properties?.label
      || `${edge.source_id} → ${edge.target_id}`;

    lines.push(`      <edge id="${edgeId}" source="${sourceId}" target="${targetId}" type="${edgeType}" label="${escapeAttr(edgeDisplayLabel)}">`);
    lines.push('        <attvalues>');
    lines.push(`          <attvalue for="${reservedEdgeAttrs.label.id}" value="${escapeAttr(edgeDisplayLabel)}"/>`);
    if (edge.type) {
      lines.push(`          <attvalue for="${reservedEdgeAttrs.type.id}" value="${escapeAttr(edge.type)}"/>`);
    }
    const props = edge.properties || {};
    for (const [key, value] of Object.entries(props)) {
      if (key === 'label') continue;
      if (reservedEdgeAttrs[key] && key === 'type') continue;
      emitAttValue(edgeAttrs, edgePropertyTypes, key, value);
    }
    lines.push('        </attvalues>');
    lines.push('      </edge>');
  }
  lines.push('    </edges>');

  lines.push('  </graph>');
  lines.push('</gexf>');

  return lines.join('\n');
}

export default toGEXF;
