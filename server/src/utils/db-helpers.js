// JSON field handling

export const fromJson = (row, fields) => {
  if (!row) return null;
  for (const f of fields) {
    if (row[f] && typeof row[f] === 'string') {
      try {
        row[f] = JSON.parse(row[f]);
      } catch {
        // leave as string if parse fails
      }
    }
  }
  return row;
};

export const toJson = (data, fields) => {
  const out = { ...data };
  for (const f of fields) {
    if (f in out && out[f] !== null && typeof out[f] !== 'string') {
      out[f] = JSON.stringify(out[f]);
    }
  }
  return out;
};

// Validation helpers - fail fast
export const requireInt = (name, value) => {
  const num = parseInt(value, 10);
  if (Number.isNaN(num)) {
    throw new TypeError(`${name} must be an integer, got: ${value}`);
  }
  return num;
};

export const requireString = (name, value) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string, got: ${value}`);
  }
  return value;
};

// Field validation - fail fast with standard messages
export const requireField = (data, field) => {
  const value = data[field];
  if (value === undefined || value === null || value === '') {
    throw new Error(`${field} is required`);
  }
  return value;
};

export const requireNonEmpty = (obj, name = 'fields') => {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    throw new Error(`No ${name} to update`);
  }
  return keys;
};

// Database error code mapping - abstracts SQLite specifics
export const DB_CODES = Object.freeze({
  DUPLICATE_KEY: 'SQLITE_CONSTRAINT_UNIQUE',
  FK_VIOLATION: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  NOT_NULL_VIOLATION: 'SQLITE_CONSTRAINT_NOTNULL',
  CHECK_VIOLATION: 'SQLITE_CONSTRAINT_CHECK'
});

// HTTP status mapping for route responses
export const HTTP_CODES = Object.freeze({
  DUPLICATE_KEY: 409,
  CONFLICT: 409,
  FK_VIOLATION: 422,
  NOT_NULL_VIOLATION: 400,
  CHECK_VIOLATION: 400,
  DATABASE_ERROR: 500,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNKNOWN_ERROR: 500
});

export const mapErrorToStatus = (code) => HTTP_CODES[code] || 500;

/**
 * Check if value is nullish (null, undefined, or false for DELETE not-found cases)
 * Single helper eliminates repetitive `data === null || data === undefined` checks
 */
export const isNullish = (value) => value === null || value === undefined || value === false;

// Centralized DB wrapper - returns { success, data?, error?, code? }
export const dbExec = (operation, context) => {
  try {
    const result = operation();
    return { success: true, data: result };
  } catch (err) {
    const code = Object.keys(DB_CODES).find(k => DB_CODES[k] === err.code)
      || Object.keys(HTTP_CODES).find(k => k === err.code)
      || 'DATABASE_ERROR';
    // Include full error details for debugging
    const errorDetail = err.code ? `[${err.code}] ${err.message}` : err.message;
    return {
      success: false,
      error: `${context}: ${errorDetail}`,
      code,
      // Include raw for advanced debugging
      raw: { sqliteCode: err.code, message: err.message }
    };
  }
};

// ============================================================================
// Document Processing History Helpers
// ============================================================================

/**
 * Create a history entry for document processing
 * 
 * @param {Object} params - Entry parameters
 * @param {string} params.from - Source status
 * @param {string} params.to - Target status
 * @param {boolean} params.success - Whether the transition succeeded
 * @param {string} [params.reason] - Optional reason (e.g., for release)
 * @param {string} [params.error] - Optional error message
 * @param {Object} [params.metrics] - Optional metrics object
 * @returns {Object} History entry
 */
export const createHistoryEntry = ({ from, to, success, reason, error, metrics }) => {
  const entry = {
    timestamp: new Date().toISOString(),
    from,
    to,
    success
  };

  if (reason) entry.reason = reason;
  if (error) entry.error = error;
  if (metrics) entry.metrics = metrics;

  return entry;
};

/**
 * Append a history entry to existing history array
 * 
 * @param {Array} [existingHistory] - Existing history array
 * @param {Object} entry - New history entry from createHistoryEntry
 * @returns {Array} New history array with entry appended
 */
export const appendHistoryEntry = (existingHistory, entry) => {
  return [...(existingHistory || []), entry];
};

/**
 * Build complete update data for a document status transition
 * Returns object with doc_status and doc_processing_history ready for updateDocument
 * 
 * @param {Object} params - Transition parameters
 * @param {string} params.newStatus - New document status
 * @param {Array} [params.existingHistory] - Existing history from docResult
 * @param {Object} params.entry - History entry from createHistoryEntry
 * @returns {Object} Data ready for updateDocument()
 */
export const buildStatusTransition = ({ newStatus, existingHistory, entry }) => {
  return {
    doc_status: newStatus,
    doc_processing_history: appendHistoryEntry(existingHistory, entry)
  };
};
