import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import {
  handleDeleteById,
  sendResponse,
  validateId,
  validateBodyId,
  validateRequiredString,
  validateOptionalIdArray,
  validateIdArray,
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
  getEntityUsageCounts,
  batchUpdateEntityConfig,
  getNextEntityIdForType,
  findDocumentsForEntities,
} from '../db/crud/entities.js';
import {
  buildEntityInfoMap,
  validateEntityInfoPayload,
} from '../services/entity-info.js';

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
  word_boundary_match: dbRow.et_word_boundary_match,
  uses_entity_id_pattern: dbRow.et_uses_entity_id_pattern === 1,
  id_format_prefix: dbRow.et_id_format_prefix,
  min_id_digits: dbRow.et_min_id_digits,
  id_separator: dbRow.et_id_separator ?? 'none',
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
  word_boundary_match: dbRow.ent_word_boundary_match,
  type_word_boundary_match: dbRow.et_word_boundary_match,
  type_uses_entity_id_pattern: dbRow.et_uses_entity_id_pattern === 1,
  type_id_format_prefix: dbRow.et_id_format_prefix,
  type_min_id_digits: dbRow.et_min_id_digits,
  type_id_separator: dbRow.et_id_separator ?? 'none',
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
 *               word_boundary_match: { type: string, enum: ['boundaries', 'no-boundaries'], default: 'boundaries', description: 'Word-boundary matching rule for entity scan' }
 *               uses_entity_id_pattern: { type: boolean, default: false, description: 'Whether entities of this type use a formatted entity id pattern' }
 *               id_format_prefix: { type: string, description: 'Alphanumeric prefix for formatted entity ids (e.g. APP)' }
 *               min_id_digits: { type: integer, default: 3, minimum: 1, maximum: 10, description: 'Minimum zero-padded digits in formatted entity ids' }
 *               id_separator: { type: string, enum: ['none', '-'], default: 'none', description: 'Separator between prefix and zero-padded entity id' }
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
    word_boundary_match: req.body.word_boundary_match || 'boundaries',
    uses_entity_id_pattern: req.body.uses_entity_id_pattern,
    id_format_prefix: req.body.id_format_prefix,
    min_id_digits: req.body.min_id_digits,
    id_separator: req.body.id_separator,
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
 *               word_boundary_match: { type: string, enum: ['boundaries', 'no-boundaries'] }
 *               uses_entity_id_pattern: { type: boolean, description: 'Whether entities of this type use a formatted entity id pattern' }
 *               id_format_prefix: { type: string, description: 'Alphanumeric prefix for formatted entity ids (e.g. APP)' }
 *               min_id_digits: { type: integer, minimum: 1, maximum: 10, description: 'Minimum zero-padded digits in formatted entity ids' }
 *               id_separator: { type: string, enum: ['none', '-'], description: 'Separator between prefix and zero-padded entity id' }
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
    word_boundary_match: req.body.word_boundary_match,
    uses_entity_id_pattern: req.body.uses_entity_id_pattern,
    id_format_prefix: req.body.id_format_prefix,
    min_id_digits: req.body.min_id_digits,
    id_separator: req.body.id_separator,
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

/**
 * @openapi
 * /entities/types/{id}/next-id:
 *   get:
 *     summary: Get the next formatted entity id for a type
 *     tags: [Entities]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Next entity id or null if the type has no pattern
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 next_entity_id: { type: string, nullable: true }
 *       404:
 *         description: Entity type not found
 */
