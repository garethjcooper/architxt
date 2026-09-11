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
import { deleteGeneratedModels } from '../services/contextual-graph/delete-generated-models.js';
import { undeployContextualGraphBank as defaultUndeployBank } from '../services/contextual-graph/undeploy-bank.js';
import {
  fetchCandidatesFromModel as defaultFetchCandidates,
  ingestCandidates as defaultIngestCandidates,
} from '../services/contextual-graph/discovery.js';
import { refreshContextualGraphPatches as defaultRefreshPatches } from '../services/contextual-graph/refresh-patches.js';
import { syncContextualMentalModelConfig as defaultSyncMentalModelConfig } from '../services/contextual-graph/sync-mental-model-config.js';
import {
  startContextualGraphSyncJob as defaultStartSyncJob,
  getContextualGraphSyncJob as defaultGetSyncJob,
  listContextualGraphSyncJobs as defaultListSyncJobs,
  cancelContextualGraphSyncJob as defaultCancelSyncJob,
} from '../services/contextual-graph/sync-job.js';
import { getServer as defaultGetServer } from '../db/crud/servers.js';
import {
  getManagedBanks,
  resolveRestrictions,
} from '../services/contextual-graph/server-bank-config.js';

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
 * @param {Function} [deps.fetchCandidates]
 * @param {Function} [deps.ingestCandidates]
 * @param {Function} [deps.refreshPatches]
 * @returns {import('express').Router}
 */
