const VALID_UNITS = new Set(['m', 'h', 'd', 'w']);
const UNIT_MINUTES = {
  m: 1,
  h: 60,
  d: 60 * 24,
  w: 60 * 24 * 7,
};

const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = UNIT_MINUTES.w * 52; // ~ 1 year

/**
 * Default safe restrictions applied to any bank with mode === 'auto' that does
 * not explicitly override them. These prevent runaway provisioning.
 */
export const DEFAULT_AUTO_RESTRICTIONS = Object.freeze({
  import: Object.freeze({
    top_k_nodes: 100,
    min_weight: 0,
    exclude_patterns: [],
    include_patterns: [],
  }),
  deploy: Object.freeze({
    max_models_per_run: 50,
    allowed_model_types: Object.freeze(['entity-summary']),
    include_node_ids: [],
    exclude_node_ids: [],
  }),
});

/**
 * Parse a human duration string (e.g. "5m", "2h", "1d", "1w") into minutes.
 * Returns { success, minutes?, error? }.
 */
export function parseRefreshInterval(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return { success: false, error: 'refresh_interval must be a non-empty string like "5m", "2h", "1d", "1w"' };
  }

  const match = value.trim().match(/^(\d+)([mhdw])$/i);
  if (!match) {
    return { success: false, error: 'refresh_interval must match format like "5m", "2h", "1d", "1w"' };
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (!VALID_UNITS.has(unit)) {
    return { success: false, error: `refresh_interval unit must be one of: m, h, d, w` };
  }

  const minutes = amount * UNIT_MINUTES[unit];
  if (minutes < MIN_INTERVAL_MINUTES) {
    return { success: false, error: `refresh_interval must be at least ${MIN_INTERVAL_MINUTES} minute(s)` };
  }
  if (minutes > MAX_INTERVAL_MINUTES) {
    return { success: false, error: `refresh_interval must not exceed 52 weeks` };
  }

  return { success: true, minutes };
}

/**
 * Validate the contextual_graph_banks field for a server.
 * Expected shape: [
 *   { bank_id: string, mode: "manual" | "auto", refresh_interval?: string,
 *     restriction?: { import?: {...}, deploy?: {...} } }
 * ]
 *
 * Returns { success, data?, error? } where data is the normalized array.
 */
export function validateContextualGraphBanks(value) {
  if (value === undefined || value === null) {
    return { success: true, data: [] };
  }

  if (!Array.isArray(value)) {
    return { success: false, error: 'contextual_graph_banks must be an array' };
  }

  const seen = new Set();
  const normalized = [];

  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!entry || typeof entry !== 'object') {
      return { success: false, error: `contextual_graph_banks[${i}] must be an object` };
    }

    const { bank_id, mode, refresh_interval, restriction } = entry;

    if (typeof bank_id !== 'string' || bank_id.trim() === '') {
      return { success: false, error: `contextual_graph_banks[${i}].bank_id must be a non-empty string` };
    }

    const trimmedBankId = bank_id.trim();
    if (seen.has(trimmedBankId)) {
      return { success: false, error: `contextual_graph_banks[${i}].bank_id "${trimmedBankId}" is duplicated` };
    }
    seen.add(trimmedBankId);

    if (mode !== 'manual' && mode !== 'auto') {
      return { success: false, error: `contextual_graph_banks[${i}].mode must be "manual" or "auto"` };
    }

    const normalizedEntry = {
      bank_id: trimmedBankId,
      mode,
    };

    if (mode === 'auto') {
      if (refresh_interval === undefined || refresh_interval === null) {
        return { success: false, error: `contextual_graph_banks[${i}].refresh_interval is required when mode is "auto"` };
      }
      const parsed = parseRefreshInterval(refresh_interval);
      if (!parsed.success) {
        return { success: false, error: `contextual_graph_banks[${i}].refresh_interval: ${parsed.error}` };
      }
      normalizedEntry.refresh_interval = refresh_interval.trim().toLowerCase();
      normalizedEntry.refresh_interval_minutes = parsed.minutes;
    }

    const restrictionResult = validateRestriction(restriction);
    if (!restrictionResult.valid) {
      return { success: false, error: `contextual_graph_banks[${i}].restriction: ${restrictionResult.error}` };
    }
    normalizedEntry.restriction = restrictionResult.restriction;

    normalized.push(normalizedEntry);
  }

  return { success: true, data: normalized };
}

