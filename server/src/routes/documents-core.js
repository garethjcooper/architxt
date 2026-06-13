import { Router } from 'express';
import multer from 'multer';
import { createUploadMiddleware } from '../utils/upload.js';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { isNullish } from '../utils/db-helpers.js';
import {
  writeToStorage,
  removeStorageById
} from '../utils/file-helpers.js';
import { 
  handleGetById, 
  handleDeleteById,
  handleCrudResult,
  validateId,
  sendResponse,
  validateIdArray,
  validateOptionalIdArray
} from '../utils/route-helpers.js';
import { 
  getDocument, 
  createDocument, 
  deleteDocument, 
  listDocuments,
  updateDocument,
  getDocumentProcessing,
  batchUpdateDocumentContext
} from '../db/crud/documents.js';
import { stmt } from '../cache.js';
import { 
  batchUpdateDocumentTags
} from '../db/crud/document-tags.js';
import { batchUpdateDocumentMetadata } from '../db/crud/document-metadata.js';

// Note: batchUpdateDocumentMetadata is in document-metadata.js

const logger = createLogger('documents-core-route');
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage?.max_file_size || 100 * 1024 * 1024
  }
});

const uploadMiddleware = createUploadMiddleware('file');

// DB → API name transform (content omitted for list — use GET /documents/:id for content)
const toApiDocument = (dbRow) => ({
  id: dbRow.doc_id,
  ext_id: dbRow.doc_ext_id,
  content: dbRow.doc_content,
  content_hash: dbRow.doc_content_hash,
  filename: dbRow.doc_filename,
  source_path: dbRow.doc_source_path,
  full_path: dbRow.doc_full_path || null,
  authors: (() => {
    try {
      const raw = dbRow.doc_authors;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  })(),
  status: dbRow.doc_status,
  generated_by: dbRow.doc_generated_by,
  context_id: dbRow.ctxt_id,
  context: dbRow.doc_context || null,
  processing_history: dbRow.doc_processing_history,
  processing_progress: dbRow.doc_processing_progress,
  tags: dbRow.doc_tags || [],
  metadata: dbRow.doc_metadata || [],
  content_length_k: dbRow.doc_content_length_k || null,
  has_entities: dbRow.doc_has_entities === 1,
  timestamp: dbRow.doc_timestamp || null,
  created_at: dbRow.doc_created_at,
  updated_at: dbRow.doc_updated_at
});

/**
 * @openapi
 * /documents:
 *   get:
 *     summary: List documents
 *     description: Retrieve a list of documents with optional filtering
 *     tags: [Documents]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [uploaded, ready_to_extract, processing_extract, processed_extract_success, processed_extract_failed]
 *         description: Filter by processing status
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of documents to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of documents to skip
 *     responses:
 *       200:
 *         description: List of documents
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Document'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  
  const result = await listDocuments(db, {
    status: req.query.status,
    limit: parseInt(req.query.limit, 10) || 100,
    offset: parseInt(req.query.offset, 10) || 0
  });
  
  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiDocument) : null,
    logger,
    method: 'GET',
    path: '/documents',
    start
  });
});

/**
 * @openapi
 * /documents/processing:
 *   get:
 *     summary: Get currently processing document
 *     description: Returns the document currently being processed (doc_status = 'processing_extract'), or null if idle.
 *     tags: [Documents]
 *     responses:
 *       200:
 *         description: Current processing status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 processing:
 *                   type: object
 *                   nullable: true
 *                   description: Active processing progress, or null when idle
 *       500:
 *         description: Server error
 */
router.get('/processing', async (req, res) => {
  const start = Date.now();
  const routePath = '/documents/processing';

  try {
    const result = await getDocumentProcessing(db);

    if (!result.success || !result.data) {
      sendResponse({
        res, status: 200,
        data: { processing: null },
        logger, method: 'GET', path: routePath, duration: Date.now() - start
      });
      return;
    }

    const row = result.data;

    const parseJson = (value) => {
      if (!value) return null;
      if (typeof value === 'object') return value;
      try { return JSON.parse(value); } catch { return null; }
    };

    const progress = parseJson(row.doc_processing_progress);
    const history = parseJson(row.doc_processing_history);

    sendResponse({
      res, status: 200,
      data: {
        processing: {
          document: {
            id: row.doc_id,
            ext_id: row.doc_ext_id,
            filename: row.doc_filename,
            status: row.doc_status,
          },
          progress,
          history,
        }
      },
      logger, method: 'GET', path: routePath, duration: Date.now() - start
    });
  } catch (err) {
    const duration = Date.now() - start;
    logger.error('Failed to get processing document', { error: err.message });
    sendResponse({
      res, status: 500,
      error: 'Failed to retrieve processing status',
      code: 'DB_ERROR',
      logger, method: 'GET', path: routePath, duration
    });
  }
});


/**
 * @openapi
 * /documents/{id}:
 *   get:
 *     summary: Get document by ID
 *     description: Retrieve a single document by its ID
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
 *         description: Document found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Document'
 *       400:
 *         description: Invalid document ID
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
/**
 * @openapi
 * /documents/{id}/content:
 *   get:
 *     summary: Get document content
 *     description: Retrieve the extracted content and content hash for a document
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
 *         description: Document content
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 content:
 *                   type: string
 *                   nullable: true
 *                   description: The extracted document content
 *                 content_hash:
 *                   type: string
 *                   nullable: true
 *                   description: SHA256 hash of the content
 *       400:
 *         description: Invalid document ID
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get('/:id/content', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/content`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const result = await getDocument(db, id);
  if (!result.success) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 500, error: `Failed to retrieve document: ${result.error}`, code: result.code,
      logger, method: 'GET', path: routePath, duration
    });
    return;
  }
  if (isNullish(result.data)) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 404, error: 'Document not found', code: 'NOT_FOUND',
      logger, method: 'GET', path: routePath, duration
    });
    return;
  }

  sendResponse({
    res, status: 200,
    data: {
      content: result.data.doc_content || null,
      content_hash: result.data.doc_content_hash || null,
      content_blocks: result.data.doc_content_blocks || null
    },
    logger, method: 'GET', path: routePath, duration: Date.now() - start
  });
});

/**
 * @openapi
 * /documents/{id}/processinghistory:
 *   get:
 *     summary: Get document processing history
 *     description: Retrieve the processing history for a document
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
 *         description: Document processing history
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 processing_history:
 *                   type: array
 *                   nullable: true
 *                   description: Array of processing history entries
 *       400:
 *         description: Invalid document ID
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error
 */
router.get('/:id/processinghistory', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/processinghistory`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const result = await getDocument(db, id);
  if (!result.success) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 500, error: `Failed to retrieve document: ${result.error}`, code: result.code,
      logger, method: 'GET', path: routePath, duration
    });
    return;
  }
  if (isNullish(result.data)) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 404, error: 'Document not found', code: 'NOT_FOUND',
      logger, method: 'GET', path: routePath, duration
    });
    return;
  }

  sendResponse({
    res, status: 200,
    data: {
      processing_history: result.data.doc_processing_history || null
    },
    logger, method: 'GET', path: routePath, duration: Date.now() - start
  });
});

/** (Smart Edit) Serve an image file for a document */
router.get('/:id/images/:imageId', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/images/${req.params.imageId}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const imageId = req.params.imageId;
  if (!/^[a-zA-Z0-9_-]+$/.test(imageId)) {
    sendResponse({ res, status: 400, error: 'Invalid image ID', code: 'VALIDATION_ERROR', logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }

  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: docResult.error, code: docResult.code, logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }

  // Search for {imageId}.png / .jpg / .jpeg in {storage.path}/{id}/
  const docDir = path.join(config.storage.path, String(id));
  const extCandidates = ['png', 'jpg', 'jpeg'];
  for (const ext of extCandidates) {
    const candidate = path.join(docDir, `${imageId}.${ext}`);
    try {
      await fsPromises.access(candidate);
      res.setHeader('Content-Type', `image/${ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : 'png'}`);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const fileStream = fs.createReadStream(candidate);
      fileStream.pipe(res);
      fileStream.on('error', (err) => {
        logger.error('Error streaming image file', { id, imageId, error: err.message });
        if (!res.headersSent) {
          sendResponse({ res, status: 500, error: 'Failed to stream image', code: 'STREAM_ERROR', logger, method: 'GET', path: routePath, duration: Date.now() - start });
        }
      });
      return;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  sendResponse({ res, status: 404, error: 'Image not found', code: 'IMAGE_NOT_FOUND', logger, method: 'GET', path: routePath, duration: Date.now() - start });
});

router.get('/:id', handleGetById({
  db,
  crudFn: getDocument,
  resourceName: 'document',
  logger,
  basePath: '/documents',
  transform: toApiDocument
}));

/**
 * @openapi
 * /documents:
 *   post:
 *     summary: Upload and create document
 *     description: Upload a document file and create a new document record. Stores file to {storage_path}/{id}/source.{ext}
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: The document file to upload
 *               ext_id:
 *                 type: string
 *                 description: External document identifier (required)
 *     responses:
 *       201:
 *         description: Document created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 status:
 *                   type: string
 *                 source_path:
 *                   type: string
 *       400:
 *         description: No file provided
 *       500:
 *         description: Server error
 */
router.post('/', uploadMiddleware, async (req, res) => {
  const start = Date.now();
  const routePath = '/documents';
  const file = req.file;

  if (!file) {
    sendResponse({
      res, status: 400, error: 'No file provided', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path: routePath, duration: Date.now() - start
    });
    return;
  }

  const { ext_id } = req.body;

  if (!ext_id || typeof ext_id !== 'string' || ext_id.trim() === '') {
    sendResponse({
      res, status: 400, error: 'ext_id is required (string)', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path: routePath, duration: Date.now() - start
    });
    return;
  }

  const createResult = await createDocument(db, {
    doc_ext_id: ext_id.trim(),
    doc_status: 'uploaded',
    doc_source_path: 'UPLOADING',
    doc_filename: file.originalname,
    doc_generated_by: 'user'
  });

  if (!createResult.success) {
    logger.error('DB create failed', { error: createResult.error, code: createResult.code, raw: createResult.raw });
    sendResponse({
      res, status: 500, error: `Failed to create document: ${createResult.error}`, code: createResult.code,
      logger, method: 'POST', path: routePath, duration: Date.now() - start
    });
    return;
  }

  const docId = createResult.data;
  let finalPath;

  try {
    finalPath = await writeToStorage(file.buffer, config.storage.path, docId, file.originalname);
  } catch (fileErr) {
    logger.error('File write failed, rolling back DB record', { docId, error: fileErr.message });
    await deleteDocument(db, docId);
    sendResponse({
      res, status: 500, error: 'Failed to store file', code: 'FILE_WRITE_ERROR',
      logger, method: 'POST', path: routePath, duration: Date.now() - start
    });
    return;
  }

  const updateResult = await updateDocument(db, docId, { doc_source_path: finalPath });

  if (!updateResult.success) {
    logger.error('DB update failed, rolling back', { docId, error: updateResult.error });
    await removeStorageById(config.storage.path, docId);
    await deleteDocument(db, docId);
    sendResponse({
      res, status: 500, error: 'Failed to finalize document', code: 'DB_UPDATE_ERROR',
      logger, method: 'POST', path: routePath, duration: Date.now() - start
    });
    return;
  }

  // ── Apply optional context & tags on upload ─────────────────────────
  let contextApplied = false;
  let tagsApplied = false;

  if (req.body.context_id !== undefined) {
    let contextId = null;
    if (req.body.context_id !== '' && req.body.context_id !== 'null' && req.body.context_id !== null) {
      contextId = parseInt(req.body.context_id, 10);
      if (!Number.isNaN(contextId)) {
        await batchUpdateDocumentContext(db, [docId], contextId);
        contextApplied = true;
      }
    }
  }

  if (req.body.tags_to_add) {
    let tagIds = [];
    try {
      tagIds = JSON.parse(req.body.tags_to_add);
    } catch {
      // If not JSON, try comma-separated
      tagIds = req.body.tags_to_add
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
    }
    if (tagIds.length > 0) {
      await batchUpdateDocumentTags(db, [docId], tagIds, []);
      tagsApplied = true;
    }
  }

  // ── Apply optional metadata on upload ────────────────────────────────
  let metadataApplied = false;
  if (req.body.metadata_to_add) {
    let metaIds = [];
    try {
      metaIds = JSON.parse(req.body.metadata_to_add);
    } catch {
      metaIds = req.body.metadata_to_add
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => !Number.isNaN(n));
    }
    if (metaIds.length > 0) {
      await batchUpdateDocumentMetadata(db, [docId], metaIds, []);
      metadataApplied = true;
    }
  }

  sendResponse({
    res, status: 201,
    data: {
      id: docId,
      status: 'uploaded',
      source_path: finalPath,
      context_applied: contextApplied,
      tags_applied: tagsApplied,
      metadata_applied: metadataApplied,
    },
    logger, method: 'POST', path: routePath, duration: Date.now() - start
  });
});

/**
 * @openapi
 * /documents/{id}:
 *   delete:
 *     summary: Delete document
 *     description: Delete a document by ID and remove associated storage files
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Document deleted successfully
 *       404:
 *         description: Document not found
 *       500:
 *         description: Server error (partial deletion may have occurred)
 */
/**
 * @openapi
 * /documents/{id}:
 *   put:
 *     summary: Update document
 *     description: Update document ext_id, ctxt_id, content, and/or blocks. Pass null for ctxt_id to clear context.
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
 *             properties:
 *               ext_id:
 *                 type: string
 *                 nullable: true
 *               ctxt_id:
 *                 type: integer
 *                 nullable: true
 *                 description: Context ID or null to clear context
 *               full_path:
 *                 type: string
 *                 nullable: true
 *                 description: Full URL/path to the original document source
 *               authors:
 *                 type: array
 *                 nullable: true
 *                 items:
 *                   type: string
 *                 description: Array of author names (JSON array string)
 *               content:
 *                 type: string
 *                 nullable: true
 *               blocks:
 *                 type: array
 *                 nullable: true
 *                 description: Smart Edit block array (JSON) or null to clear
 *               timestamp:
 *                 type: string
 *                 nullable: true
 *                 description: ISO 8601 timestamp string
 *     responses:
 *       200:
 *         description: Document updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Document not found
 *       422:
 *         description: Invalid context_id (foreign key violation)
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/documents/${req.params.id}`;

  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/documents', start });
  if (!idCheck.valid) return;

  // Require at least one field
  if (Object.keys(req.body).length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'At least one field is required', code: 'VALIDATION_ERROR',
      logger, method: 'PUT', path, duration
    });
    return;
  }

  // Build update data (allow ext_id, ctxt_id, content, blocks)
  const updateData = {};
  if (req.body.ext_id !== undefined) updateData.doc_ext_id = req.body.ext_id;
  if (req.body.content !== undefined) {
    updateData.doc_content = req.body.content;
    updateData.doc_content_hash = createHash('sha256').update(req.body.content || '').digest('hex');
  }
  if (req.body.blocks !== undefined) {
    updateData.doc_content_blocks = Array.isArray(req.body.blocks) ? JSON.stringify(req.body.blocks) : null;
  }
  if (req.body.context_id !== undefined) {
    // Allow null to clear context, or integer to set context
    if (req.body.context_id === null) {
      updateData.ctxt_id = null;
    } else {
      const ctxtId = parseInt(req.body.context_id, 10);
      if (Number.isNaN(ctxtId)) {
        const duration = Date.now() - start;
        sendResponse({
          res, status: 400, error: 'context_id must be an integer or null', code: 'VALIDATION_ERROR',
          logger, method: 'PUT', path, duration
        });
        return;
      }
      updateData.ctxt_id = ctxtId;
    }
  }
  if (req.body.timestamp !== undefined) {
    if (req.body.timestamp === null) {
      updateData.doc_timestamp = null;
    } else {
      const d = new Date(req.body.timestamp);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid timestamp', code: 'VALIDATION_ERROR' });
      }
      updateData.doc_timestamp = d.toISOString();
    }
  }
  if (req.body.full_path !== undefined) {
    updateData.doc_full_path = req.body.full_path === null ? null : String(req.body.full_path);
  }
  if (req.body.authors !== undefined) {
    if (req.body.authors === null) {
      updateData.doc_authors = null;
    } else if (Array.isArray(req.body.authors)) {
      updateData.doc_authors = JSON.stringify(req.body.authors);
    } else {
      return res.status(400).json({ error: 'authors must be an array or null', code: 'VALIDATION_ERROR' });
    }
  }

  if (Object.keys(updateData).length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'No valid fields to update', code: 'VALIDATION_ERROR',
      logger, method: 'PUT', path, duration
    });
    return;
  }

  // CRUD
  const result = await updateDocument(db, idCheck.id, updateData);

  handleCrudResult({
    res, result,
    notFoundError: 'Document not found',
    successStatus: 200, successData: { success: true },
    logger, method: 'PUT', path, start
  });
});

