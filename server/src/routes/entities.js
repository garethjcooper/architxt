import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import {
  handleDeleteById,
  sendResponse,
  validateId,
  validateBodyId,
  validateRequiredString,
  handleCrudResult
} from '../utils/route-helpers.js';
import {
  createEntityType,
  updateEntityType,
  deleteEntityType,
  getEntityType,
  listEntityTypes,
} from '../db/crud/entity-types.js';
import {
  createEntity,
  updateEntity,
  deleteEntity,
  getEntityWithType,
  listEntitiesWithType,
  getEntityUsageCounts
} from '../db/crud/entities.js';

const logger = createLogger('entities-route');
const router = Router();

/* ─────────── DB → API transforms ─────────── */

const toApiEntityType = (dbRow) => ({
  id: dbRow.et_id,
  type_name: dbRow.et_type_name,
  description: dbRow.et_description,
  id_label: dbRow.et_id_label,
  name_label: dbRow.et_name_label,
  case_match: dbRow.et_case_match,
  created_at: dbRow.et_created_at,
  updated_at: dbRow.et_updated_at,
});

const toApiEntity = (dbRow) => ({
  id: dbRow.ent_id,
  type_id: dbRow.ent_type_id,
  type_name: dbRow.et_type_name,
  entity_id: dbRow.ent_entity_id,
  name: dbRow.ent_name,
  description: dbRow.ent_description,
  aliases: dbRow.ent_aliases || [],
  case_match: dbRow.ent_case_match,
  type_case_match: dbRow.et_case_match,
  generated_by: dbRow.ent_generated_by,
  usage_count: dbRow.usage_count || 0,
  created_at: dbRow.ent_created_at,
  updated_at: dbRow.ent_updated_at,
});

/* ═══════════════════════════════════════════
   ENTITY TYPES
   ═══════════════════════════════════════════ */

/**
 * @openapi
 * /entities/types:
 *   get:
 *     summary: List all entity types
 *     tags: [Entities]
 *     responses:
 *       200:
 *         description: Array of entity types
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/EntityType'
 */
router.get('/types', async (req, res) => {
  const start = Date.now();
  const result = await listEntityTypes(db, { orderBy: 'et_type_name' });
  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiEntityType) : null,
    logger,
    method: 'GET',
    path: '/entity-types',
    start,
  });
});

/**
 * @openapi
 * /entities/types:
 *   post:
 *     summary: Create a new entity type
 *     tags: [Entities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type_name]
 *             properties:
 *               type_name: { type: string }
 *               description: { type: string }
 *               id_label: { type: string }
 *               name_label: { type: string }
 *               case_match: { type: string, enum: ['insensitive', 'sensitive'], default: 'insensitive', description: 'Case matching rule for entity scan' }
 *     responses:
 *       201:
 *         description: Entity type created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: integer }
 *       400:
 *         description: Validation error
 */
router.post('/types', async (req, res) => {
  const start = Date.now();
  const path = '/entity-types';

  const nameCheck = validateRequiredString({ req, res, field: 'type_name', logger, path, start });
  if (!nameCheck.valid) return;

  const result = await createEntityType(db, {
    type_name: nameCheck.value,
    description: req.body.description || null,
    id_label: req.body.id_label || null,
    name_label: req.body.name_label || null,
    case_match: req.body.case_match || 'insensitive',
  });

  handleCrudResult({
    res, result, notFoundError: null, successStatus: 201,
    successData: result.success ? { id: result.data } : null,
    logger, method: 'POST', path, start,
  });
});

/**
 * @openapi
 * /entities/types/{id}:
 *   put:
 *     summary: Update an entity type
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type_name: { type: string }
 *               description: { type: string }
 *               id_label: { type: string }
 *               name_label: { type: string }
 *               case_match: { type: string, enum: ['insensitive', 'sensitive'] }
 *     responses:
 *       200:
 *         description: Entity type updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Entity type not found
 */
