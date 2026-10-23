import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import {
  sendResponse,
  handleCrudResult,
  validateId,
  validateRequiredString,
} from '../utils/route-helpers.js';
import {
  listViewsByBank,
  getView,
  createView,
  updateView,
  deleteView,
  getTimelineSnapshot,
  clearViewTimeline,
} from '../db/crud/views.js';

const logger = createLogger('views-route');
const router = Router({ mergeParams: true });

const SUPPORTED_DIAGRAM_TYPES = new Set([
  'flowchart',
  'sequenceDiagram',
  'erDiagram',
  'classDiagram',
  'stateDiagram',
  'timeline',
]);

// DB → API transform
const toApiView = (dbRow) => ({
  id: dbRow.view_id,
  server_id: dbRow.view_server_id,
  bank_id: dbRow.view_bank_id,
  name: dbRow.view_name,
  diagram_type: dbRow.view_diagram_type,
  graph: dbRow.view_graph,
  layout: dbRow.view_layout,
  style_defaults: dbRow.view_style_defaults,
  timeline: dbRow.view_timeline,
  created_at: dbRow.view_created_at,
  updated_at: dbRow.view_updated_at,
});

function requireBankParams(req, res, start, path) {
  const serverId = parseInt(req.params.serverId, 10);
  const bankId = req.params.bankId;
  if (Number.isNaN(serverId)) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `Invalid server id: ${req.params.serverId}`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration,
    });
    return null;
  }
  if (!bankId) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: 'bank_id is required',
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration,
    });
    return null;
  }
  return { serverId, bankId };
}

/**
 * @openapi
 * /servers/{serverId}/banks/{bankId}/views:
 *   get:
 *     summary: List views for a bank
 *     description: Retrieve all views for a bank.
 *     tags: [Views]
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank ID
 *     responses:
 *       200:
 *         description: List of views
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/View'
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const params = requireBankParams(req, res, start, `/banks/${req.params.bankId}/views`);
  if (!params) return;
  const { serverId, bankId } = params;

  try {
    const result = await listViewsByBank(db, { server_id: serverId, bank_id: bankId });
    handleCrudResult({
      res,
      result,
      notFoundError: null,
      successStatus: 200,
      successData: result.success ? result.data.map(toApiView) : null,
      logger,
      method: 'GET',
      path: `/banks/${bankId}/views`,
      start,
    });
  } catch (err) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'DATABASE_ERROR',
      logger,
      method: 'GET',
      path: `/banks/${bankId}/views`,
      duration,
    });
  }
});

/**
 * @openapi
 * /servers/{serverId}/banks/{bankId}/views:
 *   post:
 *     summary: Create a view
 *     description: Create a new view within a bank.
 *     tags: [Views]
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *               diagram_type:
 *                 type: string
 *                 default: flowchart
 *               graph:
 *                 type: object
 *               layout:
 *                 type: object
 *               style_defaults:
 *                 type: object
 *               timeline:
 *                 type: array
 *     responses:
 *       201:
 *         description: View created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const params = requireBankParams(req, res, start, `/banks/${req.params.bankId}/views`);
  if (!params) return;
  const { serverId, bankId } = params;

  const validation = validateRequiredString({
    req,
    res,
    field: 'name',
    logger,
    path: `/banks/${bankId}/views`,
    start,
  });
  if (!validation.valid) return;

  const diagramType = req.body.diagram_type || 'flowchart';
  if (!SUPPORTED_DIAGRAM_TYPES.has(diagramType)) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `Unsupported diagram_type: ${diagramType}`,
      code: 'VALIDATION_ERROR',
      logger,
      method: 'POST',
      path: `/banks/${bankId}/views`,
      duration,
    });
    return;
  }

  try {
    const result = await createView(db, {
      server_id: serverId,
      bank_id: bankId,
      name: req.body.name,
      diagram_type: diagramType,
      graph: req.body.graph,
      layout: req.body.layout,
      style_defaults: req.body.style_defaults,
      timeline: req.body.timeline,
    });
    if (!result.success) {
      const duration = Date.now() - start;
      sendResponse({
        res,
        status: result.code === 'FK_VIOLATION' ? 400 : 500,
        error: result.error || 'Failed to create view',
        code: result.code || 'DATABASE_ERROR',
        logger,
        method: 'POST',
        path: `/banks/${bankId}/views`,
        duration,
      });
      return;
    }
    sendResponse({
      res,
      status: 201,
      data: { id: result.data },
      logger,
      method: 'POST',
      path: `/banks/${bankId}/views`,
      duration: Date.now() - start,
    });
  } catch (err) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'DATABASE_ERROR',
      logger,
      method: 'POST',
      path: `/banks/${bankId}/views`,
      duration,
    });
  }
});

/**
 * @openapi
 * /servers/{serverId}/banks/{bankId}/views/{viewId}:
 *   get:
 *     summary: Get a view
 *     description: Retrieve a single view by id.
 *     tags: [Views]
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank ID
 *       - in: path
 *         name: viewId
 *         required: true
 *         schema:
 *           type: string
 */
