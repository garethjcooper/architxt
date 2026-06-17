import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import {
  sendResponse,
  validateId,
  validateBodyId,
  validateRequiredString,
  validateOptionalIdArray,
  handleCrudResult,
  handleDeleteById,
} from '../utils/route-helpers.js';
import {
  createMentalModel,
  updateMentalModel,
  deleteMentalModel,
  getMentalModelWithRelations,
  listMentalModels,
  getMentalModelTags,
  addMentalModelTag,
  removeMentalModelTag,
  getMentalModelEntities,
  addMentalModelEntity,
  removeMentalModelEntity,
  batchUpdateMentalModelTags,
  batchUpdateMentalModelEntities,
  batchUpdateMentalModelConfig,
  validateEntityTemplateEligibility,
  deriveMentalModels,
  updateMentalModelEntityOverrides,
  deleteMentalModelEntityOverrides,
  batchUpdateMentalModelEntityOverrides,
  clearMentalModelEntityOverrides,
  normaliseRefreshMode,
  normaliseTagsMatchMode,
  normaliseMaxTokens,
  toDbBool,
  DEFAULT_MAX_TOKENS,
  DEFAULT_REFRESH_MODE,
  DEFAULT_TAGS_MATCH_MODE,
  DEFAULT_BOOL,
} from '../db/crud/mental-models.js';
const logger = createLogger('mental-models-route');
const router = Router();

/* ─────────── DB → API transforms ─────────── */

const toApiTag = (dbRow) => ({
  id: dbRow.tag_id,
  name: dbRow.tag_name,
  generated_by: dbRow.tag_generated_by,
  created_at: dbRow.tag_created_at,
  updated_at: dbRow.tag_updated_at,
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
  type_case_match: dbRow.type_case_match,
  generated_by: dbRow.ent_generated_by,
  created_at: dbRow.ent_created_at,
  updated_at: dbRow.ent_updated_at,
});

const toApiMentalModel = (dbRow) => ({
  id: dbRow.mm_id,
  ext_id: dbRow.mm_ext_id,
  name: dbRow.mm_name,
  source_query: dbRow.mm_source_query,
  refresh_after_consolidation: dbRow.mm_refresh_after_consolidation === 'true',
  refresh_mode: dbRow.mm_refresh_mode,
  exclude_all_mental_models: dbRow.mm_exclude_all_mental_models === 'true',
  exclude_mental_model_list: dbRow.mm_exclude_mental_model_list,
  max_tokens: dbRow.mm_max_tokens ?? DEFAULT_MAX_TOKENS,
  tags_match_mode: dbRow.mm_tags_match_mode ?? DEFAULT_TAGS_MATCH_MODE,
  is_template: dbRow.mm_is_template === 'true',
  tags: dbRow.mm_tags || [],
  entities: (dbRow.mm_entities || []).map((e) => ({
    ...e,
    overrides: e.overrides
      ? {
          refresh_mode: e.overrides.refresh_mode,
          refresh_after_consolidation:
            e.overrides.refresh_after_consolidation === null
              ? null
              : e.overrides.refresh_after_consolidation === 'true',
          exclude_all_mental_models:
            e.overrides.exclude_all_mental_models === null
              ? null
              : e.overrides.exclude_all_mental_models === 'true',
          max_tokens: e.overrides.max_tokens ?? null,
        }
      : undefined,
  })),
  created_at: dbRow.mm_created_at,
  updated_at: dbRow.mm_updated_at,
});

/**
 * @openapi
 * tags:
 *   name: MentalModels
 *   description: Mental model management
 */

/* ═══════════════════════════════════════════
   MENTAL MODELS
   ═══════════════════════════════════════════ */

/**
 * @openapi
 * /mentalmodels:
 *   get:
 *     summary: List all mental models
 *     tags: [MentalModels]
 *     responses:
 *       200:
 *         description: Array of mental models
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MentalModel'
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const result = await listMentalModels(db, { limit: Number(req.query.limit) || 1000, offset: Number(req.query.offset) || 0 });
  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiMentalModel) : null,
    logger,
    method: 'GET',
    path: '/mentalmodels',
    start,
  });
});

/**
 * @openapi
 * /mentalmodels/{id}:
 *   get:
 *     summary: Get a single mental model
 *     tags: [MentalModels]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Mental model found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MentalModel'
 *       404:
 *         description: Mental model not found
 */
