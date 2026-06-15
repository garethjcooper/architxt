import { Router } from 'express';
import { db } from '../db/connection.js';
import { createLogger } from '../utils/logger.js';
import { 
  handleGetById, 
  handleDeleteById, 
  sendResponse,
  validateId,
  validateRequiredString,
  handleCrudResult
} from '../utils/route-helpers.js';
import {
  getServer,
  createServer,
  updateServer,
  deleteServer,
  listServers
} from '../db/crud/servers.js';
import { listBanks } from '../services/hindsight/banks.js';

const logger = createLogger('servers-route');
const router = Router();

// DB → API name transform
const toApiServer = (dbRow) => ({
  id: dbRow.svr_id,
  base_url: dbRow.svr_base_url,
  name: dbRow.svr_name,
  api_key: dbRow.svr_api_key,
  api_version: dbRow.svr_api_version,
  created_at: dbRow.svr_created_at,
  updated_at: dbRow.svr_updated_at
});

/**
 * @openapi
 * /servers:
 *   get:
 *     summary: List servers
 *     description: Retrieve all servers
 *     tags: [Servers]
 *     responses:
 *       200:
 *         description: List of servers
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Server'
 *       500:
 *         description: Server error
 */
router.get('/', async (req, res) => {
  const start = Date.now();
  
  const result = await listServers(db);
  
  handleCrudResult({
    res,
    result,
    notFoundError: null,
    successStatus: 200,
    successData: result.success ? result.data.map(toApiServer) : null,
    logger,
    method: 'GET',
    path: '/servers',
    start
  });
});

/**
 * @openapi
 * /servers/{id}:
 *   get:
 *     summary: Get server by ID
 *     description: Retrieve a single server by its integer ID
 *     tags: [Servers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *     responses:
 *       200:
 *         description: Server found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Server'
 *       400:
 *         description: Invalid server ID
 *       404:
 *         description: Server not found
 *       500:
 *         description: Server error
 */
router.get('/:id', handleGetById({
  db,
  crudFn: getServer,
  resourceName: 'server',
  logger,
  basePath: '/servers',
  transform: toApiServer
}));

/**
 * @openapi
 * /servers:
 *   post:
 *     summary: Create server
 *     description: Create a new server configuration
 *     tags: [Servers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - base_url
 *             properties:
 *               base_url:
 *                 type: string
 *                 description: Server base URL
 *               name:
 *                 type: string
 *                 description: Server name
 *               api_key:
 *                 type: string
 *                 description: API key for server authentication
 *               api_version:
 *                 type: string
 *                 description: API version
 *     responses:
 *       201:
 *         description: Server created
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
  const path = '/servers';
  
  // Validate required field
  const urlCheck = validateRequiredString({ req, res, field: 'base_url', logger, path, start });
  if (!urlCheck.valid) return;
  
  // CRUD
  const result = await createServer(db, {
    svr_base_url: urlCheck.value,
    svr_name: req.body.name || null,
    svr_api_key: req.body.api_key || null,
    svr_api_version: req.body.api_version || null
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
 * /servers/{id}:
 *   put:
 *     summary: Update server
 *     description: Update server configuration
 *     tags: [Servers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               base_url:
 *                 type: string
 *               name:
 *                 type: string
 *               type:
 *                 type: string
 *               api_version:
 *                 type: string
 *     responses:
 *       200:
 *         description: Server updated
 *       400:
 *         description: Validation error
 *       404:
 *         description: Server not found
 *       500:
 *         description: Server error
 */
