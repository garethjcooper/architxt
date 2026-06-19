import { Router } from 'express';
import { db } from '../db/connection.js';
import { stmt } from '../cache.js';
import { createLogger } from '../utils/logger.js';
import {
  handleGetById, 
  handleDeleteById, 
  handleCrudResult,
  sendResponse,
  validateId,
  validateRequiredString,
  validateEnum,
  validateBodyId,
  validateOptionalIdArray
} from '../utils/route-helpers.js';
import {
  getDirective,
  createDirective,
  updateDirective,
  deleteDirective,
  listDirectives,
  getDirectiveTags,
  addDirectiveTag,
  removeDirectiveTag,
  batchUpdateDirectiveTags
} from '../db/crud/directives.js';

const logger = createLogger('directives-route');
const router = Router();

const toApiTag = (dbRow) => ({
  id: dbRow.tag_id,
  name: dbRow.tag_name,
  generated_by: dbRow.tag_generated_by,
  created_at: dbRow.tag_created_at,
  updated_at: dbRow.tag_updated_at,
});

// DB → API name transform
const toApiDirective = (dbRow, tags = []) => ({
  id: dbRow.dir_id,
  ext_id: dbRow.dir_ext_id,
  name: dbRow.dir_name,
  statement: dbRow.dir_statement,
  is_active: dbRow.dir_is_active === 'true',
  priority: dbRow.dir_priority ?? 0,
  generated_by: dbRow.dir_generated_by,
  tags,
  created_at: dbRow.dir_created_at,
  updated_at: dbRow.dir_updated_at
});

/**
 * @openapi
 * /directives:
 *   get:
 *     summary: List directives
 *     description: Retrieve all directives
 *     tags: [Directives]
 *     responses:
 *       200:
 *         description: List of directives
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Directive'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();

  const result = await listDirectives(db, {
    limit: req.query.limit,
    offset: req.query.offset,
  });

  if (result.success && result.data.length > 0) {
    const dirIds = result.data.map((d) => d.dir_id);
    const placeholders = dirIds.map(() => '?').join(',');
    const tagRows = stmt(db, `
      SELECT dt.dir_id, t.* FROM tags t
      JOIN directive_tags dt ON t.tag_id = dt.tag_id
      WHERE dt.dir_id IN (${placeholders})
    `).all(...dirIds);
    const tagMap = new Map();
    for (const row of tagRows) {
      const list = tagMap.get(row.dir_id) || [];
      list.push(toApiTag(row));
      tagMap.set(row.dir_id, list);
    }
    result.data = result.data.map((d) => toApiDirective(d, tagMap.get(d.dir_id) || []));
  } else {
    result.data = result.data.map((d) => toApiDirective(d));
  }

  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data : null,
    logger,
    method: 'GET',
    path: '/directives',
    start
  });
});

/**
 * @openapi
 * /directives/{id}:
 *   get:
 *     summary: Get directive by ID
 *     description: Retrieve a single directive by its ID
 *     tags: [Directives]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Directive ID
 *     responses:
 *       200:
 *         description: Directive found
 *       400:
 *         description: Invalid directive ID
 *       404:
 *         description: Directive not found
 *       500:
 *         description: Server error
 */
router.get('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/directives/${req.params.id}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/directives', start });
  if (!idCheck.valid) return;

  const result = await getDirective(db, idCheck.id);

  if (!result.success) {
    return sendResponse({
      res,
      status: 500,
      error: result.error,
      code: result.code,
      logger,
      method: 'GET',
      path,
      start
    });
  }

  if (!result.data) {
    return sendResponse({
      res,
      status: 404,
      error: 'Directive not found',
      code: 'NOT_FOUND',
      logger,
      method: 'GET',
      path,
      start
    });
  }

  const tagsResult = await getDirectiveTags(db, idCheck.id);
  const tags = tagsResult.success ? tagsResult.data.map(toApiTag) : [];

  sendResponse({
    res,
    status: 200,
    data: toApiDirective(result.data, tags),
    logger,
    method: 'GET',
    path,
    start
  });
});

