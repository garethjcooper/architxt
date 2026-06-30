/**
 * Centralized route handler for CRUD operations
 * Reduces boilerplate: ID validation, logging, response formatting
 */

import { mapErrorToStatus, isNullish } from '../utils/db-helpers.js';

/**
 * Send response and log in one place
 * Single return path pattern - eliminates multiple return statements
 */
function findBadJsonValue(value, path = 'root') {
  if (value === undefined) return path;
  if (typeof value === 'function') return `${path} (function)`;
  if (typeof value === 'symbol') return `${path} (symbol)`;
  if (typeof value === 'bigint') return `${path} (bigint)`;
  if (Number.isNaN(value)) return `${path} (NaN)`;
  if (value === Infinity || value === -Infinity) return `${path} (Infinity)`;
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const found = findBadJsonValue(value[i], `${path}[${i}]`);
        if (found) return found;
      }
    } else {
      for (const key of Object.keys(value)) {
        const found = findBadJsonValue(value[key], `${path}.${key}`);
        if (found) return found;
      }
    }
  }
  return null;
}

export function makeJsonSafe(value) {
  if (value === undefined) return null;
  if (typeof value === 'function' || typeof value === 'symbol') return null;
  if (typeof value === 'bigint') return Number(value);
  if (Number.isNaN(value)) return null;
  if (value === Infinity || value === -Infinity) return null;
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map((v) => makeJsonSafe(v));
    }
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = makeJsonSafe(value[key]);
    }
    return out;
  }
  return value;
}

export const sendResponse = ({ res, status, data, error, code, logger, method, path, duration, extra = {} }) => {
  const message = error || `${method} ${path} ${status}`;
  const level = status >= 400 ? 'warn' : 'info';
  
  logger[level](message, {
    method,
    path,
    statusCode: status,
    durationMs: duration,
    ...(error && { error, code }),
    ...extra
  });
  
  if (error) {
    return res.status(status).json({ error, code });
  }

  const safeData = makeJsonSafe(data);

  try {
    JSON.stringify(safeData);
  } catch (err) {
    const badPath = findBadJsonValue(safeData);
    logger.error('Response data is not JSON serializable', { error: err.message, badPath });
    return res.status(500).json({ error: 'Internal server error: response serialization failed', code: 'SERIALIZATION_ERROR' });
  }

  return res.status(status).json(safeData);
};

/**
 * Validate integer ID parameter
 * Returns { valid: false, responseSent: true } if invalid (already sent error response)
 * Returns { valid: true, id: number } if valid
 */
export const validateId = ({ req, res, paramName = 'id', logger, path, start }) => {
  const rawId = req.params[paramName];
  const id = parseInt(rawId, 10);
  
  if (Number.isNaN(id)) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `Invalid ${paramName}: '${rawId}' is not a valid integer`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path: `${path}/${rawId}`,
      duration
    });
    return { valid: false };
  }
  
  return { valid: true, id };
};

/**
 * Validate required integer ID in request body (API field name: 'id')
 * Used for tag_id/meta_id payloads where API field is 'id'.
 * Returns { valid: false } if invalid (already sent error response)
 * Returns { valid: true, id: number } if valid
 */
export const validateBodyId = ({ req, res, field = 'id', logger, path, start }) => {
  const rawId = req.body[field];
  if (rawId === undefined || rawId === null) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `${field} is required`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration
    });
    return { valid: false };
  }

  const id = parseInt(rawId, 10);
  if (Number.isNaN(id)) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `${field} must be an integer`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration
    });
    return { valid: false };
  }

  return { valid: true, id };
};

/**
 * Validate an array of integer IDs from request body
 * Returns { valid: false } if invalid (already sent error response)
 * Returns { valid: true, ids: number[] } if valid
 */
export const validateIdArray = ({ req, res, field, logger, path, start }) => {
  const arr = req.body[field];

  if (!Array.isArray(arr) || arr.length === 0) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `${field} must be a non-empty array`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration
    });
    return { valid: false };
  }

  const ids = arr.map((raw) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid ID in ${field}: ${raw}`);
    }
    return parsed;
  });

  return { valid: true, ids };
};

/**
 * Validate an optional array of integer IDs from request body.
 * Returns { valid: true, ids: [] } if field is missing/null/undefined.
 * Returns { valid: false } if field is not an array or contains non-integer (response already sent).
 */
export const validateOptionalIdArray = ({ req, res, field, logger, path, start }) => {
  const arr = req.body[field];

  if (arr === undefined || arr === null) {
    return { valid: true, ids: [] };
  }

  if (!Array.isArray(arr)) {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `${field} must be an array`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration
    });
    return { valid: false };
  }

  const ids = arr.map((raw) => {
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Invalid ID in ${field}: ${raw}`);
    }
    return parsed;
  });

  return { valid: true, ids };
};

