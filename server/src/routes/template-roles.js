import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import {
  sendResponse,
  validateRequiredString,
  validateEnum,
  handleCrudResult,
} from '../utils/route-helpers.js';
import {
  listTemplateRoles,
  getTemplateRole,
  createTemplateRole,
  updateTemplateRole,
  deleteTemplateRole,
} from '../db/crud/template-roles.js';

const logger = createLogger('template-roles-route');
const router = Router();

const VALID_SCOPES = ['node', 'edge', 'seed', 'graph'];

const toApiRole = (dbRow) => ({
  role_id: dbRow.role_id,
  display_name: dbRow.display_name,
  derivation_scope: dbRow.derivation_scope,
  sort_order: dbRow.sort_order,
  is_system: dbRow.role_id?.startsWith('sys_') ?? false,
});

/**
 * @openapi
 * /template-roles:
 *   get:
 *     summary: List all template roles
 *     description: Retrieve system and custom template roles ordered by sort_order then role_id.
 *     tags: [TemplateRoles]
 *     responses:
 *       200:
 *         description: List of template roles
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  const result = await listTemplateRoles(db);

  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiRole) : null,
    logger,
    method: 'GET',
    path: '/template-roles',
    start,
  });
});

/**
 * @openapi
 * /template-roles:
 *   post:
 *     summary: Create a custom template role
 *     tags: [TemplateRoles]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role_id, display_name, derivation_scope]
 *             properties:
 *               role_id: { type: string }
 *               display_name: { type: string }
 *               derivation_scope: { type: string, enum: [node, edge, seed, graph] }
 *               sort_order: { type: integer, default: 1 }
 *     responses:
 *       201:
 *         description: Template role created
 */
router.post('/', async (req, res) => {
  const start = Date.now();
  const path = '/template-roles';

  const roleIdCheck = validateRequiredString({ req, res, field: 'role_id', logger, path, start });
  if (!roleIdCheck.valid) return;

  const displayNameCheck = validateRequiredString({ req, res, field: 'display_name', logger, path, start });
  if (!displayNameCheck.valid) return;

  const scopeCheck = validateEnum({ req, res, field: 'derivation_scope', allowed: VALID_SCOPES, logger, path, start });
  if (!scopeCheck.valid) return;

  const sortOrder = req.body.sort_order ?? 1;
  if (!Number.isInteger(sortOrder)) {
    return sendResponse({
      res, status: 400, error: 'sort_order must be an integer', code: 'VALIDATION_ERROR',
      logger, method: 'POST', path, duration: Date.now() - start,
    });
  }

  const result = await createTemplateRole(db, {
    role_id: roleIdCheck.value,
    display_name: displayNameCheck.value,
    derivation_scope: scopeCheck.value,
    sort_order: sortOrder,
  });

  handleCrudResult({
    res, result, notFoundError: null, successStatus: 201,
    successData: result.success ? { role_id: result.data } : null,
    logger, method: 'POST', path, start,
  });
});

/**
 * @openapi
 * /template-roles/{role_id}:
 *   patch:
 *     summary: Update editable fields of a template role
 *     tags: [TemplateRoles]
 *     parameters:
 *       - in: path
 *         name: role_id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               display_name: { type: string }
 *               derivation_scope: { type: string, enum: [node, edge, seed, graph] }
 *               sort_order: { type: integer }
 *     responses:
 *       200:
 *         description: Template role updated
 */
router.patch('/:role_id', async (req, res) => {
  const start = Date.now();
  const roleId = req.params.role_id;
  const path = `/template-roles/${roleId}`;

  const update = {};

  if (req.body.display_name !== undefined) {
    const check = validateRequiredString({ req, res, field: 'display_name', logger, path, start });
    if (!check.valid) return;
    update.display_name = check.value;
  }

  if (req.body.derivation_scope !== undefined) {
    const check = validateEnum({ req, res, field: 'derivation_scope', allowed: VALID_SCOPES, logger, path, start });
    if (!check.valid) return;
    update.derivation_scope = check.value;
  }

  if (req.body.sort_order !== undefined) {
    const order = req.body.sort_order;
    if (!Number.isInteger(order)) {
      return sendResponse({
        res, status: 400, error: 'sort_order must be an integer', code: 'VALIDATION_ERROR',
        logger, method: 'PATCH', path, duration: Date.now() - start,
      });
    }
    update.sort_order = order;
  }

  if (Object.keys(update).length === 0) {
    return sendResponse({
      res, status: 400, error: 'At least one field is required', code: 'VALIDATION_ERROR',
      logger, method: 'PATCH', path, duration: Date.now() - start,
    });
  }

  const result = await updateTemplateRole(db, roleId, update);

  handleCrudResult({
    res, result, notFoundError: 'Template role not found', successStatus: 200,
    successData: { success: true }, logger, method: 'PATCH', path, start,
  });
});

/**
 * @openapi
 * /template-roles/{role_id}:
 *   delete:
 *     summary: Delete a template role
 *     description: Deletion is blocked if the role is referenced by any mental model.
 *     tags: [TemplateRoles]
 *     parameters:
 *       - in: path
 *         name: role_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: Template role deleted
 */
router.delete('/:role_id', async (req, res) => {
  const start = Date.now();
  const roleId = req.params.role_id;
  const path = `/template-roles/${roleId}`;

  const result = await deleteTemplateRole(db, roleId);

  handleCrudResult({
    res, result, notFoundError: 'Template role not found', successStatus: 204,
    successData: null, logger, method: 'DELETE', path, start,
  });
});

export default router;