router.get('/:viewId', async (req, res) => {
  const start = Date.now();
  const params = requireBankParams(req, res, start, `/banks/${req.params.bankId}/views/${req.params.viewId}`);
  if (!params) return;
  const { serverId, bankId } = params;
  const viewId = req.params.viewId;

  try {
    const result = await getView(db, viewId);
    if (!result.success || !result.data) {
      sendResponse({
        res,
        status: 404,
        error: 'View not found',
        code: 'NOT_FOUND',
        logger,
        method: 'GET',
        path: `/banks/${bankId}/views/${viewId}`,
        duration: Date.now() - start,
      });
      return;
    }
    if (result.data.view_bank_id !== bankId || result.data.view_server_id !== serverId) {
      sendResponse({
        res,
        status: 404,
        error: 'View not found in this bank',
        code: 'NOT_FOUND',
        logger,
        method: 'GET',
        path: `/banks/${bankId}/views/${viewId}`,
        duration: Date.now() - start,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: toApiView(result.data),
      logger,
      method: 'GET',
      path: `/banks/${bankId}/views/${viewId}`,
      duration: Date.now() - start,
    });
  } catch (err) {
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'DATABASE_ERROR',
      logger,
      method: 'GET',
      path: `/banks/${bankId}/views/${viewId}`,
      duration: Date.now() - start,
    });
  }
});

/**
 * @openapi
 * /servers/{serverId}/banks/{bankId}/views/{viewId}/timeline/{snapshotId}/snapshot:
 *   get:
 *     summary: Get a timeline snapshot
 *     description: Fetch the graph and layout stored for a single timeline slice.
 *     tags: [Views]
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank ID
 *       - in: path
 *         name: viewId
 *         required: true
 *         schema:
 *           type: string
 *         description: View ID
 *       - in: path
 *         name: snapshotId
 *         required: true
 *         schema:
 *           type: string
 *         description: Snapshot ID
 */
router.get('/:viewId/timeline/:snapshotId/snapshot', async (req, res) => {
  const start = Date.now();
  const params = requireBankParams(
    req,
    res,
    start,
    `/banks/${req.params.bankId}/views/${req.params.viewId}/timeline/${req.params.snapshotId}/snapshot`
  );
  if (!params) return;
  const { serverId, bankId } = params;
  const { viewId, snapshotId } = req.params;

  try {
    const result = await getTimelineSnapshot(db, viewId, snapshotId);
    const snapshotData = result?.success ? result.data : result;
    const existing = await getView(db, viewId);
    if (!existing.success || !existing.data || existing.data.view_bank_id !== bankId || existing.data.view_server_id !== serverId) {
      sendResponse({
        res,
        status: 404,
        error: 'View not found',
        code: 'NOT_FOUND',
        logger,
        method: 'GET',
        path: `/banks/${bankId}/views/${viewId}/timeline/${snapshotId}/snapshot`,
        duration: Date.now() - start,
      });
      return;
    }

    sendResponse({
      res,
      status: 200,
      data: snapshotData,
      logger,
      method: 'GET',
      path: `/banks/${bankId}/views/${viewId}/timeline/${snapshotId}/snapshot`,
      duration: Date.now() - start,
    });
  } catch (err) {
    if (err.message?.includes('not found')) {
      sendResponse({
        res,
        status: 404,
        error: err.message,
        code: 'NOT_FOUND',
        logger,
        method: 'GET',
        path: `/banks/${bankId}/views/${viewId}/timeline/${snapshotId}/snapshot`,
        duration: Date.now() - start,
      });
      return;
    }
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'DATABASE_ERROR',
      logger,
      method: 'GET',
      path: `/banks/${bankId}/views/${viewId}/timeline/${snapshotId}/snapshot`,
      duration: Date.now() - start,
    });
  }
});