router.put('/:id', async (req, res) => {
  const start = Date.now();
  const path = `/servers/${req.params.id}`;
  
  // Validate ID
  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/servers', start });
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
  
  // CRUD
  const result = await updateServer(db, idCheck.id, {
    svr_base_url: req.body.base_url,
    svr_name: req.body.name,
    svr_api_key: req.body.api_key,
    svr_api_version: req.body.api_version
  });
  
  handleCrudResult({
    res,
    result,
    notFoundError: 'Server not found',
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
 * /servers/{id}:
 *   delete:
 *     summary: Delete server
 *     description: Delete a server by ID
 *     tags: [Servers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *     responses:
 *       204:
 *         description: Deleted successfully
 *       400:
 *         description: Invalid server ID
 *       404:
 *         description: Server not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', handleDeleteById({
  db,
  crudFn: deleteServer,
  resourceName: 'server',
  logger,
  basePath: '/servers'
}));

/**
 * @openapi
 * /servers/{id}/banks:
 *   get:
 *     summary: List memory banks on the remote Hindsight server
 *     description: Proxy a listBanks request to the remote server's Hindsight API.
 *     tags: [Servers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *     responses:
 *       200:
 *         description: List of banks from remote server
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 banks:
 *                   type: array
 *       400:
 *         description: Invalid server ID
 *       404:
 *         description: Server not found
 *       502:
 *         description: Remote server error
 *       500:
 *         description: Internal server error
 */
router.get('/:id/banks', async (req, res) => {
  const start = Date.now();
  const path = `/servers/${req.params.id}/banks`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/servers', start });
  if (!idCheck.valid) return;

  const result = await getServer(db, idCheck.id);
  if (!result.success || !result.data) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 404,
      error: 'Server not found',
      code: 'NOT_FOUND',
      logger,
      method: 'GET',
      path,
      duration
    });
    return;
  }

  const banksResult = await listBanks(idCheck.id);
  if (!banksResult.success) {
    const duration = Date.now() - start;
    const status = banksResult.error?.includes('404') ? 404 : (banksResult.error?.includes('timeout') ? 504 : 502);
    sendResponse({
      res,
      status,
      error: banksResult.error,
      code: status === 502 ? 'REMOTE_ERROR' : (status === 504 ? 'TIMEOUT' : 'NOT_FOUND'),
      logger,
      method: 'GET',
      path,
      duration
    });
    return;
  }

  const duration = Date.now() - start;
  sendResponse({
    res,
    status: 200,
    data: banksResult.banks || [],
    logger,
    method: 'GET',
    path,
    duration
  });
});

/**
 * @openapi
 * /servers/{id}/health:
 *   get:
 *     summary: Check server health
 *     description: Proxy a /health request to the remote server's base_url. Returns the remote health response or an error if unreachable.
 *     tags: [Servers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Server ID
 *     responses:
 *       200:
 *         description: Remote server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *       400:
 *         description: Invalid server ID
 *       404:
 *         description: Server not found
 *       502:
 *         description: Remote server is unreachable or returned an error
 *       500:
 *         description: Internal server error
 */
router.get('/:id/health', async (req, res) => {
  const start = Date.now();
  const path = `/servers/${req.params.id}/health`;

  const idCheck = validateId({ req, res, paramName: 'id', logger, path: '/servers', start });
  if (!idCheck.valid) return;

  const result = await getServer(db, idCheck.id);
  if (!result.success || !result.data) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 404,
      error: 'Server not found',
      code: 'NOT_FOUND',
      logger,
      method: 'GET',
      path,
      duration
    });
    return;
  }

  const server = toApiServer(result.data);

  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10000);

    const remoteRes = await fetch(`${server.base_url}/health`, {
      signal: controller.signal,
      headers: server.api_key ? { 'X-API-Key': server.api_key } : undefined,
    });
    clearTimeout(timeout);

    if (!remoteRes.ok) {
      const body = await remoteRes.text();
      const duration = Date.now() - start;
      sendResponse({
        res,
        status: 502,
        error: `Remote server returned ${remoteRes.status}: ${body || remoteRes.statusText}`,
        code: 'REMOTE_ERROR',
        logger,
        method: 'GET',
        path,
        duration
      });
      return;
    }

    const data = await remoteRes.json();
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 200,
      data,
      logger,
      method: 'GET',
      path,
      duration
    });
  } catch (err) {
    clearTimeout(timeout);
    const isTimeout = err.name === 'AbortError';
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 502,
      error: isTimeout ? 'Health check timed out after 10s' : `Could not reach server: ${err.message}`,
      code: isTimeout ? 'TIMEOUT' : 'CONNECTION_ERROR',
      logger,
      method: 'GET',
      path,
      duration
    });
  }
});

export default router;
