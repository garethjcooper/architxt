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
  getContext,
  createContext,
  updateContext,
  deleteContext,
  listContexts,
  getContextUsageCounts
} from '../db/crud/contexts.js';

const logger = createLogger('contexts-route');
const router = Router();

// DB → API name transform
const toApiContext = (dbRow) => ({
  id: dbRow.ctxt_id,
  description: dbRow.ctxt_desc,
  generated_by: dbRow.ctxt_generated_by,
  usage_count: dbRow.usage_count || 0,
  created_at: dbRow.ctxt_created_at,
  updated_at: dbRow.ctxt_updated_at
});

/**
 * @openapi
 * /contexts:
 *   get:
 *     summary: List contexts
 *     description: Retrieve all contexts
 *     tags: [Contexts]
 *     responses:
 *       200:
 *         description: List of contexts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Context'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();

  const result = await listContexts(db, {
    limit: req.query.limit,
    offset: req.query.offset,
  });

  // Add usage count (documents using each context) via CRUD
  if (result.success && result.data.length > 0) {
    const ctxIds = result.data.map((c) => c.ctxt_id);
    const countResult = await getContextUsageCounts(db, ctxIds);
    if (countResult.success) {
      result.data = result.data.map((ctx) => ({
        ...ctx,
        usage_count: countResult.data.get(ctx.ctxt_id) || 0,
      }));
    }
  }

  handleCrudResult({
    res,
    result,
    notFoundError: null, // list doesn't 404
    successStatus: 200,
    successData: result.success ? result.data.map(toApiContext) : null,
    logger,
    method: 'GET',
    path: '/contexts',
    start
  });
});

/**
 * @openapi
 * /contexts/{id}:
 *   get:
 *     summary: Get context by ID
 *     description: Retrieve a single context by its ID
 *     tags: [Contexts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Context ID
 *     responses:
 *       200:
 *         description: Context found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Context'
 *       400:
 *         description: Invalid context ID
 *       404:
 *         description: Context not found
 *       500:
 *         description: Server error
 */
router.get('/:id', handleGetById({
  db,
  crudFn: getContext,
  resourceName: 'context',
  logger,
  basePath: '/contexts',
  transform: toApiContext
}));

/**
 * @openapi
 * /contexts:
 *   post:
 *     summary: Create context
 *     description: Create a new context with description and source
 *     tags: [Contexts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *             properties:
 *               description:
 *                 type: string
 *               generated_by:
 *                 type: string
 *                 enum: [user, import]
 *                 default: user
 *     responses:
 *       201:
 *         description: Context created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const path = '/contexts';
  
  // Validate fields (responses already sent if invalid)
  const descCheck = validateRequiredString({ req, res, field: 'description', logger, path, start });
  if (!descCheck.valid) return;
  
  const sourceCheck = validateEnum({ req, res, field: 'generated_by', allowed: ['user', 'import'], defaultValue: 'user', logger, path, start });
  if (!sourceCheck.valid) return;
  
  // CRUD
  const result = await createContext(db, {
    ctxt_desc: descCheck.value,
    ctxt_generated_by: sourceCheck.value
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
 * /contexts/{id}:
 *   put:
 *     summary: Update context description
 *     description: Update context description only
 *     tags: [Contexts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Context ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *             properties:
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Context updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Context not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/contexts/${req.params.id}`;
  
  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/contexts', start });
  if (!idCheck.valid) return;
  
  // Validate field
  const descCheck = validateRequiredString({ req, res, field: 'description', logger, path, start });
  if (!descCheck.valid) return;
  
  // CRUD
  const result = await updateContext(db, idCheck.id, { ctxt_desc: descCheck.value });
  
  handleCrudResult({
    res,
    result,
    notFoundError: 'Context not found',
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
 * /contexts/{id}:
 *   delete:
 *     summary: Delete context
 *     description: Delete a context by ID
 *     tags: [Contexts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Context ID
 *     responses:
 *       204:
 *         description: Deleted successfully
 *       400:
 *         description: Invalid context ID
 *       404:
 *         description: Context not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', handleDeleteById({
  db,
  crudFn: deleteContext,
  resourceName: 'context',
  logger,
  basePath: '/contexts'
}));

export default router;