router.get('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}`;
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;

  const result = await getMentalModelWithRelations(db, idCheck.id);

  if (!result || !result.success || !result.data) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 404, error: 'Mental model not found', code: 'NOT_FOUND', logger, method: 'GET', path, duration });
    return;
  }

  sendResponse({ res, status: 200, data: toApiMentalModel(result.data), logger, method: 'GET', path, duration: Date.now() - start });
});

/**
 * @openapi
 * /mentalmodels:
 *   post:
 *     summary: Create a new mental model
 *     tags: [MentalModels]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ext_id]
 *             properties:
 *               ext_id: { type: string, description: 'External unique identifier' }
 *               name: { type: string, nullable: true }
 *               source_query: { type: string, nullable: true }
 *               refresh_after_consolidation: { type: boolean, default: false }
 *               refresh_mode: { type: string, enum: ['full', 'delta'], default: 'full' }
 *               exclude_all_mental_models: { type: boolean, default: false }
 *               exclude_mental_model_list: { type: string, nullable: true }
 *               max_tokens: { type: integer, minimum: 1, maximum: 8192, default: 2048 }
 *               tags_match_mode: { type: string, enum: ['all_strict', 'any_strict', 'all', 'any'], default: 'all_strict' }
 *     responses:
 *       201:
 *         description: Mental model created
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
  const path = '/mentalmodels';

  const extIdCheck = validateRequiredString({ req, res, field: 'ext_id', logger, path, start });
  if (!extIdCheck.valid) return;

  const body = req.body;

  const entities = Array.isArray(body.entities) ? body.entities : [];
  const isTemplate = toDbBool(body.is_template);

  const eligibility = validateEntityTemplateEligibility({
    mm_is_template: isTemplate,
    mm_name: body.name,
    mm_ext_id: extIdCheck.value,
    mm_source_query: body.source_query,
  });

  if (!eligibility.valid) {
    const duration = Date.now() - start;
    return sendResponse({ res, status: 400, error: eligibility.error, code: eligibility.code, logger, method: 'POST', path, duration });
  }

  const result = await createMentalModel(db, {
    mm_ext_id: extIdCheck.value,
    mm_name: body.name ?? null,
    mm_source_query: body.source_query ?? null,
    mm_refresh_after_consolidation: toDbBool(body.refresh_after_consolidation) ?? DEFAULT_BOOL,
    mm_refresh_mode: normaliseRefreshMode(body.refresh_mode) ?? DEFAULT_REFRESH_MODE,
    mm_exclude_all_mental_models: toDbBool(body.exclude_all_mental_models) ?? DEFAULT_BOOL,
    mm_exclude_mental_model_list: body.exclude_mental_model_list ?? null,
    mm_tags_match_mode: normaliseTagsMatchMode(body.tags_match_mode) ?? DEFAULT_TAGS_MATCH_MODE,
    mm_is_template: isTemplate,
    mm_max_tokens: normaliseMaxTokens(body.max_tokens) ?? DEFAULT_MAX_TOKENS,
  });

  handleCrudResult({
    res, result, notFoundError: null, successStatus: 201,
    successData: result.success ? { id: result.data } : null,
    logger, method: 'POST', path, start,
  });
});

/**
 * @openapi
 * /mentalmodels/{id}:
 *   put:
 *     summary: Update a mental model
 *     tags: [MentalModels]
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
 *               ext_id: { type: string }
 *               name: { type: string, nullable: true }
 *               source_query: { type: string, nullable: true }
 *               refresh_after_consolidation: { type: boolean }
 *               refresh_mode: { type: string, enum: ['full', 'delta'] }
 *               exclude_all_mental_models: { type: boolean }
 *               exclude_mental_model_list: { type: string, nullable: true }
 *               max_tokens: { type: integer, minimum: 1, maximum: 8192 }
 *               tags_match_mode: { type: string, enum: ['all_strict', 'any_strict', 'all', 'any'] }
 *     responses:
 *       200:
 *         description: Mental model updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Mental model not found
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;

  if (Object.keys(req.body).length === 0) {
    return sendResponse({ res, status: 400, error: 'At least one field is required', code: 'VALIDATION_ERROR', logger, method: 'PUT', path, duration: Date.now() - start });
  }

  const body = req.body;
  const data = {
    mm_ext_id: body.ext_id,
    mm_name: body.name,
    mm_source_query: body.source_query,
  };

  if (body.is_template !== undefined) {
    data.mm_is_template = toDbBool(body.is_template);
  }

  // Validate template eligibility against the merged future state.
  if (data.mm_is_template === 'true') {
    const existing = await getMentalModelWithRelations(db, idCheck.id);
    const row = existing?.success ? existing.data : null;
    const eligibility = validateEntityTemplateEligibility({
      mm_is_template: data.mm_is_template,
      mm_name: data.mm_name ?? row?.mm_name ?? null,
      mm_ext_id: data.mm_ext_id ?? row?.mm_ext_id ?? null,
      mm_source_query: data.mm_source_query ?? row?.mm_source_query ?? null,
    });
    if (!eligibility.valid) {
      const duration = Date.now() - start;
      return sendResponse({ res, status: 400, error: eligibility.error, code: eligibility.code, logger, method: 'PUT', path, duration });
    }
  }

  if (body.refresh_after_consolidation !== undefined) {
    data.mm_refresh_after_consolidation = toDbBool(body.refresh_after_consolidation);
  }
  if (body.refresh_mode !== undefined) {
    data.mm_refresh_mode = normaliseRefreshMode(body.refresh_mode);
  }
  if (body.exclude_all_mental_models !== undefined) {
    data.mm_exclude_all_mental_models = toDbBool(body.exclude_all_mental_models);
  }
  if (body.exclude_mental_model_list !== undefined) {
    data.mm_exclude_mental_model_list = body.exclude_mental_model_list;
  }
  if (body.max_tokens !== undefined) {
    data.mm_max_tokens = normaliseMaxTokens(body.max_tokens);
  }
  if (body.tags_match_mode !== undefined) {
    data.mm_tags_match_mode = normaliseTagsMatchMode(body.tags_match_mode);
  }

  const result = await updateMentalModel(db, idCheck.id, data);

  // When template mode is disabled, clear all per-entity config overrides.
  // The entity associations themselves are managed separately and are left
  // intact; derived instances simply stop being generated.
  if (data.mm_is_template === 'false') {
    await clearMentalModelEntityOverrides(db, idCheck.id);
  }

  handleCrudResult({
    res, result, notFoundError: 'Mental model not found', successStatus: 200,
    successData: { success: true }, logger, method: 'PUT', path, start,
  });
});

router.delete('/:id', handleDeleteById({
  db, crudFn: deleteMentalModel, resourceName: 'mental model', logger, basePath: '/mentalmodels',
}));

/**
 * @openapi
 * /mentalmodels/{id}/derived:
 *   get:
 *     summary: Get derived mental models for an entity template
 *     tags: [MentalModels]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Array of derived mental models (empty if not a template)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/MentalModel'
 *       404:
 *         description: Mental model not found
 */
