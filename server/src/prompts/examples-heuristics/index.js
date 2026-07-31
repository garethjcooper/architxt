import { createLogger } from '../../utils/logger.js';

const logger = createLogger('examples-heuristics');

/**
 * Anti-pattern exclusion examples — bank-agnostic items that should not be nodes.
 */
const DEFAULT_EXCLUDE_EXAMPLES = [
  'usage records',
  'invoice PDF',
  'pricing step',
  'validation routine',
  'customer data field',
  'monthly report',
  'batch job',
  'transformation step',
  'message queue entry',
  'dashboard widget',
  'UI page',
  'database table',
  'schema attribute',
  'event payload',
];

/**
 * top-n heuristic: pick the first N known entities of distinct types for the include list,
 * plus a fixed set of anti-pattern exclusions.
 *
 * @param {Array<{id: string, name: string, type?: string}>} entities
 * @param {number} [maxInclude=5]
 * @param {number} [maxExclude=6]
 * @returns {{include: string[], exclude: string[]}}
 */
export function topN(entities, maxInclude = 5, maxExclude = 6) {
  if (!Array.isArray(entities)) {
    logger.warn('top-n heuristic received non-array entities; returning empty examples');
    return { include: [], exclude: DEFAULT_EXCLUDE_EXAMPLES.slice(0, maxExclude) };
  }

  const seenTypes = new Set();
  const include = [];
  for (const ent of entities) {
    if (!ent || typeof ent.id !== 'string' || typeof ent.name !== 'string') continue;
    const type = ent.type || ent.id.split(':')[0] || 'unknown';
    if (seenTypes.has(type)) continue;
    seenTypes.add(type);
    include.push(`${ent.name} (${ent.id})`);
    if (include.length >= maxInclude) break;
  }

  const exclude = DEFAULT_EXCLUDE_EXAMPLES.slice(0, maxExclude);
  return { include, exclude };
}

/**
 * Registry of heuristic functions.
 */
const HEURISTICS = {
  'top-n': topN,
};

/**
 * Apply the named heuristic to the provided entities.
 * @param {string} name
 * @param {Array<{id: string, name: string, type?: string}>} entities
 * @returns {{include: string[], exclude: string[]}}
 */
export function applyHeuristic(name, entities) {
  const fn = HEURISTICS[name];
  if (!fn) {
    throw new Error(`Unknown examples heuristic: ${name}`);
  }
  return fn(entities);
}

export { DEFAULT_EXCLUDE_EXAMPLES };
