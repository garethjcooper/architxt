import { Router } from 'express';
import { db as defaultDb } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { sendResponse } from '../utils/route-helpers.js';
import {
  listNodes,
  getNode,
  upsertNode,
  deleteNode,
  listEdges,
  getEdge,
  upsertEdge,
  deleteEdge,
  deleteAllContextualGraphNodesAndEdges,
} from '../db/crud/contextual-graph.js';
import { importHindsightSkeleton as defaultImportSkeleton } from '../services/contextual-graph/import-hindsight-skeleton.js';
import { addContext as defaultAddContext } from '../services/contextual-graph/add-context.js';

const BASE_PATH = '/contextual-graph';

/**
 * Create the contextual-graph Express router.
 *
 * Accepts optional injected dependencies so tests can supply an in-memory DB
 * and mock the Hindsight-facing services without touching the module loader.
 *
 * @param {Object} [deps]
 * @param {Object} [deps.db]
 * @param {import('winston').Logger} [deps.logger]
 * @param {Function} [deps.importHindsightSkeleton]
 * @param {Function} [deps.addContext]
 * @returns {import('express').Router}
 */
export function createContextualGraphRouter({
  db = defaultDb,
  logger = createLogger('contextual-graph-route'),
  importHindsightSkeleton = defaultImportSkeleton,
  addContext = defaultAddContext,
} = {}) {
  const router = Router();

  /**
   * Parse a list of string labels from a comma-separated query value.
   */
  function parseLabels(value) {
    if (!value || typeof value !== 'string') return undefined;
    const labels = value.split(',').map((s) => s.trim()).filter(Boolean);
    return labels.length > 0 ? labels : undefined;
  }

  /**
   * Parse an integer query param, returning undefined if missing or invalid.
   */
  function parseIntParam(value) {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  /**
   * Parse a boolean query param.
   */
  function parseBoolParam(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return undefined;
  }

  /**
   * Validate required (server_id, bank_id) scope.
   * Returns { valid: true, serverId, bankId } or { valid: false } with response already sent.
   */
  function validateScope(req, res, start, source = 'query') {
    const rawServerId = source === 'body' ? req.body.server_id : req.query.server_id;
    const bankId = source === 'body' ? req.body.bank_id : req.query.bank_id;
    const serverId = parseIntParam(rawServerId);

    if (!serverId || !bankId || typeof bankId !== 'string' || bankId.trim() === '') {
      const duration = Date.now() - start;
      sendResponse({
        res,
        status: 400,
        error: 'server_id and bank_id are required',
        code: 'MISSING_PARAMS',
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return { valid: false };
    }

    return { valid: true, serverId, bankId: bankId.trim() };
  }

  /**
   * Validate a string route id parameter.
   */
  function validateStringId(req, res, start, paramName = 'id') {
    const id = req.params[paramName];
    if (!id || typeof id !== 'string' || id.trim() === '') {
      const duration = Date.now() - start;
      sendResponse({
        res,
        status: 400,
        error: `Invalid ${paramName}`,
        code: 'VALIDATION_ERROR',
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return { valid: false };
    }
    return { valid: true, id: id.trim() };
  }

  /**
   * Normalize a node row from CRUD into the public API shape.
   */
  function normalizeNode(row) {
    if (!row) return null;
    return {
      id: row.cgn_id ?? row.id,
      server_id: row.cgn_server_id ?? row.server_id,
      bank_id: row.cgn_bank_id ?? row.bank_id,
      labels: row.cgn_labels ?? row.labels ?? [],
      properties: row.cgn_properties ?? row.properties ?? {},
      created_at: row.cgn_created_at ?? row.created_at,
      updated_at: row.cgn_updated_at ?? row.updated_at,
    };
  }

  /**
   * Normalize an edge row from CRUD into the public API shape.
   */
  function normalizeEdge(row) {
    if (!row) return null;
    return {
      id: row.cge_id ?? row.id,
      server_id: row.cge_server_id ?? row.server_id,
      bank_id: row.cge_bank_id ?? row.bank_id,
      source_id: row.cge_source_id ?? row.source_id,
      target_id: row.cge_target_id ?? row.target_id,
      type: row.cge_type ?? row.type ?? null,
      properties: row.cge_properties ?? row.properties ?? {},
      created_at: row.cge_created_at ?? row.created_at,
      updated_at: row.cge_updated_at ?? row.updated_at,
    };
  }
  function buildNodeListOptions(req) {
    const options = {};
    const labels = parseLabels(req.query.labels);
    if (labels) options.labels = labels;
    if (req.query.id_prefix) options.idPrefix = req.query.id_prefix;
    const limit = parseIntParam(req.query.limit);
    if (limit !== undefined) options.limit = limit;
    const offset = parseIntParam(req.query.offset);
    if (offset !== undefined) options.offset = offset;
    return options;
  }

  /**
   * Build list options for edges from query params.
   */
  function buildEdgeListOptions(req) {
    const options = {};
    if (req.query.source_id) options.sourceId = req.query.source_id;
    if (req.query.target_id) options.targetId = req.query.target_id;
    if (req.query.type !== undefined) {
      options.type = req.query.type === '' ? null : req.query.type;
    }
    const undirected = parseBoolParam(req.query.undirected);
    if (undirected !== undefined) options.undirected = undirected;
    const limit = parseIntParam(req.query.limit);
    if (limit !== undefined) options.limit = limit;
    const offset = parseIntParam(req.query.offset);
    if (offset !== undefined) options.offset = offset;
    return options;
  }

  /**
   * @openapi
   * /contextual-graph/import:
   *   post:
   *     summary: Import Hindsight entity graph skeleton into the working graph
   *     tags: [Contextual Graph]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [server_id, bank_id]
   *             properties:
   *               server_id: { type: integer }
   *               bank_id: { type: string }
   *               min_count: { type: integer }
   *               min_weight: { type: number }
   *     responses:
   *       200: { description: Skeleton imported }
   *       400: { description: Missing or invalid scope }
   *       502: { description: Hindsight entity graph unavailable }
   */
  router.post('/import', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const result = await importHindsightSkeleton(db, serverId, bankId, {
      min_count: parseIntParam(req.body.min_count),
      min_weight: typeof req.body.min_weight === 'number' ? req.body.min_weight : undefined,
    });

    const duration = Date.now() - start;
    if (!result.success) {
      const status = result.code === 'MISSING_PARAMS' ? 400 : 502;
      sendResponse({
        res,
        status,
        error: result.error,
        code: result.code,
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: {
        success: true,
        imported: result.imported,
        raw: result.raw,
      },
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/add-context:
   *   post:
   *     summary: Import skeleton and derive/deploy contextual mental models
   *     tags: [Contextual Graph]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [server_id, bank_id]
   *             properties:
   *               server_id: { type: integer }
   *               bank_id: { type: string }
   *               min_count: { type: integer }
   *               min_weight: { type: number }
   *               seed_node_ids: { type: array, items: { type: string } }
   *               neighborhood:
   *                 type: object
   *                 properties:
   *                   top_k_neighbors: { type: integer }
   *                   min_weight: { type: number }
   *                   min_count: { type: integer }
   *                   run_discovery: { type: boolean }
   *     responses:
   *       200: { description: Context added }
   *       400: { description: Missing or invalid scope }
   *       502: { description: Hindsight call failed }
   */
  router.post('/add-context', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const options = {
      min_count: parseIntParam(req.body.min_count),
      min_weight: typeof req.body.min_weight === 'number' ? req.body.min_weight : undefined,
      neighborhood: req.body.neighborhood,
    };

    if (Array.isArray(req.body.seed_node_ids)) {
      options.seed_node_ids = req.body.seed_node_ids.filter((id) => typeof id === 'string');
    }

    const result = await addContext(db, serverId, bankId, options);

    const duration = Date.now() - start;
    if (!result.success) {
      const status = result.code === 'MISSING_PARAMS' ? 400 : 502;
      sendResponse({
        res,
        status,
        error: result.error,
        code: result.code,
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: {
        success: true,
        queued: result.queued,
        deployed: result.deployed,
        failed: result.failed,
      },
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/clear:
   *   post:
   *     summary: Delete every working-graph node and edge for a server/bank scope
   *     tags: [Contextual Graph]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [server_id, bank_id]
   *             properties:
   *               server_id: { type: integer }
   *               bank_id: { type: string }
   *     responses:
   *       200: { description: Working graph cleared }
   *       400: { description: Missing or invalid scope }
   */
  router.post('/clear', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const result = deleteAllContextualGraphNodesAndEdges(db, serverId, bankId);
    const counts = result.success ? result.data : { nodes: 0, edges: 0 };

    const duration = Date.now() - start;
    logger.info('Cleared contextual graph', { serverId, bankId, nodes: counts.nodes, edges: counts.edges });

    sendResponse({
      res,
      status: 200,
      data: { success: true, cleared: counts },
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/nodes:
   *   get:
   *     summary: List working-graph nodes for a bank
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: query
   *         name: server_id
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: bank_id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: labels
   *         schema: { type: string }
   *       - in: query
   *         name: id_prefix
   *         schema: { type: string }
   *       - in: query
   *         name: limit
   *         schema: { type: integer }
   *       - in: query
   *         name: offset
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Nodes list }
   *       400: { description: Missing or invalid scope }
   */
  router.get('/nodes', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'query');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const result = listNodes(db, serverId, bankId, buildNodeListOptions(req));

    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 200,
      data: result.success ? result.data.map(normalizeNode) : [],
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/nodes/{id}:
   *   get:
   *     summary: Get a single working-graph node
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: server_id
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: bank_id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Node found }
   *       400: { description: Invalid parameters }
   *       404: { description: Node not found }
   */
  router.get('/nodes/:id', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;
    const scope = validateScope(req, res, start, 'query');
    if (!scope.valid) return;

    const result = getNode(db, scope.serverId, scope.bankId, idCheck.id);

    const duration = Date.now() - start;
    if (!result.success || result.data === null || result.data === undefined) {
      sendResponse({
        res,
        status: 404,
        error: 'Node not found',
        code: 'NOT_FOUND',
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: normalizeNode(result.data),
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/nodes/{id}:
   *   post:
   *     summary: Upsert a working-graph node
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [server_id, bank_id]
   *             properties:
   *               server_id: { type: integer }
   *               bank_id: { type: string }
   *               labels: { type: array, items: { type: string } }
   *               properties: { type: object }
   *     responses:
   *       200: { description: Node upserted }
   *       400: { description: Invalid parameters }
   */
  router.post('/nodes/:id', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const labels = Array.isArray(req.body.labels) ? req.body.labels.filter((l) => typeof l === 'string') : [];
    const properties = req.body.properties && typeof req.body.properties === 'object' ? req.body.properties : {};

    const result = upsertNode(db, scope.serverId, scope.bankId, idCheck.id, labels, properties);

    const duration = Date.now() - start;
    if (!result.success) {
      sendResponse({
        res,
        status: 500,
        error: result.error,
        code: result.code,
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: normalizeNode(result.data),
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/nodes/{id}:
   *   delete:
   *     summary: Delete a working-graph node and its connected edges
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: server_id
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: bank_id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       204: { description: Node deleted }
   *       400: { description: Invalid parameters }
   */
  router.delete('/nodes/:id', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;
    const scope = validateScope(req, res, start, 'query');
    if (!scope.valid) return;

    deleteNode(db, scope.serverId, scope.bankId, idCheck.id);

    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 204,
      data: null,
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/edges:
   *   get:
   *     summary: List working-graph edges for a bank
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: query
   *         name: server_id
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: bank_id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: source_id
   *         schema: { type: string }
   *       - in: query
   *         name: target_id
   *         schema: { type: string }
   *       - in: query
   *         name: type
   *         schema: { type: string }
   *       - in: query
   *         name: undirected
   *         schema: { type: boolean }
   *       - in: query
   *         name: limit
   *         schema: { type: integer }
   *       - in: query
   *         name: offset
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Edges list }
   *       400: { description: Missing or invalid scope }
   */
  router.get('/edges', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'query');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const result = listEdges(db, serverId, bankId, buildEdgeListOptions(req));

    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 200,
      data: result.success ? result.data.map(normalizeEdge) : [],
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/edges/{id}:
   *   get:
   *     summary: Get a single working-graph edge
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: server_id
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: bank_id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Edge found }
   *       400: { description: Invalid parameters }
   *       404: { description: Edge not found }
   */
  router.get('/edges/:id', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;
    const scope = validateScope(req, res, start, 'query');
    if (!scope.valid) return;

    const result = getEdge(db, scope.serverId, scope.bankId, idCheck.id);

    const duration = Date.now() - start;
    if (!result.success || result.data === null || result.data === undefined) {
      sendResponse({
        res,
        status: 404,
        error: 'Edge not found',
        code: 'NOT_FOUND',
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: normalizeEdge(result.data),
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/edges/{id}:
   *   post:
   *     summary: Upsert a working-graph edge
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [server_id, bank_id, source_id, target_id]
   *             properties:
   *               server_id: { type: integer }
   *               bank_id: { type: string }
   *               source_id: { type: string }
   *               target_id: { type: string }
   *               type: { type: string }
   *               properties: { type: object }
   *     responses:
   *       200: { description: Edge upserted }
   *       400: { description: Invalid parameters }
   */
  router.post('/edges/:id', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { source_id: sourceId, target_id: targetId } = req.body;
    if (!sourceId || !targetId || typeof sourceId !== 'string' || typeof targetId !== 'string') {
      const duration = Date.now() - start;
      sendResponse({
        res,
        status: 400,
        error: 'source_id and target_id are required',
        code: 'VALIDATION_ERROR',
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return;
    }

    const type = req.body.type === undefined ? null : req.body.type;
    const properties = req.body.properties && typeof req.body.properties === 'object' ? req.body.properties : {};

    const result = upsertEdge(db, scope.serverId, scope.bankId, idCheck.id, sourceId, targetId, type, properties);

    const duration = Date.now() - start;
    if (!result.success) {
      sendResponse({
        res,
        status: 500,
        error: result.error,
        code: result.code,
        logger,
        method: req.method,
        path: req.path,
        duration,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: normalizeEdge(result.data),
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/edges/{id}:
   *   delete:
   *     summary: Delete a working-graph edge
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: server_id
   *         required: true
   *         schema: { type: integer }
   *       - in: query
   *         name: bank_id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       204: { description: Edge deleted }
   *       400: { description: Invalid parameters }
   */
  router.delete('/edges/:id', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;
    const scope = validateScope(req, res, start, 'query');
    if (!scope.valid) return;

    deleteEdge(db, scope.serverId, scope.bankId, idCheck.id);

    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 204,
      data: null,
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  return router;
}

// Production default: router wired to the real DB and services.
const contextualGraphRoute = createContextualGraphRouter();
export default contextualGraphRoute;
export { BASE_PATH };