router.get('/:id/derived', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/derived`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;

  const result = await getMentalModelWithRelations(db, idCheck.id);

  if (!result || !result.success || !result.data) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 404, error: 'Mental model not found', code: 'NOT_FOUND', logger, method: 'GET', path, duration });
    return;
  }

  const template = toApiMentalModel(result.data);
  const derived = deriveMentalModels(template);
  sendResponse({ res, status: 200, data: derived, logger, method: 'GET', path, duration: Date.now() - start });
});

/**
 * @openapi
 * /mentalmodels/{id}/entities/{entity_id}/overrides:
 *   put:
 *     summary: Update per-entity config overrides for a derived mental model
 *     tags: [MentalModels]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: entity_id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh_mode: { type: string, enum: ['full', 'delta'] }
 *               refresh_after_consolidation: { type: boolean }
 *               exclude_all_mental_models: { type: boolean }
 *     responses:
 *       200:
 *         description: Overrides updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Mental model or entity association not found
 */
router.put('/:id/entities/:entity_id/overrides', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/entities/${req.params.entity_id}/overrides`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;
  const mmId = idCheck.id;

  const entityIdCheck = validateId({ req, res, paramName: 'entity_id', logger, path: `/mentalmodels/${mmId}/entities`, start });
  if (!entityIdCheck.valid) return;
  const entId = entityIdCheck.id;

  const body = req.body;
  const overrides = {};

  if (body.refresh_mode !== undefined && body.refresh_mode !== null) {
    overrides.refresh_mode = normaliseRefreshMode(body.refresh_mode);
  }
  if (body.refresh_after_consolidation !== undefined && body.refresh_after_consolidation !== null) {
    overrides.refresh_after_consolidation = body.refresh_after_consolidation === true;
  }
  if (body.exclude_all_mental_models !== undefined && body.exclude_all_mental_models !== null) {
    overrides.exclude_all_mental_models = body.exclude_all_mental_models === true;
  }
  if (body.max_tokens !== undefined && body.max_tokens !== null) {
    overrides.max_tokens = normaliseMaxTokens(body.max_tokens);
  }

  if (Object.keys(overrides).length === 0) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 400, error: 'At least one override field is required', code: 'VALIDATION_ERROR', logger, method: 'PUT', path, duration });
    return;
  }

  const result = await updateMentalModelEntityOverrides(db, mmId, entId, overrides);

  if (result === null) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 404, error: 'Entity association not found', code: 'NOT_FOUND', logger, method: 'PUT', path, duration });
    return;
  }

  sendResponse({ res, status: 200, data: { success: true }, logger, method: 'PUT', path, duration: Date.now() - start });
});

