import { stmt } from '../../cache.js';
import { dbExec } from '../../utils/db-helpers.js';

const NODE_TABLE = 'contextual_graph_nodes';
const EDGE_TABLE = 'contextual_graph_edges';

/**
 * Parse JSON columns from a node or edge row. Returns null if input is null.
 */
function parseJson(row) {
  if (!row) return null;
  const parsed = { ...row };
  for (const key of Object.keys(row)) {
    if ((key.endsWith('_labels') || key.endsWith('_properties')) && typeof row[key] === 'string') {
      try {
        parsed[key] = JSON.parse(row[key]);
      } catch {
        parsed[key] = row[key];
      }
    }
  }
  return parsed;
}

function now() {
  return new Date().toISOString();
}

/**
 * Upsert a working-graph node.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} id
 * @param {string[]} labels
 * @param {Object} properties
 * @returns {{success: boolean, data?: Object, error?: string, code?: string}}
 */
export const upsertNode = (db, serverId, bankId, id, labels, properties) => dbExec(() => {
  const sql = `
    INSERT INTO ${NODE_TABLE} (
      cgn_id, cgn_server_id, cgn_bank_id, cgn_labels, cgn_properties, cgn_created_at, cgn_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cgn_server_id, cgn_bank_id, cgn_id) DO UPDATE SET
      cgn_labels = excluded.cgn_labels,
      cgn_properties = excluded.cgn_properties,
      cgn_updated_at = excluded.cgn_updated_at
  `;
  const ts = now();
  const result = stmt(db, sql).run(
    id,
    serverId,
    bankId,
    JSON.stringify(labels || []),
    JSON.stringify(properties || {}),
    ts,
    ts,
  );
  return {
    id,
    server_id: serverId,
    bank_id: bankId,
    labels,
    properties,
    created_at: ts,
    updated_at: ts,
    isNew: result.changes === 1 && result.lastInsertRowid != null,
  };
}, `${NODE_TABLE}.upsertNode`);

/**
 * Get a single node by scoped id.
 */
export const getNode = (db, serverId, bankId, id) => dbExec(() => {
  const sql = `SELECT * FROM ${NODE_TABLE} WHERE cgn_server_id = ? AND cgn_bank_id = ? AND cgn_id = ?`;
  const row = stmt(db, sql).get(serverId, bankId, id);
  const data = parseJson(row);
  return data ? { ...data, labels: data.cgn_labels, properties: data.cgn_properties } : null;
}, `${NODE_TABLE}.getNode`);

/**
 * List nodes for a bank with optional filters.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {string[]} [options.labels] - nodes must contain all of these labels
 * @param {string} [options.idPrefix] - id prefix match (case-sensitive)
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 */
export const listNodes = (db, serverId, bankId, options = {}) => dbExec(() => {
  const conditions = ['cgn_server_id = ?', 'cgn_bank_id = ?'];
  const values = [serverId, bankId];

  if (options.labels && options.labels.length > 0) {
    for (const label of options.labels) {
      conditions.push("cgn_labels LIKE ?");
      values.push(`%"${label}"%`);
    }
  }

  if (options.idPrefix) {
    conditions.push('cgn_id LIKE ?');
    values.push(`${options.idPrefix}%`);
  }

  const limit = Number.isInteger(options.limit) ? options.limit : 1000;
  const offset = Number.isInteger(options.offset) ? options.offset : 0;

  const sql = `
    SELECT * FROM ${NODE_TABLE}
    WHERE ${conditions.join(' AND ')}
    ORDER BY cgn_id
    LIMIT ? OFFSET ?
  `;
  const rows = stmt(db, sql).all(...values, limit, offset);
  return rows.map((r) => {
    const data = parseJson(r);
    return data ? { ...data, labels: data.cgn_labels, properties: data.cgn_properties } : data;
  });
}, `${NODE_TABLE}.listNodes`);

/**
 * Delete a node and all edges connected to it (in both directions).
 */
export const deleteNode = (db, serverId, bankId, id) => dbExec(() => {
  const edgeSql = `
    DELETE FROM ${EDGE_TABLE}
    WHERE cge_server_id = ? AND cge_bank_id = ?
      AND (cge_source_id = ? OR cge_target_id = ?)
  `;
  stmt(db, edgeSql).run(serverId, bankId, id, id);

  const nodeSql = `DELETE FROM ${NODE_TABLE} WHERE cgn_server_id = ? AND cgn_bank_id = ? AND cgn_id = ?`;
  const result = stmt(db, nodeSql).run(serverId, bankId, id);
  return { deleted: result.changes > 0 };
}, `${NODE_TABLE}.deleteNode`);

