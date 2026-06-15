import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { 
  sendResponse,
  validateId,
  validateBodyId,
  handleCrudResult
} from '../utils/route-helpers.js';
import {
  addDocumentMetadata,
  removeDocumentMetadata,
  getDocumentMetadata,
  getExpandedDocumentMetadata
} from '../db/crud/document-metadata.js';
import { getDocument } from '../db/crud/documents.js';

const logger = createLogger('document-metadata-route');
const router = Router({ mergeParams: true });

// DB → API transform for metadata (includes expanded flag when present)
const toApiMetadata = (dbRow) => ({
  id: dbRow.meta_id,
  key: dbRow.meta_key,
  value: dbRow.meta_value,
  generated_by: dbRow.meta_generated_by,
  expanded: dbRow.expanded === 1,      // true if computed from system preset
  created_at: dbRow.meta_created_at,
  updated_at: dbRow.meta_updated_at
});

/**
 * @openapi
 * /documents/{id}/metadata:
 *   get:
 *     summary: Get document metadata
 *     description: Retrieve all directly associated metadata entries for a document
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
 *         description: List of metadata entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Metadata'
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/metadata`;

  // Validate document ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;

  // Verify document exists
  const docResult = await getDocument(db, idCheck.id);
  if (!docResult.success || !docResult.data) {
    handleCrudResult({
      res, result: docResult,
      notFoundError: 'Document not found',
      successStatus: 200,
      logger, method: 'GET', path, start
    });
    return;
  }

  // Get directly associated metadata only (standard CRUD)
  const result = await getDocumentMetadata(db, idCheck.id);
  
  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiMetadata) : null,
    logger, method: 'GET', path, start
  });
});

/**
 * @openapi
 * /documents/{id}/metadata/expanded:
 *   get:
 *     summary: Get expanded document metadata
 *     description: |
 *       Returns all metadata for a document, including directly associated entries
 *       PLUS system preset values computed from live document fields
 *       (full-path, file-name, document-date, author, size, tags, etc.).
 *       Computed entries include `expanded: true`.
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
 *         description: List of metadata entries (direct + computed)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   key:
 *                     type: string
 *                   value:
 *                     type: string
 *                   generated_by:
 *                     type: string
 *                   expanded:
 *                     type: boolean
 *                     description: True when value is computed from document fields
 *                   created_at:
 *                     type: string
 *                   updated_at:
 *                     type: string
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get('/expanded', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/metadata/expanded`;

  // Validate document ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;

  // Verify document exists
  const docResult = await getDocument(db, idCheck.id);
  if (!docResult.success || !docResult.data) {
    handleCrudResult({
      res, result: docResult,
      notFoundError: 'Document not found',
      successStatus: 200,
      logger, method: 'GET', path, start
    });
    return;
  }

  // Get expanded metadata (direct + system preset computations)
  const result = await getExpandedDocumentMetadata(db, idCheck.id);

  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiMetadata) : null,
    logger, method: 'GET', path, start
  });
});

/**
 * @openapi
 * /documents/{id}/metadata/add:
 *   post:
 *     summary: Add metadata to document
 *     description: Associate a metadata entry with a document
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
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Metadata ID to add
 *     responses:
 *       201:
 *         description: Metadata added to document
 *       400:
 *         description: Validation error
 *       404:
 *         description: Document or metadata not found
 *       409:
 *         description: Metadata already associated with document
 *       500:
 *         description: Server error
 */
router.post('/add', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/metadata/add`;

  // Validate document ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;
  const docId = idCheck.id;

  // Validate body.id (API field name for meta_id)
  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const metaId = bodyIdCheck.id;

  // Verify document exists
  const docResult = await getDocument(db, docId);
  if (!docResult.success) {
    handleCrudResult({
      res, result: docResult,
      notFoundError: null,
      successStatus: 200,
      logger, method: 'POST', path, start
    });
    return;
  }
  if (!docResult.data) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 404, error: 'Document not found', code: 'NOT_FOUND',
      logger, method: 'POST', path, duration
    });
    return;
  }

  // Add metadata
  const result = await addDocumentMetadata(db, docId, metaId);

  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 201,
    successData: { document_id: docId, metadata_id: metaId },
    logger, method: 'POST', path, start
  });
});

/**
 * @openapi
 * /documents/{id}/metadata/remove:
 *   post:
 *     summary: Remove metadata from document
 *     description: Remove a metadata association from a document
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
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *                 description: Metadata ID to remove
 *     responses:
 *       200:
 *         description: Metadata removed from document
 *       400:
 *         description: Validation error
 *       404:
 *         description: Document or metadata association not found
 *       500:
 *         description: Server error
 */
router.post('/remove', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/metadata/remove`;

  // Validate document ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;
  const docId = idCheck.id;

  // Validate body.id (API field name for meta_id)
  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const metaId = bodyIdCheck.id;

  // Remove metadata
  const result = await removeDocumentMetadata(db, docId, metaId);

  handleCrudResult({
    res, result,
    notFoundError: 'Metadata not associated with document',
    successStatus: 200,
    successData: { success: true },
    logger, method: 'POST', path, start
  });
});

export default router;
