import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { 
  handleGetById, 
  handleDeleteById, 
  sendResponse,
  validateId,
  validateRequiredString,
  validateEnum,
  handleCrudResult
} from '../utils/route-helpers.js';
import {
  getMetadata,
  createMetadata,
  updateMetadata,
  deleteMetadata,
  listMetadata,
  getMetadataUsageCounts
} from '../db/crud/metadata.js';

const logger = createLogger('metadata-route');
const router = Router();

// DB → API name transform
const toApiMetadata = (dbRow) => ({
  id: dbRow.meta_id,
  key: dbRow.meta_key,
  value: dbRow.meta_value,
  generated_by: dbRow.meta_generated_by,
  usage_count: dbRow.usage_count || 0,
  created_at: dbRow.meta_created_at,
  updated_at: dbRow.meta_updated_at
});

/**
 * @openapi
 * /metadata:
 *   get:
 *     summary: List metadata entries
 *     description: Retrieve all metadata entries
 *     tags: [Metadata]
 *     responses:
 *       200:
 *         description: List of metadata entries
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Metadata'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();

  const result = await listMetadata(db, {
    limit: req.query.limit,
    offset: req.query.offset,
  });

  // Add usage count (documents using each metadata entry) via CRUD
  if (result.success && result.data.length > 0) {
    const metaIds = result.data.map((m) => m.meta_id);
    const countResult = await getMetadataUsageCounts(db, metaIds);
    if (countResult.success) {
      result.data = result.data.map((meta) => ({
        ...meta,
        usage_count: countResult.data.get(meta.meta_id) || 0,
      }));
    }
  }

  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiMetadata) : null,
    logger,
    method: 'GET',
    path: '/metadata',
    start
  });
});

/**
 * @openapi
 * /metadata/{id}:
 *   get:
 *     summary: Get metadata entry by ID
 *     description: Retrieve a single metadata entry by its integer ID
 *     tags: [Metadata]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Metadata ID
 *     responses:
 *       200:
 *         description: Metadata entry found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Metadata'
 *       400:
 *         description: Invalid metadata ID
 *       404:
 *         description: Metadata not found
 *       500:
 *         description: Server error
 */
router.get('/:id', handleGetById({
  db,
  crudFn: getMetadata,
  resourceName: 'metadata',
  logger,
  basePath: '/metadata',
  transform: toApiMetadata
}));

/**
 * @openapi
 * /metadata:
 *   post:
 *     summary: Create metadata entry
 *     description: Create a new metadata key-value pair
 *     tags: [Metadata]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - key
 *             properties:
 *               key:
 *                 type: string
 *                 description: Metadata key
 *               value:
 *                 type: string
 *                 description: Metadata value
 *               generated_by:
 *                 type: string
 *                 enum: [user, import]
 *                 default: user
 *     responses:
 *       201:
 *         description: Metadata entry created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *       400:
 *         description: Validation error
 *       409:
 *         description: Metadata key already exists
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const path = '/metadata';
  
  // Validate required key field
  const keyCheck = validateRequiredString({ req, res, field: 'key', logger, path, start });
  if (!keyCheck.valid) return;
  
  // Validate generated_by enum
  const sourceCheck = validateEnum({ req, res, field: 'generated_by', allowed: ['user', 'import'], defaultValue: 'user', logger, path, start });
  if (!sourceCheck.valid) return;
  
  // CRUD
  const result = await createMetadata(db, {
    meta_key: keyCheck.value,
    meta_value: req.body.value || null,
    meta_generated_by: sourceCheck.value
  });
  
  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 201,
    successData: { id: result.data },
    logger,
    method: 'POST',
    path,
    start
  });
});

/**
 * @openapi
 * /metadata/{id}:
 *   put:
 *     summary: Update metadata entry
 *     description: Update metadata key, value, and/or generated_by
 *     tags: [Metadata]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Metadata ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               key:
 *                 type: string
 *               value:
 *                 type: string
 *               generated_by:
 *                 type: string
 *                 enum: [user, import]
 *     responses:
 *       200:
 *         description: Metadata updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Metadata not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/metadata/${req.params.id}`;
  
  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/metadata', start });
  if (!idCheck.valid) return;
  
  // Require at least one field
  if (Object.keys(req.body).length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: 'At least one field is required',
      code: 'VALIDATION_ERROR',
      logger,
      method: 'PUT',
      path,
      duration
    });
    return;
  }
  
  // CRUD - allow updating key, value, and generated_by
  const result = await updateMetadata(db, idCheck.id, {
    meta_key: req.body.key,
    meta_value: req.body.value,
    meta_generated_by: req.body.generated_by
  });
  
  handleCrudResult({
    res,
    result,
    notFoundError: 'Metadata not found',
    successStatus: 200,
    successData: { success: true },
    logger,
    method: 'PUT',
    path,
    start
  });
});

/**
 * @openapi
 * /metadata/{id}:
 *   delete:
 *     summary: Delete metadata entry
 *     description: Delete a metadata entry by ID
 *     tags: [Metadata]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Metadata ID
 *     responses:
 *       204:
 *         description: Deleted successfully
 *       400:
 *         description: Invalid metadata ID
 *       404:
 *         description: Metadata not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', handleDeleteById({
  db,
  crudFn: deleteMetadata,
  resourceName: 'metadata',
  logger,
  basePath: '/metadata'
}));

export default router;
