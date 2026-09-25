import {
  buildTag,
  findExistingEntityTags,
  scanForEntityMatches,
  stripEntityTags,
} from '@architxt/entity-matcher';
import { getActiveFormat } from '../../entity-tag-format.js';
import { listEntitiesForDetection } from '../../db/crud/entities.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('agent-entity-resolver');

/**
 * Resolve catalog entities mentioned in arbitrary text.
 *
 * This is deterministic, catalog-only, and lookup-only:
 *   - parses explicit [[Name (type:entity_id)]] tags
 *   - scans clean text against entity names + aliases
 *   - respects per-entity and per-type case/word-boundary rules
 *   - never creates or invents entities
 *
 * @param {Object} db
 * @param {string} text
 * @returns {Promise<{
 *   success: boolean,
 *   data?: Array<{
 *     db_id: number,
 *     entity_id: string,
 *     name: string,
 *     type_name: string,
 *     canonical_reference: string,
 *     matched_text: string,
 *     from_tag: boolean,
 *     ranges: Array<{start: number, end: number}>,
 *   }>,
 *   error?: string,
 *   code?: string,
 * }>}
 */
export async function resolveEntitiesFromText(db, text) {
  if (!text || typeof text !== 'string') {
    return { success: false, error: 'text must be a non-empty string', code: 'VALIDATION_ERROR' };
  }

  const entitiesResult = await listEntitiesForDetection(db);
  if (!entitiesResult.success) {
    return { success: false, error: entitiesResult.error, code: entitiesResult.code || 'DATABASE_ERROR' };
  }
  const entities = entitiesResult.data || [];
  if (entities.length === 0) {
    return { success: true, data: [] };
  }

  const format = {
    key: getActiveFormat().key,
    regexSource: getActiveFormat().regex.source,
    regexFlags: getActiveFormat().regex.flags,
    presentInIndicator: '[[',
  };

  try {
    const matches = scanForEntityMatches(format, entities, text);

    logger.info('Resolved entities from text', {
      entityCount: matches.length,
      fromTagCount: matches.filter((m) => m.fromTag).length,
      scannedCount: matches.filter((m) => !m.fromTag).length,
    });

    return { success: true, data: matches };
  } catch (err) {
    logger.error('resolveEntitiesFromText failed', { error: err.message, stack: err.stack });
    return { success: false, error: err.message || 'Entity resolution failed', code: 'RESOLVER_FAILED' };
  }
}

/**
 * Group raw entity matches by canonical entity id.
 * This produces the historical resolved-entity shape used by the UI and chat context.
 *
 * @param {Array} matches - Raw matches from scanForEntityMatches / resolveEntitiesFromText
 * @returns {Array<{id: number, db_id: number, entity_id: string, name: string, type_name: string, canonical_reference: string, matched_text: string, from_tag: boolean, ranges: Array<{start: number, end: number}>}>}
 */
export function groupResolvedEntities(matches) {
  if (!matches || matches.length === 0) return [];

  const format = {
    key: getActiveFormat().key,
    regexSource: getActiveFormat().regex.source,
    regexFlags: getActiveFormat().regex.flags,
    presentInIndicator: '[[',
  };
  const formatKey = format.key;

  const byEntity = new Map();
  for (const m of matches) {
    const entityId = m.dbId ?? m.id;
    const existing = byEntity.get(entityId);
    if (existing) {
      existing.ranges.push({ start: m.start, end: m.end });
      if (!m.fromTag && !existing.from_tag) {
        existing.matched_text = existing.matched_text || m.matchedText;
      }
      if (m.fromTag) {
        existing.from_tag = true;
        existing.matched_text = m.matchedText;
      }
    } else {
      byEntity.set(entityId, {
        id: entityId,
        db_id: entityId,
        entity_id: m.entity_id,
        name: m.name,
        type_name: m.type_name,
        canonical_reference: buildTag(m.name, m.name, m.entity_id, m.type_name, formatKey),
        matched_text: m.matchedText,
        from_tag: m.fromTag,
        ranges: [{ start: m.start, end: m.end }],
      });
    }
  }

  return Array.from(byEntity.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Convert raw entity matches to a de-duplicated list of canonical type:id refs.
 *
 * @param {Array} matches - Raw matches from resolveEntitiesFromText
 * @returns {string[]}
 */
export function toCanonicalEntityRefs(matches) {
  if (!matches || matches.length === 0) return [];
  return [...new Set(
    matches
      .filter((e) => e.entity_id && e.type_name)
      .map((e) => `${e.type_name}:${e.entity_id}`),
  )];
}

/**
 * Strip entity tags from text and return the clean plain text.
 * Useful when feeding content to LLMs that should not see bracket markup.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripEntityTagsFromText(text) {
  const format = getActiveFormat();
  return stripEntityTags(
    {
      key: format.key,
      regexSource: format.regex.source,
      regexFlags: format.regex.flags,
      presentInIndicator: '[[',
    },
    text || '',
  );
}

/**
 * Find explicit [[...]] references in text without scanning the catalog.
 *
 * @param {string} text
 * @returns {Array<{text: string, name: string, id?: string, start: number, end: number, isValid: boolean}>}
 */
export function findExplicitEntityReferences(text) {
  const format = getActiveFormat();
  return findExistingEntityTags(
    {
      key: format.key,
      regexSource: format.regex.source,
      regexFlags: format.regex.flags,
      presentInIndicator: '[[',
    },
    text || '',
  );
}

export default {
  resolveEntitiesFromText,
  stripEntityTagsFromText,
  findExplicitEntityReferences,
};