/**
 * @openapi
 * /directives:
 *   post:
 *     summary: Create directive
 *     description: Create a new directive with an external ID and statement
 *     tags: [Directives]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - statement
 *             properties:
 *               name:
 *                 type: string
 *               ext_id:
 *                 type: string
 *               statement:
 *                 type: string
 *               generated_by:
 *                 type: string
 *                 enum: [user, import]
 *                 default: user
 *     responses:
 *       201:
 *         description: Directive created
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
  const path = '/directives';

  const nameCheck = validateRequiredString({ req, res, field: 'name', logger, path, start });
  if (!nameCheck.valid) return;

  const statementCheck = validateRequiredString({ req, res, field: 'statement', logger, path, start });
  if (!statementCheck.valid) return;

  const sourceCheck = validateEnum({ req, res, field: 'generated_by', allowed: ['user', 'import'], defaultValue: 'user', logger, path, start });
  if (!sourceCheck.valid) return;

  const result = await createDirective(db, {
    dir_ext_id: req.body.ext_id ?? null,
    dir_name: nameCheck.value,
    dir_statement: statementCheck.value,
    dir_is_active: req.body.is_active,
    dir_priority: req.body.priority,
    dir_generated_by: sourceCheck.value
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
 * /directives/{id}:
 *   put:
 *     summary: Update directive
 *     description: Update a directive's external ID and statement
 *     tags: [Directives]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Directive ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               statement:
 *                 type: string
 *               is_active:
 *                 type: boolean
 *               priority:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Directive updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Directive not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/directives/${req.params.id}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/directives', start });
  if (!idCheck.valid) return;

  const result = await updateDirective(db, idCheck.id, {
    dir_name: req.body.name,
    dir_statement: req.body.statement,
    dir_is_active: req.body.is_active,
    dir_priority: req.body.priority
  });

  handleCrudResult({
    res,
    result,
    notFoundError: 'Directive not found',
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
 * /directives/{id}:
 *   delete:
 *     summary: Delete directive
 *     description: Delete a directive by ID
 *     tags: [Directives]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Directive ID
 *     responses:
 *       204:
 *         description: Deleted successfully
 *       400:
 *         description: Invalid directive ID
 *       404:
 *         description: Directive not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', handleDeleteById({
  db,
  crudFn: deleteDirective,
  resourceName: 'directive',
  logger,
  basePath: '/directives'
}));

/**
 * @openapi
 * /directives/{id}/tags:
 *   get:
 *     summary: Get tags associated with a directive
 *     tags: [Directives]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Directive ID
 *     responses:
 *       200:
 *         description: List of tags
 */
router.get('/:id/tags', async (req, res) => {
  const start = Date.now();
  const path = `/directives/${req.params.id}/tags`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/directives', start });
  if (!idCheck.valid) return;

  const result = await getDirectiveTags(db, idCheck.id);

  handleCrudResult({
    res,
    result,
    notFoundError: 'Directive not found',
    successStatus: 200,
    successData: result.success ? result.data.map(toApiTag) : null,
    logger,
    method: 'GET',
    path,
    start
  });
});

/**
 * @openapi
 * /directives/{id}/tags/add:
 *   post:
 *     summary: Add a tag to a directive
 *     tags: [Directives]
 */
router.post('/:id/tags/add', async (req, res) => {
  const start = Date.now();
  const path = `/directives/${req.params.id}/tags/add`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/directives', start });
  if (!idCheck.valid) return;

  const bodyIdCheck = validateBodyId({ req, res, field: 'tag_id', logger, path, start });
  if (!bodyIdCheck.valid) return;

  const result = await addDirectiveTag(db, idCheck.id, bodyIdCheck.id);

  handleCrudResult({
    res,
    result,
    notFoundError: 'Directive or tag not found',
    successStatus: 200,
    successData: result.data,
    logger,
    method: 'POST',
    path,
    start
  });
});

/**
 * @openapi
 * /directives/{id}/tags/remove:
 *   post:
 *     summary: Remove a tag from a directive
 *     tags: [Directives]
 */
router.post('/:id/tags/remove', async (req, res) => {
  const start = Date.now();
  const path = `/directives/${req.params.id}/tags/remove`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/directives', start });
  if (!idCheck.valid) return;

  const bodyIdCheck = validateBodyId({ req, res, field: 'tag_id', logger, path, start });
  if (!bodyIdCheck.valid) return;

  const result = await removeDirectiveTag(db, idCheck.id, bodyIdCheck.id);

  handleCrudResult({
    res,
    result,
    notFoundError: 'Directive or tag not found',
    successStatus: 200,
    successData: { success: result.data },
    logger,
    method: 'POST',
    path,
    start
  });
});

/**
 * @openapi
 * /directives/batch/updatetags:
 *   post:
 *     summary: Batch add/remove tags across directives
 *     tags: [Directives]
 */
router.post('/batch/updatetags', async (req, res) => {
  const start = Date.now();
  const path = '/directives/batch/updatetags';

  const dirIdsCheck = validateOptionalIdArray({ req, res, field: 'directive_ids', logger, path, start });
  if (!dirIdsCheck.valid) return;
  if (dirIdsCheck.ids.length === 0) {
    return sendResponse({
      res,
      status: 400,
      error: 'directive_ids is required',
      code: 'VALIDATION_ERROR',
      logger,
      method: 'POST',
      path,
      start
    });
  }

  const tagsToAddCheck = validateOptionalIdArray({ req, res, field: 'tags_to_add', logger, path, start });
  if (!tagsToAddCheck.valid) return;
  const tagsToAdd = tagsToAddCheck.ids;

  const tagsToRemoveCheck = validateOptionalIdArray({ req, res, field: 'tags_to_remove', logger, path, start });
  if (!tagsToRemoveCheck.valid) return;
  const tagsToRemove = tagsToRemoveCheck.ids;

  if (tagsToAdd.length === 0 && tagsToRemove.length === 0) {
    return sendResponse({
      res,
      status: 400,
      error: 'Must provide tags_to_add or tags_to_remove',
      code: 'VALIDATION_ERROR',
      logger,
      method: 'POST',
      path,
      start
    });
  }

  const result = await batchUpdateDirectiveTags(db, dirIdsCheck.ids, tagsToAdd, tagsToRemove);

  const { modelsUpdated, tagsAdded, tagsRemoved } = result.data;

  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: {
      directives_updated: modelsUpdated,
      tags_added: tagsAdded,
      tags_removed: tagsRemoved,
    },
    logger,
    method: 'POST',
    path,
    start
  });
});

export default router;