/**
 * @openapi
 * /mentalmodels/{id}/entities/{entity_id}/overrides:
 *   delete:
 *     summary: Clear per-entity config overrides
 *     tags: [MentalModels]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *       - in: path
 *         name: entity_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Overrides cleared
 *       404:
 *         description: Entity association not found
 */
router.delete('/:id/entities/:entity_id/overrides', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/entities/${req.params.entity_id}/overrides`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;
  const mmId = idCheck.id;

  const entityIdCheck = validateId({ req, res, paramName: 'entity_id', logger, path: `/mentalmodels/${mmId}/entities`, start });
  if (!entityIdCheck.valid) return;
  const entId = entityIdCheck.id;

  const ok = await deleteMentalModelEntityOverrides(db, mmId, entId);

  if (!ok) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 404, error: 'Entity association not found', code: 'NOT_FOUND', logger, method: 'DELETE', path, duration });
    return;
  }

  sendResponse({ res, status: 200, data: { success: true }, logger, method: 'DELETE', path, duration: Date.now() - start });
});

/**
 * @openapi
 * /mentalmodels/{id}/entities/overrides:
 *   put:
 *     summary: Batch update per-entity config overrides for selected derived mental models
 *     tags: [MentalModels]
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
 *               entity_ids:
 *                 type: array
 *                 items: { type: integer }
 *               overrides:
 *                 type: object
 *                 properties:
 *                   refresh_mode: { type: string, enum: ['full', 'delta'] }
 *                   refresh_after_consolidation: { type: boolean }
 *                   exclude_all_mental_models: { type: boolean }
 *     responses:
 *       200:
 *         description: Overrides updated
 *       400:
 *         description: Validation error
 */
router.put('/:id/entities/overrides', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/entities/overrides`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;
  const mmId = idCheck.id;

  const body = req.body;
  const entityIds = Array.isArray(body.entity_ids) ? body.entity_ids : [];
  if (entityIds.length === 0) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 400, error: 'entity_ids is required and must not be empty', code: 'VALIDATION_ERROR', logger, method: 'PUT', path, duration });
    return;
  }

  const overrides = {};
  if (body.overrides?.refresh_mode !== undefined) {
    overrides.refresh_mode = normaliseRefreshMode(body.overrides.refresh_mode);
  }
  if (body.overrides?.refresh_after_consolidation !== undefined) {
    overrides.refresh_after_consolidation = body.overrides.refresh_after_consolidation === true;
  }
  if (body.overrides?.exclude_all_mental_models !== undefined) {
    overrides.exclude_all_mental_models = body.overrides.exclude_all_mental_models === true;
  }
  if (body.overrides?.max_tokens !== undefined) {
    overrides.max_tokens = normaliseMaxTokens(body.overrides.max_tokens);
  }

  if (Object.keys(overrides).length === 0) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 400, error: 'At least one override field is required', code: 'VALIDATION_ERROR', logger, method: 'PUT', path, duration });
    return;
  }

  try {
    const result = await batchUpdateMentalModelEntityOverrides(db, mmId, entityIds, overrides);
    sendResponse({ res, status: 200, data: result, logger, method: 'PUT', path, duration: Date.now() - start });
  } catch (err) {
    const duration = Date.now() - start;
    sendResponse({ res, status: 400, error: err.message, code: 'VALIDATION_ERROR', logger, method: 'PUT', path, duration });
  }
});