export function createContextualGraphRouter({
  db = defaultDb,
  logger = createLogger('contextual-graph-route'),
  importHindsightSkeleton = defaultImportSkeleton,
  addContext = defaultAddContext,
  fetchCandidates = defaultFetchCandidates,
  ingestCandidates = defaultIngestCandidates,
  refreshPatches = defaultRefreshPatches,
  syncMentalModelConfig = defaultSyncMentalModelConfig,
  startSyncJob = defaultStartSyncJob,
  getSyncJob = defaultGetSyncJob,
  listSyncJobs = defaultListSyncJobs,
  cancelSyncJob = defaultCancelSyncJob,
  undeployBank = defaultUndeployBank,
  getServer = defaultGetServer,
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
   *               import_skeleton: { type: boolean, default: true }
   *               node_ids: { type: array, items: { type: string } }
   *               seed_node_ids: { type: array, items: { type: string } }
   *               neighborhood:
   *                 type: object
   *                 properties:
   *                   top_k_neighbors: { type: integer }
   *                   min_weight: { type: number }
   *                   min_count: { type: integer }
   *               allowed_model_types:
   *                 type: array
   *                 items:
   *                   type: string
   *                   enum: [entity-summary, entity-capabilities, edge-ctx, discover]
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
      import_skeleton: parseBoolParam(req.body.import_skeleton),
      allowed_model_types: Array.isArray(req.body.allowed_model_types)
        ? req.body.allowed_model_types.filter((t) => typeof t === 'string')
        : undefined,
    };

    if (Array.isArray(req.body.node_ids)) {
      options.node_ids = req.body.node_ids.filter((id) => typeof id === 'string');
    }

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
        composed: result.composed,
        pushed: result.pushed,
        unchanged: result.unchanged,
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
   * /contextual-graph/discover-candidates:
   *   post:
   *     summary: Fetch discovery candidates from a discover-ctx mental model
   *     description: |
   *       Reads the content of an existing discover-ctx mental model on Hindsight
   *       and returns the candidate list. This is a lightweight read; no LLM call.
   *     tags: [Contextual Graph]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [server_id, bank_id, ext_id]
   *             properties:
   *               server_id: { type: integer }
   *               bank_id: { type: string }
   *               ext_id: { type: string }
   *     responses:
   *       200: { description: Candidates returned }
   *       400: { description: Missing or invalid scope }
   *       502: { description: Hindsight call failed }
   */
  router.post('/discover-candidates', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const extId = typeof req.body.ext_id === 'string' ? req.body.ext_id.trim() : '';
    if (!extId) {
      sendResponse({
        res,
        status: 400,
        error: 'ext_id is required',
        code: 'MISSING_EXT_ID',
        logger,
        method: req.method,
        path: req.path,
        duration: Date.now() - start,
      });
      return;
    }

    const result = await fetchCandidates(serverId, bankId, extId);
    const duration = Date.now() - start;

    if (!result.success) {
      sendResponse({
        res,
        status: 502,
        error: result.error,
        code: result.code || 'FETCH_FAILED',
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
      data: { success: true, ext_id: extId, candidates: result.candidates },
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/ingest-candidates:
   *   post:
   *     summary: Ingest approved discovery candidates into the working graph
   *     description: |
   *       Upserts candidate nodes/edges into the working graph and returns the
   *       entity-ctx / edge-ctx mental-model specs derived for them. The caller
   *       can then queue/deploy those specs separately or pass deploy=true to do it
   *       inline.
   *     tags: [Contextual Graph]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [server_id, bank_id, seed_id, candidates]
   *             properties:
   *               server_id: { type: integer }
   *               bank_id: { type: string }
   *               seed_id: { type: string }
   *               candidates:
   *                 type: array
   *                 items:
   *                   type: object
   *     responses:
   *       200: { description: Candidates ingested }
   *       400: { description: Missing or invalid scope }
   *       502: { description: Hindsight call failed }
   */
  router.post('/ingest-candidates', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const seedId = typeof req.body.seed_id === 'string' ? req.body.seed_id.trim() : '';
    const candidates = Array.isArray(req.body.candidates) ? req.body.candidates : [];

    if (!seedId) {
      sendResponse({
        res,
        status: 400,
        error: 'seed_id is required',
        code: 'MISSING_SEED_ID',
        logger,
        method: req.method,
        path: req.path,
        duration: Date.now() - start,
      });
      return;
    }

    if (candidates.length === 0) {
      sendResponse({
        res,
        status: 400,
        error: 'candidates must be a non-empty array',
        code: 'MISSING_CANDIDATES',
        logger,
        method: req.method,
        path: req.path,
        duration: Date.now() - start,
      });
      return;
    }

    const nodesResult = listNodes(db, serverId, bankId, { limit: 10000 });
    const existingNodes = nodesResult.success ? nodesResult.data : [];

    const ingestResult = await ingestCandidates(db, serverId, bankId, seedId, candidates, { existingNodes });
    const duration = Date.now() - start;

    if (!ingestResult.success) {
      sendResponse({
        res,
        status: 502,
        error: ingestResult.error,
        code: ingestResult.code || 'INGEST_FAILED',
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
        seed_id: seedId,
        upserted: ingestResult.upserted,
        entity_specs: ingestResult.entity,
        edge_specs: ingestResult.edge,
      },
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/delete-generated:
   *   post:
   *     summary: Delete generated contextual-graph mental models from Hindsight and clear local provenance
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
   *               dry_run: { type: boolean }
   *     responses:
   *       200: { description: Models deleted or previewed }
   *       400: { description: Missing or invalid scope }
   */
  router.post('/delete-generated', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const dryRun = req.body.dry_run === true;

    const result = await deleteGeneratedModels(db, serverId, bankId, { dry_run: dryRun });

    const duration = Date.now() - start;
    logger.info('Delete generated models', { serverId, bankId, dryRun, total: result.deleted?.length ?? 0, failed: result.failed?.length ?? 0 });

    const responseData = {
      success: result.success,
      dry_run: dryRun,
      total: (dryRun ? result.ext_ids?.length : result.deleted?.length) ?? 0,
      ids: dryRun ? (result.ext_ids ?? []) : (result.deleted ?? []),
      failed: result.failed ?? [],
      cleared: result.cleared ?? { nodes: 0, edges: 0 },
    };

    if (!result.success) {
      sendResponse({
        res,
        status: 500,
        data: { ...responseData, error: result.error, code: result.code },
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
      data: responseData,
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/undeploy-bank:
   *   post:
   *     summary: Undeploy every contextual-graph generated mental model from a bank and stop auto-sync
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
   *               dry_run: { type: boolean }
   *               delete_local_graph: { type: boolean }
   *     responses:
   *       200: { description: Bank undeployed or previewed }
   *       400: { description: Missing or invalid scope }
   */
  router.post('/undeploy-bank', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const dryRun = req.body.dry_run === true;
    const deleteLocalGraph = req.body.delete_local_graph === true;

    const result = await undeployBank(db, serverId, bankId, {
      dry_run: dryRun,
      delete_local_graph: deleteLocalGraph,
    });

    const duration = Date.now() - start;
    logger.info('Undeploy contextual graph bank', {
      serverId,
      bankId,
      dryRun,
      deleteLocalGraph,
      targetCount: result.target_count ?? result.deleted?.length ?? 0,
      deleted: result.deleted?.length ?? 0,
      failed: result.failed?.length ?? 0,
    });

    const responseData = {
      success: result.success,
      dry_run: dryRun,
      stopped_auto_sync: result.stopped_auto_sync ?? false,
      target_count: result.target_count ?? result.deleted?.length ?? 0,
      deleted_count: result.deleted?.length ?? 0,
      deleted: result.deleted ?? [],
      failed: result.failed ?? [],
      cleared: result.cleared ?? { nodes: 0, edges: 0 },
      marked_stale: result.marked_stale ?? { nodes: 0, edges: 0 },
      deleted_local_graph: result.deleted_local_graph ?? { nodes: 0, edges: 0 },
    };

    if (!result.success) {
      sendResponse({
        res,
        status: 500,
        data: { ...responseData, error: result.error, code: result.code },
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
      data: responseData,
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/refresh:
   *   post:
   *     summary: Refresh contextual-graph patches from Hindsight
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
   *               dry_run: { type: boolean }
   *     responses:
   *       200: { description: Refresh completed or previewed }
   *       400: { description: Missing or invalid scope }
   *       500: { description: Hindsight fetch or apply failed }
   */
  router.post('/refresh', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const dryRun = req.body.dry_run === true;

    // Single user-facing refresh flow: sync config, then explicitly request fresh
    // Hindsight output for any models whose config changed, then fetch and apply.
    // A prompt/config change does not auto-regenerate content, so we pass the
    // changed ext_ids into refresh as rerunExtIds.
    let syncResult = { success: true, stats: {}, updatedExtIds: [] };
    if (!dryRun) {
      syncResult = await syncMentalModelConfig(db, serverId, bankId, { dryRun });
      if (!syncResult.success) {
        const duration = Date.now() - start;
        logger.error('Refresh aborted: config sync failed', { serverId, bankId, error: syncResult.error });
        sendResponse({
          res,
          status: 500,
          data: { success: false, error: syncResult.error, stats: syncResult.stats },
          logger,
          method: req.method,
          path: req.path,
          duration,
        });
        return;
      }
    }

    const result = await refreshPatches(db, serverId, bankId, { dryRun, rerunExtIds: syncResult.updatedExtIds });

    const duration = Date.now() - start;
    const combinedStats = { ...result.stats, sync: syncResult.stats };
    logger.info('Refresh contextual patches', { serverId, bankId, dryRun, success: result.success, ...combinedStats });

    if (!result.success) {
      sendResponse({
        res,
        status: 500,
        data: { success: false, error: result.error, stats: combinedStats },
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
      data: { success: true, dry_run: dryRun, stats: combinedStats },
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/sync-config:
   *   post:
   *     summary: Push updated mental-model config from local system templates to Hindsight
   *     description: |
   *       Re-derives the configuration of every contextual mental model referenced
   *       by the working graph from the current DB system template, compares it to
   *       the live Hindsight model, and pushes an update for any model that has
   *       diverged. Use dry_run=true to preview changes without applying them.
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
   *               dry_run: { type: boolean }
   *     responses:
   *       200: { description: Config sync completed or previewed }
   *       400: { description: Missing or invalid scope }
   *       500: { description: Hindsight fetch or push failed }
   */
  router.post('/sync-config', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const dryRun = req.body.dry_run === true;

    const result = await syncMentalModelConfig(db, serverId, bankId, { dryRun });

    const duration = Date.now() - start;
    logger.info('Sync contextual mental model config', { serverId, bankId, dryRun, success: result.success, ...result.stats });

    if (!result.success) {
      sendResponse({
        res,
        status: 500,
        data: { success: false, error: result.error, stats: result.stats },
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
      data: { success: true, dry_run: dryRun, stats: result.stats },
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

  /**
   * @openapi
   * /contextual-graph/sync-jobs:
   *   post:
   *     summary: Start a tracked contextual-graph sync job
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
   *               node_ids: { type: array, items: { type: string } }
   *               seed_node_ids: { type: array, items: { type: string } }
   *               min_count: { type: integer }
   *               min_weight: { type: number }
   *     responses:
   *       202: { description: Job started }
   *       400: { description: Missing or invalid scope }
   *       409: { description: A sync job is already running for this server/bank }
   */
  router.post('/sync-jobs', async (req, res) => {
    const start = Date.now();
    const scope = validateScope(req, res, start, 'body');
    if (!scope.valid) return;

    const { serverId, bankId } = scope;
    const options = {
      node_ids: Array.isArray(req.body.node_ids) ? req.body.node_ids.filter((id) => typeof id === 'string') : undefined,
      seed_node_ids: Array.isArray(req.body.seed_node_ids) ? req.body.seed_node_ids.filter((id) => typeof id === 'string') : undefined,
      min_count: parseIntParam(req.body.min_count),
      min_weight: typeof req.body.min_weight === 'number' ? req.body.min_weight : undefined,
      neighborhood: req.body.neighborhood,
    };

    // When the caller does not provide explicit restrictions, look up the bank
    // config and apply the same restrictions the auto-sync daemon would use.
    if (!options.restriction) {
      const serverResult = getServer(db, serverId);
      const managedBanks = serverResult?.success ? getManagedBanks(serverResult.data) : [];
      const bankConfig = managedBanks.find((b) => b.bank_id === bankId);
      if (bankConfig) {
        options.restriction = resolveRestrictions(bankConfig);
      }
    }

    const result = await startSyncJob(db, serverId, bankId, options);
    const duration = Date.now() - start;

    if (!result.success) {
      const status = result.code === 'ALREADY_RUNNING' ? 409 : 500;
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
      status: 202,
      data: { success: true, job: result.job },
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/sync-jobs:
   *   get:
   *     summary: List sync jobs
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: query
   *         name: server_id
   *         schema: { type: integer }
   *       - in: query
   *         name: bank_id
   *         schema: { type: string }
   *       - in: query
   *         name: status
   *         schema: { type: string }
   *       - in: query
   *         name: since
   *         description: Inclusive ISO 8601 lower bound on cgj_created_at
   *         schema: { type: string, format: date-time }
   *       - in: query
   *         name: until
   *         description: Inclusive ISO 8601 upper bound on cgj_created_at
   *         schema: { type: string, format: date-time }
   *       - in: query
   *         name: limit
   *         schema: { type: integer }
   *       - in: query
   *         name: offset
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Jobs list }
   */
  router.get('/sync-jobs', async (req, res) => {
    const start = Date.now();
    const options = {
      serverId: parseIntParam(req.query.server_id),
      bankId: typeof req.query.bank_id === 'string' ? req.query.bank_id : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      since: typeof req.query.since === 'string' && req.query.since.trim() ? req.query.since.trim() : undefined,
      until: typeof req.query.until === 'string' && req.query.until.trim() ? req.query.until.trim() : undefined,
      limit: parseIntParam(req.query.limit) ?? 50,
      offset: parseIntParam(req.query.offset) ?? 0,
    };

    const result = listSyncJobs(db, options);
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 200,
      data: result.success ? result.data : [],
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/sync-jobs/{id}:
   *   get:
   *     summary: Get a sync job and its logs
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: limit
   *         schema: { type: integer }
   *       - in: query
   *         name: offset
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Job found }
   *       404: { description: Job not found }
   */
  router.get('/sync-jobs/:id', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;

    const limit = parseIntParam(req.query.limit) ?? 200;
    const offset = parseIntParam(req.query.offset) ?? 0;
    const result = getSyncJob(db, idCheck.id, { limit, offset });
    const duration = Date.now() - start;

    if (!result.success) {
      sendResponse({
        res,
        status: 404,
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
      data: result.job,
      logger,
      method: req.method,
      path: req.path,
      duration,
    });
  });

  /**
   * @openapi
   * /contextual-graph/sync-jobs/{id}/cancel:
   *   post:
   *     summary: Cancel a pending or running sync job
   *     tags: [Contextual Graph]
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Cancel requested }
   *       400: { description: Job not active }
   *       404: { description: Job not found }
   */
  router.post('/sync-jobs/:id/cancel', async (req, res) => {
    const start = Date.now();
    const idCheck = validateStringId(req, res, start);
    if (!idCheck.valid) return;

    const result = cancelSyncJob(db, idCheck.id);
    const duration = Date.now() - start;

    if (!result.success) {
      const status = result.code === 'NOT_FOUND' ? 404 : 400;
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
      data: { success: true },
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