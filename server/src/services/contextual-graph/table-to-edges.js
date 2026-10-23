/**
 * Convert an edge-context table into the same `{ nodes, edges }` shape that
 * `applyEdgeContext` already consumes.
 *
 * The edge-context table contract:
 *   columns: [from, to, type, label, detail, frequency, evidence]
 * Each row becomes one directed edge. Nodes are derived deterministically from
 * the unique set of endpoint ids used by valid rows.
 */

const EDGE_CONTEXT_TABLE_COLUMNS = ['from', 'to', 'type', 'label', 'detail', 'frequency', 'evidence'];

function normalizeEvidence(value) {
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

/**
 * Build a graph-like edge list from an edge-context table.
 *
 * @param {object} table
 * @param {string[]} table.columns
 * @param {Array<Array>} table.rows
 * @returns {{ nodes: Array<{id, name}>, edges: Array<{from, to, type, label, detail, evidence, properties}> }}
 */
export function edgeContextTableToGraph(table) {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    return { nodes: [], edges: [] };
  }

  const columns = table.columns.map((c) => String(c).toLowerCase().trim());
  const colIdx = Object.fromEntries(columns.map((c, i) => [c, i]));

  const required = ['from', 'to', 'type'];
  for (const name of required) {
    if (!(name in colIdx)) return { nodes: [], edges: [] };
  }

  const nodeIds = new Set();
  const edges = [];

  for (const row of table.rows) {
    let from;
    let to;
    let type;
    let label;
    let detail;
    let evidence;
    let frequency;

    if (Array.isArray(row)) {
      from = row[colIdx.from];
      to = row[colIdx.to];
      type = row[colIdx.type];
      label = row[colIdx.label];
      detail = row[colIdx.detail];
      evidence = row[colIdx.evidence];
      frequency = row[colIdx.frequency];
    } else if (row && typeof row === 'object') {
      from = row.from;
      to = row.to;
      type = row.type;
      label = row.label;
      detail = row.detail;
      evidence = row.evidence;
      frequency = row.frequency;
    } else {
      continue;
    }

    if (!from || !to || !type) continue;
    if (typeof from !== 'string' || typeof to !== 'string' || typeof type !== 'string') continue;

    const cleanLabel = typeof label === 'string' ? label.trim() : '';
    const cleanDetail = typeof detail === 'string' ? detail.trim() : '';
    const cleanEvidence = normalizeEvidence(evidence);
    const cleanFrequency = typeof frequency === 'string' ? frequency.trim() : '';

    const properties = {};
    if (cleanFrequency) properties.frequency = cleanFrequency;

    nodeIds.add(from.trim());
    nodeIds.add(to.trim());

    edges.push({
      from: from.trim(),
      to: to.trim(),
      type: type.trim(),
      label: cleanLabel,
      detail: cleanDetail,
      evidence: cleanEvidence,
      properties: Object.keys(properties).length > 0 ? properties : undefined,
    });
  }

  const nodes = Array.from(nodeIds).map((id) => ({ id, name: id }));

  return { nodes, edges };
}

/**
 * Derive the effective edge list for an edge-context model.
 *
 * Table output takes precedence. If no valid edge-context table is present,
 * fall back to the legacy graph envelope so existing models keep working until
 * they are rebuilt.
 *
 * @param {object} output - normalized envelope { tables, graph }
 * @returns {{ nodes: object[], edges: object[], source: 'table'|'graph' }}
 */
export function deriveEdgeContextEdges(output) {
  const firstTable = output?.tables?.[0];
  if (firstTable) {
    const derived = edgeContextTableToGraph(firstTable);
    if (derived.edges.length > 0) {
      return { ...derived, source: 'table' };
    }
    // A table existed but had no valid rows; do not fall back to graph.
    return { ...derived, source: 'table' };
  }

  const graph = output?.graph;
  return {
    nodes: graph?.nodes || [],
    edges: graph?.edges || [],
    source: 'graph',
  };
}

export { EDGE_CONTEXT_TABLE_COLUMNS };