/* ═══════════════════════════════════════════
   TAGS
   ═══════════════════════════════════════════ */

/**
 * @openapi
 * /mentalmodels/{id}/tags:
 *   get:
 *     summary: Get tags associated with a mental model
 *     tags: [MentalModels]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
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
 *         description: Mental model not found
 */
router.get('/:id/tags', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/tags`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;

  const result = await getMentalModelTags(db, idCheck.id);

  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiTag) : null,
    logger, method: 'GET', path, start,
  });
});

/**
 * @openapi
 * /mentalmodels/{id}/tags/add:
 *   post:
 *     summary: Add a tag to a mental model
 *     tags: [MentalModels]
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
 *             required: [id]
 *             properties:
 *               id: { type: integer, description: 'Tag ID to add' }
 *     responses:
 *       201:
 *         description: Tag added
 *       400:
 *         description: Validation error
 *       404:
 *         description: Mental model or tag not found
 */
router.post('/:id/tags/add', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/tags/add`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;
  const mmId = idCheck.id;

  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const tagId = bodyIdCheck.id;

  const result = await addMentalModelTag(db, mmId, tagId);

  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 201,
    successData: { mental_model_id: mmId, tag_id: tagId },
    logger, method: 'POST', path, start,
  });
});

/**
 * @openapi
 * /mentalmodels/{id}/tags/remove:
 *   post:
 *     summary: Remove a tag from a mental model
 *     tags: [MentalModels]
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
 *             required: [id]
 *             properties:
 *               id: { type: integer, description: 'Tag ID to remove' }
 *     responses:
 *       200:
 *         description: Tag removed
 *       400:
 *         description: Validation error
 *       404:
 *         description: Tag not associated with mental model
 */
router.post('/:id/tags/remove', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/tags/remove`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;
  const mmId = idCheck.id;

  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const tagId = bodyIdCheck.id;

  const result = await removeMentalModelTag(db, mmId, tagId);

  handleCrudResult({
    res, result,
    notFoundError: 'Tag not associated with mental model',
    successStatus: 200,
    successData: { success: true },
    logger, method: 'POST', path, start,
  });
});

/* ═══════════════════════════════════════════
   ENTITIES
   ═══════════════════════════════════════════ */

/**
 * @openapi
 * /mentalmodels/{id}/entities:
 *   get:
 *     summary: Get entities associated with a mental model
 *     tags: [MentalModels]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of entities
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Entity'
 *       404:
 *         description: Mental model not found
 */
router.get('/:id/entities', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/entities`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;

  const result = await getMentalModelEntities(db, idCheck.id);

  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiEntity) : null,
    logger, method: 'GET', path, start,
  });
});

/**
 * @openapi
 * /mentalmodels/{id}/entities/add:
 *   post:
 *     summary: Add an entity to a mental model
 *     tags: [MentalModels]
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
 *             required: [id]
 *             properties:
 *               id: { type: integer, description: 'Entity ID to add' }
 *     responses:
 *       201:
 *         description: Entity added
 *       400:
 *         description: Validation error
 *       404:
 *         description: Mental model or entity not found
 */