/**
 * Upsert a working-graph edge.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {string} id
 * @param {string} sourceId
 * @param {string} targetId
 * @param {string|null} type
 * @param {Object} properties
 */
export const upsertEdge = (db, serverId, bankId, id, sourceId, targetId, type, properties) => dbExec(() => {
  const sql = `
    INSERT INTO ${EDGE_TABLE} (
      cge_id, cge_server_id, cge_bank_id, cge_source_id, cge_target_id,
      cge_type, cge_properties, cge_created_at, cge_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cge_server_id, cge_bank_id, cge_id) DO UPDATE SET
      cge_source_id = excluded.cge_source_id,
      cge_target_id = excluded.cge_target_id,
      cge_type = excluded.cge_type,
      cge_properties = excluded.cge_properties,
      cge_updated_at = excluded.cge_updated_at
  `;
  const ts = now();
  const result = stmt(db, sql).run(
    id,
    serverId,
    bankId,
    sourceId,
    targetId,
    type,
    JSON.stringify(properties || {}),
    ts,
    ts,
  );
  return {
    id,
    server_id: serverId,
    bank_id: bankId,
    source_id: sourceId,
    target_id: targetId,
    type,
    properties,
    created_at: ts,
    updated_at: ts,
    isNew: result.changes === 1 && result.lastInsertRowid != null,
  };
}, `${EDGE_TABLE}.upsertEdge`);

/**
 * Get a single edge by scoped id.
 */
export const getEdge = (db, serverId, bankId, id) => dbExec(() => {
  const sql = `SELECT * FROM ${EDGE_TABLE} WHERE cge_server_id = ? AND cge_bank_id = ? AND cge_id = ?`;
  const row = stmt(db, sql).get(serverId, bankId, id);
  const data = parseJson(row);
  return data ? { ...data, labels: data.cgn_labels, properties: data.cge_properties } : null;
}, `${EDGE_TABLE}.getEdge`);

/**
 * List edges for a bank with optional filters.
 *
 * @param {Object} db
 * @param {number} serverId
 * @param {string} bankId
 * @param {Object} [options]
 * @param {string} [options.sourceId]
 * @param {string} [options.targetId]
 * @param {string|null} [options.type]
 * @param {boolean} [options.undirected] - if true, returns edges with properties.directed === false
 * @param {number} [options.limit]
 * @param {number} [options.offset]
 */
export const listEdges = (db, serverId, bankId, options = {}) => dbExec(() => {
  const conditions = ['cge_server_id = ?', 'cge_bank_id = ?'];
  const values = [serverId, bankId];

  if (options.sourceId) {
    conditions.push('cge_source_id = ?');
    values.push(options.sourceId);
  }

  if (options.targetId) {
    conditions.push('cge_target_id = ?');
    values.push(options.targetId);
  }

  if (options.type !== undefined) {
    if (options.type === null) {
      conditions.push('cge_type IS NULL');
    } else {
      conditions.push('cge_type = ?');
      values.push(options.type);
    }
  }

  const limit = Number.isInteger(options.limit) ? options.limit : 1000;
  const offset = Number.isInteger(options.offset) ? options.offset : 0;

  let sql = `
    SELECT * FROM ${EDGE_TABLE}
    WHERE ${conditions.join(' AND ')}
    ORDER BY cge_id
    LIMIT ? OFFSET ?
  `;
  const rows = stmt(db, sql).all(...values, limit, offset);
  const parsed = rows.map((r) => {
    const data = parseJson(r);
    return data ? { ...data, labels: data.cgn_labels, properties: data.cge_properties } : data;
  });

  if (options.undirected) {
    return parsed.filter((e) => e.properties?.directed === false);
  }
  return parsed;
}, `${EDGE_TABLE}.listEdges`);

/**
 * Delete a single edge by scoped id.
 */
export const deleteEdge = (db, serverId, bankId, id) => dbExec(() => {
  const sql = `DELETE FROM ${EDGE_TABLE} WHERE cge_server_id = ? AND cge_bank_id = ? AND cge_id = ?`;
  const result = stmt(db, sql).run(serverId, bankId, id);
  return { deleted: result.changes > 0 };
}, `${EDGE_TABLE}.deleteEdge`);