/**
 * @openapi
 * /servers/{serverId}/banks/{bankId}/views/{viewId}/timeline:
 *   delete:
 *     summary: Clear view timeline
 *     description: Delete all timeline snapshots for a view and reset its timeline.
 *     tags: [Views]
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank ID
 *       - in: path
 *         name: viewId
 *         required: true
 *         schema:
 *           type: string
 *         description: View ID
 *     responses:
 *       200:
 *         description: Timeline cleared
 */
router.delete('/:viewId/timeline', async (req, res) => {
  const start = Date.now();
  const params = requireBankParams(
    req,
    res,
    start,
    `/banks/${req.params.bankId}/views/${req.params.viewId}/timeline`
  );
  if (!params) return;
  const { serverId, bankId } = params;
  const { viewId } = req.params;

  try {
    const existing = await getView(db, viewId);
    if (!existing.success || !existing.data || existing.data.view_bank_id !== bankId || existing.data.view_server_id !== serverId) {
      sendResponse({
        res,
        status: 404,
        error: 'View not found',
        code: 'NOT_FOUND',
        logger,
        method: 'DELETE',
        path: `/banks/${bankId}/views/${viewId}/timeline`,
        duration: Date.now() - start,
      });
      return;
    }

    const result = await clearViewTimeline(db, viewId);
    const deleted = result?.success ? result.data : result;

    sendResponse({
      res,
      status: 200,
      data: { deleted },
      logger,
      method: 'DELETE',
      path: `/banks/${bankId}/views/${viewId}/timeline`,
      duration: Date.now() - start,
    });
  } catch (err) {
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'DATABASE_ERROR',
      logger,
      method: 'DELETE',
      path: `/banks/${bankId}/views/${viewId}/timeline`,
      duration: Date.now() - start,
    });
  }
});

/**
 * @openapi
 * /servers/{serverId}/banks/{bankId}/views/{viewId}:
 *   patch:
 *     summary: Update a view
 *     description: Update name, layout, graph, or style_defaults of a view.
 *     tags: [Views]
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank ID
 *       - in: path
 *         name: viewId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               layout:
 *                 type: object
 *               graph:
 *                 type: object
 *               diagram_type:
 *                 type: string
 *               style_defaults:
 *                 type: object
 */
