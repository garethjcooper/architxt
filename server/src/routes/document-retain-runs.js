import { Router } from 'express';
import { db } from '../db/connection.js';
import * as documentCrud from '../db/crud/documents.js';
import * as retainRunCrud from '../db/crud/document-retain-runs.js';
import {
  validateId,
  sendResponse,
} from '../utils/route-helpers.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('document-retain-runs-route');
const router = Router({ mergeParams: true });

/**
 * @openapi
 * /documents/{id}/retain-runs:
 *   get:
 *     summary: List saved retain dry-run runs
 *     description: Return saved dry-run runs for a document, newest first.
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of retain runs
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/RetainRun'
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 *   post:
 *     summary: Save a retain dry-run run
 *     description: Persist a dry-run extraction output so it can be reloaded and compared later.
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RetainRunInput'
 *     responses:
 *       201:
 *         description: Saved run
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RetainRun'
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/retain-runs`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;

  const doc = await documentCrud.getDocument(db, idCheck.id);
  if (!doc.success || !doc.data) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 404,
      error: 'Document not found',
      code: 'NOT_FOUND',
      logger,
      method: req.method,
      path,
      duration
    });
    return;
  }

  const limit = parseInt(req.query.limit, 10) || 50;
  const offset = parseInt(req.query.offset, 10) || 0;
  const result = await retainRunCrud.listRunsByDocument(db, idCheck.id, { limit, offset });

  const duration = Date.now() - start;
  sendResponse({
    res,
    status: 200,
    data: result.data,
    logger,
    method: req.method,
    path,
    duration
  });
});

router.post('/', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/retain-runs`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;

  const doc = await documentCrud.getDocument(db, idCheck.id);
  if (!doc.success || !doc.data) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 404,
      error: 'Document not found',
      code: 'NOT_FOUND',
      logger,
      method: req.method,
      path,
      duration
    });
    return;
  }

  const body = req.body ?? {};
  const createResult = await retainRunCrud.createRun(db, {
    doc_id: idCheck.id,
    server_id: body.server_id,
    bank_id: body.bank_id,
    context: body.context,
    retain_mission: body.retain_mission,
    extraction_mode: body.extraction_mode,
    timestamp: body.timestamp ?? new Date().toISOString(),
    entity_label_source: body.entity_label_source,
    free_form_entities: body.free_form_entities ?? body.entities_allow_free_form,
    content_snapshot: body.content_snapshot,
    content_hash: body.content_hash,
    facts: body.facts,
    usage: body.usage,
    model: body.model,
  });

  if (!createResult.success) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 500,
      error: createResult.error || 'Failed to save retain run',
      code: 'DB_ERROR',
      logger,
      method: req.method,
      path,
      duration
    });
    return;
  }

  const saved = await retainRunCrud.getRun(db, createResult.data, idCheck.id);
  const duration = Date.now() - start;
  sendResponse({
    res,
    status: 201,
    data: saved?.data ?? saved,
    logger,
    method: req.method,
    path,
    duration
  });
});

/**
 * @openapi
 * /documents/{id}/retain-runs/{runId}:
 *   get:
 *     summary: Get a single saved retain run
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Retain run
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RetainRun'
 *       404:
 *         description: Run or document not found
 *       500:
 *         description: Server error
 *   delete:
 *     summary: Delete a saved retain run
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Deleted
 *       404:
 *         description: Run or document not found
 *       500:
 *         description: Server error
 */
router.get('/:runId', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/retain-runs/${req.params.runId}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;

  const runCheck = validateId({ req, res, paramName: 'runId', logger, path: '/documents', start });
  if (!runCheck.valid) return;

  const runResult = await retainRunCrud.getRun(db, runCheck.id, idCheck.id);
  const run = runResult?.data ?? runResult;
  if (!run) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 404,
      error: 'Retain run not found',
      code: 'NOT_FOUND',
      logger,
      method: req.method,
      path,
      duration
    });
    return;
  }

  const duration = Date.now() - start;
  sendResponse({
    res,
    status: 200,
    data: run,
    logger,
    method: req.method,
    path,
    duration
  });
});

router.delete('/:runId', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/retain-runs/${req.params.runId}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;

  const runCheck = validateId({ req, res, paramName: 'runId', logger, path: '/documents', start });
  if (!runCheck.valid) return;

  const existingResult = await retainRunCrud.getRun(db, runCheck.id, idCheck.id);
  const existing = existingResult?.data ?? existingResult;
  if (!existing) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 404,
      error: 'Retain run not found',
      code: 'NOT_FOUND',
      logger,
      method: req.method,
      path,
      duration
    });
    return;
  }

  await retainRunCrud.deleteRun(db, runCheck.id);
  const duration = Date.now() - start;
  sendResponse({
    res,
    status: 204,
    data: null,
    logger,
    method: req.method,
    path,
    duration
  });
});

export default router;
