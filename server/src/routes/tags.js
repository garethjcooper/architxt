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
  getTag,
  createTag,
  updateTag,
  deleteTag,
  listTags,
  getTagUsageCounts
} from '../db/crud/tags.js';

const logger = createLogger('tags-route');
const router = Router();

// DB → API name transform
const toApiTag = (dbRow) => ({
  id: dbRow.tag_id,
  name: dbRow.tag_name,
  generated_by: dbRow.tag_generated_by,
  usage_count: dbRow.usage_count || 0,
  created_at: dbRow.tag_created_at,
  updated_at: dbRow.tag_updated_at
});

/**
 * @openapi
 * /tags:
 *   get:
 *     summary: List tags
 *     description: Retrieve all tags with document usage count
 *     tags: [Tags]
 *     responses:
 *       200:
 *         description: List of tags
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Tag'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();

  const result = await listTags(db, {
    limit: req.query.limit,
    offset: req.query.offset,
  });

  // Add usage count (documents using each tag) via CRUD
  if (result.success && result.data.length > 0) {
    const tagIds = result.data.map((t) => t.tag_id);
    const countResult = await getTagUsageCounts(db, tagIds);
    if (countResult.success) {
      result.data = result.data.map((tag) => ({
        ...tag,
        usage_count: countResult.data.get(tag.tag_id) || 0,
      }));
    }
  }

  handleCrudResult({
    res,
    result,
    notFoundError: null, // list doesn't 404
    successStatus: 200,
    successData: result.success ? result.data.map(toApiTag) : null,
    logger,
    method: 'GET',
    path: '/tags',
    start
  });
});

/**
 * @openapi
 * /tags/{id}:
 *   get:
 *     summary: Get tag by ID
 *     description: Retrieve a single tag by its integer ID
 *     tags: [Tags]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Tag ID
 *     responses:
 *       200:
 *         description: Tag found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Tag'
 *       400:
 *         description: Invalid tag ID
 *       404:
 *         description: Tag not found
 *       500:
 *         description: Server error
 */
router.get('/:id', handleGetById({
  db,
  crudFn: getTag,
  resourceName: 'tag',
  logger,
  basePath: '/tags',
  transform: toApiTag
}));

/**
 * @openapi
 * /tags:
 *   post:
 *     summary: Create tag
 *     description: Create a new tag with a name
 *     tags: [Tags]
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
 *                 description: Tag name
 *               generated_by:
 *                 type: string
 *                 enum: [user, import]
 *                 default: user
 *     responses:
 *       201:
 *         description: Tag created
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
 *         description: Tag name already exists
 *       500:
 *         description: Server error
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const path = '/tags';
  
  // Validate fields (responses already sent if invalid)
  const nameCheck = validateRequiredString({ req, res, field: 'name', logger, path, start });
  if (!nameCheck.valid) return;
  
  const sourceCheck = validateEnum({ req, res, field: 'generated_by', allowed: ['user', 'import'], defaultValue: 'user', logger, path, start });
  if (!sourceCheck.valid) return;
  
  // CRUD
  const result = await createTag(db, {
    tag_name: nameCheck.value,
    tag_generated_by: sourceCheck.value
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
 * /tags/{id}:
 *   put:
 *     summary: Update tag name
 *     description: Update tag name only
 *     tags: [Tags]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Tag ID
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
 *     responses:
 *       200:
 *         description: Tag updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Tag not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/tags/${req.params.id}`;
  
  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/tags', start });
  if (!idCheck.valid) return;
  
  // Validate field
  const nameCheck = validateRequiredString({ req, res, field: 'name', logger, path, start });
  if (!nameCheck.valid) return;
  
  // CRUD
  const result = await updateTag(db, idCheck.id, { tag_name: nameCheck.value });
  
  handleCrudResult({
    res,
    result,
    notFoundError: 'Tag not found',
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
 * /tags/{id}:
 *   delete:
 *     summary: Delete tag
 *     description: Delete a tag by ID
 *     tags: [Tags]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Tag ID
 *     responses:
 *       204:
 *         description: Deleted successfully
 *       400:
 *         description: Invalid tag ID
 *       404:
 *         description: Tag not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', handleDeleteById({
  db,
  crudFn: deleteTag,
  resourceName: 'tag',
  logger,
  basePath: '/tags'
}));

export default router;