router.patch('/:viewId', async (req, res) => {
  const start = Date.now();
  const params = requireBankParams(req, res, start, `/banks/${req.params.bankId}/views/${req.params.viewId}`);
  if (!params) return;
  const { serverId, bankId } = params;
  const viewId = req.params.viewId;

  try {
    const existing = await getView(db, viewId);
    if (!existing.success || !existing.data || existing.data.view_bank_id !== bankId || existing.data.view_server_id !== serverId) {
      sendResponse({
        res,
        status: 404,
        error: 'View not found',
        code: 'NOT_FOUND',
        logger,
        method: 'PATCH',
        path: `/banks/${bankId}/views/${viewId}`,
        duration: Date.now() - start,
      });
      return;
    }

    const updates = {};
    if (req.body.name !== undefined) updates.view_name = req.body.name;
    if (req.body.diagram_type !== undefined) {
      if (!SUPPORTED_DIAGRAM_TYPES.has(req.body.diagram_type)) {
        sendResponse({
          res,
          status: 400,
          error: `Unsupported diagram_type: ${req.body.diagram_type}`,
          code: 'VALIDATION_ERROR',
          logger,
          method: 'PATCH',
          path: `/banks/${bankId}/views/${viewId}`,
          duration: Date.now() - start,
        });
        return;
      }
      updates.view_diagram_type = req.body.diagram_type;
    }
    if (req.body.graph !== undefined) updates.view_graph = req.body.graph;
    if (req.body.layout !== undefined) updates.view_layout = req.body.layout;
    if (req.body.style_defaults !== undefined) updates.view_style_defaults = req.body.style_defaults;
    if (req.body.timeline !== undefined) updates.view_timeline = req.body.timeline;

    if (Object.keys(updates).length === 0) {
      sendResponse({
        res,
        status: 400,
        error: 'No fields to update',
        code: 'VALIDATION_ERROR',
        logger,
        method: 'PATCH',
        path: `/banks/${bankId}/views/${viewId}`,
        duration: Date.now() - start,
      });
      return;
    }

    const result = await updateView(db, viewId, updates);
    if (result === null) {
      sendResponse({
        res,
        status: 404,
        error: 'View not found',
        code: 'NOT_FOUND',
        logger,
        method: 'PATCH',
        path: `/banks/${bankId}/views/${viewId}`,
        duration: Date.now() - start,
      });
      return;
    }

    const refreshed = await getView(db, viewId);
    sendResponse({
      res,
      status: 200,
      data: refreshed.success ? toApiView(refreshed.data) : null,
      logger,
      method: 'PATCH',
      path: `/banks/${bankId}/views/${viewId}`,
      duration: Date.now() - start,
    });
  } catch (err) {
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'DATABASE_ERROR',
      logger,
      method: 'PATCH',
      path: `/banks/${bankId}/views/${viewId}`,
      duration: Date.now() - start,
    });
  }
});

/**
 * @openapi
 * /servers/{serverId}/banks/{bankId}/views/{viewId}:
 *   delete:
 *     summary: Delete a view
 *     description: Delete a view. Frozen views cannot be deleted via this route.
 *     tags: [Views]
 *     parameters:
 *       - in: path
 *         name: serverId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *       - in: path
 *         name: bankId
 *         required: true
 *         schema:
 *           type: string
 *         description: Bank ID
 *       - in: path
 *         name: viewId
 *         required: true
 *         schema:
 *           type: string
 */
router.delete('/:viewId', async (req, res) => {
  const start = Date.now();
  const params = requireBankParams(req, res, start, `/banks/${req.params.bankId}/views/${req.params.viewId}`);
  if (!params) return;
  const { serverId, bankId } = params;
  const viewId = req.params.viewId;

  try {
    const existing = await getView(db, viewId);
    if (!existing.success || !existing.data) {
      sendResponse({
        res,
        status: 404,
        error: 'View not found',
        code: 'NOT_FOUND',
        logger,
        method: 'DELETE',
        path: `/banks/${bankId}/views/${viewId}`,
        duration: Date.now() - start,
      });
      return;
    }
    if (existing.data.view_bank_id !== bankId || existing.data.view_server_id !== serverId) {
      logger.warn('View bank mismatch on delete', {
        viewId,
        requestBankId: bankId,
        requestServerId: serverId,
        viewBankId: existing.data.view_bank_id,
        viewServerId: existing.data.view_server_id,
        viewName: existing.data.view_name,
      });
      sendResponse({
        res,
        status: 404,
        error: 'View not found in this bank',
        code: 'NOT_FOUND',
        logger,
        method: 'DELETE',
        path: `/banks/${bankId}/views/${viewId}`,
        duration: Date.now() - start,
      });
      return;
    }

    const result = await deleteView(db, viewId);
    sendResponse({
      res,
      status: result ? 204 : 404,
      data: null,
      logger,
      method: 'DELETE',
      path: `/banks/${bankId}/views/${viewId}`,
      duration: Date.now() - start,
    });
  } catch (err) {
    sendResponse({
      res,
      status: 500,
      error: err.message,
      code: 'DATABASE_ERROR',
      logger,
      method: 'DELETE',
      path: `/banks/${bankId}/views/${viewId}`,
      duration: Date.now() - start,
    });
  }
});

export default router;
