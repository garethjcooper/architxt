import { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { createHash } from 'crypto';
import { createLogger } from '../utils/logger.js';
import { 
  validateId,
  sendResponse
} from '../utils/route-helpers.js';
import { 
  createHistoryEntry,
  buildStatusTransition,
  isNullish
} from '../utils/db-helpers.js';
import { 
  getDocument, 
  listDocuments,
  updateDocument,
  getNextReadyToExtractDocument,
  claimDocument,
  markDocumentReadyToExtract
} from '../db/crud/documents.js';

const logger = createLogger('documents-workflow-route');
const router = Router();

// DB → API name transform (content omitted for list — use GET /documents/:id for content)
const toApiDocument = (dbRow) => ({
  id: dbRow.doc_id,
  ext_id: dbRow.doc_ext_id,
  content: dbRow.doc_content,
  content_hash: dbRow.doc_content_hash,
  filename: dbRow.doc_filename,
  source_path: dbRow.doc_source_path,
  status: dbRow.doc_status,
  generated_by: dbRow.doc_generated_by,
  context_id: dbRow.ctxt_id,
  context: dbRow.doc_context || null,
  processing_history: dbRow.doc_processing_history,
  processing_progress: dbRow.doc_processing_progress,
  tags: dbRow.doc_tags || [],
  metadata: dbRow.doc_metadata || [],
  created_at: dbRow.doc_created_at,
  updated_at: dbRow.doc_updated_at
});

/**
 * @openapi
 * /documents/extractwork:
 *   get:
 *     summary: Get next document ready for extraction
 *     description: Returns the ID of the oldest document in ready_to_extract state. No state change occurs.
 *     tags: [Documents]
 *     responses:
 *       200:
 *         description: Document ID ready for claiming
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *       204:
 *         description: No documents ready for extraction
 *       500:
 *         description: Server error
 */
router.get('/extractwork', async (req, res) => {
  const start = Date.now();
  const routePath = '/documents/extractwork';

  const result = await getNextReadyToExtractDocument(db);

  // CRUD error
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code, logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }

  // No work available - 204 with empty body (daemon polls for this)
  if (isNullish(result.data)) {
    sendResponse({ res, status: 204, data: null, logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }

  // Success - return doc_id
  sendResponse({ res, status: 200, data: { id: result.data }, logger, method: 'GET', path: routePath, duration: Date.now() - start });
});

/**
 * @openapi
 * /documents/reconcile:
 *   get:
 *     summary: Get orphaned documents
 *     description: Returns document IDs stuck in processing_extract for too long
 *     tags: [Documents]
 *     responses:
 *       200:
 *         description: List of orphaned document IDs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orphans:
 *                   type: array
 *                   items:
 *                     type: integer
 */
router.get('/reconcile', async (req, res) => {
  const start = Date.now();
  const routePath = '/documents/reconcile';
  const ORPHAN_THRESHOLD_MINUTES = config.extractdaemon?.orphan_threshold_minutes || 5;

  const result = await listDocuments(db, { status: 'processing_extract', limit: 1000 });
  if (!result.success) {
    sendResponse({ res, status: 500, error: result.error, code: result.code, logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }

  const cutoffTime = new Date(Date.now() - ORPHAN_THRESHOLD_MINUTES * 60 * 1000);
  const orphans = result.data
    ?.filter(doc => new Date(doc.doc_updated_at) < cutoffTime)
    ?.map(doc => doc.doc_id) || [];

  sendResponse({ res, status: 200, data: { orphans, threshold_minutes: ORPHAN_THRESHOLD_MINUTES }, logger, method: 'GET', path: routePath, duration: Date.now() - start });
});

/**
 * @openapi
 * /documents/{id}/claim:
 *   post:
 *     summary: Atomically claim a document for processing
 *     description: Transitions document from ready_to_extract to processing_extract if still in that state. Daemon should verify it got 200 before processing; 409 means another daemon claimed it first.
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document claimed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 claimed:
 *                   type: boolean
 *       409:
 *         description: Document already claimed or wrong state
 *       500:
 *         description: Server error
 */
router.post('/:id/claim', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/claim`;

  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  // Check existence first
  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: docResult.error, code: docResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const claimResult = await claimDocument(db, id);

  if (!claimResult.success) {
    sendResponse({ res, status: 500, error: claimResult.error, code: claimResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  if (!claimResult.data) {
    const currentStatus = docResult.data.doc_status;
    sendResponse({ res, status: 409, error: `Document in state '${currentStatus}', expected 'ready_to_extract'`, code: 'STATE_CONFLICT', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  sendResponse({ res, status: 200, data: { id, status: 'processing_extract', claimed: true }, logger, method: 'POST', path: routePath, duration: Date.now() - start });
});

/**
 * @openapi
 * /documents/{id}/process:
 *   post:
 *     summary: Trigger document processing
 *     description: Transition document from uploaded to ready_to_extract state
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document queued for processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Invalid document ID or not in uploaded state
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.post('/:id/process', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/process`;

  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: `Failed to retrieve document: ${docResult.error}`, code: docResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const transitionResult = await markDocumentReadyToExtract(db, id);
  if (!transitionResult.success) {
    sendResponse({ res, status: 500, error: `Failed to transition status: ${transitionResult.error}`, code: transitionResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (transitionResult.data === false) {
    const currentStatus = docResult.data.doc_status;
    sendResponse({ res, status: 409, error: `Document in state '${currentStatus}', cannot queue for processing`, code: 'STATE_CONFLICT', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  sendResponse({ res, status: 200, data: { id, status: 'ready_to_extract', message: 'Document queued for processing' }, logger, method: 'POST', path: routePath, duration: Date.now() - start });
});

/**
 * @openapi
 * /documents/{id}/extractprogress:
 *   post:
 *     summary: Report extraction progress
 *     description: Daemon reports progress during processing (called approximately every 30s)
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
 *             type: object
 *             required:
 *               - progress
 *               - success
 *             properties:
 *               progress:
 *                 type: object
 *               success:
 *                 type: boolean
 *               error:
 *                 type: string
 *               metrics:
 *                 type: object
 *     responses:
 *       200:
 *         description: Status updated
 *       409:
 *         description: Wrong state (not processing_extract)
 */
router.post('/:id/extractprogress', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/extractprogress`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const { progress } = req.body || {};
  if (!progress || typeof progress !== 'object') {
    sendResponse({ res, status: 400, error: 'progress object required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: docResult.error, code: docResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  // Only allow progress updates while processing
  if (docResult.data.doc_status !== 'processing_extract') {
    sendResponse({ res, status: 409, error: `Document in state '${docResult.data.doc_status}', expected 'processing_extract'`, code: 'STATE_CONFLICT', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const updateResult = await updateDocument(db, id, { doc_processing_progress: progress });
  if (!updateResult.success) {
    sendResponse({ res, status: 500, error: updateResult.error, code: updateResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  sendResponse({ res, status: 200, data: { id, progress_updated: true }, logger, method: 'POST', path: routePath, duration: Date.now() - start });
});

/**
 * @openapi
 * /documents/{id}/cancel:
 *   post:
 *     summary: Cancel document processing
 *     description: Transition document from processing_extract to request_release state
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Document ID
 *     responses:
 *       200:
 *         description: Document cancel request sent
 *       409:
 *         description: Document not in processing state
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.post('/:id/cancel', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/cancel`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: docResult.error, code: docResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  // Only allow cancelling while processing
  if (docResult.data.doc_status !== 'processing_extract') {
    sendResponse({ res, status: 409, error: `Document in state '${docResult.data.doc_status}', expected 'processing_extract'`, code: 'STATE_CONFLICT', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const historyEntry = createHistoryEntry({
    from: 'processing_extract',
    to: 'request_release',
    success: true,
    reason: 'User cancelled processing',
    metrics: {}
  });

  const updateResult = await updateDocument(
    db,
    id,
    buildStatusTransition({ newStatus: 'request_release', existingHistory: docResult.data.doc_processing_history, entry: historyEntry })
  );
  if (!updateResult.success) {
    sendResponse({ res, status: 500, error: updateResult.error, code: updateResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  sendResponse({ res, status: 200, data: { id, status: 'request_release', cancelled: true }, logger, method: 'POST', path: routePath, duration: Date.now() - start });
});

/**
 * @openapi
 * /documents/{id}/release:
 *   post:
 *     summary: Release document from processing
 *     description: Force transition from processing_extract or request_release back to uploaded. Derives current status from the database — no from/reason payload required.
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               metrics:
 *                 type: object
 *     responses:
 *       200:
 *         description: Document released
 *       409:
 *         description: Wrong state
 */
router.post('/:id/release', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/release`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const { reason, metrics } = req.body || {};

  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: docResult.error, code: docResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const currentStatus = docResult.data.doc_status;

  if (currentStatus !== 'processing_extract' && currentStatus !== 'request_release') {
    sendResponse({ res, status: 409, error: `Document in state '${currentStatus}', expected 'processing_extract' or 'request_release'`, code: 'STATE_CONFLICT', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const existingContent = docResult.data.doc_content;
  const existingHash = docResult.data.doc_content_hash;

  // If document has content and the hash verifies, preserve as extracted
  let newStatus = 'uploaded';
  let finalReason = reason || 'released';
  let hasValidContent = false;

  if (existingContent && existingHash) {
    const computedHash = createHash('sha256').update(existingContent).digest('hex');
    if (computedHash === existingHash) {
      newStatus = 'processed_extract_success';
      finalReason = reason || 'released_with_content';
      hasValidContent = true;
    } else {
      logger.warn('Content hash mismatch during release', { id, existingHash, computedHash });
    }
  }

  const historyEntry = createHistoryEntry({
    from: currentStatus,
    to: newStatus,
    success: true,
    reason: finalReason,
    metrics
  });

  const updateResult = await updateDocument(
    db,
    id,
    buildStatusTransition({ newStatus, existingHistory: docResult.data.doc_processing_history, entry: historyEntry })
  );
  if (!updateResult.success) {
    sendResponse({ res, status: 500, error: updateResult.error, code: updateResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  sendResponse({ res, status: 200, data: { id, status: newStatus, released: true, preserved: hasValidContent }, logger, method: 'POST', path: routePath, duration: Date.now() - start });
});

export default router;