/**
 * Validate a restriction object.
 *
 * @param {Object} [restriction]
 * @returns {{valid: boolean, error?: string, restriction?: Object}}
 */
function validateRestriction(restriction) {
  const normalised = {
    import: {},
    deploy: {},
  };

  if (restriction == null) {
    return { valid: true, restriction: normalised };
  }
  if (typeof restriction !== 'object' || Array.isArray(restriction)) {
    return { valid: false, error: 'restriction must be an object' };
  }

  const imp = restriction.import || {};
  if (imp.top_k_nodes !== undefined) {
    const n = parsePositiveInt(imp.top_k_nodes);
    if (n === null) return { valid: false, error: 'import.top_k_nodes must be a positive integer' };
    normalised.import.top_k_nodes = n;
  }
  if (imp.min_weight !== undefined) {
    const n = parseNumber(imp.min_weight);
    if (n === null || n < 0) return { valid: false, error: 'import.min_weight must be a non-negative number' };
    normalised.import.min_weight = n;
  }
  normalised.import.exclude_patterns = parseStringArray(imp.exclude_patterns);
  normalised.import.include_patterns = parseStringArray(imp.include_patterns);

  const dep = restriction.deploy || {};
  if (dep.max_models_per_run !== undefined) {
    const n = parsePositiveInt(dep.max_models_per_run);
    if (n === null) return { valid: false, error: 'deploy.max_models_per_run must be a positive integer' };
    normalised.deploy.max_models_per_run = n;
  }
  if (dep.allowed_model_types !== undefined) {
    const types = parseStringArray(dep.allowed_model_types);
    const validTypes = new Set(['entity-summary', 'entity-capabilities', 'edge-ctx', 'discover']);
    for (const t of types) {
      if (!validTypes.has(t)) {
        return { valid: false, error: `deploy.allowed_model_types contains invalid type "${t}"` };
      }
    }
    normalised.deploy.allowed_model_types = types;
  }
  normalised.deploy.include_node_ids = parseStringArray(dep.include_node_ids);
  normalised.deploy.exclude_node_ids = parseStringArray(dep.exclude_node_ids);

  return { valid: true, restriction: normalised };
}

function parsePositiveInt(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value === 'string') {
    const n = parseInt(value, 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function parseNumber(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function parseStringArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((s) => typeof s === 'string' && s.trim() !== '').map((s) => s.trim());
  }
  if (typeof value === 'string') {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Merge user-provided restrictions with default auto-sync restrictions.
 *
 * @param {Object} bank
 * @returns {Object} resolved restriction object
 */
export function resolveRestrictions(bank) {
  const user = bank?.restriction || {};
  const defaults = bank?.mode === 'auto' ? DEFAULT_AUTO_RESTRICTIONS : { import: {}, deploy: {} };

  return {
    import: {
      ...defaults.import,
      ...user.import,
    },
    deploy: {
      ...defaults.deploy,
      ...user.deploy,
    },
  };
}

/**
 * Get the list of enabled bank IDs with their mode for display.
 */
export function getManagedBanks(serverRow) {
  if (!serverRow?.svr_contextual_graph_banks) return [];
  try {
    const parsed = typeof serverRow.svr_contextual_graph_banks === 'string'
      ? JSON.parse(serverRow.svr_contextual_graph_banks)
      : serverRow.svr_contextual_graph_banks;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Find auto-enabled banks for a server row.
 */
export function getAutoSyncBanks(serverRow) {
  return getManagedBanks(serverRow).filter((b) => b.mode === 'auto');
}