router.get('/types/:id/next-id', async (req, res) => {
  const start = Date.now();
  const path = `/entity-types/${req.params.id}/next-id`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/entity-types', start });
  if (!idCheck.valid) return;

  const typeResult = await getEntityType(db, idCheck.id);
  if (!typeResult.success || !typeResult.data) {
    sendResponse({ res, status: 404, error: 'Entity type not found', code: 'NOT_FOUND', logger, method: 'GET', path, duration: Date.now() - start });
    return;
  }

  const nextIdResult = await getNextEntityIdForType(db, typeResult.data, { excludeEntityId: req.query.exclude_entity_id });
  const nextId = nextIdResult.success ? nextIdResult.data : null;
  sendResponse({ res, status: 200, data: { next_entity_id: nextId }, logger, method: 'GET', path, duration: Date.now() - start });
});

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
  // Add usage count (documents referencing each entity) in a single efficient query.
  // Uses the configured full-text document index to avoid full LIKE scans of doc_content.
  const start = Date.now();
  const listStart = Date.now();
  const result = await listEntitiesWithType(db);
  logger.info(`GET /entities listEntitiesWithType took ${Date.now() - listStart}ms`);

  if (result.success && result.data.length > 0) {
    const entIds = result.data.map((e) => e.ent_entity_id);
    const countStart = Date.now();
    const countResult = await getEntityUsageCounts(db, entIds);
    logger.info(`GET /entities getEntityUsageCounts took ${Date.now() - countStart}ms`);
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
 * /entities/info:
 *   post:
 *     summary: Consolidated discoverable info for one or more entities
 *     description: |
 *       Read-only aggregation that returns, for each requested entity id, the
 *       contextual graph node, catalog metadata, system contextual refs,
 *       user-defined template-derived models, plain mental models, and edge
 *       contexts between any pair of requested entities. Optionally fetches
 *       the current Hindsight content for each referenced mental model.
 *     tags: [Entities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [server_id, bank_id, entity_ids]
 *             properties:
 *               server_id:
 *                 type: integer
 *                 description: Server ID configured in Architxt
 *               bank_id:
 *                 type: string
 *                 description: Hindsight bank name
 *               entity_ids:
 *                 type: array
 *                 items: { type: string }
 *                 description: Contextual-graph node ids (e.g. "svc:SVC-005").
 *               include_content:
 *                 type: boolean
 *                 default: false
 *                 description: Fetch each mental model's content from Hindsight
 *     responses:
 *       200:
 *         description: Consolidated entity info map
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entities:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                 meta:
 *                   type: object
 *                 content:
 *                   type: object
 *                   nullable: true
 *       400:
 *         description: Validation error
 *       500:
 *         description: Internal error
 */
router.post('/info', async (req, res) => {
  const start = Date.now();
  const path = '/entities/info';

  const validation = validateEntityInfoPayload(req.body);
  if (!validation.valid) {
    sendResponse({
      res, status: 400, error: validation.error, code: validation.code,
      logger, method: 'POST', path, duration: Date.now() - start,
    });
    return;
  }

  const result = await buildEntityInfoMap(
    req.app.locals.db || db,
    validation.serverId,
    validation.bankId,
    validation.entityIds,
    { includeContent: validation.includeContent },
  );

  if (!result.success) {
    const status = result.code === 'VALIDATION_ERROR' ? 400 : 500;
    sendResponse({
      res, status, error: result.error, code: result.code || 'INTERNAL_ERROR',
      logger, method: 'POST', path, duration: Date.now() - start,
    });
    return;
  }

  sendResponse({
    res, status: 200, data: result.data, logger, method: 'POST', path,
    duration: Date.now() - start,
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
 *               word_boundary_match: { type: string, enum: ['boundaries', 'no-boundaries'], default: 'boundaries', description: 'Word-boundary matching rule for entity scan' }
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
    case_match: req.body.case_match,
    word_boundary_match: req.body.word_boundary_match,
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
 *               word_boundary_match: { type: string, enum: ['boundaries', 'no-boundaries'] }
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
    word_boundary_match: req.body.word_boundary_match,
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

/**
 * @openapi
 * /entities/batch/updateconfig:
 *   post:
 *     summary: Batch update entity configuration across entities
 *     tags: [Entities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity_ids]
 *             properties:
 *               entity_ids:
 *                 type: array
 *                 items: { type: integer }
 *               type_id:
 *                 type: integer
 *               case_match:
 *                 type: string
 *                 enum: ['insensitive', 'sensitive']
 *               word_boundary_match:
 *                 type: string
 *                 enum: ['boundaries', 'no-boundaries']
 *     responses:
 *       200:
 *         description: Batch update summary
 */
router.post('/batch/updateconfig', async (req, res) => {
  const start = Date.now();
  const path = '/entities/batch/updateconfig';

  const idsCheck = validateOptionalIdArray({ req, res, field: 'entity_ids', logger, path, start });
  if (!idsCheck.valid) return;
  const entityIds = idsCheck.ids;

  if (entityIds.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'entity_ids must be a non-empty array', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const config = {};
  if (req.body.type_id !== undefined && req.body.type_id !== null) {
    config.type_id = Number(req.body.type_id);
  }
  if (req.body.case_match !== undefined && req.body.case_match !== null) {
    config.case_match = req.body.case_match;
  }
  if (req.body.word_boundary_match !== undefined && req.body.word_boundary_match !== null) {
    config.word_boundary_match = req.body.word_boundary_match;
  }

  if (Object.keys(config).length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'At least one config field is required', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const result = await batchUpdateEntityConfig(db, entityIds, config);

  if (!result.success) {
    handleCrudResult({ res, result, notFoundError: null, successStatus: 200, logger, method: 'POST', path, start });
    return;
  }

  const { entitiesUpdated } = result.data;
  const duration = Date.now() - start;
  sendResponse({
    res, status: 200, data: { success: true, entities_updated: entitiesUpdated },
    logger, method: 'POST', path, duration,
  });
});

/**
 * @openapi
 * /entities/documents:
 *   post:
 *     summary: Find documents containing any of the provided entities
 *     description: Uses the full-text document index to return distinct documents whose content matches the entity ids, names, or aliases.
 *     tags: [Entities]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [entity_ids]
 *             properties:
 *               entity_ids:
 *                 type: array
 *                 items: { type: integer }
 *               limit:
 *                 type: integer
 *                 default: 1000
 *     responses:
 *       200:
 *         description: List of matching documents
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: integer }
 *                   ext_id: { type: string, nullable: true }
 */
router.post('/documents', async (req, res) => {
  const start = Date.now();
  const path = '/entities/documents';

  const idsCheck = validateIdArray({ req, res, field: 'entity_ids', logger, path, start });
  if (!idsCheck.valid) return;

  const limit = parseInt(req.body.limit, 10) || undefined;
  const result = await findDocumentsForEntities(db, idsCheck.ids, { limit });

  if (!result.success) {
    handleCrudResult({ res, result, notFoundError: null, successStatus: 200, logger, method: 'POST', path, start });
    return;
  }

  const docs = (result.data || []).map((d) => ({
    id: d.id ?? d.doc_id,
    ext_id: d.ext_id ?? d.doc_ext_id,
    filename: d.filename ?? d.doc_filename,
  }));
  sendResponse({
    res, status: 200, data: docs,
    logger, method: 'POST', path, duration: Date.now() - start,
  });
});

export default router;
