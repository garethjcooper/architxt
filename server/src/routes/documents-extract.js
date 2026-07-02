import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { createHash } from 'crypto';
import { config } from '../config.js';
import { db } from '../db/connection.js';
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
  updateDocument
} from '../db/crud/documents.js';

const logger = createLogger('documents-extract-route');
const router = Router();

/**
 * @openapi
 * /documents/{id}/source:
 *   get:
 *     summary: Get original document source file
 *     description: Streams the original uploaded file for processing by daemon
 *     tags: [Documents]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: File stream
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Document or file not found
 */
router.get('/:id/source', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/source`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  const docResult = await getDocument(db, id);
  if (!docResult.success) {
    sendResponse({ res, status: 500, error: docResult.error, code: docResult.code, logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }
  if (isNullish(docResult.data)) {
    sendResponse({ res, status: 404, error: 'Document not found', code: 'NOT_FOUND', logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }

  const sourcePath = docResult.data.doc_source_path;
  if (!sourcePath) {
    sendResponse({ res, status: 404, error: 'Source path not found', code: 'SOURCE_NOT_FOUND', logger, method: 'GET', path: routePath, duration: Date.now() - start });
    return;
  }

  try {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(sourcePath)}"`);
    const fileStream = fs.createReadStream(sourcePath);
    fileStream.pipe(res);
    fileStream.on('error', (err) => {
      logger.error('Error streaming file', { id, error: err.message });
      if (!res.headersSent) {
        sendResponse({ res, status: 500, error: 'Failed to stream file', code: 'STREAM_ERROR', logger, method: 'GET', path: routePath, duration: Date.now() - start });
      }
    });
  } catch (err) {
    logger.error('Failed to stream source file', { id, error: err.message });
    sendResponse({ res, status: 500, error: 'Failed to stream source file', code: 'STREAM_ERROR', logger, method: 'GET', path: routePath, duration: Date.now() - start });
  }
});

/**
 * @openapi
 * /documents/{id}/extracted:
 *   post:
 *     summary: Report extraction result
 *     description: Daemon reports success or failure of processing
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
 *               - success
 *             properties:
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
router.post('/:id/extracted', async (req, res) => {
  const start = Date.now();
  const routePath = `/documents/${req.params.id}/extracted`;

  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: routePath, start });
  if (!idCheck.valid) return;
  const id = idCheck.id;

  // Extract markdown and images from request
  const { success, error: errorMsg, metrics, markdown, images = [], metadata = {}, errorDetails } = req.body || {};

  if (typeof success !== 'boolean') {
    sendResponse({ res, status: 400, error: 'success boolean required', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  // If successful, markdown is required
  if (success && typeof markdown !== 'string') {
    sendResponse({ res, status: 400, error: 'markdown string required when success=true', code: 'VALIDATION_ERROR', logger, method: 'POST', path: routePath, duration: Date.now() - start });
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

  if (docResult.data.doc_status !== 'processing_extract') {
    sendResponse({ res, status: 409, error: `Document in state '${docResult.data.doc_status}', expected 'processing_extract'`, code: 'STATE_CONFLICT', logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  const finalStatus = success ? 'processed_extract_success' : 'processed_extract_failed';
  
  // Build history entry
  const historyEntry = createHistoryEntry({
    from: 'processing_extract',
    to: finalStatus,
    success,
    error: errorMsg,
    metrics: {
      ...(metrics || {}),
      ...(!success ? { errorDetails: errorDetails || null } : {})
    }
  });

  let updateData = buildStatusTransition({ newStatus: finalStatus, existingHistory: docResult.data.doc_processing_history, entry: historyEntry });

  // If successful, save content and images
  if (success) {
    // Generate content hash
    const contentHash = createHash('sha256').update(markdown).digest('hex');
    
    // Save images to disk (same directory as source file for simplicity)
    const docDir = path.join(config.storage.path, String(id));
    const imagePaths = [];
    const imageErrors = [];
    
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      
      // Validate image data before writing
      if (!image.data || typeof image.data !== 'string') {
        logger.error('Invalid image data in extraction result', { 
          id, 
          imageIndex: i,
          hasData: !!image.data,
          dataType: typeof image.data 
        });
        imageErrors.push({ index: i, error: 'Missing or invalid data field' });
        continue; // Skip this image but continue with others
      }
      
      try {
        const imagePath = path.join(docDir, image.filename || `image-${i}.png`);
        await fsPromises.writeFile(imagePath, Buffer.from(image.data, 'base64'));
        imagePaths.push(imagePath);
      } catch (writeErr) {
        logger.error('Failed to write image file', { 
          id, 
          imageIndex: i, 
          filename: image.filename,
          error: writeErr.message 
        });
        imageErrors.push({ index: i, filename: image.filename, error: writeErr.message });
      }
    }
    
    // Log if any images failed but we still succeeded
    if (imageErrors.length > 0) {
      logger.warn('Some images failed to save', { id, total: images.length, failed: imageErrors.length, imageErrors });
    }
    
    // Update document with content, hash, and clear blocks (content changed externally)
    updateData = {
      ...updateData,
      doc_content: markdown,
      doc_content_hash: contentHash,
      doc_content_blocks: null
    };
    
    logger.info('Document extracted and saved', { id, contentLength: markdown.length, imageCount: images.length, hash: contentHash, imagePaths });
  }

  const updateResult = await updateDocument(db, id, updateData);
  if (!updateResult.success) {
    sendResponse({ res, status: 500, error: updateResult.error, code: updateResult.code, logger, method: 'POST', path: routePath, duration: Date.now() - start });
    return;
  }

  sendResponse({ res, status: 200, data: { id, status: finalStatus, success }, logger, method: 'POST', path: routePath, duration: Date.now() - start });
});

export default router;