router.put('/types/:id', async (req, res) => {
  const start = Date.now();
  const path = `/entity-types/${req.params.id}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/entity-types', start });
  if (!idCheck.valid) return;

  if (Object.keys(req.body).length === 0) {
    return sendResponse({ res, status: 400, error: 'At least one field is required', code: 'VALIDATION_ERROR', logger, method: 'PUT', path, duration: Date.now() - start });
  }

  const result = await updateEntityType(db, idCheck.id, {
    type_name: req.body.type_name,
    description: req.body.description,
    id_label: req.body.id_label,
    name_label: req.body.name_label,
    case_match: req.body.case_match,
  });

  handleCrudResult({
    res, result, notFoundError: 'Entity type not found', successStatus: 200,
    successData: { success: true }, logger, method: 'PUT', path, start,
  });
});

/**
 * @openapi
 * /entities/types/{id}:
 *   delete:
 *     summary: Delete an entity type
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Entity type deleted
 *       404:
 *         description: Entity type not found
 */
router.delete('/types/:id', handleDeleteById({
  db, crudFn: deleteEntityType, resourceName: 'entity type', logger, basePath: '/entity-types',
}));

/* ═══════════════════════════════════════════
   ENTITIES
   ═══════════════════════════════════════════ */

/**
 * @openapi
 * /entities:
 *   get:
 *     summary: List all entities
 *     tags: [Entities]
 *     responses:
 *       200:
 *         description: Array of entities with their type info
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Entity'
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const result = await listEntitiesWithType(db);

  // Add usage count (documents referencing each entity) in a single efficient query.
  // Entities are referenced via [[...]] tags in doc_content, not via a junction table.
  // We count documents whose content contains the entity_id in entity tag format.
  if (result.success && result.data.length > 0) {
    const entIds = result.data.map((e) => e.ent_entity_id);
    const countResult = await getEntityUsageCounts(db, entIds);
    if (countResult.success) {
      result.data = result.data.map((ent) => ({
        ...ent,
        usage_count: countResult.data.get(ent.ent_entity_id) || 0,
      }));
    }
  }

  handleCrudResult({
    res, result, notFoundError: null, successStatus: 200,
    successData: result.success ? result.data.map(toApiEntity) : null,
    logger, method: 'GET', path: '/entities', start,
  });
});

/**
 * @openapi
 * /entities/{id}:
 *   get:
 *     summary: Get a single entity by ID
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Entity found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Entity'
 *       404:
 *         description: Entity not found
 */
router.get('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/entities/${req.params.id}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/entities', start });
  if (!idCheck.valid) return;

  const result = await getEntityWithType(db, idCheck.id);

  if (!result || !result.success || !result.data) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 404, error: 'Entity not found', code: 'NOT_FOUND', logger, method: 'GET', path, duration });
    return;
  }

  sendResponse({ res, status: 200, data: toApiEntity(result.data), logger, method: 'GET', path, duration: Date.now() - start });
});

/**
 * @openapi
 * /entities:
 *   post:
 *     summary: Create a new entity
 *     tags: [Entities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type_id, entity_id, name]
 *             properties:
 *               type_id: { type: integer }
 *               entity_id: { type: string, description: 'External entity identifier (e.g. SYS-001)' }
 *               name: { type: string }
 *               description: { type: string }
 *               aliases: { type: array, items: { type: string } }
 *               generated_by: { type: string, enum: ['user', 'import'], default: 'user' }
 *               case_match: { type: string, enum: ['insensitive', 'sensitive'], default: 'insensitive', description: 'Case matching rule for entity scan' }
 *     responses:
 *       201:
 *         description: Entity created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: integer }
 *       400:
 *         description: Validation error
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const path = '/entities';

  const entityIdCheck = validateRequiredString({ req, res, field: 'entity_id', logger, path, start });
  if (!entityIdCheck.valid) return;

  const nameCheck = validateRequiredString({ req, res, field: 'name', logger, path, start });
  if (!nameCheck.valid) return;

  const typeIdCheck = validateBodyId({ req, res, field: 'type_id', logger, path, start });
  if (!typeIdCheck.valid) return;

  const result = await createEntity(db, {
    type_id: typeIdCheck.id,
    entity_id: entityIdCheck.value,
    name: nameCheck.value,
    description: req.body.description || null,
    aliases: Array.isArray(req.body.aliases) ? req.body.aliases : [],
    case_match: req.body.case_match || 'insensitive',
    generated_by: req.body.generated_by || 'user',
  });

  handleCrudResult({
    res, result, notFoundError: null, successStatus: 201,
    successData: result.success ? { id: result.data } : null,
    logger, method: 'POST', path, start,
  });
});

/**
 * @openapi
 * /entities/{id}:
 *   put:
 *     summary: Update an entity
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type_id: { type: integer }
 *               entity_id: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *               aliases: { type: array, items: { type: string } }
 *               generated_by: { type: string, enum: ['user', 'import'] }
 *               case_match: { type: string, enum: ['insensitive', 'sensitive'] }
 *     responses:
 *       200:
 *         description: Entity updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Entity not found
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/entities/${req.params.id}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/entities', start });
  if (!idCheck.valid) return;

  if (Object.keys(req.body).length === 0) {
    return sendResponse({ res, status: 400, error: 'At least one field is required', code: 'VALIDATION_ERROR', logger, method: 'PUT', path, duration: Date.now() - start });
  }

  const result = await updateEntity(db, idCheck.id, {
    type_id: req.body.type_id,
    entity_id: req.body.entity_id,
    name: req.body.name,
    description: req.body.description,
    aliases: req.body.aliases,
    case_match: req.body.case_match,
    generated_by: req.body.generated_by,
  });

  handleCrudResult({
    res, result, notFoundError: 'Entity not found', successStatus: 200,
    successData: { success: true }, logger, method: 'PUT', path, start,
  });
});

/**
 * @openapi
 * /entities/{id}:
 *   delete:
 *     summary: Delete an entity
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Entity deleted
 *       404:
 *         description: Entity not found
 */
router.delete('/:id', handleDeleteById({
  db, crudFn: deleteEntity, resourceName: 'entity', logger, basePath: '/entities',
}));

export default router;
