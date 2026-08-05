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
 * Expected shape: [{ bank_id: string, mode: "manual" | "auto", refresh_interval?: string }]
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

    const { bank_id, mode, refresh_interval } = entry;

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

    normalized.push(normalizedEntry);
  }

  return { success: true, data: normalized };
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