/**
 * Validate required string field
 * Returns { valid: false } if invalid (already sent response)
 * Returns { valid: true, value: trimmedString } if valid
 */
export const validateRequiredString = ({ req, res, field, logger, path, start }) => {
  const value = req.body[field];
  
  if (!value || typeof value !== 'string' || value.trim() === '') {
    const duration = Date.now() - start;
    sendResponse({
      res,
      status: 400,
      error: `${field} is required`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration
    });
    return { valid: false };
  }
  
  return { valid: true, value: value.trim() };
};

/**
 * Validate enum field
 */
export const validateEnum = ({ req, res, field, allowed, defaultValue, logger, path, start }) => {
  const value = req.body[field] ?? defaultValue;
  
  if (!value || !allowed.includes(value)) {
    const duration = Date.now() - start;
    const allowedStr = allowed.join(' or ');
    sendResponse({
      res,
      status: 400,
      error: `${field} must be ${allowedStr}`,
      code: 'VALIDATION_ERROR',
      logger,
      method: req.method,
      path,
      duration
    });
    return { valid: false };
  }
  
  return { valid: true, value };
};

/**
 * Handle CRUD result with single response point
 * Already sends response and returns nothing
 */
export const handleCrudResult = ({ res, result, notFoundError, successStatus, successData, logger, method, path, start }) => {
  const duration = Date.now() - start;
  
  // CRUD error
  if (!result.success) {
    const status = mapErrorToStatus(result.code);
    sendResponse({
      res,
      status,
      error: result.error,
      code: result.code,
      logger,
      method,
      path,
      duration
    });
    return;
  }
  
  // Not found (null, undefined, or false from DELETE)
  if (isNullish(result.data)) {
    sendResponse({
      res,
      status: 404,
      error: notFoundError,
      code: 'NOT_FOUND',
      logger,
      method,
      path,
      duration
    });
    return;
  }
  
  // Success
  sendResponse({
    res,
    status: successStatus,
    data: successData ?? result.data,
    logger,
    method,
    path,
    duration
  });
};

/**
 * Handle GET by ID route
 * @param {Object} options
 * @param {Object} options.db - Database connection (imported directly)
 * @param {Function} options.crudFn - CRUD function (getDocument, getContext, etc)
 * @param {string} options.resourceName - 'document', 'context' etc (for error messages)
 * @param {winston.Logger} options.logger - Logger instance
 * @param {string} options.basePath - '/documents', '/contexts' etc
 * @param {Function} options.transform - Optional transform function for result.data
 */
export const handleGetById = ({ db, crudFn, resourceName, logger, basePath, transform }) => {
  return async (req, res) => {
    const start = Date.now();
    const path = `${basePath}/${req.params.id}`;
    
    const idCheck = validateId({ req, res, paramName: 'id', logger, path: basePath, start });
    if (!idCheck.valid) return;
    
    const result = await crudFn(db, idCheck.id);
    
    handleCrudResult({
      res,
      result,
      notFoundError: `${resourceName.charAt(0).toUpperCase() + resourceName.slice(1)} not found`,
      successStatus: 200,
      successData: transform && result.data ? transform(result.data) : result.data,
      logger,
      method: req.method,
      path,
      start
    });
  };
};

/**
 * Handle DELETE by ID route
 * @param {Object} options
 * @param {Object} options.db - Database connection (imported directly)
 * @param {Function} options.crudFn - CRUD function (deleteDocument, deleteContext, etc)
 * @param {string} options.resourceName - Resource name for error messages
 * @param {winston.Logger} options.logger - Logger instance
 * @param {string} options.basePath - Base path for logging
 */
export const handleDeleteById = ({ db, crudFn, resourceName, logger, basePath }) => {
  return async (req, res) => {
    const start = Date.now();
    const path = `${basePath}/${req.params.id}`;
    
    const idCheck = validateId({ req, res, paramName: 'id', logger, path: basePath, start });
    if (!idCheck.valid) return;
    
    const result = await crudFn(db, idCheck.id);
    
    handleCrudResult({
      res,
      result,
      notFoundError: `${resourceName.charAt(0).toUpperCase() + resourceName.slice(1)} not found`,
      successStatus: 204,
      successData: null, // 204 sends empty body
      logger,
      method: req.method,
      path,
      start
    });
  };
};

/**
 * Simple timed CRUD call with logging
 * For cases where ID validation happens elsewhere (like POST, PUT)
 * @deprecated Use handleCrudResult instead for single-response pattern
 */
export const callCrudLogged = async ({ 
  crudFn, 
  args, 
  logger, 
  method, 
  path,
  db
}) => {
  const start = Date.now();
  const result = await crudFn(db, ...args);
  const duration = Date.now() - start;
  
  if (!result.success) {
    const statusCode = mapErrorToStatus(result.code);
    return { result, duration, statusCode };
  }
  
  return { result, duration, statusCode: 200 };
};
