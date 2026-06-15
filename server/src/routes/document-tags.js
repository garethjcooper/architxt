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
  addDocumentTag,
  removeDocumentTag,
  getDocumentTags
} from '../db/crud/document-tags.js';
import { getDocument } from '../db/crud/documents.js';

const logger = createLogger('document-tags-route');
const router = Router({ mergeParams: true });

// DB → API transform for document tags
// NOTE: This endpoint returns JOIN results from tags + document_tags.
// The document_tags junction table has no extra columns (no id, no confidence, no created_at).
// We emit API field names for the tag portion; the response shape is for the UI's
// "On All Documents" tag list, not a standalone DocumentTag entity.
const toApiDocumentTag = (dbRow) => ({
  id: dbRow.tag_id,
  name: dbRow.tag_name,
  generated_by: dbRow.tag_generated_by,
  created_at: dbRow.tag_created_at,
  updated_at: dbRow.tag_updated_at,
});

/**
 * @openapi
 * /documents/{id}/tags:
 *   get:
 *     summary: Get document tags
 *     description: Retrieve all tags associated with a document
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
 *         description: List of tags
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Tag'
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/tags`;

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

  // Get tags
  const result = await getDocumentTags(db, idCheck.id);
  
  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiDocumentTag) : null,
    logger, method: 'GET', path, start
  });
});

/**
 * @openapi
 * /documents/{id}/tags/add:
 *   post:
 *     summary: Add tag to document
 *     description: Associate a tag with a document
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
 *                 description: Tag ID to add
 *     responses:
 *       201:
 *         description: Tag added to document
 *       400:
 *         description: Validation error
 *       404:
 *         description: Document or tag not found
 *       409:
 *         description: Tag already associated with document
 *       500:
 *         description: Server error
 */
router.post('/add', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/tags/add`;

  // Validate document ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;
  const docId = idCheck.id;

  // Validate body.id (API field name for tag_id)
  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const tagId = bodyIdCheck.id;

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

  // Add tag
  const result = await addDocumentTag(db, docId, tagId);

  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 201,
    successData: { document_id: docId, tag_id: tagId },
    logger, method: 'POST', path, start
  });
});

/**
 * @openapi
 * /documents/{id}/tags/remove:
 *   post:
 *     summary: Remove tag from document
 *     description: Remove a tag association from a document
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
 *                 description: Tag ID to remove
 *     responses:
 *       200:
 *         description: Tag removed from document
 *       400:
 *         description: Validation error
 *       404:
 *         description: Document or tag association not found
 *       500:
 *         description: Server error
 */
router.post('/remove', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}/tags/remove`;

  // Validate document ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;
  const docId = idCheck.id;

  // Validate body.id (API field name for tag_id)
  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const tagId = bodyIdCheck.id;

  // Remove tag
  const result = await removeDocumentTag(db, docId, tagId);

  handleCrudResult({
    res, result,
    notFoundError: 'Tag not associated with document',
    successStatus: 200,
    successData: { success: true },
    logger, method: 'POST', path, start
  });
});

export default router;
