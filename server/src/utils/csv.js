/**
 * CSV export utilities.
 *
 * Produces a two-file CSV representation of a graph:
 *   - nodes.csv: id, labels, plus all flattened node properties
 *   - edges.csv: id, source_id, target_id, type, directed, plus all flattened edge properties
 *
 * The output uses standard CSV escaping (RFC 4180-style):
 *   - fields are comma-separated
 *   - fields containing commas, quotes, newlines, or carriage returns are
 *     wrapped in double quotes, and embedded double quotes are doubled
 *   - a header row is included in every file
 *
 * Non-scalar property values are JSON-stringified so they remain parseable.
 */

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values) {
  return values.map(csvEscape).join(',');
}

function collectPropertyKeys(items, reserved = new Set()) {
  const keys = [];
  const seen = new Set();
  for (const item of items) {
    for (const key of Object.keys(item.properties || {})) {
      if (reserved.has(key) || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  // Objects and arrays become a JSON string so the value survives CSV round-trips.
  return JSON.stringify(value);
}

/**
 * Build the nodes CSV.
 *
 * Columns: id, labels, <all unique node property keys in insertion order>
 * labels is a semicolon-delimited string.
 *
 * @param {Array<{id: string, labels: string[], properties: Record<string, any>}>} nodes
 * @returns {string}
 */
function buildNodesCsv(nodes) {
  const propertyKeys = collectPropertyKeys(nodes);
  const header = ['id', 'labels', ...propertyKeys];
  const rows = [csvRow(header)];

  for (const node of nodes) {
    const values = [
      node.id,
      (node.labels || []).join(';'),
    ];
    for (const key of propertyKeys) {
      values.push(formatValue((node.properties || {})[key]));
    }
    rows.push(csvRow(values));
  }

  return rows.join('\n') + (rows.length > 1 ? '\n' : '');
}

/**
 * Build the edges CSV.
 *
 * Columns: id, source_id, target_id, type, directed, <all unique edge property keys in insertion order>
 * The `directed` column reflects the resolved direction of each edge: `true`
 * unless the edge has `properties.directed === false` or the export was
 * requested with the global `undirected` flag.
 *
 * @param {Array<{id: string, source_id: string, target_id: string, type: string | null, properties: Record<string, any>}>} edges
 * @param {boolean} undirected
 * @returns {string}
 */
function buildEdgesCsv(edges, undirected = false) {
  const propertyKeys = collectPropertyKeys(edges, new Set(['directed']));
  const header = ['id', 'source_id', 'target_id', 'type', 'directed', ...propertyKeys];
  const rows = [csvRow(header)];

  for (const edge of edges) {
    const edgeDirected = edge.properties?.directed;
    const directed = typeof edgeDirected === 'boolean'
      ? edgeDirected
      : !undirected;

    const values = [
      edge.id,
      edge.source_id,
      edge.target_id,
      edge.type ?? '',
      String(directed),
    ];
    for (const key of propertyKeys) {
      values.push(formatValue((edge.properties || {})[key]));
    }
    rows.push(csvRow(values));
  }

  return rows.join('\n') + (rows.length > 1 ? '\n' : '');
}

/**
 * Build the delimiter line used by some multi-file CSV import tools.
 *
 * @returns {string}
 */
function buildDelimiter() {
  return 'delimiter=,';
}

/**
 * Export a graph as a two-file CSV package.
 *
 * Returns an object with a `files` array describing each file and a
 * `toString()` helper that produces a combined textual representation for
 * tests and simple clients.
 *
 * @param {Array<{id: string, labels: string[], properties: Record<string, any>}>} nodes
 * @param {Array<{id: string, source_id: string, target_id: string, type: string | null, properties: Record<string, any>}>} edges
 * @param {Object} meta
 * @param {boolean} undirected
 * @returns {{ nodes: string, edges: string, meta: Object, files: Array<{name: string, content: string, content_type: string}> }}
 */
export function toCsv(nodes, edges, meta, undirected = false) {
  const generatedAt = meta?.generated_at
    ? String(meta.generated_at).replace(/\*/g, ' ')
    : new Date().toISOString();

  const nodesCsv = buildNodesCsv(nodes);
  const edgesCsv = buildEdgesCsv(edges, undirected);

  const exportMeta = {
    server_id: meta?.server_id,
    bank_id: meta?.bank_id,
    format: 'csv',
    version: '1.0',
    generated_at: generatedAt,
    node_count: nodes.length,
    edge_count: edges.length,
    files: ['nodes.csv', 'edges.csv'],
  };

  return {
    nodes: nodesCsv,
    edges: edgesCsv,
    meta: exportMeta,
    files: [
      { name: 'nodes.csv', content: nodesCsv, content_type: 'text/csv; charset=utf-8' },
      { name: 'edges.csv', content: edgesCsv, content_type: 'text/csv; charset=utf-8' },
    ],
  };
}

export default toCsv;