router.post('/:id/entities/add', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/entities/add`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;
  const mmId = idCheck.id;

  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const entId = bodyIdCheck.id;

  const result = await addMentalModelEntity(db, mmId, entId);

  handleCrudResult({
    res, result,
    notFoundError: null,
    successStatus: 201,
    successData: { mental_model_id: mmId, entity_id: entId },
    logger, method: 'POST', path, start,
  });
});

/**
 * @openapi
 * /mentalmodels/{id}/entities/remove:
 *   post:
 *     summary: Remove an entity from a mental model
 *     tags: [MentalModels]
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
 *             required: [id]
 *             properties:
 *               id: { type: integer, description: 'Entity ID to remove' }
 *     responses:
 *       200:
 *         description: Entity removed
 *       400:
 *         description: Validation error
 *       404:
 *         description: Entity not associated with mental model
 */
router.post('/:id/entities/remove', async (req, res) => {
  const start = Date.now();
  const path = `/mentalmodels/${req.params.id}/entities/remove`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/mentalmodels', start });
  if (!idCheck.valid) return;
  const mmId = idCheck.id;

  const bodyIdCheck = validateBodyId({ req, res, field: 'id', logger, path, start });
  if (!bodyIdCheck.valid) return;
  const entId = bodyIdCheck.id;

  const result = await removeMentalModelEntity(db, mmId, entId);

  handleCrudResult({
    res, result,
    notFoundError: 'Entity not associated with mental model',
    successStatus: 200,
    successData: { success: true },
    logger, method: 'POST', path, start,
  });
});

/* ═══════════════════════════════════════════
   BATCH
   ═══════════════════════════════════════════ */

/**
 * @openapi
 * /mentalmodels/batch/updatetags:
 *   post:
 *     summary: Batch add/remove tags across mental models
 *     tags: [MentalModels]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mental_model_ids]
 *             properties:
 *               mental_model_ids:
 *                 type: array
 *                 items: { type: integer }
 *               tags_to_add:
 *                 type: array
 *                 items: { type: integer }
 *               tags_to_remove:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: Batch update summary
 */
router.post('/batch/updatetags', async (req, res) => {
  const start = Date.now();
  const path = '/mentalmodels/batch/updatetags';

  const mmIdsCheck = validateOptionalIdArray({ req, res, field: 'mental_model_ids', logger, path, start });
  if (!mmIdsCheck.valid) return;
  const mmIds = mmIdsCheck.ids;

  if (mmIds.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'mental_model_ids must be a non-empty array', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const tagsToAddCheck = validateOptionalIdArray({ req, res, field: 'tags_to_add', logger, path, start });
  if (!tagsToAddCheck.valid) return;
  const tagsToAdd = tagsToAddCheck.ids;

  const tagsToRemoveCheck = validateOptionalIdArray({ req, res, field: 'tags_to_remove', logger, path, start });
  if (!tagsToRemoveCheck.valid) return;
  const tagsToRemove = tagsToRemoveCheck.ids;

  if (tagsToAdd.length === 0 && tagsToRemove.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'Must provide tags_to_add or tags_to_remove', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const result = await batchUpdateMentalModelTags(db, mmIds, tagsToAdd, tagsToRemove);

  if (!result.success) {
    handleCrudResult({ res, result, notFoundError: null, successStatus: 200, logger, method: 'POST', path, start });
    return;
  }

  const { modelsUpdated, tagsAdded, tagsRemoved } = result.data;
  const duration = Date.now() - start;
  sendResponse({
    res, status: 200, data: {
      success: true,
      models_updated: modelsUpdated,
      tags_added: tagsAdded,
      tags_removed: tagsRemoved,
    },
    logger, method: 'POST', path, duration,
  });
});

/**
 * @openapi
 * /mentalmodels/batch/updateentities:
 *   post:
 *     summary: Batch add/remove entities across mental models
 *     tags: [MentalModels]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mental_model_ids]
 *             properties:
 *               mental_model_ids:
 *                 type: array
 *                 items: { type: integer }
 *               entities_to_add:
 *                 type: array
 *                 items: { type: integer }
 *               entities_to_remove:
 *                 type: array
 *                 items: { type: integer }
 *     responses:
 *       200:
 *         description: Batch update summary
 */
router.post('/batch/updateentities', async (req, res) => {
  const start = Date.now();
  const path = '/mentalmodels/batch/updateentities';

  const mmIdsCheck = validateOptionalIdArray({ req, res, field: 'mental_model_ids', logger, path, start });
  if (!mmIdsCheck.valid) return;
  const mmIds = mmIdsCheck.ids;

  if (mmIds.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'mental_model_ids must be a non-empty array', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const entitiesToAddCheck = validateOptionalIdArray({ req, res, field: 'entities_to_add', logger, path, start });
  if (!entitiesToAddCheck.valid) return;
  const entitiesToAdd = entitiesToAddCheck.ids;

  const entitiesToRemoveCheck = validateOptionalIdArray({ req, res, field: 'entities_to_remove', logger, path, start });
  if (!entitiesToRemoveCheck.valid) return;
  const entitiesToRemove = entitiesToRemoveCheck.ids;

  if (entitiesToAdd.length === 0 && entitiesToRemove.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'Must provide entities_to_add or entities_to_remove', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const result = await batchUpdateMentalModelEntities(db, mmIds, entitiesToAdd, entitiesToRemove);

  if (!result.success) {
    handleCrudResult({ res, result, notFoundError: null, successStatus: 200, logger, method: 'POST', path, start });
    return;
  }

  const { modelsUpdated, entitiesAdded, entitiesRemoved } = result.data;
  const duration = Date.now() - start;
  sendResponse({
    res, status: 200, data: {
      success: true,
      models_updated: modelsUpdated,
      entities_added: entitiesAdded,
      entities_removed: entitiesRemoved,
    },
    logger, method: 'POST', path, duration,
  });
});

/**
 * @openapi
 * /mentalmodels/batch/updateconfig:
 *   post:
 *     summary: Batch update mental model configuration across mental models
 *     tags: [MentalModels]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mental_model_ids]
 *             properties:
 *               mental_model_ids:
 *                 type: array
 *                 items: { type: integer }
 *               refresh_mode:
 *                 type: string
 *                 enum: ['full', 'delta']
 *               refresh_after_consolidation:
 *                 type: boolean
 *               exclude_all_mental_models:
 *                 type: boolean
 *               max_tokens:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 8192
 *               tags_match_mode:
 *                 type: string
 *                 enum: ['all_strict', 'any_strict', 'all', 'any']
 *     responses:
 *       200:
 *         description: Batch update summary
 */
router.post('/batch/updateconfig', async (req, res) => {
  const start = Date.now();
  const path = '/mentalmodels/batch/updateconfig';

  const mmIdsCheck = validateOptionalIdArray({ req, res, field: 'mental_model_ids', logger, path, start });
  if (!mmIdsCheck.valid) return;
  const mmIds = mmIdsCheck.ids;

  if (mmIds.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'mental_model_ids must be a non-empty array', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const body = req.body;
  const config = {};

  if (body.refresh_mode !== undefined && body.refresh_mode !== null) {
    config.refresh_mode = normaliseRefreshMode(body.refresh_mode);
  }
  if (body.refresh_after_consolidation !== undefined && body.refresh_after_consolidation !== null) {
    config.refresh_after_consolidation = body.refresh_after_consolidation === true;
  }
  if (body.exclude_all_mental_models !== undefined && body.exclude_all_mental_models !== null) {
    config.exclude_all_mental_models = body.exclude_all_mental_models === true;
  }
  if (body.max_tokens !== undefined && body.max_tokens !== null) {
    config.max_tokens = normaliseMaxTokens(body.max_tokens);
  }
  if (body.tags_match_mode !== undefined && body.tags_match_mode !== null) {
    config.tags_match_mode = normaliseTagsMatchMode(body.tags_match_mode);
  }

  if (Object.keys(config).length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res, status: 400, error: 'At least one config field is required', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration,
    });
    return;
  }

  const result = await batchUpdateMentalModelConfig(db, mmIds, config);

  if (!result.success) {
    handleCrudResult({ res, result, notFoundError: null, successStatus: 200, logger, method: 'POST', path, start });
    return;
  }

  const { modelsUpdated, entitiesUpdated } = result.data;
  const duration = Date.now() - start;
  sendResponse({
    res, status: 200, data: {
      success: true,
      models_updated: modelsUpdated,
      entities_updated: entitiesUpdated,
    },
    logger, method: 'POST', path, duration,
  });
});

export default router;