router.delete('/:id', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;

  const id = idCheck.id;

  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: `Failed to retrieve document: ${docResult.error}`, code: docResult.code, logger, method: 'DELETE', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'DELETE', path: routePath, duration: Date.now() - start });
    return;
  }

  const deleteResult = await deleteDocument(db, id);
  if (!deleteResult.success) {
    sendResponse({ res, status: 500, error: `Failed to delete document: ${deleteResult.error}`, code: deleteResult.code, logger, method: 'DELETE', path: routePath, duration: Date.now() - start });
    return;
  }

  try {
    await removeStorageById(config.storage.path, id);
  } catch (fileErr) {
    logger.error('DB deleted but file removal failed', { id, error: fileErr.message, orphanedPath: `${config.storage.path}/${id}` });
  }

  sendResponse({ res, status: 204, data: null, logger, method: 'DELETE', path: routePath, duration: Date.now() - start });
});

/**
 * @openapi
 * /documents/batch/updatetags:
 *   post:
 *     summary: Batch update tags for multiple documents
 *     description: Add or remove tags from multiple documents in a single operation
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - document_ids
 *             properties:
 *               document_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Document IDs to update (minimum 1)
 *               tags_to_add:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Tag IDs to add to all selected documents
 *               tags_to_remove:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Tag IDs to remove from all selected documents
 *     responses:
 *       200:
 *         description: Tags updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 docs_updated:
 *                   type: integer
 *                 tags_added:
 *                   type: integer
 *                 tags_removed:
 *                   type: integer
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/batch/updatetags', async (req, res) => {
  const start = Date.now();
  const path = '/documents/batch/updatetags';

  // Validate document_ids
  const docIdsCheck = validateIdArray({ req, res, field: 'document_ids', logger, path, start });
  if (!docIdsCheck.valid) return;
  const docIds = docIdsCheck.ids;

  // Validate tags_to_add and tags_to_remove
  const tagsToAddCheck = validateOptionalIdArray({ req, res, field: 'tags_to_add', logger, path, start });
  if (!tagsToAddCheck.valid) return;
  const tagsToAdd = tagsToAddCheck.ids;

  const tagsToRemoveCheck = validateOptionalIdArray({ req, res, field: 'tags_to_remove', logger, path, start });
  if (!tagsToRemoveCheck.valid) return;
  const tagsToRemove = tagsToRemoveCheck.ids;

  // Must have at least one action
  if (tagsToAdd.length === 0 && tagsToRemove.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'Must provide tags_to_add or tags_to_remove', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration
    });
    return;
  }

  // Execute batch update
  const result = await batchUpdateDocumentTags(db, docIds, tagsToAdd, tagsToRemove);

  if (!result.success) {
    handleCrudResult({
      res, result,
      notFoundError: null,
      successStatus: 200,
      logger, method: 'POST', path, start
    });
    return;
  }

  const { tagsAdded, tagsRemoved } = result.data;
  const duration = Date.now() - start;
  sendResponse({
    res, status: 200, data: {
      success: true,
      docs_updated: docIds.length,
      tags_added: tagsAdded,
      tags_removed: tagsRemoved
    },
    logger, method: 'POST', path, duration
  });
});

// Batch context update route
router.post('/batch/context', async (req, res) => {
  const start = Date.now();
  const path = '/documents/batch/context';

  try {
    const { context_id } = req.body;

    // Validate document_ids
    const docIdsCheck = validateIdArray({ req, res, field: 'document_ids', logger, path, start });
    if (!docIdsCheck.valid) return;
    const docIds = docIdsCheck.ids;

    let contextId = null;
    if (context_id !== null && context_id !== undefined) {
      const parsed = parseInt(context_id, 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid context ID: ${context_id}`);
      }
      contextId = parsed;
    }

    const result = await batchUpdateDocumentContext(db, docIds, contextId);

    if (!result.success) {
      handleCrudResult({
        res, result,
        notFoundError: null,
        successStatus: 200,
        logger, method: 'POST', path, start
      });
      return;
    }

    const duration = Date.now() - start;
    sendResponse({
      res, status: 200, data: {
        success: true,
        docs_updated: result.data.docsUpdated
      },
      logger, method: 'POST', path, duration
    });
  } catch (error) {
    logger.error('Batch context update error:', error);
    const duration = Date.now() - start;
    sendResponse({
      res, status: 500, error: 'Failed to update context',
      code: 'SERVER_ERROR',
      logger, method: 'POST', path, duration
    });
  }
});


export default router;
export { toApiDocument };
/**
 * @openapi
 * /documents/batch/updatemetadata:
 *   post:
 *     summary: Batch update metadata for multiple documents
 *     description: Add or remove metadata from multiple documents in a single operation
 *     tags: [Documents]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - document_ids
 *             properties:
 *               document_ids:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Document IDs to update (minimum 1)
 *               metadata_to_add:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Metadata IDs to add to all selected documents
 *               metadata_to_remove:
 *                 type: array
 *                 items:
 *                   type: integer
 *                 description: Metadata IDs to remove from all selected documents
 *     responses:
 *       200:
 *         description: Metadata updated successfully
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
// Batch metadata update route
router.post('/batch/updatemetadata', async (req, res) => {
  const start = Date.now();
  const path = '/documents/batch/updatemetadata';

  try {
    // Validate document_ids
    const docIdsCheck = validateIdArray({ req, res, field: 'document_ids', logger, path, start });
    if (!docIdsCheck.valid) return;
    const docIds = docIdsCheck.ids;

    const metadataToAddCheck = validateOptionalIdArray({ req, res, field: 'metadata_to_add', logger, path, start });
    if (!metadataToAddCheck.valid) return;
    const metadataToAdd = metadataToAddCheck.ids;

    const metadataToRemoveCheck = validateOptionalIdArray({ req, res, field: 'metadata_to_remove', logger, path, start });
    if (!metadataToRemoveCheck.valid) return;
    const metadataToRemove = metadataToRemoveCheck.ids;

    if (metadataToAdd.length === 0 && metadataToRemove.length === 0) {
      const duration = Date.now() - start;
      sendResponse({
        res, status: 400, error: 'Must provide metadata_to_add or metadata_to_remove', code: 'VALIDATION_ERROR',
        logger, method: 'POST', path, duration
      });
      return;
    }

    // Execute batch update via CRUD
    const result = batchUpdateDocumentMetadata(db, docIds, metadataToAdd, metadataToRemove);

    if (!result.success) {
      handleCrudResult({
        res, result,
        notFoundError: null,
        successStatus: 200,
        logger, method: 'POST', path, start
      });
      return;
    }

    const { docsUpdated, metadataAdded, metadataRemoved } = result.data;
    const duration = Date.now() - start;
    sendResponse({
      res, status: 200, data: {
        success: true,
        docs_updated: docsUpdated,
        metadata_added: metadataAdded,
        metadata_removed: metadataRemoved
      },
      logger, method: 'POST', path, duration
    });
  } catch (error) {
    logger.error('Batch metadata update error:', error);
    const duration = Date.now() - start;
    sendResponse({
      res, status: 500, error: 'Failed to update metadata',
      code: 'SERVER_ERROR',
      logger, method: 'POST', path, duration
    });
  }
});

